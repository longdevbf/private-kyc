// =====================================================================
// Demo backend -- hosts the contract and exposes it to the three personas.
// =====================================================================
// Every endpoint here executes the REAL compiled Compact circuits through
// @midnight-ntwrk/compact-runtime. Nothing is faked: if the UI shows a
// rejection, an in-circuit assert produced it.
//
// What this is NOT: a chain. The contract runs against an in-memory ledger
// rather than a Midnight node, so there is no consensus, no transaction
// finality, and -- importantly -- no zero-knowledge PROOF is generated. The
// circuits execute and every constraint is enforced, but the prover is not
// invoked. Timings reported to the UI are real circuit-execution times and
// are labelled as such; they are not proving times and the UI does not
// pretend otherwise.
// =====================================================================

import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  Sim, makeHolder, bytes32, label32,
  type CredentialAttrs, type Holder, type PredicateRequest,
} from '../core/engine.js';
import { MockCredentialAuthority, MOCK_WARNING, hex } from '../issuer/mockIssuer.js';
import type { MerkleTreeDigest, MerkleTreePath } from '@midnight-ntwrk/compact-runtime';

const PORT = Number(process.env.PORT ?? 4000);
const ADMIN_SECRET = bytes32(1);

// ---------------------------------------------------------------------
// Demo state
// ---------------------------------------------------------------------

type Wallet = {
  name: string;
  holder: Holder;
  /** Cached Merkle path, exactly as a real wallet would keep one. */
  path?: MerkleTreePath<Uint8Array>;
  /** Tree root at the moment the path was built; used to detect staleness. */
  pathRoot?: MerkleTreeDigest;
  label?: string;
};

type Presentation = {
  at: number;
  verifierId: string;
  nullifier: string;
  predicate: string;
  accepted: boolean;
  reason?: string;
  ms: number;
};

let sim: Sim;
let authority: MockCredentialAuthority;
let registered = false;
const wallets = new Map<string, Wallet>();
const presentations: Presentation[] = [];

async function reset() {
  sim = await Sim.deploy(ADMIN_SECRET, Date.now());
  authority = new MockCredentialAuthority(1n, 'Mock National ID Authority');
  registered = false;
  wallets.clear();
  presentations.length = 0;
}

await reset();

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const VERIFIERS: Record<string, Uint8Array> = {
  'alpha-exchange': label32('verifier:alpha-exchange'),
  'beta-lending': label32('verifier:beta-lending'),
};

/** A cached path is usable iff the tree still accepts the root it was built against. */
function pathFresh(w: Wallet): boolean {
  if (!w.path || !w.pathRoot) return false;
  try {
    return sim.ledger().activeCredentials.checkRoot(w.pathRoot);
  } catch {
    return false;
  }
}

function refreshPath(w: Wallet): boolean {
  const p = sim.ledger().activeCredentials.findPathForLeaf(w.holder.commitment);
  if (!p) {
    w.path = undefined;
    w.pathRoot = undefined;
    return false;
  }
  w.path = p;
  w.pathRoot = sim.ledger().activeCredentials.root();
  return true;
}

function describePredicate(req: PredicateRequest): string {
  const years = (n: bigint) => Number(n / 31_536_000_000n);
  switch (req.predicateId) {
    case 0: return `age >= ${years(req.threshold)}`;
    case 1: return `kycTier >= ${req.threshold}`;
    case 2: return `country in {${req.allowedCountries.filter((c) => c !== 0n).join(', ')}}`;
    default: return `unknown predicate ${req.predicateId}`;
  }
}

/** Public ledger state, as the chain sees it. Nothing private is included. */
function publicState() {
  const l = sim.ledger();
  const issuers: string[] = [];
  for (const [id] of l.issuerKeys) issuers.push(id.toString());
  const nullifiers: string[] = [];
  for (const [n] of l.spentNullifiers) nullifiers.push(hex(n));
  return {
    issuers,
    merkleRoot: hex32(l.activeCredentials.root().field),
    nextLeafIndex: l.activeCredentials.firstFree().toString(),
    revocationEpoch: l.revocationEpoch.toString(),
    spentNullifiers: nullifiers,
    admin: hex(l.admin),
    chainTime: sim.time,
  };
}

