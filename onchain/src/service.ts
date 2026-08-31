// =====================================================================
// On-chain lifecycle service
// =====================================================================
//   npx tsx src/service.ts preview          (default port 4100)
//
// A small HTTP front for ChainClient, so the demo web app can drive the
// deployed contract without pulling this package's dependency tree into
// its own.
//
// WHY A SEPARATE PROCESS. The reference build needs compact-runtime
// 0.19.0; this one needs 0.16.0, and two versions of that package cannot
// coexist in one dependency tree -- which is why `onchain/` is a separate
// npm package with its own node_modules in the first place. Importing
// across that boundary in-process would defeat the separation. An HTTP
// hop is the honest way to keep both.
//
// Everything this serves is real: a real proof per call, a real
// transaction, a real block. The only mocked thing is the ISSUER, which
// attests to whatever attribute values it is given and verifies no
// real-world identity. That is true here exactly as it is in the
// simulator; deploying to a network does not change it.
// =====================================================================

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { ChainClient, readDeployment, type TxReceipt } from './chain.js';
import {
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  PredicateId,
  bytes32,
  countries,
  hex,
  label32,
  leafFor,
  makeIssuer,
  nowSeconds,
  rebuildHolder,
  type CredentialAttrs,
  type Holder,
  type MockIssuer,
  type PredicateRequest,
} from './engine.js';
import { resolveNetwork } from './network.js';
import { loadOrCreateAuthority } from './authority.js';
import { describePredicate, refusalReason } from './present-format.js';
import { ONCHAIN_ROOT } from './wallet.js';

const network = process.argv[2] ?? 'preview';
const PORT = Number(process.env.CHAIN_SERVICE_PORT ?? 4100);
const cfg = resolveNetwork(network);

// The admin and issuer secrets this deployment was made with, read from
// `.authority.<network>.json`. Whoever holds that file is the authority --
// there is no signature to check, only preimage knowledge -- so it is
// generated per network, never committed, and shared by every entry point
// rather than each deriving its own.
const { adminSecret: ADMIN_SECRET, issuer } = loadOrCreateAuthority(network);

// ---------------------------------------------------------------------
// Off-chain state: exactly the things that must never reach a ledger
// ---------------------------------------------------------------------

type Wallet = {
  name: string;
  label?: string;
  holder: Holder;
};

const wallets = new Map<string, Wallet>();
const receipts: (TxReceipt & { at: number; action: string; detail?: string })[] = [];

// ---------------------------------------------------------------------
// Holder wallets, persisted
// ---------------------------------------------------------------------
// In the simulator, losing these on restart costs nothing: the ledger goes
// with them. On a chain it is different and worse. The leaf stays in the
// active set forever, and without the holder's secret nobody can present
// it and nobody can work out which leaf to revoke. The credential is
// stranded, permanently.
//
// So they are written to disk. The file holds holder SECRETS and is
// gitignored; it is the demo standing in for a wallet, which is a
// limitation of the demo and is stated as one in the UI.

const WALLETS_FILE = join(ONCHAIN_ROOT, `.holders.${network}.json`);

type StoredHolder = {
  name: string;
  label?: string;
  secret: string;
  blinding: string;
  issuerId?: string;
  leafIndex?: string;
  attributes: Record<'birthTimestamp' | 'countryCode' | 'kycTier' | 'expiresAt', string>;
};

/**
 * A holder with fresh random key material.
 *
 * The simulator derives holder secrets from a counter so its tests are
 * reproducible. That is wrong here: this service persists wallets and
 * reloads them, so a counter keyed on the current wallet count reissues
 * the same secret whenever a name is reused -- two holders sharing a
 * secret, which is the one thing a per-holder secret may never do.
 */
function newHolder(attributes: CredentialAttrs): Holder {
  return rebuildHolder(
    new Uint8Array(randomBytes(32)),
    new Uint8Array(randomBytes(32)),
    attributes,
  );
}

