// =====================================================================
// Shared contract engine
// =====================================================================
// Used by the test suite, the mock issuer service, and the web demo, so all
// three drive the contract through one implementation rather than three.
//
// Everything here drives the REAL compiled circuits through
// @midnight-ntwrk/compact-runtime. Nothing is stubbed: if a test passes,
// the actual zero-knowledge circuit accepted the input.
//
// The mock issuer's signing keys are generated here with the runtime's own
// Jubjub primitives, so the signatures the tests produce are the same shape
// jubjubSchnorrVerify checks in-circuit.
// =====================================================================

import {
  CompactTypeField,
  CompactTypeVector,
  createCircuitContext,
  convertBigintToBytes,
  createConstructorContext,
  jubjubSchnorrSign,
  jubjubSchnorrVerifyingKey,
  sampleJubjubSchnorrSk,
  type CircuitContext,
  type JubjubPoint,
  type JubjubSchnorrSignature,
  type MerkleTreePath,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract,
  ledger as readLedger,
  pureCircuits,
  type Ledger,
  type Witnesses,
} from '../contracts/managed/credential/contract/index.js';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type CredentialAttrs = {
  birthTimestamp: bigint;
  countryCode: bigint;
  kycTier: bigint;
  expiresAt: bigint;
};

export type PredicateRequest = {
  predicateId: number;
  threshold: bigint;
  allowedCountries: bigint[];
};

/** Predicate ids, matching the PredicateId enum in Predicates.compact. */
export const PredicateId = {
  AGE_AT_LEAST: 0,
  TIER_AT_LEAST: 1,
  COUNTRY_IN_SET: 2,
} as const;

/**
 * Everything the witnesses read from. In a real deployment this is the
 * holder's local private state, never transmitted anywhere.
 */
export type PrivateState = {
  localSecret: Uint8Array;
  attributes: CredentialAttrs;
  blinding: Uint8Array;
  issuerSig: JubjubSchnorrSignature;
  merklePath: MerkleTreePath<Uint8Array>;
};

// ---------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------

export const MS_PER_YEAR = 31_536_000_000n; // 365 days
export const FRESHNESS_WINDOW_MS = 300_000n; // must match freshnessWindow()
export const TREE_DEPTH = 10;

/** Deterministic 32-byte value, so failures are reproducible. */
export function bytes32(seed: number): Uint8Array {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = (seed * 31 + i * 7) & 0xff;
  return b;
}

/** Right-pad an ASCII label into 32 bytes, mirroring Compact's pad(32, ...). */
export function label32(s: string): Uint8Array {
  const b = new Uint8Array(32);
  const enc = new TextEncoder().encode(s);
  if (enc.length > 32) throw new Error(`label too long: ${s}`);
  b.set(enc, 0);
  return b;
}

/** A zero-filled allowed-country list; 0 is not a valid ISO code. */
export function noCountries(): bigint[] {
  return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
}

/** Pad an allowed-country list out to the fixed width of 8. */
export function countries(...codes: bigint[]): bigint[] {
  if (codes.length > 8) throw new Error('at most 8 allowed countries');
  const out = noCountries();
  codes.forEach((c, i) => (out[i] = c));
  return out;
}

// The message type jubjubSchnorrVerify<3> checks: Vector<3, Field>.
const MSG_TYPE = new CompactTypeVector(3, CompactTypeField);

// ---------------------------------------------------------------------
// Mock issuer
// ---------------------------------------------------------------------

export type MockIssuer = {
  id: bigint;
  signingKey: bigint;
  publicKey: JubjubPoint;
};

/** Generate a mock issuer keypair. THIS IS A MOCK — no real-world identity. */
export function makeIssuer(id: bigint): MockIssuer {
  const signingKey = sampleJubjubSchnorrSk();
  return { id, signingKey, publicKey: jubjubSchnorrVerifyingKey(signingKey) };
}

/**
 * Sign a credential attestation. The message is built by the contract's own
 * exported pure circuit, so the bytes signed here are exactly the bytes the
 * circuit reconstructs and verifies.
 */
export function signAttestation(
  issuer: MockIssuer,
  commitment: Uint8Array,
  holderId: Uint8Array,
): JubjubSchnorrSignature {
  const msg = pureCircuits.attestMessage(commitment, holderId);
  return jubjubSchnorrSign(MSG_TYPE, msg, issuer.signingKey);
}

