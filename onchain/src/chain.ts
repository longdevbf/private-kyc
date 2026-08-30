// =====================================================================
// The lifecycle engine, driven against a real network
// =====================================================================
// This is the on-chain counterpart of `Sim` in engine.ts. Same four
// circuits, same private/public boundary, same witnesses -- but every
// call here produces a real zero-knowledge proof on the local proof
// server and a real transaction that a real network includes in a block.
//
// Two things differ from the simulator and both are consequences of
// being on a chain rather than in a process:
//
//   TIME     `asOf` is checked against the BLOCK's time, not a variable
//            we control. A presentation proved now and included three
//            minutes later is still inside the five-minute freshness
//            window; one included six minutes later is not. That is the
//            window doing its job, not a bug.
//
//   STATE    the Merkle path has to be rebuilt from the ledger state the
//            indexer reports, because there is no local tree. This is the
//            same "refresh path" the UI exposes, and it is why revoking
//            invalidates every holder's cached path.
//
// THE ISSUER IS STILL MOCKED. Deploying to a network changes nothing
// about that: `issueCredential` signs off on whatever attribute values it
// is handed. No real-world identity is verified anywhere in this repo.
// =====================================================================

import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  createCallTxOptions,
  createUnprovenCallTx,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import * as CompiledContract from '@midnight-ntwrk/compact-js/effect/CompiledContract';
import { convertFieldToBytes, type MerkleTreePath } from '@midnight-ntwrk/compact-runtime';

import {
  Contract,
  ledger as readLedger,
  pureCircuits,
  type Ledger,
} from '../managed/contract/index.js';
import { resolveNetwork, PROOF_SERVER, type NetworkConfig } from './network.js';
import { loadOrCreateSeed, ONCHAIN_ROOT } from './wallet.js';
import { openFacade, saveWalletCache, waitSynced, type OpenFacade } from './facade.js';
import { buildProviders, type ProvingTimings } from './providers.js';
import {
  FRESHNESS_WINDOW_SEC,
  nowSeconds,
  bytes32,
  blankPrivateState,
  leafFor,
  type Holder,
  type MockIssuer,
  type PredicateRequest,
  type PrivateState,
} from './engine.js';

export const PRIVATE_STATE_ID = 'credential-lifecycle';
const MANAGED = join(ONCHAIN_ROOT, 'managed');

// ---------------------------------------------------------------------
// Deployment records
// ---------------------------------------------------------------------

export type DeploymentRecord = {
  network: string;
  networkId: string;
  contractAddress: string;
  txId?: string;
  txHash?: string;
  blockHeight?: string;
  deployedAt: string;
  compiler: string;
  languageVersion: string;
  proofServer: string;
  node: string;
  indexer: string;
};

export function deploymentPath(network: string): string {
  return join(ONCHAIN_ROOT, 'deployments', `${network}.json`);
}

/**
 * Read the record written by deploy.ts. Absence is not an error worth
 * dressing up: it means nothing has been deployed to that network, and
 * every caller wants to say so plainly rather than guess an address.
 */
export function readDeployment(network: string): DeploymentRecord | null {
  const p = deploymentPath(network);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as DeploymentRecord;
}

// ---------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------

/** What a real transaction leaves behind, and what it cost in time. */
export type TxReceipt = {
  circuit: string;
  txId?: string;
  txHash?: string;
  blockHeight?: string;
  status?: string;
  /** Wall clock for the whole call: prove, balance, submit, await block. */
  totalMs: number;
  /** Time inside the proof server producing the call proof. */
  proveMs?: number;
  /** Time balancing, which proves a second transaction for the fee. */
  balanceMs?: number;
  /**
   * present() only: how old `asOf` was, IN SECONDS, by the time this
   * returned. The contract rejects anything older than the freshness
   * window, so this is the measured headroom -- the number that says
   * whether five minutes is the right window on a real chain.
   */
  asOfAgeSec?: number;
};

function receipt(circuit: string, res: any, totalMs: number, t: Partial<ProvingTimings>): TxReceipt {
  const pub = res?.public ?? {};
  return {
    circuit,
    txId: pub.txId,
    txHash: pub.txHash,
    blockHeight: pub.blockHeight === undefined ? undefined : String(pub.blockHeight),
    status: pub.status,
    totalMs,
    proveMs: t.proveMs,
    balanceMs: t.balanceMs,
  };
}

// ---------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------