function saveWallets(): void {
  const out: StoredHolder[] = [...wallets.values()].map((w) => ({
    name: w.name,
    label: w.label,
    secret: hex(w.holder.secret),
    blinding: hex(w.holder.blinding),
    issuerId: w.holder.issuerId === undefined ? undefined : String(w.holder.issuerId),
    leafIndex: w.holder.leafIndex === undefined ? undefined : String(w.holder.leafIndex),
    attributes: {
      birthTimestamp: String(w.holder.attributes.birthTimestamp),
      countryCode: String(w.holder.attributes.countryCode),
      kycTier: String(w.holder.attributes.kycTier),
      expiresAt: String(w.holder.attributes.expiresAt),
    },
  }));
  writeFileSync(WALLETS_FILE, JSON.stringify(out, null, 2), { mode: 0o600 });
}

function loadWallets(): void {
  if (!existsSync(WALLETS_FILE)) return;
  let stored: StoredHolder[];
  try {
    stored = JSON.parse(readFileSync(WALLETS_FILE, 'utf8')) as StoredHolder[];
  } catch {
    console.warn(`ignoring unreadable holder file at ${WALLETS_FILE}`);
    return;
  }

  for (const s of stored) {
    // Rebuilt through the contract's own pure circuits, so the commitment
    // and holder id are recomputed rather than trusted from the file.
    const holder = rebuildHolder(
      Buffer.from(s.secret, 'hex'),
      Buffer.from(s.blinding, 'hex'),
      {
        birthTimestamp: BigInt(s.attributes.birthTimestamp),
        countryCode: BigInt(s.attributes.countryCode),
        kycTier: BigInt(s.attributes.kycTier),
        expiresAt: BigInt(s.attributes.expiresAt),
      },
    );
    if (s.issuerId !== undefined) {
      holder.issuerId = BigInt(s.issuerId);
      holder.leaf = leafFor(holder, holder.issuerId);
    }
    if (s.leafIndex !== undefined) holder.leafIndex = BigInt(s.leafIndex);
    wallets.set(s.name, { name: s.name, label: s.label, holder });
  }
  console.log(`restored ${wallets.size} holder wallet(s) from ${WALLETS_FILE}`);
}

/**
 * Presentations, in the same shape the simulator backend reports them, so
 * the UI renders one from a live network exactly as it renders one from
 * memory -- with the transaction and the proving time added, which is
 * precisely the difference worth seeing.
 */
type Presentation = {
  at: number;
  verifierId: string;
  nullifier: string;
  predicate: string;
  accepted: boolean;
  reason?: string;
  /** Total wall clock, including block inclusion. */
  ms: number;
  proveMs?: number;
  balanceMs?: number;
  txHash?: string;
  txId?: string;
  blockHeight?: string;
};

const presentations: Presentation[] = [];

const VERIFIERS: Record<string, Uint8Array> = {
  'alpha-exchange': label32('verifier:alpha-exchange'),
  'beta-lending': label32('verifier:beta-lending'),
};

function record(action: string, r: TxReceipt, detail?: string) {
  receipts.unshift({ ...r, at: Date.now(), action, detail });
  if (receipts.length > 50) receipts.length = 50;
  return r;
}

// ---------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------

const deployment = readDeployment(cfg.name);
if (!deployment) {
  console.error(
    `\nNothing is deployed to ${cfg.name}.\n` +
      `Deploy first:  npx tsx src/deploy.ts ${cfg.name}\n`,
  );
  process.exit(1);
}

loadWallets();

console.log(`connecting to ${cfg.name} at ${deployment.contractAddress}`);
const client = await ChainClient.connect(cfg.name);
console.log('connected\n');

// ---------------------------------------------------------------------
// Reading state
// ---------------------------------------------------------------------

async function publicState() {
  const l = await client.ledger();
  const issuers: string[] = [];
  for (const [id] of l.issuerAuth) issuers.push(String(id));
  const spent: string[] = [];
  for (const [k] of l.spentNullifiers) spent.push(hex(k));

  // A MerkleTreeDigest is a field element, not bytes. Rendering it as
  // padded hex keeps it the same shape as every other 32-byte value the
  // UI shows, without pretending it was ever a byte string.
  const root = (l.activeCredentials.root() as { field: bigint }).field;

  return {
    issuers,
    merkleRoot: root.toString(16).padStart(64, '0'),
    nextLeafIndex: String(l.activeCredentials.firstFree()),
    revocationEpoch: String(l.revocationEpoch),
    spentNullifiers: spent,
    treeFull: l.activeCredentials.isFull(),
    admin: hex(l.admin),
  };
}

