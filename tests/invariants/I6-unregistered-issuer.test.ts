// I6 -- a credential signed by an unregistered issuer is rejected.
//
// Two distinct failure modes are covered, because they fail at different
// places and a naive implementation could pass one while failing the other:
//   * the issuer id is not in the registry at all;
//   * the id IS registered, but the signature was made with a different key.

import { describe, it, expect } from 'vitest';
import {
  Sim, makeIssuer, makeHolder, standardAttrs, ageAtLeast,
  signAttestation, ADMIN_SECRET, VERIFIER_A,
} from '../setup.js';

describe('I6: unregistered issuers are rejected', () => {
  it('rejects issuance under an unregistered issuer id', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const rogue = makeIssuer(99n); // never registered

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await expect(sim.issue(rogue, holder)).rejects.toThrow(/unregistered issuer/);
  });

  it('rejects a signature from a key other than the registered one', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const real = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, real);

    // Same id, different keypair -- an impersonation attempt.
    const impostor = { ...makeIssuer(1n), id: 1n };
    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));

    await expect(sim.issue(impostor, holder)).rejects.toThrow();
  });

  it('rejects presentation of a credential attested by a foreign key', async () => {
    // The credential is legitimately in the active set, but the attestation
    // travelling with it was signed by someone else. Membership alone must
    // not be enough to pass.
    const sim = await Sim.deploy(ADMIN_SECRET);
    const real = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, real);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(real, holder);

    // Swap in a signature from an unrelated key.
    const foreign = makeIssuer(7n);
    holder.signature = signAttestation(foreign, holder.commitment, holder.holderId);

    await expect(
      sim.present(holder, real, VERIFIER_A, ageAtLeast(18n)),
    ).rejects.toThrow();
  });

  it('rejects presentation naming an issuer id that does not exist', async () => {
    const sim = await Sim.deploy(ADMIN_SECRET);
    const real = makeIssuer(1n);
    await sim.registerIssuer(ADMIN_SECRET, real);

    const holder = makeHolder(42, standardAttrs(BigInt(sim.time)));
    await sim.issue(real, holder);

    const ghost = { ...real, id: 1234n };
    await expect(
      sim.present(holder, ghost, VERIFIER_A, ageAtLeast(18n)),
    ).rejects.toThrow(/unregistered issuer/);
  });
});
