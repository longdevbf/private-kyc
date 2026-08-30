// =====================================================================
// midnight-js providers backed by the real DUST-era wallet
// =====================================================================
// midnight-js 4.1.1 asks for two small interfaces:
//
//   WalletProvider    balanceTx(unbound, ttl?) -> FinalizedTransaction
//                     getCoinPublicKey()
//                     getEncryptionPublicKey()
//   MidnightProvider  submitTx(finalized) -> TransactionId
//
// `@midnight-ntwrk/wallet@5.0.0` does not implement them. It predates the
// NIGHT/DUST fee model entirely -- its dependency tree stops at zswap
// 4.0.0, it pulls in no ledger-v8, and `grep -c dust` over its type
// declarations returns zero. A transaction it balances cannot pay a fee on
// a network whose fees are denominated in DUST, which is every live
// network today.
//
// The facade from `@midnightntwrk/wallet-sdk` does implement the model, in
// three steps rather than one:
//
//   balanceUnboundTransaction   pick the coins, build a balancing tx
//   signRecipe                  sign any unshielded segments
//   finalizeRecipe              prove the balancing tx, bind, merge
//
// So this file is the adapter between the two shapes. It is deliberately
// thin: every decision it makes is stated here rather than buried.
// =====================================================================

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { inspect } from 'node:util';
import { performance } from 'node:perf_hooks';

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';

import type { OpenFacade } from './facade.js';
import type { NetworkConfig } from './network.js';
import { PROOF_SERVER } from './network.js';

/**
 * The facade's own default, read from its source rather than guessed:
 * `DEFAULT_TTL_MS = 60 * 60 * 1000` in wallet-sdk-facade/dist/index.js.
 * midnight-js may pass no ttl at all, and the facade's balancing entry
 * points require one, so the same default is reproduced here instead of
 * inventing a different number.
 */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export type ChainProviders = ReturnType<typeof buildProviders>;

/**
 * How long the proof server spent producing the call proof, and how long
 * balancing (which proves a second, separate transaction) took on top.
 *
 * This exists to answer a specific question honestly. The in-memory demo
 * reports circuit *execution* time because it generates no proof at all.
 * These numbers are the real thing, measured around the actual calls, so
 * the two can be shown side by side without either being mislabelled.
 */
export type ProvingTimings = {
  /** ms inside ProofProvider.proveTx — the contract call proof. */
  proveMs: number;
  /** ms inside balanceTx — coin selection plus proving the balancing tx. */
  balanceMs: number;
};