async function fullState() {
  const pub = await publicState();
  const l = await client.ledger();

  const hex32 = (v: bigint) => v.toString(16).padStart(64, '0');
  const currentRoot = (l.activeCredentials.root() as { field: bigint }).field;

  const holders = [...wallets.values()].map((w) => {
    // On a chain there is no local tree to keep stale, so the path is
    // always rebuilt from the state the indexer just reported. Its
    // presence therefore answers a real question: is this credential
    // still in the active set, or has it been revoked?
    const path = w.holder.leaf
      ? l.activeCredentials.findPathForLeaf(w.holder.leaf)
      : undefined;

    return {
      name: w.name,
      label: w.label,
      commitment: hex(w.holder.commitment),
      holderId: hex(w.holder.holderId),
      hasCredential: w.holder.leafIndex !== undefined,
      pathFresh: path !== undefined,
      merklePath: path
        ? {
            leaf: hex(path.leaf as Uint8Array),
            entries: (path as any).path.map((e: any) => ({
              sibling: hex32(e.sibling.field as bigint),
              goesLeft: Boolean(e.goes_left),
            })),
          }
        : null,
      pathRoot: path ? hex32(currentRoot) : null,
      leafIndex: w.holder.leafIndex === undefined ? null : String(w.holder.leafIndex),
      // Private register. Displayed only because this is a demo whose
      // whole point is showing what stayed off the ledger. These values
      // are held here, off chain, and no circuit ever discloses them.
      privateAttributes: {
        birthTimestamp: String(w.holder.attributes.birthTimestamp),
        countryCode: String(w.holder.attributes.countryCode),
        kycTier: String(w.holder.attributes.kycTier),
        expiresAt: String(w.holder.attributes.expiresAt),
      },
    };
  });

  const credentials = [...wallets.values()]
    .filter((w) => w.holder.leafIndex !== undefined)
    .map((w) => ({
      commitment: hex(w.holder.commitment),
      leafIndex: String(w.holder.leafIndex),
      label: w.label ?? w.name,
      revoked: w.holder.leaf
        ? l.activeCredentials.findPathForLeaf(w.holder.leaf) === undefined
        : false,
    }));

  return {
    network: cfg.name,
    networkId: cfg.networkId,
    node: cfg.node,
    indexer: cfg.indexer,
    contractAddress: client.contractAddress,
    walletAddress: client.walletAddress,
    deployment,
    issuerRegistered: pub.issuers.includes(String(issuer.id)),
    issuerId: String(issuer.id),
    public: pub,
    credentials,
    holders,
    presentations,
    receipts,
  };
}

// ---------------------------------------------------------------------
// Actions — each one is a real transaction
// ---------------------------------------------------------------------

async function doRegisterIssuer() {
  const r = await client.registerIssuer(ADMIN_SECRET, issuer);
  return record('registerIssuer', r, `issuer ${issuer.id}`);
}

type IssueBody = {
  holderName: string;
  label?: string;
  ageYears: number;
  countryCode: number;
  kycTier: number;
  validDays: number;
};

async function doIssue(b: IssueBody) {
  const now = nowSeconds();
  const attributes: CredentialAttrs = {
    birthTimestamp: now - BigInt(b.ageYears) * SECONDS_PER_YEAR,
    countryCode: BigInt(b.countryCode),
    kycTier: BigInt(b.kycTier),
    expiresAt: now + BigInt(b.validDays) * SECONDS_PER_DAY,
  };
  const holder = newHolder(attributes);
  const r = await client.issue(issuer, holder);
  wallets.set(b.holderName, { name: b.holderName, label: b.label, holder });
  saveWallets();
  return record('issueCredential', r, b.holderName);
}

/**
 * Revoke by holder name or by commitment. The issuer UI identifies a
 * credential by its commitment because that is the only identifier the
 * ledger carries; accepting both keeps this callable either way.
 */
