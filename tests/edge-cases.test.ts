// Adversarial and boundary cases that are not tied to a single invariant.

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, standardAttrs,
  ageAtLeast, tierAtLeast, countryIn,
  bytes32, ADMIN_SECRET, VERIFIER_A, MS_PER_YEAR, FRESHNESS_WINDOW_MS,
  type PrivateState,
} from './setup.js';

describe('access control', () => {
  it('rejects issuer registration by a non-admin', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const notAdmin = bytes32(777);
    await expect(
      sim.registerIssuer(notAdmin, makeIssuer(1n)),
    ).rejects.toThrow(/not the admin/);
  });

  it('rejects registering the same issuer id twice', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    await expect(
      sim.registerIssuer(ADMIN_SECRET, issuer),
    ).rejects.toThrow(/already registered/);
  });

  it('rejects revocation signed by an unregistered issuer', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    const rogue = makeIssuer(50n);
    await expect(sim.revoke(rogue, holder.leafIndex!)).rejects.toThrow(/unregistered issuer/);
  });

  it('rejects revoking a leaf index that holds no credential', async () => {
    // Previously this succeeded. The tree was unchanged, but the epoch still
    // bumped and resetHistory() still fired, so any registered issuer could
    // invalidate every holder's cached Merkle path for free -- an unlimited,
    // costless denial of service. The occupancy check closes it.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);
    const cached = sim.path(holder.commitment);

    await expect(sim.revoke(issuer, 500n)).rejects.toThrow(/no credential at that leaf index/);

    // Nothing moved: the epoch is untouched and the innocent path still works.
    expect(sim.ledger().revocationEpoch).toBe(0n);
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n), { path: cached });
    expect(sim.ledger().spentNullifiers.size()).toBe(1n);
  });

  it('stops one issuer revoking another issuer credential', async () => {
    // Both issuers are legitimately registered. Without an ownership check,
    // either could destroy the other's credentials at will.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const gov = makeIssuer(1n);
    const bank = makeIssuer(2n);
    await sim.registerIssuer(ADMIN_SECRET, gov);
    await sim.registerIssuer(ADMIN_SECRET, bank);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(gov, holder);

    await expect(sim.revoke(bank, holder.leafIndex!))
      .rejects.toThrow(/belongs to another issuer/);

    // The rightful issuer still can.
    await sim.revoke(gov, holder.leafIndex!);
    expect(sim.ledger().revocationEpoch).toBe(1n);
  });

  it('stops an issuer overwriting a live credential by reusing its slot', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const alice = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, alice);

    const mallory = makeHolder(99, standardAttrs(BigInt(sim.time)));
    await expect(sim.issue(issuer, mallory, alice.leafIndex!))
      .rejects.toThrow(/leaf index already in use/);
  });
});

describe('predicate boundaries', () => {
  // A holder who is exactly 18 years old to the millisecond.
  async function exactlyAged(years: bigint) {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const now = BigInt(sim.time);
    const holder = makeHolder(42, {
      birthTimestamp: now - years * MS_PER_YEAR,
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: now + 10n * MS_PER_YEAR,
    });
    await sim.issue(issuer, holder);
    return { sim, issuer, holder };
  }

  it('accepts age exactly at the threshold', async () => {
    const { sim, issuer, holder } = await exactlyAged(18n);
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    expect(sim.ledger().spentNullifiers.size()).toBe(1n);
  });

  it('rejects age one millisecond below the threshold', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const now = BigInt(sim.time);
    const holder = makeHolder(42, {
      birthTimestamp: now - 18n * MS_PER_YEAR + 1n, // one ms too young
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: now + 10n * MS_PER_YEAR,
    });
    await sim.issue(issuer, holder);
    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n)),
    ).rejects.toThrow(/predicate not satisfied/);
  });

  it('accepts age comfortably above the threshold', async () => {
    const { sim, issuer, holder } = await exactlyAged(40n);
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));
    expect(sim.ledger().spentNullifiers.size()).toBe(1n);
  });

  it('rejects a birth timestamp in the future', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const now = BigInt(sim.time);
    const holder = makeHolder(42, {
      birthTimestamp: now + 10n * MS_PER_YEAR, // not born yet
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: now + 20n * MS_PER_YEAR,
    });
    await sim.issue(issuer, holder);
    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n)),
    ).rejects.toThrow(/predicate not satisfied/);
  });

  it('handles tier exactly at, below, and above the threshold', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const now = BigInt(sim.time);
    const holder = makeHolder(42, {
      birthTimestamp: now - 30n * MS_PER_YEAR,
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: now + 10n * MS_PER_YEAR,
    });
    await sim.issue(issuer, holder);

    await sim.present(holder, issuer, VERIFIER_A, tierAtLeast(3n));            // exact
    await sim.present(holder, issuer, bytes32(11), tierAtLeast(2n));           // below
    await expect(
      sim.present(holder, issuer, bytes32(12), tierAtLeast(4n)),               // above
    ).rejects.toThrow(/predicate not satisfied/);
  });

  it('rejects a country outside the allowed set', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time))); // 704
    await sim.issue(issuer, holder);

    await expect(
      sim.present(holder, issuer, VERIFIER_A, countryIn(840n, 826n)),
    ).rejects.toThrow(/predicate not satisfied/);
  });

  it('does not let zero padding in the allowed list match a real credential', async () => {
    // countryIn() pads unused slots with 0. A holder whose code were 0 must
    // not slip through on the padding.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const now = BigInt(sim.time);
    const holder = makeHolder(42, {
      birthTimestamp: now - 30n * MS_PER_YEAR,
      countryCode: 840n,
      kycTier: 3n,
      expiresAt: now + 10n * MS_PER_YEAR,
    });
    await sim.issue(issuer, holder);

    // Only 704 permitted; the other seven slots are zero padding.
    await expect(
      sim.present(holder, issuer, VERIFIER_A, countryIn(704n)),
    ).rejects.toThrow(/predicate not satisfied/);
  });

  it('rejects an unknown predicate id (fails closed)', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    await expect(
      sim.present(holder, issuer, VERIFIER_A, {
        predicateId: 7, // not a defined PredicateId
        threshold: 0n,
        allowedCountries: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
      }),
    ).rejects.toThrow();
  });
});