export function buildProviders(
  cfg: NetworkConfig,
  open: OpenFacade,
  opts: {
    managedDir: string;
    privateStateId: string;
    /** Encrypts the on-disk private state store. Never committed. */
    password: string;
    /** Called once per proving step, so callers can report real timings. */
    onTiming?: (t: Partial<ProvingTimings>) => void;
  },
) {
  const { wallet, keys, keystore, address } = open;

  const secretKeys = {
    shieldedSecretKeys: keys.shielded.keys,
    dustSecretKey: keys.dust.key,
  };

  // The unshielded keystore signs any unshielded segment the balancer
  // introduces. When a transaction has no unshielded segment this is a
  // no-op -- signUnboundTransaction walks the intents it finds -- so it is
  // applied unconditionally rather than guessed at per transaction.
  const signSegment = (payload: Uint8Array): ledger.Signature =>
    keystore.signData(payload) as unknown as ledger.Signature;

  const walletProvider = {
    /**
     * Balance, sign, prove, bind. The proving inside `finalizeRecipe` is
     * real work on the local proof server: it is proving the *balancing*
     * transaction, which is separate from the contract call proof that
     * midnight-js already obtained from the proofProvider.
     *
     * The explicit `signRecipe` here is required and is NOT the same
     * situation as the dust registration in register-dust.ts, which must
     * NOT sign again. `createDustActionTransaction` runs signRecipe as its
     * own step 5; `balanceUnboundTransaction` does not sign at all. Making
     * these two call sites look alike would break one of them.
     */
    async balanceTx(tx: unknown, ttl?: Date): Promise<ledger.FinalizedTransaction> {
      // performance.now(), not Date.now(): this measures a DURATION, and a
      // wall clock can step backwards mid-measurement. The first on-chain
      // run reported "-1142 ms proving" for exactly that reason.
      const started = performance.now();
      const deadline = ttl ?? new Date(Date.now() + DEFAULT_TTL_MS);
      const recipe = await wallet.balanceUnboundTransaction(tx as never, secretKeys, {
        ttl: deadline,
      });
      const signed = await wallet.signRecipe(recipe, signSegment);
      const finalized = await wallet.finalizeRecipe(signed);
      opts.onTiming?.({ balanceMs: Math.round(performance.now() - started) });
      return finalized;
    },

    getCoinPublicKey(): string {
      return keys.shielded.keys.coinPublicKey;
    },

    getEncryptionPublicKey(): string {
      return keys.shielded.keys.encryptionPublicKey;
    },
  };

  const midnightProvider = {
    /**
     * Submit, and survive the SDK dropping its own socket.
     *
     * One `PolkadotNodeClient` is built at `WalletFacade.init` and shared,
     * and several operations on it end with `ensuring(api.disconnect())`.
     * A finalizer belonging to some other operation can therefore close
     * the socket a submission is still using, which surfaces as
     * "disconnected ... 1000:: Normal Closure" — see RESEARCH.md §H.8.
     *
     * The retry resubmits the SAME finalized transaction rather than
     * rebuilding one. That is what makes it safe here: an identical
     * transaction cannot land twice, so a retry after a submission that
     * actually succeeded is rejected as a duplicate rather than deploying
     * a second contract. That case is treated as success, and the
     * identifier is taken from the transaction itself — the same value the
     * facade would have returned.
     */
    async submitTx(tx: ledger.FinalizedTransaction): Promise<string> {
      const identifier = () => String(tx.identifiers().at(-1));

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await wallet.submitTransaction(tx);
        } catch (e) {
          const text = inspect(e, { depth: 8 });

          // Already on the chain or already in the mempool. Not an error:
          // the transaction we were asked to submit is submitted.
          if (/already imported|AlreadyImported|already in pool|Duplicate/i.test(text)) {
            return identifier();
          }

          // The node SAW it and refused. Checked before the transport
          // patterns, and that order is load-bearing: a rejection's stack
          // runs through @polkadot/rpc-provider/ws, so the word "WebSocket"
          // appears in it and a transport-first test matches. Resubmitting
          // a refused transaction earns "1012: Transaction is temporarily
          // banned", which is what happened before this check existed.
          if (/Invalid Transaction|Custom error|temporarily banned|BalanceCheck|Overspend/i.test(text)) {
            throw e;
          }

          if (attempt === 3) throw e;
          if (!/disconnect|Normal Closure|ECONN|ETIMEDOUT|socket hang up/i.test(text)) throw e;

          await new Promise((r) => setTimeout(r, 4_000 * attempt));
        }
      }
      throw new Error('unreachable');
    },
  };

  const zkConfigProvider = new NodeZkConfigProvider<string>(opts.managedDir);

  // Wrapped rather than replaced: the real provider does the work, this
  // only records how long it took. Timing the whole callTx would fold
  // proving together with indexer round trips and block inclusion, which
  // are not proving time and must not be reported as such.
  const inner = httpClientProofProvider(PROOF_SERVER, zkConfigProvider);
  const proofProvider = {
    async proveTx(unprovenTx: never, config?: never) {
      const started = performance.now();
      const proven = await inner.proveTx(unprovenTx, config);
      opts.onTiming?.({ proveMs: Math.round(performance.now() - started) });
      return proven;
    },
  };

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: opts.privateStateId,
      accountId: address,
      privateStoragePasswordProvider: async () => opts.password,
    }),
    publicDataProvider: indexerPublicDataProvider(cfg.indexer, cfg.indexerWs),
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}
