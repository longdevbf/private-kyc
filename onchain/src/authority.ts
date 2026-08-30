// =====================================================================
// The secrets that control the deployed contract
// =====================================================================
// Language 0.23 has no in-circuit signature verification, so the ported
// contract authorises an admin and an issuer by proof of knowledge of a
// secret whose digest sits in ledger state. Whoever holds the secret IS
// the authority. There is nothing else to check.
//
// These were previously `bytes32(1)` and `makeIssuer(1n)` -- constants in
// this repository, and therefore known to everyone who can read it. The
// deployment they controlled offered no issuer authority at all: any
// reader could issue and revoke on it. That was labelled a demo shortcut,
// which is true and was not sufficient, because the weakness it created is
// exactly the one the contract exists to argue about.
//
// So they are generated once per network, stored beside the wallet seed
// with the same permissions, and gitignored. Losing the file means losing
// control of that deployment: the digests are sealed into ledger state at
// deploy time and cannot be rotated by any circuit this contract has.
//
// This is still a demo. A production issuer would keep this in an HSM and
// would never have a single secret standing in for a whole authority.
// =====================================================================

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { pureCircuits } from '../managed/contract/index.js';
import type { MockIssuer } from './engine.js';
import { ONCHAIN_ROOT } from './wallet.js';

export type Authority = {
  /** Sealed into `admin` at deploy time. Registers issuers. */
  adminSecret: Uint8Array;
  /** The mock credential authority. Its digest goes in `issuerKeys`. */
  issuer: MockIssuer;
};

type Stored = { adminSecret: string; issuerSecret: string; issuerId: string };

const filePath = (network: string) => join(ONCHAIN_ROOT, `.authority.${network}.json`);

/**
 * Read this network's authority secrets, generating them on first use.
 *
 * Every entry point must call this rather than deriving secrets of its
 * own: `deploy`, `provision`, `service` and `lifecycle-demo` all have to
 * agree, and they only agree if they read the same file.
 */
export function loadOrCreateAuthority(network: string): Authority {
  const p = filePath(network);

  if (existsSync(p)) {
    const s = JSON.parse(readFileSync(p, 'utf8')) as Stored;
    return {
      adminSecret: Uint8Array.from(Buffer.from(s.adminSecret, 'hex')),
      issuer: makeIssuerFromSecret(BigInt(s.issuerId), Buffer.from(s.issuerSecret, 'hex')),
    };
  }

  const stored: Stored = {
    adminSecret: randomBytes(32).toString('hex'),
    issuerSecret: randomBytes(32).toString('hex'),
    issuerId: '1',
  };
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });

  return {
    adminSecret: Uint8Array.from(Buffer.from(stored.adminSecret, 'hex')),
    issuer: makeIssuerFromSecret(1n, Buffer.from(stored.issuerSecret, 'hex')),
  };
}

/**
 * A mock issuer whose secret is supplied rather than derived from a
 * counter.
 *
 * `makeIssuer(id)` in the engine derives the secret from a seed plus the
 * id, which is right for tests -- they need the same issuer every run --
 * and wrong for a deployment, where the whole point is that the secret is
 * not reproducible from anything published. The digest is computed by the
 * contract's own pure circuit, so there is no second implementation of it
 * here to drift.
 */
function makeIssuerFromSecret(id: bigint, secret: Uint8Array): MockIssuer {
  return { id, secret, authDigest: pureCircuits.deriveIssuerAuth(secret) };
}