describe('asOf freshness', () => {
  it('rejects an asOf in the future', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n), {
        asOf: BigInt(sim.time) + 60_000n,
      }),
    ).rejects.toThrow(/asOf is in the future/);
  });

  it('rejects an asOf older than the freshness window', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n), {
        asOf: BigInt(sim.time) - FRESHNESS_WINDOW_MS - 1n,
      }),
    ).rejects.toThrow(/asOf is stale/);
  });

  it('accepts an asOf just inside the window', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n), {
      asOf: BigInt(sim.time) - FRESHNESS_WINDOW_MS + 1n,
    });
    expect(sim.ledger().spentNullifiers.size()).toBe(1n);
  });

  it('cannot back-date asOf to resurrect an expired credential', async () => {
    // The attack the freshness lower bound exists to stop.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const now = BigInt(sim.time);
    const holder = makeHolder(42, {
      birthTimestamp: now - 30n * MS_PER_YEAR,
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: now + 1000n,
    });
    await sim.issue(issuer, holder);

    sim.advance(24 * 3_600_000); // a day later, long expired

    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n), { asOf: now }),
    ).rejects.toThrow(/asOf is stale/);
  });
});

describe('malformed Merkle paths', () => {
  it('rejects a path with a tampered sibling', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    const path = sim.path(holder.commitment) as any;
    path.path[0].sibling.field = path.path[0].sibling.field + 1n;

    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n), { path }),
    ).rejects.toThrow(/not in the active set/);
  });

  it('rejects a path with flipped direction bits', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const a = makeHolder(42, standardAttrs(BigInt(sim.time)));
    const b = makeHolder(43, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, a);
    await sim.issue(issuer, b);

    const path = sim.path(b.commitment) as any;
    for (const e of path.path) e.goes_left = !e.goes_left;

    await expect(
      sim.present(b, issuer, VERIFIER_A, ageAtLeast(18n), { path }),
    ).rejects.toThrow(/not in the active set/);
  });

  it('rejects a path for a credential that was never issued', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const real = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, real);

    const ghost = makeHolder(77, standardAttrs(BigInt(sim.time)));
    // Ghost was never issued, so no path exists for its commitment.
    expect(sim.ledger().activeCredentials.findPathForLeaf(ghost.commitment))
      .toBeUndefined();
  });
});

describe('attribute tampering', () => {
  it('rejects attributes that do not match the committed ones', async () => {
    // A holder tries to upgrade their own tier after issuance. The
    // commitment no longer matches, so the attestation fails.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    const tampered: PrivateState = {
      localSecret: holder.secret,
      attributes: { ...holder.attributes, kycTier: 9n },
      blinding: holder.blinding,
      issuerSig: holder.signature!,
      merklePath: sim.path(holder.commitment),
    };

    // Changing any attribute changes the commitment, so the attestation no
    // longer verifies. The signature check runs before the path check, so
    // that is the assertion that fires.
    await expect(
      sim.present(holder, issuer, VERIFIER_A, tierAtLeast(9n), { state: tampered }),
    ).rejects.toThrow(/invalid issuer signature/);
  });

  it('rejects a swapped blinding factor', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    const tampered: PrivateState = {
      localSecret: holder.secret,
      attributes: holder.attributes,
      blinding: bytes32(31337),
      issuerSig: holder.signature!,
      merklePath: sim.path(holder.commitment),
    };

    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n), { state: tampered }),
    ).rejects.toThrow(/invalid issuer signature/);
  });
});

describe('capacity', () => {
  // Depth 10 => 1024 leaves. Slow by design: this is the only test that
  // actually reaches isFull(), so it fills the tree rather than trusting it.
  it('refuses issuance once the tree is full', { timeout: 300_000 }, async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const attrs = standardAttrs(BigInt(sim.time));
    for (let i = 0; i < 1024; i++) {
      await sim.issue(issuer, makeHolder(10_000 + i, attrs), BigInt(i));
    }
    expect(sim.ledger().activeCredentials.isFull()).toBe(true);

    // The 1025th has nowhere to go.
    await expect(
      sim.issue(issuer, makeHolder(99_999, attrs), 1024n),
    ).rejects.toThrow();
  });
});