export type ChainClientOptions = {
  /** Defaults to the deployment record's address for this network. */
  contractAddress?: string;
  /** Encrypts the local private state store. */
  password?: string;
  quiet?: boolean;
};

export class ChainClient {
  private constructor(
    readonly cfg: NetworkConfig,
    readonly contractAddress: string,
    readonly walletAddress: string,
    private readonly open: OpenFacade,
    private readonly providers: any,
    private readonly deployed: any,
    private readonly compiledContract: any,
    private readonly timings: { current: Partial<ProvingTimings> },
  ) {}

  static async connect(
    networkName: string,
    opts: ChainClientOptions = {},
  ): Promise<ChainClient> {
    const cfg = resolveNetwork(networkName);

    const record = readDeployment(cfg.name);
    const contractAddress = opts.contractAddress ?? record?.contractAddress;
    if (!contractAddress) {
      throw new Error(
        `nothing deployed to ${cfg.name}: ${deploymentPath(cfg.name)} does not exist.\n` +
          `Deploy first:  npx tsx src/deploy.ts ${cfg.name}`,
      );
    }

    const proofUp = await fetch(PROOF_SERVER)
      .then((r) => r.status)
      .catch(() => 0);
    if (proofUp === 0) {
      throw new Error(
        `no proof server answering at ${PROOF_SERVER}. Start one: bash scripts/proof-server.sh start`,
      );
    }

    setNetworkId(cfg.networkId);

    const seed = loadOrCreateSeed(cfg.name);
    const open = await openFacade(cfg, seed, { quiet: opts.quiet });
    await waitSynced(open, { quiet: opts.quiet });
    await saveWalletCache(cfg, open);

    // One mutable slot the provider hooks write into. Each call reads and
    // clears it, so a receipt reports its own proving time and not the
    // previous call's.
    const timings = { current: {} as Partial<ProvingTimings> };

    const providers = buildProviders(cfg, open, {
      managedDir: MANAGED,
      privateStateId: PRIVATE_STATE_ID,
      password:
        opts.password ??
        process.env.MIDNIGHT_PRIVATE_STATE_PASSWORD ??
        'Demo-Credential-Lifecycle-2026!',
      onTiming: (t) => Object.assign(timings.current, t),
    });

    // Same widening as in deploy.ts, and for the same reason: the Effect
    // builder's conditional types collapse to `never` once the pipeline
    // head is widened at all.
    const make = CompiledContract.make as unknown as (t: string, c: unknown) => unknown;
    const withWitnesses = CompiledContract.withWitnesses as unknown as (
      s: unknown,
      w: unknown,
    ) => unknown;
    const withAssets = CompiledContract.withCompiledFileAssets as unknown as (
      s: unknown,
      p: string,
    ) => unknown;

    const witnesses = {
      localSecret: (ctx: any) => [ctx.privateState, ctx.privateState.localSecret],
      issuerSecret: (ctx: any) => [ctx.privateState, ctx.privateState.issuerSecret],
      attributes: (ctx: any) => [ctx.privateState, ctx.privateState.attributes],
      blinding: (ctx: any) => [ctx.privateState, ctx.privateState.blinding],
      merklePath: (ctx: any) => [ctx.privateState, ctx.privateState.merklePath],
    };

    const compiledContract = withAssets(
      withWitnesses(make(PRIVATE_STATE_ID, Contract), witnesses),
      MANAGED,
    );

    const deployed = await findDeployedContract(providers as any, {
      compiledContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: blankPrivateState(),
    } as any);

    return new ChainClient(
      cfg,
      contractAddress,
      open.address,
      open,
      providers,
      deployed,
      compiledContract,
      timings,
    );
  }

  // ---- reading public state ------------------------------------------

