// The full intended lifecycle, end to end, exercising the real circuits.

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, standardAttrs,
  ageAtLeast, tierAtLeast, countryIn,
  ADMIN_SECRET, VERIFIER_A, VERIFIER_B,
} from './setup.js';

describe('happy path: issue -> present -> revoke', () => {
  it('walks the whole lifecycle', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);

    // --- admin authorises an issuer ------------------------------------
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    expect(sim.ledger().issuerKeys.size()).toBe(1n);

    // --- issuance -------------------------------------------------------
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);
    expect(sim.ledger().activeCredentials.firstFree()).toBe(1n);

    // --- presentation ---------------------------------------------------
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    expect(sim.ledger().spentNullifiers.size()).toBe(1n);

    // --- revocation -----------------------------------------------------
    await sim.revoke(issuer, holder.leafIndex!);
    expect(sim.ledger().revocationEpoch).toBe(1n);

    // --- and the credential is dead --------------------------------------
    await expect(
      sim.present(holder, issuer, VERIFIER_B, ageAtLeast(18n)),
    ).rejects.toThrow();
  });

  it('supports all three predicates on one credential', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    // Each to a different verifier, since one nullifier is spent per pairing.
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    await sim.present(holder, issuer, VERIFIER_B, tierAtLeast(2n));
    await sim.present(holder, issuer, new Uint8Array(32).fill(3), countryIn(704n, 840n));

    expect(sim.ledger().spentNullifiers.size()).toBe(3n);
  });

  it('serves many holders from one issuer', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holders = [1, 2, 3, 4, 5].map((i) =>
      makeHolder(100 + i, standardAttrs(BigInt(sim.time))),
    );
    for (const h of holders) await sim.issue(issuer, h);

    expect(sim.ledger().activeCredentials.firstFree()).toBe(5n);

    // Each presents to the same verifier; all succeed with distinct nullifiers.
    for (const h of holders) {
      await sim.present(h, issuer, VERIFIER_A, ageAtLeast(18n));
    }
    expect(sim.ledger().spentNullifiers.size()).toBe(5n);
  });

  it('supports multiple registered issuers', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const gov = makeIssuer(1n);
    const bank = makeIssuer(2n);
    await sim.registerIssuer(ADMIN_SECRET, gov);
    await sim.registerIssuer(ADMIN_SECRET, bank);

    const a = makeHolder(60, standardAttrs(BigInt(sim.time)));
    const b = makeHolder(61, standardAttrs(BigInt(sim.time)));
    await sim.issue(gov, a);
    await sim.issue(bank, b);

    await sim.present(a, gov, VERIFIER_A, ageAtLeast(18n));
    await sim.present(b, bank, VERIFIER_A, ageAtLeast(18n));

    expect(sim.ledger().spentNullifiers.size()).toBe(2n);
  });
});
