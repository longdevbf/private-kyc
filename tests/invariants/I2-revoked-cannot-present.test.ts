// I2 -- a revoked credential can never produce a valid presentation.
//
// Revocation tombstones the leaf AND clears the tree's root history. The
// history reset is the load-bearing part: HistoricMerkleTree.checkRoot
// accepts ANY past root, so without it a revoked holder could simply present
// against a pre-revocation root. The stale-path test below is what would
// catch that regression.

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, standardAttrs, ageAtLeast,
  ADMIN_SECRET, VERIFIER_A,
} from '../setup.js';

describe('I2: revoked credentials cannot be presented', () => {
  it('rejects a presentation made with a pre-revocation Merkle path', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);

    // The holder caches a valid path, exactly as a real wallet would.
    const stalePath = sim.path(holder.commitment);

    await sim.revoke(issuer, holder.leafIndex!);

    await expect(
      sim.present(holder, issuer, VERIFIER_A, ageAtLeast(18n), { path: stalePath }),
    ).rejects.toThrow(/not in the active set/);
  });

  it('leaves no path to rebuild after revocation', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, holder);
    await sim.revoke(issuer, holder.leafIndex!);

    // The leaf is gone, so the holder cannot even construct a fresh path.
    expect(sim.ledger().activeCredentials.findPathForLeaf(holder.commitment))
      .toBeUndefined();
    expect(() => sim.path(holder.commitment)).toThrow(/not present/);
  });

  it('revoking one holder does not permanently bar another (path refresh works)', async () => {
    // The honest cost of resetHistory(): everyone's path goes stale. This
    // test pins down that unaffected holders can recover by refreshing,
    // which is the behaviour the UI's "refresh path" button relies on.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const alice = makeHolder(42, standardAttrs(BigInt(sim.time)));
    const bob = makeHolder(43, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, alice);
    await sim.issue(issuer, bob);

    const bobStale = sim.path(bob.commitment);
    await sim.revoke(issuer, alice.leafIndex!);

    // Bob's cached path is now worthless...
    await expect(
      sim.present(bob, issuer, VERIFIER_A, ageAtLeast(18n), { path: bobStale }),
    ).rejects.toThrow(/not in the active set/);

    // ...but a refreshed one works.
    await sim.present(bob, issuer, VERIFIER_A, ageAtLeast(18n));
    expect(sim.ledger().spentNullifiers.size()).toBe(1n);
  });
});