  /** The contract's public ledger state, as the indexer reports it. */
  async ledger(): Promise<Ledger> {
    const state = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress,
    );
    if (state === null) {
      throw new Error(`no contract state at ${this.contractAddress}`);
    }
    return readLedger(state.data);
  }

  /** The current epoch encoded exactly as the contract's nullifierFor does. */
  async epochBytes(): Promise<Uint8Array> {
    const l = await this.ledger();
    return convertFieldToBytes(32, l.revocationEpoch, 'epochBytes');
  }

  /**
   * The nullifier a holder will produce at a given verifier this epoch.
   *
   * Computable only by someone holding the holder's secret, which is the
   * whole point: two verifiers each see one of these and cannot tell they
   * describe the same person. Predicting it locally lets the UI show the
   * value before the transaction lands, and check it against what actually
   * appears in `spentNullifiers` afterwards.
   */
  async expectedNullifier(holder: Holder, verifierId: Uint8Array): Promise<Uint8Array> {
    return pureCircuits.nullifierAt(holder.secret, verifierId, await this.epochBytes());
  }

  /**
   * Rebuild a holder's Merkle path from current on-chain state. This is
   * the "refresh path" action, and it has to be redone after every
   * revocation because revoking calls resetHistory().
   */
  async path(leaf: Uint8Array): Promise<MerkleTreePath<Uint8Array>> {
    const l = await this.ledger();
    const p = l.activeCredentials.findPathForLeaf(leaf);
    if (p === undefined) throw new Error('leaf not present in the active set');
    return p;
  }

  // ---- writing: every one of these is a real transaction --------------

  private async submit(
    circuit: string,
    ps: PrivateState,
    ...args: unknown[]
  ): Promise<TxReceipt> {
    // The witnesses read from whatever is stored under the private state
    // id, so the caller's secrets go in immediately before the call. This
    // is the on-chain equivalent of passing a private state to Sim.call.
    await this.providers.privateStateProvider.set(PRIVATE_STATE_ID, ps);

    // The state this call is about to be built against. Kept so the wait
    // afterwards knows what "changed" means.
    const before = await this.rawContractState();

    this.timings.current = {};
    const started = performance.now();
    const res = await this.deployed.callTx[circuit](...args);
    const r = receipt(
      circuit,
      res,
      Math.round(performance.now() - started),
      this.timings.current,
    );

    await this.settle(before);
    return r;
  }

  /** The contract's state as the indexer currently reports it, as a string. */
  private async rawContractState(): Promise<string> {
    const s = await this.providers.publicDataProvider.queryContractState(
      this.contractAddress,
    );
    return s === null ? '' : String(s.data);
  }

  /**
   * Wait until the indexer reports a contract state different from `before`.
   *
   * A call transaction is proved against the contract state the indexer
   * hands out. Being included in a block is not the same as being visible
   * to the indexer, so building the next call immediately can prove
   * against the state as it was BEFORE the previous call -- and the node
   * refuses the result.
   *
   * That is what "1010: Invalid Transaction: Custom error: 117" was: a
   * `registerIssuer` landed, an `issueCredential` was built a second later
   * against pre-registration state, and the node rejected it.
   *
   * A timeout here is not fatal. It means the wait gave up, not that the
   * transaction failed, so it warns and lets the caller proceed.
   */
  private async settle(before: string, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      if ((await this.rawContractState()) !== before) return;
    }
    console.warn(
      `contract state at ${this.contractAddress} did not change within ` +
        `${timeoutMs / 1000}s of a successful call; the next call may be ` +
        'built against stale state',
    );
  }

  // ---- the same calls, but paid for by somebody else's wallet ---------

  /**
   * Build and prove a call, and stop before balancing.
   *
   * The result is a `Transaction<SignatureEnabled, Proof, PreBinding>` --
   * proven, but unbalanced and unbound. That is exactly the type the DApp
   * Connector's `balanceUnsealedTransaction` takes, so a browser wallet
   * can add the fee from ITS OWN Dust and relay it. The fee payer is then
   * the person at the keyboard rather than this process's seed wallet.
   *
   * What this does NOT move into the wallet, stated plainly:
   *   * the proof is produced by the local proof server, against the
   *     proving keys in managed/, because those keys are not in the
   *     browser;
   *   * the witnesses -- the holder's secret, attributes and blinding --
   *     are read from this process's private state store.
   * So the wallet pays and relays; it does not yet hold the credential.
   */
  async prepare(
    circuit: string,
    ps: PrivateState,
    ...args: unknown[]
  ): Promise<{ txHex: string; circuit: string; proveMs: number }> {
    await this.providers.privateStateProvider.set(PRIVATE_STATE_ID, ps);

    const options = createCallTxOptions(
      this.compiledContract,
      circuit as never,
      this.contractAddress as never,
      PRIVATE_STATE_ID,
      undefined,
      args as never,
    );

    const unsubmitted: any = await createUnprovenCallTx(this.providers, options as never);

    const started = performance.now();
    const unbound: any = await this.providers.proofProvider.proveTx(
      unsubmitted.private.unprovenTx,
    );
    const proveMs = Math.round(performance.now() - started);

    return {
      circuit,
      proveMs,
      txHex: Buffer.from(unbound.serialize()).toString('hex'),
    };
  }

  /** Private state for each action, so `prepare` and `submit` agree. */
  stateForRegisterIssuer(adminSecret: Uint8Array): PrivateState {
    return { ...blankPrivateState(), localSecret: adminSecret };
  }

  stateForIssuer(issuer: MockIssuer): PrivateState {
    return { ...blankPrivateState(), issuerSecret: issuer.secret };
  }

  async stateForPresent(
    holder: Holder,
    path?: MerkleTreePath<Uint8Array>,
  ): Promise<PrivateState> {
    if (holder.leaf === undefined) throw new Error('holder has no credential yet');
    return {
      localSecret: holder.secret,
      issuerSecret: bytes32(0),
      attributes: holder.attributes,
      blinding: holder.blinding,
      merklePath: path ?? (await this.path(holder.leaf)),
    };
  }

  async registerIssuer(adminSecret: Uint8Array, issuer: MockIssuer): Promise<TxReceipt> {
    return this.submit(
      'registerIssuer',
      { ...blankPrivateState(), localSecret: adminSecret },
      issuer.id,
      issuer.authDigest,
    );
  }

  /**
   * Issue into an explicit leaf slot. The index is explicit because the
   * Merkle tree ADT exposes no in-circuit occupancy test, which is also
   * why the contract keeps a leafIssuer map -- see DESIGN.md §4.5.
   */
  async issue(issuer: MockIssuer, holder: Holder, atIndex?: bigint): Promise<TxReceipt> {
    const index = atIndex ?? (await this.ledger()).activeCredentials.firstFree();
    const r = await this.submit(
      'issueCredential',
      { ...blankPrivateState(), issuerSecret: issuer.secret },
      issuer.id,
      holder.commitment,
      holder.holderId,
      index,
    );
    holder.issuerId = issuer.id;
    holder.leaf = leafFor(holder, issuer.id);
    holder.leafIndex = index;
    return r;
  }

  async revoke(issuer: MockIssuer, leafIndex: bigint): Promise<TxReceipt> {
    return this.submit(
      'revokeCredential',
      { ...blankPrivateState(), issuerSecret: issuer.secret },
      issuer.id,
      leafIndex,
    );
  }

  /**
   * Present a credential to a verifier.
   *
   * `asOf` defaults to now. The contract pins it to
   * (blockTime - 5 minutes, blockTime], and the block that includes this
   * transaction is minutes away, so a default of "now" is correct: it is
   * in the past by the time the assertion runs, and comfortably inside the
   * window. Passing a future timestamp to get ahead of that fails on
   * "asOf is in the future", which is the point of the check.
   */
  async present(
    holder: Holder,
    issuer: MockIssuer,
    verifierId: Uint8Array,
    req: PredicateRequest,
    opts: { asOf?: bigint; path?: MerkleTreePath<Uint8Array> } = {},
  ): Promise<TxReceipt> {
    if (holder.leaf === undefined) throw new Error('holder has no credential yet');
    const path = opts.path ?? (await this.path(holder.leaf));
    const ps: PrivateState = {
      localSecret: holder.secret,
      // A holder does not hold the issuer secret and must not need one.
      issuerSecret: bytes32(0),
      attributes: holder.attributes,
      blinding: holder.blinding,
      merklePath: path,
    };
    // Stamped as late as possible: everything after this point -- proving,
    // balancing, submission, block inclusion -- eats into the contract's
    // five-minute freshness window.
    const asOf = opts.asOf ?? nowSeconds();
    const r = await this.submit('present', ps, issuer.id, verifierId, req, asOf);

    // How much of the window the round trip actually consumed. The window
    // is a guess until something measures it, and a presentation that
    // succeeds with four minutes gone is a warning, not a pass.
    r.asOfAgeSec = Number(nowSeconds() - asOf);
    if (r.asOfAgeSec > Number(FRESHNESS_WINDOW_SEC) * 0.6) {
      console.warn(
        `present() used ${r.asOfAgeSec}s of a ` +
          `${FRESHNESS_WINDOW_SEC}s freshness window`,
      );
    }
    return r;
  }

  async close(): Promise<void> {
    await (this.open.wallet as any).stop?.();
  }
}
