// =====================================================================
//                    *** MOCK ISSUER — NOT A REAL KYC PROVIDER ***
// =====================================================================
//
// READ THIS BEFORE TRUSTING ANYTHING THIS SERVICE SAYS.
//
// This service generates a Jubjub keypair on startup and signs whatever
// attribute values it is handed. It performs NO identity verification of any
// kind. It does not check a passport, query a government register, run a
// sanctions screen, or verify that the person requesting a credential is who
// they claim to be. Anyone who can reach this HTTP endpoint can obtain a
// credential asserting anything they like.
//
// It exists so the rest of the system — issuance, revocation, per-verifier
// unlinkability, expiry — can be demonstrated end to end. Those parts are
// real. The identity assurance is not, and this project makes no claim to it.
//
// What IS real here: the Schnorr signature. It is produced with the runtime's
// own Jubjub primitives and is genuinely verified inside the zero-knowledge
// circuit. A credential this service did not sign cannot be presented.
//
// Replacing this with a real credential source is Wave 3 work.
// =====================================================================

import {
  makeIssuer,
  signAttestation,
  signRevocation,
  type CredentialAttrs,
  type MockIssuer,
} from '../core/engine.js';
import type { JubjubSchnorrSignature } from '@midnight-ntwrk/compact-runtime';

export const MOCK_WARNING =
  'MOCK ISSUER: no real-world identity verification is performed. ' +
  'Attribute values are accepted as supplied and signed without checking.';

/**
 * A mock credential authority. Holds the signing key; the contract host must
 * never see it. That separation is the one piece of the real trust boundary
 * this mock does preserve.
 */
export class MockCredentialAuthority {
  readonly issuer: MockIssuer;
  readonly name: string;

  /** Leaf index of every credential issued, so revocation can find them. */
  private readonly issued = new Map<string, IssuedRecord>();

  constructor(id: bigint, name: string) {
    this.issuer = makeIssuer(id);
    this.name = name;
  }

  /** Public verification key, safe to publish on chain. */
  publicKey() {
    return this.issuer.publicKey;
  }

  /**
   * Sign an attestation binding a commitment to a holder.
   *
   * NOTE the absence of any verification step. A real issuer would establish
   * that `attrs` describes the person controlling `holderId` before signing.
   * This one signs on request. That is the mock.
   */
  attest(commitment: Uint8Array, holderId: Uint8Array): JubjubSchnorrSignature {
    return signAttestation(this.issuer, commitment, holderId);
  }

  /** Sign a revocation, bound to the epoch in which it is submitted. */
  revoke(leafIndex: bigint, epoch: bigint): JubjubSchnorrSignature {
    return signRevocation(this.issuer, leafIndex, epoch);
  }

  remember(rec: IssuedRecord): void {
    this.issued.set(hex(rec.commitment), rec);
  }

  forget(commitment: Uint8Array): void {
    this.issued.delete(hex(commitment));
  }

  records(): IssuedRecord[] {
    return [...this.issued.values()];
  }
}

export type IssuedRecord = {
  commitment: Uint8Array;
  holderId: Uint8Array;
  leafIndex: bigint;
  label: string;
  attrs: CredentialAttrs;
  revoked: boolean;
};

export const hex = (b: Uint8Array) =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
