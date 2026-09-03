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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  Sim, makeHolder, bytes32, label32, nowSeconds,
  type CredentialAttrs, type Holder, type PredicateRequest,
} from '../core/engine.js';
import { MockCredentialAuthority, MOCK_WARNING, hex } from '../issuer/mockIssuer.js';
import type { MerkleTreeDigest, MerkleTreePath } from '@midnight-ntwrk/compact-runtime';

const PORT = Number(process.env.PORT ?? 4000);
const ADMIN_SECRET = bytes32(1);

// ---------------------------------------------------------------------
// Two engines, one shape
// ---------------------------------------------------------------------
// The demo can be driven two ways, and the difference between them is the
// most honest thing this UI has to say:
//
//   simulator   the circuits run in this process against an in-memory
//               ledger. Every assert is enforced. NO PROOF IS GENERATED,
//               so reported milliseconds are circuit execution.
//
//   onchain     the same lifecycle, compiled for the language version the
//               live networks accept, running as a deployed contract. Each
//               action generates a real zero-knowledge proof on a local
//               proof server and lands in a real block. Milliseconds are
//               proving time and block inclusion, and are labelled as
//               such.
//
// The on-chain half lives in a separate process because it needs
// compact-runtime 0.16.0 while this one needs 0.19.0, and those cannot
// share a dependency tree. This file talks to it over HTTP and maps its
// answer into the same shape the UI already consumes, so no component has
// to know which engine produced the state it is rendering.
const CHAIN_URL = process.env.CHAIN_SERVICE_URL ?? 'http://localhost:4100';

type Mode = 'simulator' | 'onchain';

// Held in a cell rather than a bare `let`: a module-level `let` initialised
// to a literal is narrowed to that literal, and every `=== 'onchain'` in
// this file would then be flagged as an impossible comparison.
//
// The default is the simulator, deliberately: a restart should not silently
// start spending DUST because of a choice made in a previous session. To
// come up on chain -- for a scripted demo, say -- ask for it explicitly:
//
//   ENGINE=onchain npm run dev:chain
//
// An unreachable service is not a startup failure. The mode is still set,
// the UI reports the on-chain engine as unavailable with the reason, and
// starting the service later is enough.
const engine: { mode: Mode } = {
  mode: process.env.ENGINE === 'onchain' ? 'onchain' : 'simulator',
};

async function chain(path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${CHAIN_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!r.ok) throw new Error(`chain service ${r.status} on ${path}`);
  return r.json();
}

/** Whether the on-chain service is answering, and on which network. */
async function chainProbe(): Promise<{ available: boolean; network?: string; contractAddress?: string; walletAddress?: string; reason?: string }> {
  try {
    // /health, not /state.
    //
    // This probe answers one question -- is the service there -- and it
    // used to ask it by fetching the whole demo state, which the service
    // builds by reading contract state through the indexer. That is a
    // round trip to a shared testnet, and it has been measured between 6
    // and 24 seconds depending on nothing this project controls. So the
    // probe kept timing out against a service that was running, and the
    // UI disabled the on-chain option and gave a reason that was false.
    // Raising the timeout was tried twice, 4s then 20s, and the second
    // failed the same way at 23.8s: the number was never the problem.
    // /health returns three values fixed at startup and touches nothing.
    const s = await Promise.race([
      chain('/health'),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), 5_000)),
    ] as const) as any;
    return {
      available: true,
      network: s.network,
      contractAddress: s.contractAddress,
      walletAddress: s.walletAddress,
    };
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

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
  // Seconds since the epoch: the unit every blockTime* comparison uses.
  sim = await Sim.deploy(ADMIN_SECRET, Number(nowSeconds()));
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
  const years = (n: bigint) => Number(n / 31_536_000n);
  switch (req.predicateId) {
    case 0: return `age >= ${years(req.threshold)}`;
    case 1: return `kycTier >= ${req.threshold}`;
    case 2: return `country in {${req.allowedCountries.filter((c) => c !== 0n).join(', ')}}`;
    default: return `unknown predicate ${req.predicateId}`;
  }
}

/** Public ledger state, as the chain sees it. Nothing private is included. */
// ---------------------------------------------------------------------
// On-chain deployment record
// ---------------------------------------------------------------------
// The deployable port in onchain/ writes one JSON file per network it has
// actually been deployed to. Reading them here lets the UI state, with a
// real contract address and transaction hash, what has and has not been
// put on a network -- rather than the UI having to hedge in prose.
//
// Read on every request, not cached, so a deployment that happens while
// the demo is running shows up without a restart.