async function doRevoke(b: { holderName?: string; commitment?: string }) {
  const w = b.holderName
    ? wallets.get(b.holderName)
    : [...wallets.values()].find((x) => hex(x.holder.commitment) === b.commitment);

  if (!w || w.holder.leafIndex === undefined) {
    throw new Error(`no credential issued to "${b.holderName ?? b.commitment}"`);
  }
  const r = await client.revoke(issuer, w.holder.leafIndex);
  return record('revokeCredential', r, w.name);
}

type PresentBody = {
  holderName: string;
  verifierId: string;
  predicateId?: number;
  threshold?: string;
  allowedCountries?: number[];
};


async function doPresent(b: PresentBody): Promise<Presentation> {
  const w = wallets.get(b.holderName);
  if (!w) throw new Error(`unknown holder "${b.holderName}"`);
  const verifier = VERIFIERS[b.verifierId];
  if (!verifier) {
    throw new Error(
      `unknown verifier "${b.verifierId}". Known: ${Object.keys(VERIFIERS).join(', ')}`,
    );
  }

  const req: PredicateRequest = {
    predicateId: b.predicateId ?? PredicateId.AGE_AT_LEAST,
    threshold: BigInt(b.threshold ?? String(18n * SECONDS_PER_YEAR)),
    allowedCountries: countries(...(b.allowedCountries ?? []).map((c) => BigInt(c))),
  };

  // Predicted before the call, because the epoch can advance if a
  // revocation lands in between -- in which case the nullifier the chain
  // records will not be this one, and that mismatch is worth being able
  // to see rather than hiding by computing it afterwards.
  const nullifier = hex(await client.expectedNullifier(w.holder, verifier));
  const predicate = describePredicate(req.predicateId, String(req.threshold), (b.allowedCountries ?? []).map(Number));

  const started = Date.now();
  try {
    const r = await client.present(w.holder, issuer, verifier, req);
    record('present', r, `${b.holderName} -> ${b.verifierId}`);
    const p: Presentation = {
      at: started,
      verifierId: b.verifierId,
      nullifier,
      predicate,
      accepted: true,
      ms: r.totalMs,
      proveMs: r.proveMs,
      balanceMs: r.balanceMs,
      txHash: r.txHash,
      txId: r.txId,
      blockHeight: r.blockHeight,
    };
    presentations.unshift(p);
    return p;
  } catch (e) {
    // A refusal is a result. It is recorded with the same weight as an
    // acceptance, because the refusals are what the invariants are for.
    const p: Presentation = {
      at: started,
      verifierId: b.verifierId,
      nullifier,
      predicate,
      accepted: false,
      reason: reason(e),
      ms: Date.now() - started,
    };
    presentations.unshift(p);
    return p;
  }
}

// ---------------------------------------------------------------------
// Actions prepared for someone else's wallet to pay for
// ---------------------------------------------------------------------
// Same circuits, same proofs. The difference is who settles the fee: the
// browser wallet balances and relays, so the transaction is paid for by
// the person using the demo rather than by this process's seed wallet.
//
// The holder's secrets and the proving keys stay here; only a proven,
// unbalanced transaction crosses to the browser. That boundary is stated
// in the UI rather than glossed over.

type PrepareBody =
  | { action: 'registerIssuer' }
  | ({ action: 'issue' } & IssueBody)
  | { action: 'revoke'; holderName?: string; commitment?: string }
  | ({ action: 'present' } & PresentBody);