/** Sign a revocation, bound to the epoch it is issued in. */
export function signRevocation(
  issuer: MockIssuer,
  leafIndex: bigint,
  epoch: bigint,
): JubjubSchnorrSignature {
  const msg = pureCircuits.revokeMessage(leafIndex, epoch);
  return jubjubSchnorrSign(MSG_TYPE, msg, issuer.signingKey);
}

// ---------------------------------------------------------------------
// A holder's local wallet
// ---------------------------------------------------------------------

export type Holder = {
  secret: Uint8Array;
  holderId: Uint8Array;
  attributes: CredentialAttrs;
  blinding: Uint8Array;
  commitment: Uint8Array;
  signature?: JubjubSchnorrSignature;
  leafIndex?: bigint;
};

export function makeHolder(seed: number, attributes: CredentialAttrs): Holder {
  const secret = bytes32(seed);
  const blinding = bytes32(seed + 1000);
  // deriveHolderId and credentialCommitment are exported pure circuits, so
  // these are computed by the contract's own code, not a reimplementation.
  const holderId = pureCircuits.deriveHolderId(secret);
  const commitment = pureCircuits.credentialCommitment(attributes, blinding);
  return { secret, holderId, attributes, blinding, commitment };
}

// ---------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------

const COIN_PUBLIC_KEY = '0'.repeat(64);
const CONTRACT_ADDRESS = '01'.repeat(32);

/** Placeholder private state, overwritten per call by `as`. */
function blankPrivateState(): PrivateState {
  return {
    localSecret: bytes32(0),
    attributes: { birthTimestamp: 0n, countryCode: 0n, kycTier: 0n, expiresAt: 0n },
    blinding: bytes32(0),
    issuerSig: { announcement: { x: 0n, y: 0n } as unknown as JubjubPoint, response: 0n },
    merklePath: { leaf: bytes32(0), path: [] } as unknown as MerkleTreePath<Uint8Array>,
  };
}

/**
 * Witnesses simply surface whatever the caller placed in private state.
 * That is deliberate: it mirrors reality, where the witness implementation
 * is supplied by the DApp and is therefore untrusted. Tests exploit this to
 * feed the circuit hostile input.
 */
const witnesses: Witnesses<PrivateState> = {
  localSecret: (ctx) => [ctx.privateState, ctx.privateState.localSecret],
  issuerSig: (ctx) => [ctx.privateState, ctx.privateState.issuerSig],
  attributes: (ctx) => [ctx.privateState, ctx.privateState.attributes],
  blinding: (ctx) => [ctx.privateState, ctx.privateState.blinding],
  merklePath: (ctx) => [ctx.privateState, ctx.privateState.merklePath],
};

export class Sim {
  private contract: Contract<PrivateState>;
  private state: unknown;
  /** Simulated chain time, in milliseconds. */
  public time: number;

  private constructor(contract: Contract<PrivateState>, state: unknown, time: number) {
    this.contract = contract;
    this.state = state;
    this.time = time;
  }

  /** Deploy the contract; `adminSecret` becomes the sealed admin identity. */
  static async deploy(adminSecret: Uint8Array, startTime = 1_700_000_000_000): Promise<Sim> {
    const contract = new Contract<PrivateState>(witnesses);
    const ps = { ...blankPrivateState(), localSecret: adminSecret };
    const res = await contract.initialState(createConstructorContext(ps, COIN_PUBLIC_KEY));
    return new Sim(contract, res.currentContractState, startTime);
  }

  /** Read public ledger state. */
  ledger(): Ledger {
    return readLedger(this.stateValue());
  }

  private stateValue(): any {
    const s = this.state as any;
    return s?.data ?? s;
  }

  /** A neutral private state, for calls that need no holder secrets. */
  blankState(): PrivateState {
    return blankPrivateState();
  }

  /** Advance simulated chain time. */
  advance(ms: number): void {
    this.time += ms;
  }

  /**
   * A complete textual dump of PUBLIC on-chain state. Used by the I1 test to
   * scan for attribute plaintext rather than eyeballing typed accessors.
   */
  rawState(): string {
    return String(this.stateValue());
  }

