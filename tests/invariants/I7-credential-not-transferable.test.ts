// I7 -- a credential cannot be presented by a holder other than the bound one.
//
// The threat: Mallory obtains everything that travels with a credential --
// the commitment, the issuer signature, the attribute values, the blinding
// factor, and a currently-valid Merkle path. All of that is either public or
// could plausibly leak. The ONLY thing she lacks is the holder secret.
//
// The attestation is signed over (tag, commitment, holderId) where holderId
// is derived from that secret, so presenting requires re-deriving an
// identifier Mallory cannot produce.

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, standardAttrs, ageAtLeast,
  bytes32, ADMIN_SECRET, VERIFIER_A, type PrivateState,
} from '../setup.js';

describe('I7: credentials are bound to their holder', () => {
  it('rejects a stolen credential presented with a different secret', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const alice = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, alice);

    // Mallory has stolen absolutely everything except the secret.
    const stolen: PrivateState = {
      localSecret: bytes32(999), // her own, not Alice's
      attributes: alice.attributes,
      blinding: alice.blinding,
      issuerSig: alice.signature!,
      merklePath: sim.path(alice.commitment),
    };

    await expect(
      sim.present(alice, issuer, VERIFIER_A, ageAtLeast(18n), { state: stolen }),
    ).rejects.toThrow();
  });

  it('still rejects when the thief also holds a legitimate credential', async () => {
    // Mallory is a real user with her own credential, so she cannot be
    // stopped merely by not being in the active set.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const alice = makeHolder(42, standardAttrs(BigInt(sim.time)));
    const mallory = makeHolder(999, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, alice);
    await sim.issue(issuer, mallory);

    // Mallory presents Alice's credential using Mallory's secret.
    const stolen: PrivateState = {
      localSecret: mallory.secret,
      attributes: alice.attributes,
      blinding: alice.blinding,
      issuerSig: alice.signature!,
      merklePath: sim.path(alice.commitment),
    };

    await expect(
      sim.present(alice, issuer, VERIFIER_A, ageAtLeast(18n), { state: stolen }),
    ).rejects.toThrow();
  });

  it('rejects a mismatched Merkle path (path for someone else, own credential)', async () => {
    // A holder whose own leaf is unusable tries to borrow a live one.
    // Caught by the explicit path.leaf == commitment binding in present().
    const sim = await Sim.deploy(ADMIN_SECRET);
    const issuer = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, issuer);

    const alice = makeHolder(42, standardAttrs(BigInt(sim.time)));
    const bob = makeHolder(43, standardAttrs(BigInt(sim.time)));
    await sim.issue(issuer, alice);
    await sim.issue(issuer, bob);

    const borrowed: PrivateState = {
      localSecret: bob.secret,
      attributes: bob.attributes,
      blinding: bob.blinding,
      issuerSig: bob.signature!,
      merklePath: sim.path(alice.commitment), // not Bob's leaf
    };

    await expect(
      sim.present(bob, issuer, VERIFIER_A, ageAtLeast(18n), { state: borrowed }),
    ).rejects.toThrow(/path is not for this credential/);
  });
});