async function doPrepare(b: PrepareBody) {
  switch (b.action) {
    case 'registerIssuer':
      return client.prepare(
        'registerIssuer',
        client.stateForRegisterIssuer(ADMIN_SECRET),
        issuer.id,
        issuer.authDigest,
      );

    case 'issue': {
      const now = nowSeconds();
      const attributes: CredentialAttrs = {
        birthTimestamp: now - BigInt(b.ageYears) * SECONDS_PER_YEAR,
        countryCode: BigInt(b.countryCode),
        kycTier: BigInt(b.kycTier),
        expiresAt: now + BigInt(b.validDays) * SECONDS_PER_DAY,
      };
      const holder = newHolder(attributes);
      const index = (await client.ledger()).activeCredentials.firstFree();
      const out = await client.prepare(
        'issueCredential',
        client.stateForIssuer(issuer),
        issuer.id,
        holder.commitment,
        holder.holderId,
        index,
      );
      // Recorded only once the wallet confirms the transaction landed --
      // see /confirm. Holding it here would claim an issuance that the
      // user may still refuse to sign.
      pending.set(out.txHex, { kind: 'issue', name: b.holderName, label: b.label, holder, index });
      return out;
    }

    case 'revoke': {
      const w = b.holderName
        ? wallets.get(b.holderName)
        : [...wallets.values()].find((x) => hex(x.holder.commitment) === b.commitment);
      if (!w || w.holder.leafIndex === undefined) {
        throw new Error(`no credential issued to "${b.holderName ?? b.commitment}"`);
      }
      return client.prepare(
        'revokeCredential',
        client.stateForIssuer(issuer),
        issuer.id,
        w.holder.leafIndex,
      );
    }

    case 'present': {
      const w = wallets.get(b.holderName);
      if (!w) throw new Error(`unknown holder "${b.holderName}"`);
      const verifier = VERIFIERS[b.verifierId];
      if (!verifier) throw new Error(`unknown verifier "${b.verifierId}"`);

      const req: PredicateRequest = {
        predicateId: b.predicateId ?? PredicateId.AGE_AT_LEAST,
        threshold: BigInt(b.threshold ?? String(18n * SECONDS_PER_YEAR)),
        allowedCountries: countries(...(b.allowedCountries ?? []).map((c) => BigInt(c))),
      };

      const out = await client.prepare(
        'present',
        await client.stateForPresent(w.holder),
        issuer.id,
        verifier,
        req,
        // Proving takes a while and the wallet adds more delay before the
        // transaction reaches a block. `asOf` is stamped now and the
        // contract's five-minute freshness window is what absorbs that
        // gap -- if the user sits on the wallet prompt for six minutes,
        // the chain rejects it on "asOf is stale", correctly.
        nowSeconds(),
      );
      pending.set(out.txHex, {
        kind: 'present',
        name: b.holderName,
        verifierId: b.verifierId,
        nullifier: hex(await client.expectedNullifier(w.holder, verifier)),
        predicate: describePredicate(req.predicateId, String(req.threshold), (b.allowedCountries ?? []).map(Number)),
      });
      return out;
    }
  }
  throw new Error('unknown action');
}

/** Prepared-but-unsubmitted work, keyed by the transaction handed out. */
const pending = new Map<string, any>();

/**
 * Told by the browser that the wallet accepted and relayed a prepared
 * transaction. The chain is still the source of truth -- the next /state
 * read shows what actually landed -- but the off-chain half of an
 * issuance (the holder's secret and attributes) only exists here, so it
 * has to be committed at this point or it is lost.
 */
function doConfirm(b: { txHex: string; txHash?: string; proveMs?: number }) {
  const p = pending.get(b.txHex);
  if (!p) return { ok: true, note: 'nothing was pending for that transaction' };
  pending.delete(b.txHex);

  if (p.kind === 'issue') {
    p.holder.issuerId = issuer.id;
    p.holder.leaf = leafFor(p.holder, issuer.id);
    p.holder.leafIndex = p.index;
    wallets.set(p.name, { name: p.name, label: p.label, holder: p.holder });
    saveWallets();
  } else if (p.kind === 'present') {
    presentations.unshift({
      at: Date.now(),
      verifierId: p.verifierId,
      nullifier: p.nullifier,
      predicate: p.predicate,
      accepted: true,
      // The wallet relays without waiting for a block, so there is no
      // inclusion time to report -- only what proving took.
      ms: b.proveMs ?? 0,
      proveMs: b.proveMs,
      txHash: b.txHash,
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------

const readBody = (req: any): Promise<any> =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c));
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });

/**
 * Turn a rejection into the message the caller needs. In-circuit asserts
 * arrive wrapped by the runtime, so the whole chain of causes is walked
 * and joined -- otherwise a genuine "nullifier already spent this epoch"
 * shows up as a generic proving failure.
 */
const reason = refusalReason;