const hex32 = (v: bigint) => v.toString(16).padStart(64, '0');

/** Extract a readable message from an in-circuit assertion failure. */
function reasonOf(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^failed assert:\s*/, '');
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/state', (_req, res) => {
  res.json({
    mockWarning: MOCK_WARNING,
    issuerRegistered: registered,
    issuerName: authority.name,
    public: publicState(),
    credentials: authority.records().map((r) => ({
      commitment: hex(r.commitment),
      leafIndex: r.leafIndex.toString(),
      label: r.label,
      revoked: r.revoked,
    })),
    holders: [...wallets.values()].map((w) => ({
      name: w.name,
      label: w.label,
      commitment: hex(w.holder.commitment),
      hasCredential: Boolean(w.holder.signature),
      pathFresh: pathFresh(w),
      // Exposed so the UI can draw the actual membership path. Public
      // information -- it is derived entirely from the on-chain tree.
      merklePath: w.path ? {
        leaf: hex(w.path.leaf as Uint8Array),
        entries: (w.path as any).path.map((e: any) => ({
          sibling: hex32(e.sibling.field as bigint),
          goesLeft: Boolean(e.goes_left),
        })),
      } : null,
      // The root this cached path actually folds to, which is not always
      // the current root: HistoricMerkleTree accepts any root it has
      // published before. The UI shows this one rather than the live root
      // so that the fold it draws is the fold the circuit would check.
      pathRoot: w.pathRoot ? hex32(w.pathRoot.field) : null,
      leafIndex: authority.records()
        .find((r) => hex(r.commitment) === hex(w.holder.commitment))?.leafIndex.toString() ?? null,
      // Deliberately exposed so the UI can show the public/private split.
      // In a real deployment these never leave the holder's device.
      privateAttributes: w.holder.signature ? {
        birthTimestamp: w.holder.attributes.birthTimestamp.toString(),
        countryCode: w.holder.attributes.countryCode.toString(),
        kycTier: w.holder.attributes.kycTier.toString(),
        expiresAt: w.holder.attributes.expiresAt.toString(),
      } : null,
    })),
    presentations,
  });
});

app.post('/api/reset', async (_req, res) => {
  await reset();
  res.json({ ok: true });
});

// --- Issuer -----------------------------------------------------------

