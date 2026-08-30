// =====================================================================
// Wallet handling for the deployment driver
// =====================================================================
// A deployment costs fees, so it needs a funded wallet. The seed lives in
// onchain/.seed, which is gitignored: it controls real testnet funds and
// must not end up in the repository.
//
// This is a DEMO wallet for a testnet deployment. It is not a custody
// solution and makes no attempt to be one.
// =====================================================================

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstValueFrom, filter, map, timeout } from 'rxjs';

import { WalletBuilder } from '@midnight-ntwrk/wallet';
import type { Wallet } from '@midnight-ntwrk/wallet-api';
import type { NetworkConfig } from './network.js';
import { PROOF_SERVER } from './network.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ONCHAIN_ROOT = join(HERE, '..');

/** Native token, whose balance pays the fees. */
export const NATIVE_TOKEN =
  '0100000000000000000000000000000000000000000000000000000000000000000000';

function seedPath(network: string): string {
  return join(ONCHAIN_ROOT, `.seed.${network}`);
}

/**
 * Read the seed for a network, creating one on first use. Separate seeds
 * per network so funding one does not silently depend on the other.
 */
export function loadOrCreateSeed(network: string): string {
  const p = seedPath(network);
  if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  const seed = randomBytes(32).toString('hex');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, seed + '\n', { mode: 0o600 });
  return seed;
}

export type OpenWallet = Wallet & { close: () => Promise<void> };

/**
 * Build a wallet and wait until it has caught up with the chain.
 *
 * Sync is not instant on a public network, and a deployment submitted
 * against a half-synced wallet fails in ways that look like unrelated
 * errors, so this waits rather than racing.
 */
export async function openWallet(
  cfg: NetworkConfig,
  seed: string,
  opts: { syncTimeoutMs?: number; quiet?: boolean; waitForSync?: boolean } = {},
): Promise<OpenWallet> {
  const log = opts.quiet ? () => {} : (m: string) => console.log(m);

  log(`connecting to ${cfg.name}`);
  log(`  node        ${cfg.node}`);
  log(`  indexer     ${cfg.indexer}`);
  log(`  proof srv   ${PROOF_SERVER}`);

  const wallet = await WalletBuilder.build(
    cfg.indexer,
    cfg.indexerWs,
    PROOF_SERVER,
    cfg.node,
    seed,
    cfg.zswapNetworkId,
    'warn',
  );
  wallet.start();

  // The address is available from the first state emission, long before the
  // wallet has scanned the chain. Funding it does not require a synced
  // wallet, so callers that only need the address skip the wait -- a fresh
  // wallet on preview scans several hundred thousand blocks, and making
  // someone watch that before they can visit the faucet is pointless.
  if (opts.waitForSync !== false) {
    log('syncing — a fresh wallet scans the whole chain, so this is slow');
    await firstValueFrom(
      wallet.state().pipe(
        filter((s) => s.syncProgress?.synced === true),
        timeout({ each: opts.syncTimeoutMs ?? 60 * 60_000 }),
        map(() => true),
      ),
    );
    log('synced');
  }

  const w = wallet as unknown as OpenWallet;
  const close = (wallet as unknown as { close?: () => Promise<void> }).close;
  w.close = close ? close.bind(wallet) : async () => {};
  return w;
}

export async function walletInfo(wallet: Wallet): Promise<{
  address: string;
  balance: bigint;
  coinPublicKey: string;
}> {
  const s = await firstValueFrom(wallet.state());
  return {
    address: s.address,
    balance: s.balances[NATIVE_TOKEN] ?? 0n,
    coinPublicKey: s.coinPublicKey,
  };
}

/** tDUST has 6 decimal places; print it the way the faucet does. */
export function formatDust(v: bigint): string {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${frac}`;
}