type DeploymentRecord = {
  network: string;
  contractAddress: string;
  txId?: string;
  txHash?: string;
  blockHeight?: string;
  deployedAt: string;
  compiler: string;
  languageVersion: string;
  proofServer: string;
  indexer?: string;
};

const DEPLOYMENTS_DIR = join(import.meta.dirname, '..', 'onchain', 'deployments');

function deployments(): DeploymentRecord[] {
  if (!existsSync(DEPLOYMENTS_DIR)) return [];
  try {
    return readdirSync(DEPLOYMENTS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(DEPLOYMENTS_DIR, f), 'utf8')) as DeploymentRecord)
      .sort((a, b) => a.network.localeCompare(b.network));
  } catch {
    return [];
  }
}

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

/**
 * Map the on-chain service's answer into the shape the UI already reads.
 *
 * The mapping is deliberately total rather than a spread: every field the
 * UI depends on is named here, so a field the chain service does not have
 * fails loudly at the seam instead of arriving as `undefined` somewhere in
 * a component.
 */
function fromChain(s: any) {
  return {
    mockWarning: MOCK_WARNING,
    issuerRegistered: Boolean(s.issuerRegistered),
    issuerName: 'Mock National ID Authority',
    engine: {
      mode: 'onchain' as const,
      proofsGenerated: true,
      timingMeans: 'proof generation and block inclusion',
      runtime: '@midnight-ntwrk/compact-runtime 0.16.0 → on-chain runtime v3',
      network: s.network,
      contractAddress: s.contractAddress,
      feePayer: s.walletAddress,
      node: s.node,
      indexer: s.indexer,
    },
    deployments: deployments(),
    public: {
      issuers: s.public.issuers,
      merkleRoot: s.public.merkleRoot,
      nextLeafIndex: s.public.nextLeafIndex,
      revocationEpoch: s.public.revocationEpoch,
      spentNullifiers: s.public.spentNullifiers,
      admin: s.public.admin,
      // The chain's own clock is what the freshness window is checked
      // against; the browser's is only used for display, so this is the
      // wall clock at read time and is labelled as such in the UI.
      // Seconds, matching the simulator's clock and the chain's own unit.
    chainTime: Number(nowSeconds()),
    },
    credentials: s.credentials,
    holders: s.holders,
    presentations: s.presentations,
    receipts: s.receipts,
  };
}

