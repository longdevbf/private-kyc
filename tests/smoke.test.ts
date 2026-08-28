// =====================================================================
// Smoke test -- de-risks the one composition the documentation never
// demonstrates: TypeScript-side pathForLeaf/findPathForLeaf feeding a
// witness, verified in-circuit by merkleTreePathRoot against checkRoot.
// (RESEARCH.md UNKNOWN #2.) If this passes, present() is wired correctly.
// =====================================================================

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, standardAttrs, ageAtLeast,
  ADMIN_SECRET, VERIFIER_A,
} from './setup.js';

describe('smoke: end-to-end lifecycle', () => {
  it('deploys and seals the admin identity', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    expect(sim.ledger().admin).toHaveLength(32);
    expect(sim.ledger().revocationEpoch).toBe(0n);
  });

  it('registers an issuer', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);
    expect(sim.ledger().issuerKeys.member(1n)).toBe(true);
  });

  it('issues a credential into the active set', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    expect(holder.leafIndex).toBe(0n);
    // The commitment is findable, which means the leaf really landed.
    expect(sim.ledger().activeCredentials.findPathForLeaf(holder.commitment))
      .toBeDefined();
  });

  it('THE CRITICAL ONE: a Merkle path built off-chain verifies in-circuit', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    // present() asserts merkleTreePathRoot(path) is an accepted root.
    // Reaching the end without throwing means insert()'s leaf hashing and
    // merkleTreePathRoot's leaf hashing agree.
    await sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n));

    expect(sim.ledger().spentNullifiers.size()).toBe(1n);
  });
});
