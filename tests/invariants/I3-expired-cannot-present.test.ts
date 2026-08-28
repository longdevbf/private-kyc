// I3 -- an expired credential can never produce a valid presentation.
//
// Expiry is compared against the public `asOf` timestamp rather than via
// blockTimeLt(expiresAt), because the latter would disclose a bound on the
// private expiry date. See the privacy note in Predicates.compact.

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, standardAttrs, ageAtLeast,
  ADMIN_SECRET, VERIFIER_A, MS_PER_YEAR,
} from '../setup.js';

describe('I3: expired credentials cannot be presented', () => {
  it('rejects a credential whose expiry is already in the past', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const now = BigInt(sim.time);
    const holder = makeHolder(42, {
      birthTimestamp: now - 30n * MS_PER_YEAR,
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: now - 1n, // expired one millisecond ago
    });
    await sim.issue(issuer, holder);

    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n)),
    ).rejects.toThrow(/expired/);
  });

  it('rejects a credential that expires while it is held', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const now = BigInt(sim.time);
    const holder = makeHolder(42, {
      birthTimestamp: now - 30n * MS_PER_YEAR,
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: now + 3_600_000n, // valid for one hour
    });
    await sim.issue(issuer, holder);

    // Valid now.
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));

    // Two hours later it must not be.
    sim.advance(2 * 3_600_000);
    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n)),
    ).rejects.toThrow(/expired/);
  });

  it('accepts a credential expiring one millisecond in the future', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const now = BigInt(sim.time);
    const holder = makeHolder(42, {
      birthTimestamp: now - 30n * MS_PER_YEAR,
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: now + 1n,
    });
    await sim.issue(issuer, holder);
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    expect(sim.ledger().spentNullifiers.size()).toBe(1n);
  });
});
