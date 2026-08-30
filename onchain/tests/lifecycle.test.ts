// =====================================================================
// Invariants of the deployable (language 0.23) port
// =====================================================================
// These mirror the reference suite in ../../tests, with two differences
// that follow from the port's authorisation model:
//
//   * The signature-forgery tests are replaced by secret-knowledge tests.
//     "Forge a Schnorr signature" has no meaning here; "call issue without
//     the issuer's secret" is the equivalent attack and is what is tested.
//   * The Merkle leaf is credentialLeaf(commitment, holderId, issuerId)
//     rather than the bare commitment, so the binding tests target that.
//
// Every assertion below is enforced by the compiled circuit, not by this
// file. A test that passes means the circuit rejected the input.
// =====================================================================

import { describe, expect, it, beforeEach } from 'vitest';
import {
  Sim,
  makeIssuer,
  makeHolder,
  leafFor,
  bytes32,
  label32,
  countries,
  noCountries,
  hex,
  blankPrivateState,
  SECONDS_PER_YEAR,
  FRESHNESS_WINDOW_SEC,
  PredicateId,
  type CredentialAttrs,
  type MockIssuer,
  type Holder,
} from '../src/engine.js';

const START = 1_700_000_000;
const ADMIN = bytes32(1);

const ALPHA = label32('verifier:alpha-exchange');
const BETA = label32('verifier:beta-lending');

const adult = (): CredentialAttrs => ({
  birthTimestamp: BigInt(START) - 30n * SECONDS_PER_YEAR,
  countryCode: 704n,
  kycTier: 3n,
  expiresAt: BigInt(START) + SECONDS_PER_YEAR,
});

const ageAtLeast = (years: bigint) => ({
  predicateId: PredicateId.AGE_AT_LEAST,
  threshold: years * SECONDS_PER_YEAR,
  allowedCountries: noCountries(),
});

const tierAtLeast = (tier: bigint) => ({
  predicateId: PredicateId.TIER_AT_LEAST,
  threshold: tier,
  allowedCountries: noCountries(),
});

const countryIn = (...codes: bigint[]) => ({
  predicateId: PredicateId.COUNTRY_IN_SET,
  threshold: 0n,
  allowedCountries: countries(...codes),
});