const server = createServer(async (req, res) => {
  const send = (code: number, body: unknown) => {
    const json = JSON.stringify(body, (_k, v) =>
      typeof v === 'bigint' ? String(v) : v,
    );
    res.writeHead(code, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    res.end(json);
  };

  if (req.method === 'OPTIONS') return send(204, {});

  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  try {
    if (req.method === 'GET' && path === '/state') return send(200, await fullState());

    if (req.method === 'POST') {
      const body = await readBody(req);
      switch (path) {
        case '/register-issuer':
          return send(200, { ok: true, receipt: await doRegisterIssuer() });
        case '/issue':
          return send(200, { ok: true, receipt: await doIssue(body) });
        case '/revoke':
          return send(200, { ok: true, receipt: await doRevoke(body) });
        case '/present': {
          const p = await doPresent(body);
          return send(200, { ok: p.accepted, reason: p.reason, presentation: p });
        }
        case '/prepare':
          return send(200, { ok: true, ...(await doPrepare(body)) });
        case '/inspect':
          return send(200, { ok: true, ...inspectTransaction(body.txHex) });
        case '/confirm':
          return send(200, doConfirm(body));
      }
    }
    return send(404, { ok: false, reason: `no route ${req.method} ${path}` });
  } catch (e) {
    // A rejected call is a RESULT, not a server fault: the contract said
    // no. 200 with ok:false keeps that distinction visible to the UI.
    return send(200, { ok: false, reason: reason(e) });
  }
});

server.listen(PORT, () => {
  console.log(`on-chain service   http://localhost:${PORT}`);
  console.log(`network            ${cfg.name}`);
  console.log(`contract           ${client.contractAddress}`);
  console.log(`fee payer          ${client.walletAddress}`);
  console.log('\nEvery call here produces a real proof and a real transaction.');
});

/**
 * Describe a serialized transaction, whoever built it.
 *
 * This exists because of a failure that could not be diagnosed from either
 * end alone. A browser wallet balanced a transaction from /prepare and its
 * submission was refused with `Custom error: 182` -- replay protection.
 * The prepared transaction was known good: this service's own wallet
 * balanced and submitted the identical bytes and the chain accepted them.
 * So the thing nobody had looked at was what the WALLET produced after
 * balancing, and there was no way to look at it.
 *
 * Now there is. The page posts the balanced hex here when a submission
 * fails, and the intents it carries -- how many, at which segment ids,
 * with which TTLs -- are printed and returned.
 *
 * Read-only. It deserializes and reports; it never submits.
 */
function inspectTransaction(txHex: unknown): Record<string, unknown> {
  if (typeof txHex !== 'string' || !/^[0-9a-fA-F]+$/.test(txHex)) {
    return { error: 'txHex must be a hex string' };
  }
  const raw = Uint8Array.from(Buffer.from(txHex, 'hex'));

  // A balanced transaction is sealed (Binding); one straight out of
  // /prepare is not (PreBinding). Which one this is, is itself worth
  // knowing, so both are tried and the successful marker is reported.
  const attempts: Array<['binding' | 'pre-binding', string]> = [
    ['binding', 'sealed — signed and cryptographically bound'],
    ['pre-binding', 'unsealed — proved but not yet bound'],
  ];

  for (const [marker, description] of attempts) {
    try {
      const tx: any = ledger.Transaction.deserialize('signature', 'proof', marker, raw);
      const now = Date.now();
      const intents = [...((tx.intents as Map<number, any>) ?? new Map()).entries()].map(
        ([segment, intent]) => ({
          segment,
          ttl: intent.ttl.toISOString(),
          ttlInSec: Math.round((intent.ttl.getTime() - now) / 1000),
          actions: intent.actions?.length ?? 0,
          hasDustActions: Boolean(intent.dustActions),
          hasGuaranteedOffer: Boolean(intent.guaranteedUnshieldedOffer),
        }),
      );
      const summary = { bytes: raw.length, binding: marker, description, intents };
      console.log(`[inspect] ${JSON.stringify(summary)}`);
      return summary;
    } catch {
      // Try the other marker before giving up.
    }
  }
  return { error: 'could not deserialize as a transaction under either binding' };
}
