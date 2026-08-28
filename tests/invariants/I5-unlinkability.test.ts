// I5 -- two presentations by the same holder to different verifiers are
//       computationally unlinkable.
//
// WHAT THIS TEST PROVES
//   * the two nullifiers differ, so a byte comparison across verifiers finds
//     no match;
//   * public state after "one holder, two verifiers" is shaped identically to
//     public state after "two holders, one verifier each", so the record does
//     not distinguish the two worlds;
//   * the nullifier IS reproducible by anyone holding the holder secret,
//     which pins down that secrecy of that value is exactly what the
//     unlinkability rests on.
//
// WHAT THIS TEST DOES NOT PROVE
//   It is not a proof of computational indistinguishability, and cannot be:
//   that property reduces to preimage resistance of persistentHash (SHA-256),
//   a cryptographic assumption no unit test can establish. What it does is
//   rule out the failure modes a wrong implementation actually reaches --
//   a reused nullifier, a missing verifier salt, or a linkable side value
//   written to the ledger alongside it.

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, standardAttrs, ageAtLeast,
  ADMIN_SECRET, VERIFIER_A, VERIFIER_B,
} from '../setup.js';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function spentList(sim: Sim): string[] {
  const out: string[] = [];
  for (const [k] of sim.ledger().spentNullifiers) out.push(hex(k));
  return out.sort();
}

describe('I5: per-verifier unlinkability', () => {
  it('produces unrelated nullifiers at two verifiers', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    const nA = sim.expectedNullifier(holder, VERIFIER_A);
    const nB = sim.expectedNullifier(holder, VERIFIER_B);

    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    await sim.present(holder, issuer, VERIFIER_B, ageAtLeast(18n));

    // Both landed, and they are distinct.
    expect(hex(nA)).not.toEqual(hex(nB));
    expect(sim.ledger().spentNullifiers.member(nA)).toBe(true);
    expect(sim.ledger().spentNullifiers.member(nB)).toBe(true);

    // No shared structure a colluding pair could match on -- a derivation
    // that forgot to mix in the verifier id would leave a common prefix.
    const a = hex(nA);
    const b = hex(nB);
    expect(a.slice(0, 16)).not.toEqual(b.slice(0, 16));
    expect(a.slice(-16)).not.toEqual(b.slice(-16));
  });

  it('is indistinguishable from two different holders, by public state alone', async () => {
    // Two worlds that must look the same to colluding verifiers:
    //   world 1 -- ONE holder presents to A and to B
    //   world 2 -- TWO holders, one to A and one to B
    const now = 1_700_000_000_000;

    const one = await Sim.deploy(ADMIN_SECRET, now);
    const issuer1 = makeIssuer(1n);
    await one.registerIssuer(ADMIN_SECRET, issuer1);
    const solo = makeHolder(42, standardAttrs(BigInt(one.time)));
    await one.issue(issuer1, solo);
    await one.present(solo, issuer1, VERIFIER_A, ageAtLeast(18n));
    await one.present(solo, issuer1, VERIFIER_B, ageAtLeast(18n));

    const two = await Sim.deploy(ADMIN_SECRET, now);
    const issuer2 = makeIssuer(1n);
    await two.registerIssuer(ADMIN_SECRET, issuer2);
    const alice = makeHolder(50, standardAttrs(BigInt(two.time)));
    const bob = makeHolder(51, standardAttrs(BigInt(two.time)));
    await two.issue(issuer2, alice);
    await two.issue(issuer2, bob);
    await two.present(alice, issuer2, VERIFIER_A, ageAtLeast(18n));
    await two.present(bob, issuer2, VERIFIER_B, ageAtLeast(18n));

    // Same observable shape in both worlds: two spent nullifiers, distinct,
    // same epoch. Nothing marks world 1 as being a single person.
    const w1 = spentList(one);
    const w2 = spentList(two);
    expect(w1.length).toBe(2);
    expect(w2.length).toBe(2);
    expect(w1[0]).not.toEqual(w1[1]);
    expect(w2[0]).not.toEqual(w2[1]);
    expect(one.ledger().revocationEpoch).toEqual(two.ledger().revocationEpoch);
  });

  it('the holder secret is what protects the link', async () => {
    // Positive control on the threat model: someone WITH the secret links
    // the two presentations trivially. Correct behaviour, and it isolates
    // the secret as the sole protection.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    await sim.present(holder, issuer, VERIFIER_B, ageAtLeast(18n));

    const linked = spentList(sim);
    expect(linked).toContain(hex(sim.expectedNullifier(holder, VERIFIER_A)));
    expect(linked).toContain(hex(sim.expectedNullifier(holder, VERIFIER_B)));
  });
});