describe('deployable port — language 0.23', () => {
  let sim: Sim;
  let issuer: MockIssuer;
  let alice: Holder;

  beforeEach(async () => {
    sim = await Sim.deploy(ADMIN, START);
    issuer = makeIssuer(1n);
    alice = makeHolder(42, adult());
    await sim.registerIssuer(ADMIN, issuer);
  });

  // -------------------------------------------------------- happy path

  it('issues, then presents against two verifiers', async () => {
    await sim.issue(issuer, alice);
    await sim.present(alice, issuer, ALPHA, ageAtLeast(18n));
    await sim.present(alice, issuer, BETA, tierAtLeast(2n));
    expect(sim.ledger().spentNullifiers.size()).toBe(2n);
  });

  it('accepts all three predicates', async () => {
    await sim.issue(issuer, alice);
    await sim.present(alice, issuer, ALPHA, ageAtLeast(18n));
    await sim.present(alice, issuer, BETA, tierAtLeast(3n));
    await sim.present(alice, issuer, label32('v:three'), countryIn(704n, 840n));
    expect(sim.ledger().spentNullifiers.size()).toBe(3n);
  });

  it('rejects a predicate that does not hold', async () => {
    const minor = makeHolder(7, { ...adult(), birthTimestamp: BigInt(START) - 10n * SECONDS_PER_YEAR });
    await sim.issue(issuer, minor);
    await expect(sim.present(minor, issuer, ALPHA, ageAtLeast(18n))).rejects.toThrow(
      /predicate not satisfied/,
    );
  });

  it('rejects a country outside the allowed set', async () => {
    await sim.issue(issuer, alice);
    await expect(sim.present(alice, issuer, ALPHA, countryIn(840n, 392n))).rejects.toThrow(
      /predicate not satisfied/,
    );
  });

  // ------------------------------------------------- I1 no plaintext

  it('I1 — no attribute value appears anywhere in public state', async () => {
    await sim.issue(issuer, alice);
    await sim.present(alice, issuer, ALPHA, ageAtLeast(18n));

    const dump = sim.rawState();
    for (const v of [
      alice.attributes.birthTimestamp,
      alice.attributes.expiresAt,
      alice.attributes.countryCode,
    ]) {
      expect(dump).not.toContain(String(v));
    }
    // The blinding factor and the holder's secret must not be there either.
    expect(dump).not.toContain(hex(alice.blinding));
    expect(dump).not.toContain(hex(alice.secret));
  });

  // ------------------------------------------------- I2 revocation

  it('I2 — a revoked credential cannot present', async () => {
    await sim.issue(issuer, alice);
    const path = sim.path(alice.leaf!);
    await sim.revoke(issuer, alice.leafIndex!);

    // Even with the path captured before revocation, which is the strongest
    // form of this attack: resetHistory() is what closes it.
    await expect(
      sim.present(alice, issuer, ALPHA, ageAtLeast(18n), { path }),
    ).rejects.toThrow(/not in the active set/);
  });

  it('I2 — revocation invalidates an UNREVOKED holder\'s cached path too', async () => {
    const bob = makeHolder(99, adult());
    await sim.issue(issuer, alice);
    await sim.issue(issuer, bob);

    const bobPath = sim.path(bob.leaf!);
    await sim.revoke(issuer, alice.leafIndex!);

    // This is the documented cost of the active-set design, asserted rather
    // than described, so it cannot quietly stop being true.
    await expect(
      sim.present(bob, issuer, ALPHA, ageAtLeast(18n), { path: bobPath }),
    ).rejects.toThrow(/not in the active set/);

    // ...and rebuilding the path restores service.
    await sim.present(bob, issuer, ALPHA, ageAtLeast(18n));
  });

  it('revoking an empty leaf index is refused', async () => {
    await expect(sim.revoke(issuer, 5n)).rejects.toThrow(/no credential at that leaf index/);
  });

  it('one issuer cannot revoke another issuer\'s credential', async () => {
    const other = makeIssuer(2n);
    await sim.registerIssuer(ADMIN, other);
    await sim.issue(issuer, alice);
    await expect(sim.revoke(other, alice.leafIndex!)).rejects.toThrow(
      /belongs to another issuer/,
    );
  });

  it('an occupied leaf index cannot be overwritten', async () => {
    const bob = makeHolder(99, adult());
    await sim.issue(issuer, alice, 0n);
    await expect(sim.issue(issuer, bob, 0n)).rejects.toThrow(/leaf index already in use/);
  });

  // ------------------------------------------------- I3 expiry

  it('I3 — an expired credential is rejected', async () => {
    const expired = makeHolder(8, { ...adult(), expiresAt: BigInt(START) - 1n });
    await sim.issue(issuer, expired);
    await expect(sim.present(expired, issuer, ALPHA, ageAtLeast(18n))).rejects.toThrow(
      /credential has expired/,
    );
  });

  it('I3 — asOf cannot be backdated to resurrect an expired credential', async () => {
    const attrs = { ...adult(), expiresAt: BigInt(START) + 1000n };
    const holder = makeHolder(9, attrs);
    await sim.issue(issuer, holder);
    sim.advance(60 * 60); // an hour later; the credential has expired

    // Backdating asOf to before expiry is the obvious attack. The freshness
    // window is what refuses it, using public values only.
    await expect(
      sim.present(holder, issuer, ALPHA, ageAtLeast(18n), { asOf: BigInt(START) }),
    ).rejects.toThrow(/asOf is stale/);
  });

  it('I3 — asOf cannot be set in the future', async () => {
    await sim.issue(issuer, alice);
    await expect(
      sim.present(alice, issuer, ALPHA, ageAtLeast(18n), {
        asOf: BigInt(sim.time) + FRESHNESS_WINDOW_SEC,
      }),
    ).rejects.toThrow(/asOf is in the future/);
  });

  // ------------------------------------------------- I4 replay

  it('I4 — presenting twice to the same verifier is refused', async () => {
    await sim.issue(issuer, alice);
    await sim.present(alice, issuer, ALPHA, ageAtLeast(18n));
    await expect(sim.present(alice, issuer, ALPHA, ageAtLeast(18n))).rejects.toThrow(
      /nullifier already spent/,
    );
  });

  it('I4 — a nullifier spent in one epoch is usable in the next', async () => {
    const bob = makeHolder(99, adult());
    await sim.issue(issuer, alice);
    await sim.issue(issuer, bob);
    await sim.present(alice, issuer, ALPHA, ageAtLeast(18n));

    await sim.revoke(issuer, bob.leafIndex!); // moves the epoch
    await sim.present(alice, issuer, ALPHA, ageAtLeast(18n));
    expect(sim.ledger().revocationEpoch).toBe(1n);
  });

  // ------------------------------------------------- I5 unlinkability

  it('I5 — nullifiers at two verifiers share almost no bytes', async () => {
    await sim.issue(issuer, alice);

    const a = sim.expectedNullifier(alice, ALPHA);
    const b = sim.expectedNullifier(alice, BETA);
    expect(hex(a)).not.toBe(hex(b));

    const shared = [...a].filter((byte, i) => byte === b[i]).length;
    // 32 independent bytes agree by chance ~0.125 times on average. Three is
    // a generous ceiling that still fails loudly if the salting is dropped.
    expect(shared).toBeLessThanOrEqual(3);
  });

  it('I5 — the predicted nullifier is exactly what the circuit spends', async () => {
    await sim.issue(issuer, alice);
    const predicted = sim.expectedNullifier(alice, ALPHA);
    await sim.present(alice, issuer, ALPHA, ageAtLeast(18n));

    // If the TypeScript epoch encoding ever drifted from the circuit's
    // `revocationEpoch as Bytes<32>`, this is where it would show.
    expect(sim.ledger().spentNullifiers.member(predicted)).toBe(true);
  });

  it('I5 — two different holders produce different nullifiers at one verifier', async () => {
    const bob = makeHolder(99, adult());
    await sim.issue(issuer, alice);
    await sim.issue(issuer, bob);
    expect(hex(sim.expectedNullifier(alice, ALPHA))).not.toBe(
      hex(sim.expectedNullifier(bob, ALPHA)),
    );
  });

  // ------------------------------- I6 issuer authority (port-specific)

  it('I6 — an unregistered issuer cannot issue', async () => {
    const rogue = makeIssuer(77n);
    await expect(sim.issue(rogue, alice)).rejects.toThrow(/unregistered issuer/);
  });

  it('I6 — knowing the issuer id but not the secret is not enough', async () => {
    // The replacement for the signature-forgery test. The attacker has the
    // public registry entry and everything else; only the secret is missing.
    const impostor = { ...issuer, secret: bytes32(31337) };
    await expect(sim.issue(impostor, alice)).rejects.toThrow(
      /does not hold this issuer's secret/,
    );
  });

  it('I6 — the same applies to revocation', async () => {
    await sim.issue(issuer, alice);
    const impostor = { ...issuer, secret: bytes32(31337) };
    await expect(sim.revoke(impostor, alice.leafIndex!)).rejects.toThrow(
      /does not hold this issuer's secret/,
    );
  });

  it('I6 — only the admin may register an issuer', async () => {
    const other = makeIssuer(3n);
    await expect(sim.registerIssuer(bytes32(999), other)).rejects.toThrow(
      /caller is not the admin/,
    );
  });

  it('I6 — a credential cannot be presented under a different issuer id', async () => {
    const other = makeIssuer(2n);
    await sim.registerIssuer(ADMIN, other);
    await sim.issue(issuer, alice);

    // The issuer id is inside the leaf, so claiming a different one produces
    // a leaf that is not in the tree. The path lookup fails before the
    // circuit is even reached, which is itself the point: there is no path
    // to supply.
    expect(() => sim.path(leafFor(alice, other.id))).toThrow(/not present/);
  });

  // ------------------------------------------------- I7 holder binding

  it('I7 — a stolen credential is useless without the holder secret', async () => {
    await sim.issue(issuer, alice);
    const path = sim.path(alice.leaf!);

    // The thief has everything public plus the attribute values and the
    // blinding factor -- but not alice's secret.
    const thief = makeHolder(4242, alice.attributes);
    await expect(
      sim.present(thief, issuer, ALPHA, ageAtLeast(18n), {
        state: {
          ...blankPrivateState(),
          localSecret: thief.secret,
          attributes: alice.attributes,
          blinding: alice.blinding,
          merklePath: path,
        },
      }),
    ).rejects.toThrow(/Merkle path is not for this credential/);
  });

  it('I7 — substituting another holder\'s live path does not work', async () => {
    const bob = makeHolder(99, adult());
    await sim.issue(issuer, alice);
    await sim.issue(issuer, bob);

    // Alice presents bob's path. The leaf binding catches it.
    await expect(
      sim.present(alice, issuer, ALPHA, ageAtLeast(18n), { path: sim.path(bob.leaf!) }),
    ).rejects.toThrow(/Merkle path is not for this credential/);
  });

  it('I7 — claiming different attributes than were committed fails', async () => {
    await sim.issue(issuer, alice);
    const path = sim.path(alice.leaf!);

    await expect(
      sim.present(alice, issuer, ALPHA, ageAtLeast(18n), {
        state: {
          ...blankPrivateState(),
          localSecret: alice.secret,
          attributes: { ...alice.attributes, kycTier: 9n }, // upgraded tier
          blinding: alice.blinding,
          merklePath: path,
        },
      }),
    ).rejects.toThrow(/Merkle path is not for this credential/);
  });

  // ------------------------------------------------- registry hygiene

  it('an issuer cannot be registered twice', async () => {
    await expect(sim.registerIssuer(ADMIN, issuer)).rejects.toThrow(
      /issuer already registered/,
    );
  });

  it('presenting under an unregistered issuer id is refused', async () => {
    await sim.issue(issuer, alice);
    const ghost = makeIssuer(88n);
    await expect(
      sim.present(alice, issuer, ALPHA, ageAtLeast(18n), {
        state: sim.presentationState(alice),
      }).then(() => sim.present(alice, ghost, BETA, ageAtLeast(18n))),
    ).rejects.toThrow(/unregistered issuer/);
  });
});