app.get('/api/state', async (_req, res) => {
  if (engine.mode === 'onchain') {
    try {
      return res.json(fromChain(await chain('/state')));
    } catch (e) {
      // Falling back silently would be the wrong thing: the UI would show
      // simulator state while claiming to be on chain. Say what happened.
      return res.status(503).json({
        error: 'onchain',
        reason: `the on-chain service at ${CHAIN_URL} is not answering: ${reasonOf(e)}`,
      });
    }
  }
  res.json({
    mockWarning: MOCK_WARNING,
    issuerRegistered: registered,
    issuerName: authority.name,
    // What this demo instance is, stated as data rather than prose so the
    // UI cannot drift from the truth. `simulator` means the circuits run
    // here against an in-memory ledger with no proof generated; the
    // deployments list is the separate, real on-chain record.
    engine: {
      mode: 'simulator' as const,
      proofsGenerated: false,
      timingMeans: 'circuit execution',
      runtime: '@midnight-ntwrk/compact-runtime',
    },
    deployments: deployments(),
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
  // Reset is a simulator affordance and stays one. There is no reset for a
  // deployed contract: what is on the chain is on the chain. Saying so is
  // more useful than quietly resetting the wrong thing.
  if (engine.mode === 'onchain') {
    return res.status(400).json({
      ok: false,
      reason:
        'the deployed contract cannot be reset — its state is on the network. ' +
        'Switch to the simulator to start over.',
    });
  }
  await reset();
  res.json({ ok: true });
});

/**
 * Forward an action to the on-chain service and pass its answer through
 * unchanged.
 *
 * A refused call is a RESULT, not a transport failure -- the contract said
 * no, which is the outcome several of the invariants exist to produce -- so
 * the service answers 200 with `ok:false` and the reason, and that is what
 * reaches the UI. A non-200 here means the service itself is unreachable
 * or broken, which is a different thing and is reported as 503.
 */
async function proxy(res: express.Response, path: string, body: unknown) {
  const started = performance.now();
  try {
    const out = await chain(path, body);
    return res.json({ ...out, ms: out.ms ?? Math.round(performance.now() - started) });
  } catch (e) {
    return res.status(503).json({ ok: false, reason: reasonOf(e) });
  }
}

// --- Paying from the visitor's own wallet ------------------------------
// A prepared transaction is proven but unbalanced. The browser hands it to
// a connected Midnight wallet, which adds the fee from its own DUST and
// relays it. These two routes are the only ones that path needs.

app.post('/api/chain/prepare', async (req, res) => {
  if (engine.mode !== 'onchain') {
    return res.status(400).json({
      ok: false,
      reason: 'preparing a transaction for a wallet requires the on-chain engine',
    });
  }
  return proxy(res, '/prepare', req.body ?? {});
});

app.post('/api/chain/confirm', async (req, res) => {
  if (engine.mode !== 'onchain') {
    return res.status(400).json({ ok: false, reason: 'not on chain' });
  }
  return proxy(res, '/confirm', req.body ?? {});
});

/**
 * Describe a transaction a browser wallet built, without submitting it.
 *
 * A wallet's submission was refused with `Custom error: 182` while the
 * identical prepared transaction was accepted when this project's own
 * wallet balanced it. The one thing nobody could see was what the wallet
 * produced in between, so the page sends it here when a submission fails
 * and the chain service prints what it contains.
 */
app.post('/api/chain/inspect', async (req, res) => {
  if (engine.mode !== 'onchain') {
    return res.status(400).json({ ok: false, reason: 'not on chain' });
  }
  return proxy(res, '/inspect', req.body ?? {});
});

// --- Which engine is driving -----------------------------------------

app.get('/api/engine', async (_req, res) => {
  res.json({ mode: engine.mode, chain: await chainProbe(), chainUrl: CHAIN_URL });
});

app.post('/api/engine', async (req, res) => {
  const wanted = req.body?.mode as Mode | undefined;
  if (wanted !== 'simulator' && wanted !== 'onchain') {
    return res.status(400).json({ ok: false, reason: 'mode must be simulator or onchain' });
  }
  if (wanted === 'onchain') {
    const probe = await chainProbe();
    if (!probe.available) {
      return res.status(503).json({
        ok: false,
        reason:
          `no on-chain service at ${CHAIN_URL}. Start it with ` +
          `\`cd onchain && npx tsx src/service.ts preview\`, which needs a deployed ` +
          `contract and a funded wallet. (${probe.reason})`,
      });
    }
  }
  engine.mode = wanted;
  res.json({ ok: true, mode: engine.mode });
});

// --- Issuer -----------------------------------------------------------

app.post('/api/issuer/register', async (_req, res) => {
  if (engine.mode === 'onchain') return proxy(res, '/register-issuer', {});
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
  if (engine.mode === 'onchain') {
    return proxy(res, '/issue', { holderName, label, ageYears, countryCode, kycTier, validDays });
  }
  try {
    const now = BigInt(sim.time);
    const attrs: CredentialAttrs = {
      birthTimestamp: now - BigInt(Math.round(Number(ageYears) * 31_536_000)),
      countryCode: BigInt(countryCode),
      kycTier: BigInt(kycTier),
      expiresAt: now + BigInt(Math.round(Number(validDays) * 86_400)),
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
  const { commitment, holderName } = req.body ?? {};
  // Both, because the chain service accepts either and forwarding only one
  // turns a mistyped request into `no credential issued to "undefined"`.
  if (engine.mode === 'onchain') return proxy(res, '/revoke', { commitment, holderName });
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
  // On chain there is no cached path to refresh: the path is rebuilt from
  // indexer state on every read, so it is never stale. Reporting success
  // is accurate, and the UI's staleness indicator simply never lights up.
  if (engine.mode === 'onchain') return res.json({ ok: true });
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
  if (engine.mode === 'onchain') {
    return proxy(res, '/present', {
      holderName,
      verifierId,
      predicateId: Number(predicateId),
      threshold: String(threshold ?? 0),
      allowedCountries: (allowedCountries ?? []).map((c: string | number) => Number(c)),
    });
  }
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
