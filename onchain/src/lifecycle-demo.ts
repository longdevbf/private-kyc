// =====================================================================
// The whole lifecycle, on a real network, printed with transaction hashes
// =====================================================================
//   npx tsx src/lifecycle-demo.ts preview
//
// This is the demo script from README §5, run against a deployed contract
// instead of a simulator. Every line it prints that carries a transaction
// hash is checkable in a block explorer or against the indexer; nothing
// here is narrated.
//
// It walks the same nine steps and asserts the same outcomes the test
// suite asserts, including the three refusals -- a replayed nullifier, a
// revoked credential, and a stale Merkle path. A refusal that does not
// happen is a failure, and this exits non-zero for it.
//
// It is slow on purpose: each step is a real proof and a real block.
//
// THE ISSUER IS MOCKED. Being on a network changes nothing about that.
// =====================================================================

import { randomBytes } from 'node:crypto';

import { ChainClient } from './chain.js';
import { loadOrCreateAuthority } from './authority.js';
import {
  FRESHNESS_WINDOW_SEC,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  PredicateId,
  bytes32,
  countries,
  hex,
  label32,
  makeIssuer,
  nowSeconds,
  rebuildHolder,
  type PredicateRequest,
} from './engine.js';

const network = process.argv[2] ?? 'preview';
const { adminSecret: ADMIN_SECRET, issuer: AUTHORITY_ISSUER } = loadOrCreateAuthority(network);

const ALPHA = label32('verifier:alpha-exchange');
const BETA = label32('verifier:beta-lending');

const over18: PredicateRequest = {
  predicateId: PredicateId.AGE_AT_LEAST,
  threshold: 18n * SECONDS_PER_YEAR,
  allowedCountries: countries(),
};

let failures = 0;

function step(n: number, title: string) {
  console.log(`\n${'─'.repeat(66)}\n${n}. ${title}`);
}

function report(r: {
  txHash?: string; txId?: string; blockHeight?: string;
  proveMs?: number; totalMs: number; asOfAgeSec?: number;
}) {
  console.log(`   tx      ${r.txHash ?? r.txId ?? '(none)'}`);
  if (r.blockHeight) console.log(`   block   ${r.blockHeight}`);
  console.log(
    `   timing  ${r.proveMs !== undefined ? `${r.proveMs} ms proving` : 'proved'}` +
      ` · ${(r.totalMs / 1000).toFixed(1)}s to inclusion`,
  );
  if (r.asOfAgeSec !== undefined) {
    const used = ((r.asOfAgeSec / Number(FRESHNESS_WINDOW_SEC)) * 100).toFixed(0);
    console.log(`   asOf    ${r.asOfAgeSec}s old — ${used}% of the ${FRESHNESS_WINDOW_SEC}s freshness window`);
  }
}

/** Assert that a call is refused, and refused for the stated reason. */
async function mustRefuse(what: string, pattern: RegExp, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`   ✗ ${what} was ACCEPTED — it should have been refused`);
    failures += 1;
  } catch (e) {
    const chain: string[] = [];
    let cur: any = e;
    while (cur) {
      chain.push(cur.message ?? String(cur));
      cur = cur.cause;
    }
    const text = chain.join(' — ');
    if (pattern.test(text)) {
      // Print the contract's whole assertion message, not just the fragment the
      // pattern happened to match — `not in the active` reads like a truncation
      // bug in a transcript people are meant to check.
      const assertion = text.match(/failed assert: [^\n—]+/)?.[0] ?? text.match(pattern)?.[0];
      console.log(`   ✓ refused: ${assertion}`);
    } else {
      console.log(`   ✗ refused, but not for the expected reason:\n     ${text}`);
      failures += 1;
    }
  }
}

const client = await ChainClient.connect(network);

console.log(`\ncontract  ${client.contractAddress}`);
console.log(`network   ${client.cfg.name}`);
console.log(`fee payer ${client.walletAddress}`);

try {
  const issuer = AUTHORITY_ISSUER;

  // -------------------------------------------------------------------
  step(1, 'Register the issuer');
  const l0 = await client.ledger();
  if (l0.issuerAuth.member(issuer.id)) {
    console.log('   already registered on this contract — skipping');
  } else {
    report(await client.registerIssuer(ADMIN_SECRET, issuer));
  }

  // -------------------------------------------------------------------
  step(2, 'Issue a credential to Alice');
  // Random key material, not a fixed seed. On a chain the state persists
  // between runs: a deterministic holder would produce the same leaf and
  // the same nullifiers every time, so the second run would be refused
  // for replay rather than tested.
  const alice = rebuildHolder(
    new Uint8Array(randomBytes(32)),
    new Uint8Array(randomBytes(32)),
    {
      birthTimestamp: nowSeconds() - 30n * SECONDS_PER_YEAR,
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: nowSeconds() + 365n * SECONDS_PER_DAY,
    },
  );
  report(await client.issue(issuer, alice));
  console.log(`   leaf    ${alice.leafIndex}`);
  console.log('   the ledger received a commitment. The age, country and tier did not.');

  // -------------------------------------------------------------------
  step(3, 'Present to Alpha Exchange — "is Alice over 18?"');
  const nAlpha = hex(await client.expectedNullifier(alice, ALPHA));
  report(await client.present(alice, issuer, ALPHA, over18));
  console.log(`   nullifier ${nAlpha}`);

  // -------------------------------------------------------------------
  step(4, 'Present to Beta Lending — same person, same question');
  const nBeta = hex(await client.expectedNullifier(alice, BETA));
  report(await client.present(alice, issuer, BETA, over18));
  console.log(`   nullifier ${nBeta}`);

  // -------------------------------------------------------------------
  step(5, 'Linkage test — can the two verifiers tell it was the same person?');
  const a = nAlpha.match(/../g) ?? [];
  const b = nBeta.match(/../g) ?? [];
  const shared = a.filter((x, i) => x === b[i]).length;
  console.log(`   bytes in common: ${shared} of 32`);
  if (shared === 0) {
    console.log('   ✓ nothing links them');
  } else {
    console.log('   ✗ the two nullifiers share bytes at the same positions');
    failures += 1;
  }

  // -------------------------------------------------------------------
  step(6, 'Present to Alpha again — must be refused (I4)');
  await mustRefuse('a replayed presentation', /already spent/i, () =>
    client.present(alice, issuer, ALPHA, over18),
  );

  // -------------------------------------------------------------------
  step(7, 'Keep a copy of the Merkle path, then revoke Alice');
  const stalePath = await client.path(alice.leaf!);
  report(await client.revoke(issuer, alice.leafIndex!));
  console.log('   root history cleared, epoch advanced');

  // -------------------------------------------------------------------
  step(8, 'Present with the pre-revocation path — must be refused (I2)');
  await mustRefuse('a revoked credential', /active set|not in the active/i, () =>
    client.present(alice, issuer, ALPHA, over18, { path: stalePath }),
  );

  // -------------------------------------------------------------------
  step(9, 'Rebuilding the path is impossible — the leaf is gone');
  try {
    await client.path(alice.leaf!);
    console.log('   ✗ a path was still found for a revoked leaf');
    failures += 1;
  } catch {
    console.log('   ✓ leaf not present in the active set');
  }

  console.log(`\n${'─'.repeat(66)}`);
  if (failures === 0) {
    console.log('All steps behaved as specified, on a live network.');
  } else {
    console.log(`${failures} step(s) did NOT behave as specified.`);
  }
} finally {
  await client.close();
}

process.exit(failures === 0 ? 0 : 1);
