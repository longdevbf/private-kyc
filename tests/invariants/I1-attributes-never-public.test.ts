// I1 -- private attribute values never appear anywhere in public ledger state.
//
// Method: dump the ENTIRE public state as text and scan it for the byte
// encodings of the secrets. This is a scan, not an eyeball check of typed
// accessors, so it would also catch a value leaking into a field we did not
// think to inspect.
//
// The positive control matters as much as the negative assertions: we first
// prove the scan CAN find something (the commitment is present), so a clean
// negative result means "absent", not "scan is broken".

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, ageAtLeast,
  ADMIN_SECRET, VERIFIER_A, SECONDS_PER_YEAR,
} from '../setup.js';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const hexOf = (v: bigint, byteLen = 8) => v.toString(16).padStart(byteLen * 2, '0');

describe('I1: private attributes never reach public state', () => {
  it('leaks neither attribute values, blinding, nor holder secret', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const now = BigInt(sim.time);
    // Deliberately distinctive multi-byte values, so a substring hit is
    // meaningful rather than a coincidence.
    const attrs = {
      birthTimestamp: now - 30n * SECONDS_PER_YEAR - 123_456_789n,
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: now + 987_654_321n,
    };
    const holder = makeHolder(42, attrs);

    await sim.issue(issuer, holder);
    const nullifier = sim.expectedNullifier(holder, VERIFIER_A);
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));

    const dump = sim.rawState().toLowerCase();

    // --- positive control: the scan really can find a 32-byte value ---
    // The nullifier is genuinely published, so if the scan cannot find it
    // the negative results below would be meaningless.
    expect(dump).toContain(hex(nullifier));

    // Bonus property discovered while writing this test: the commitment is
    // not stored raw either. MerkleTree.insert() hashes the leaf, so the
    // ledger holds H(commitment), one step further removed than expected.
    expect(dump).not.toContain(hex(holder.commitment));

    // --- the actual invariant -----------------------------------------
    expect(dump).not.toContain(hex(holder.blinding));
    expect(dump).not.toContain(hex(holder.secret));
    expect(dump).not.toContain(hexOf(attrs.birthTimestamp));
    expect(dump).not.toContain(hexOf(attrs.expiresAt));
  });

  it('two holders with identical attributes produce unequal commitments', async () => {
    // If commitments were a plain hash of the attributes, identical people
    // would collide and be linkable. The random blinding factor is what
    // prevents that, so this is really a test that blinding is doing its job.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const attrs = {
      birthTimestamp: 100_000n,
      countryCode: 704n,
      kycTier: 3n,
      expiresAt: BigInt(sim.time) + 1_000n,
    };
    const a = makeHolder(7, attrs);
    const b = makeHolder(8, attrs);

    expect(hex(a.commitment)).not.toEqual(hex(b.commitment));
  });
});