app.post('/api/issuer/register', async (_req, res) => {
  try {
    const t0 = performance.now();
    await sim.registerIssuer(ADMIN_SECRET, authority.issuer);
    registered = true;
    res.json({ ok: true, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    res.status(400).json({ ok: false, reason: reasonOf(e) });
  }
});

app.post('/api/issuer/issue', async (req, res) => {
  const { holderName, label, ageYears, countryCode, kycTier, validDays } = req.body ?? {};
  try {
    const now = BigInt(sim.time);
    const attrs: CredentialAttrs = {
      birthTimestamp: now - BigInt(Math.round(Number(ageYears) * 31_536_000_000)),
      countryCode: BigInt(countryCode),
      kycTier: BigInt(kycTier),
      expiresAt: now + BigInt(Math.round(Number(validDays) * 86_400_000)),
    };

    const seed = 100 + wallets.size;
    const holder = makeHolder(seed, attrs);
    const t0 = performance.now();

    // The issuer service signs; the contract host never sees the signing key.
    const sig = authority.attest(holder.commitment, holder.holderId);
    const leafIndex = sim.ledger().activeCredentials.firstFree();
    await sim.call('issueCredential', { ...sim.blankState(), issuerSig: sig },
      authority.issuer.id, holder.commitment, holder.holderId, leafIndex);
    holder.signature = sig;
    holder.leafIndex = leafIndex;

    const w: Wallet = { name: holderName, holder, label };
    wallets.set(holderName, w);
    // Inserting a leaf changes every path in the tree. Existing wallets are
    // re-synced here because that is what a real wallet does when it sees a
    // new root. Revocation deliberately does not do this: there, the stale
    // path is exactly the behaviour worth showing.
    for (const other of wallets.values()) refreshPath(other);
    authority.remember({
      commitment: holder.commitment, holderId: holder.holderId,
      leafIndex, label, attrs, revoked: false,
    });

    res.json({ ok: true, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    res.status(400).json({ ok: false, reason: reasonOf(e) });
  }
});

app.post('/api/issuer/revoke', async (req, res) => {
  const { commitment } = req.body ?? {};
  try {
    const rec = authority.records().find((r) => hex(r.commitment) === commitment);
    if (!rec) throw new Error('no such credential');
    const t0 = performance.now();
    const epoch = sim.ledger().revocationEpoch;
    const sig = authority.revoke(rec.leafIndex, epoch);
    await sim.call('revokeCredential', { ...sim.blankState(), issuerSig: sig },
      authority.issuer.id, rec.leafIndex);
    rec.revoked = true;
    res.json({ ok: true, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    res.status(400).json({ ok: false, reason: reasonOf(e) });
  }
});

// --- Holder -----------------------------------------------------------

app.post('/api/holder/refresh', (req, res) => {
  const w = wallets.get(req.body?.holderName);
  if (!w) return res.status(404).json({ ok: false, reason: 'unknown holder' });
  const ok = refreshPath(w);
  res.json({
    ok,
    reason: ok ? undefined : 'no path exists -- this credential has been revoked',
  });
});

// --- Verifier ---------------------------------------------------------

app.post('/api/verifier/present', async (req, res) => {
  const { holderName, verifierId, predicateId, threshold, allowedCountries } = req.body ?? {};
  const w = wallets.get(holderName);
  if (!w) return res.status(404).json({ ok: false, reason: 'unknown holder' });

  const vid = VERIFIERS[verifierId];
  if (!vid) return res.status(400).json({ ok: false, reason: 'unknown verifier' });

  const req_: PredicateRequest = {
    predicateId: Number(predicateId),
    threshold: BigInt(threshold ?? 0),
    allowedCountries: (allowedCountries ?? []).length
      ? padCountries((allowedCountries as (string | number)[]).map((c) => BigInt(c)))
      : padCountries([]),
  };

  // Computed BEFORE the call: presenting does not change the epoch, so this
  // is the value the circuit will publish. Recording it lets the verifier UI
  // show exactly which nullifier it saw.
  const expected = hex(sim.expectedNullifier(w.holder, vid));

  const t0 = performance.now();
  try {
    await sim.present(w.holder, authority.issuer, vid, req_, { path: w.path });
    const ms = Math.round(performance.now() - t0);
    presentations.push({
      at: Date.now(), verifierId, nullifier: expected,
      predicate: describePredicate(req_), accepted: true, ms,
    });
    res.json({ ok: true, ms });
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const reason = reasonOf(e);
    presentations.push({
      at: Date.now(), verifierId, nullifier: '-',
      predicate: describePredicate(req_), accepted: false, reason, ms,
    });
    res.status(400).json({ ok: false, reason, ms });
  }
});

function padCountries(codes: bigint[]): bigint[] {
  const out = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
  codes.slice(0, 8).forEach((c, i) => (out[i] = c));
  return out;
}

// Serve the built UI when it exists, so `npm start` runs the whole demo from
// a single process. In development Vite serves the UI on :5173 and proxies here.
const dist = new URL('./dist/', import.meta.url).pathname;
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[demo backend] contract host listening on http://localhost:${PORT}`);
  console.log(`[demo backend] ${MOCK_WARNING}`);
});