  /** The current epoch encoded exactly as nullifierFor() encodes it. */
  epochBytes(): Uint8Array {
    // The third argument is only a label for the range-error message the
    // runtime throws if the value will not fit; it is not part of the
    // encoding. Supplying it keeps `tsc --noEmit` clean.
    return convertBigintToBytes(32, this.ledger().revocationEpoch, 'epochBytes');
  }

  /**
   * Predict the nullifier a holder will produce at a given verifier in the
   * current epoch. Only computable by someone holding the secret -- which is
   * precisely the point of I5.
   */
  expectedNullifier(holder: Holder, verifierId: Uint8Array): Uint8Array {
    return pureCircuits.nullifierAt(holder.secret, verifierId, this.epochBytes());
  }

  private context(circuitId: string, ps: PrivateState): CircuitContext<PrivateState> {
    return createCircuitContext<PrivateState>(
      circuitId,
      CONTRACT_ADDRESS as any,
      COIN_PUBLIC_KEY as any,
      this.state as any,
      ps,
      undefined,
      undefined,
      undefined,
      this.time,
    );
  }

  /**
   * Invoke an impure circuit with the given private state. On success the
   * simulator's public state advances; on failure it is left untouched, so
   * a rejected call cannot corrupt later assertions.
   */
  async call<R>(
    circuitId: keyof Contract<PrivateState>['impureCircuits'] & string,
    ps: PrivateState,
    ...args: any[]
  ): Promise<R> {
    const ctx = this.context(circuitId, ps);
    const fn = (this.contract.impureCircuits as any)[circuitId];
    const res = await fn(ctx, ...args);
    this.state = res.context.callContext.currentQueryContext.state;
    return res.result as R;
  }

  // ---- convenience wrappers -----------------------------------------

  async registerIssuer(adminSecret: Uint8Array, issuer: MockIssuer): Promise<void> {
    await this.call('registerIssuer', { ...blankPrivateState(), localSecret: adminSecret },
      issuer.id, issuer.publicKey);
  }

  /**
   * Full issuance: the issuer signs the holder's commitment, the commitment
   * is inserted into the active set, and the holder records the signature
   * and leaf index it will need in order to present later.
   */
  async issue(issuer: MockIssuer, holder: Holder, atIndex?: bigint): Promise<void> {
    const sig = signAttestation(issuer, holder.commitment, holder.holderId);
    // The leaf index is explicit: the contract records which issuer owns
    // which slot, so it cannot derive the index itself (the tree ADT exposes
    // no in-circuit occupancy test).
    const index = atIndex ?? this.ledger().activeCredentials.firstFree();
    await this.call('issueCredential',
      { ...blankPrivateState(), issuerSig: sig },
      issuer.id, holder.commitment, holder.holderId, index);
    holder.signature = sig;
    holder.leafIndex = index;
  }

  async revoke(issuer: MockIssuer, leafIndex: bigint): Promise<void> {
    const epoch = this.ledger().revocationEpoch;
    const sig = signRevocation(issuer, leafIndex, epoch);
    await this.call('revokeCredential', { ...blankPrivateState(), issuerSig: sig },
      issuer.id, leafIndex);
  }

  /**
   * Build the Merkle path a holder needs. This is the "refresh path" action
   * the UI exposes: it must be redone whenever the tree changes.
   */
  path(commitment: Uint8Array): MerkleTreePath<Uint8Array> {
    const p = this.ledger().activeCredentials.findPathForLeaf(commitment);
    if (p === undefined) throw new Error('leaf not present in active set');
    return p;
  }

  /** Assemble the holder's private state for a presentation. */
  presentationState(holder: Holder, path?: MerkleTreePath<Uint8Array>): PrivateState {
    if (!holder.signature) throw new Error('holder has no credential yet');
    return {
      localSecret: holder.secret,
      attributes: holder.attributes,
      blinding: holder.blinding,
      issuerSig: holder.signature,
      merklePath: path ?? this.path(holder.commitment),
    };
  }

  async present(
    holder: Holder,
    issuer: MockIssuer,
    verifierId: Uint8Array,
    req: PredicateRequest,
    opts: { asOf?: bigint; path?: MerkleTreePath<Uint8Array>; state?: PrivateState } = {},
  ): Promise<void> {
    const asOf = opts.asOf ?? BigInt(this.time);
    const ps = opts.state ?? this.presentationState(holder, opts.path);
    await this.call('present', ps, issuer.id, verifierId, req, asOf);
  }
}

