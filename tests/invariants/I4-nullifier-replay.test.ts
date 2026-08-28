// I4 -- a nullifier cannot be spent twice by the same verifier in one epoch.

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, standardAttrs, ageAtLeast, tierAtLeast,
  ADMIN_SECRET, VERIFIER_A, VERIFIER_B,
} from '../setup.js';

describe('I4: replay protection', () => {
  it('rejects a second presentation to the same verifier in the same epoch', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n)),
    ).rejects.toThrow(/nullifier already spent/);

    expect(sim.ledger().spentNullifiers.size()).toBe(1n);
  });

  it('rejects a replay even when a DIFFERENT predicate is requested', async () => {
    // The nullifier is deliberately independent of the predicate, so a
    // holder cannot get a second bite by asking a different question.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    await expect(
      sim.present(holder, issuer, VERIFIER_A, tierAtLeast(2n)),
    ).rejects.toThrow(/nullifier already spent/);
  });

  it('allows the same holder at a different verifier', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    await sim.present(holder, issuer, VERIFIER_B, ageAtLeast(18n));

    expect(sim.ledger().spentNullifiers.size()).toBe(2n);
  });

  it('allows re-presentation after the epoch advances', async () => {
    // Documented, intentional behaviour: revocation bumps the epoch, which
    // rotates every nullifier. Replay protection is per-epoch, not forever.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const alice = makeHolder(42, standardAttrs(BigInt(sim.time)));
    const bob = makeHolder(43, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, alice);
    await sim.issue(issuer, bob);

    await sim.present(alice, issuer, VERIFIER_A, ageAtLeast(18n));
    expect(sim.ledger().revocationEpoch).toBe(0n);

    // Revoking Bob bumps the epoch for everyone.
    await sim.revoke(issuer, bob.leafIndex!);
    expect(sim.ledger().revocationEpoch).toBe(1n);

    // Alice may now present to the same verifier again, under a new nullifier.
    await sim.present(alice, issuer, VERIFIER_A, ageAtLeast(18n));
    expect(sim.ledger().spentNullifiers.size()).toBe(2n);
  });
});
