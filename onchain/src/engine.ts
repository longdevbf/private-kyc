// =====================================================================
// Contract engine — deployable (language 0.23) port
// =====================================================================
// The counterpart of ../../core/engine.ts, driving the 0.23 contract.
//
// Everything here drives the REAL compiled circuits through
// @midnight-ntwrk/compact-runtime 0.16.0. Nothing is stubbed: if a test
// passes, the actual circuit accepted the input.
//
// THE ONE STRUCTURAL DIFFERENCE from the reference engine.
// There is no signing here, because language 0.23 has no in-circuit
// signature verification (RESEARCH.md §G.3). The mock issuer holds a
// secret instead of a keypair, and authorisation is proof of knowledge of
// that secret. Two things follow, and both are visible below:
//
//   * `makeIssuer` produces a secret and its digest, not a keypair.
//   * The tree leaf is credentialLeaf(commitment, holderId, issuerId)
//     rather than the bare commitment, so a holder must know its issuer id
//     to rebuild its own Merkle path.
//
// THE ISSUER IS MOCKED. No real-world identity is verified anywhere. The
// attribute values below are accepted as supplied.
// =====================================================================

import {
  createCircuitContext,
  createConstructorContext,
  convertFieldToBytes,
  type CircuitContext,
  type MerkleTreePath,
} from '@midnight-ntwrk/compact-runtime';

import {
  Contract,
  ledger as readLedger,
  pureCircuits,
  type Ledger,
  type Witnesses,
} from '../managed/contract/index.js';

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

/** Predicate ids, matching the PredicateId enum in the contract. */
export const PredicateId = {
  AGE_AT_LEAST: 0,
  TIER_AT_LEAST: 1,
  COUNTRY_IN_SET: 2,
} as const;

/**
 * Everything the witnesses read from. In a real deployment the holder half
 * of this is local private state that never leaves the device, and the
 * issuer half never leaves the issuer.
 */
export type PrivateState = {
  localSecret: Uint8Array;
  issuerSecret: Uint8Array;
  attributes: CredentialAttrs;
  blinding: Uint8Array;
  merklePath: MerkleTreePath<Uint8Array>;
};

// ---------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------

/**
 * Time is in SECONDS since the epoch, everywhere.
 *
 * Not a style choice: Compact's block time is
 * `BlockContext.secondsSinceEpoch`, which compact-runtime fills in as
 * `BigInt(time ?? Math.floor(Date.now() / 1_000))`
 * (compact-runtime/dist/circuit-context.js:47). Every `blockTime*`
 * comparison in the contract is therefore against seconds.
 *
 * This engine previously used milliseconds. Nothing caught it, because a
 * simulator supplies its own block time and milliseconds were internally
 * consistent. It failed the moment it met a real chain -- `present()` with
 * a millisecond `asOf` is rejected as "asOf is in the future" -- and was
 * confirmed by presenting the same credential in both units against the
 * deployed contract. RESEARCH.md §H.11.
 */
export const SECONDS_PER_YEAR = 31_536_000n; // 365 days
export const SECONDS_PER_DAY = 86_400n;
export const FRESHNESS_WINDOW_SEC = 300n; // must match freshnessWindow()

/** The current time in the unit the contract compares against. */
export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

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

export const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

// ---------------------------------------------------------------------
// Mock issuer
// ---------------------------------------------------------------------

export type MockIssuer = {
  id: bigint;
  /** Never leaves the issuer. Knowledge of it IS the authority to issue. */
  secret: Uint8Array;
  /** Published in ledger state by registerIssuer. */
  authDigest: Uint8Array;
};

/**
 * Generate a mock issuer. THIS IS A MOCK — no real-world identity is
 * verified, and the digest is computed by the contract's own exported pure
 * circuit so the value published on chain is exactly what the circuit
 * recomputes when checking authorisation.
 */
export function makeIssuer(id: bigint, seed = 900): MockIssuer {
  const secret = bytes32(seed + Number(id));
  return { id, secret, authDigest: pureCircuits.deriveIssuerAuth(secret) };
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
  /** Set at issuance. Needed to rebuild the leaf, hence the Merkle path. */
  issuerId?: bigint;
  leaf?: Uint8Array;
  leafIndex?: bigint;
};

export function makeHolder(seed: number, attributes: CredentialAttrs): Holder {
  return rebuildHolder(bytes32(seed), bytes32(seed + 1000), attributes);
}

/**
 * A holder from explicit key material, for restoring one that was stored.
 *
 * The commitment and holder id are recomputed here through the contract's
 * exported pure circuits rather than read back from storage. A stored
 * commitment that disagreed with its own attributes would be a silent,
 * unpresentable credential; recomputing means the mismatch cannot survive
 * a reload.
 */
export function rebuildHolder(
  secret: Uint8Array,
  blinding: Uint8Array,
  attributes: CredentialAttrs,
): Holder {
  const holderId = pureCircuits.deriveHolderId(secret);
  const commitment = pureCircuits.credentialCommitment(attributes, blinding);
  return { secret, holderId, attributes, blinding, commitment };
}

/** The tree leaf for a holder under a given issuer. */
export function leafFor(holder: Holder, issuerId: bigint): Uint8Array {
  return pureCircuits.credentialLeaf(holder.commitment, holder.holderId, issuerId);
}

// ---------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------

const COIN_PUBLIC_KEY = '0'.repeat(64);
const CONTRACT_ADDRESS = '01'.repeat(32);

/** Placeholder private state, overwritten per call by the caller. */
export function blankPrivateState(): PrivateState {
  return {
    localSecret: bytes32(0),
    issuerSecret: bytes32(0),
    attributes: { birthTimestamp: 0n, countryCode: 0n, kycTier: 0n, expiresAt: 0n },
    blinding: bytes32(0),
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
  issuerSecret: (ctx) => [ctx.privateState, ctx.privateState.issuerSecret],
  attributes: (ctx) => [ctx.privateState, ctx.privateState.attributes],
  blinding: (ctx) => [ctx.privateState, ctx.privateState.blinding],
  merklePath: (ctx) => [ctx.privateState, ctx.privateState.merklePath],
};

export class Sim {
  private contract: Contract<PrivateState>;
  private state: unknown;
  /** Simulated chain time, in SECONDS since the epoch. */
  public time: number;

  private constructor(contract: Contract<PrivateState>, state: unknown, time: number) {
    this.contract = contract;
    this.state = state;
    this.time = time;
  }

  /** Deploy the contract; `adminSecret` becomes the sealed admin identity. */
  static async deploy(adminSecret: Uint8Array, startTime = 1_700_000_000): Promise<Sim> {
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

  /** A neutral private state, for calls that need no secrets. */
  blankState(): PrivateState {
    return blankPrivateState();
  }

  /** Advance simulated chain time, in SECONDS. */
  advance(seconds: number): void {
    this.time += seconds;
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
    // 0.16.0 calls this convertFieldToBytes; 0.19.0 calls the same function
    // convertBigintToBytes. The third argument is only a label for the
    // range-error message the runtime throws if the value will not fit.
    return convertFieldToBytes(32, this.ledger().revocationEpoch, 'epochBytes');
  }

  /**
   * Predict the nullifier a holder will produce at a given verifier in the
   * current epoch. Only computable by someone holding the secret -- which is
   * precisely the point of I5.
   */
  expectedNullifier(holder: Holder, verifierId: Uint8Array): Uint8Array {
    return pureCircuits.nullifierAt(holder.secret, verifierId, this.epochBytes());
  }

  /**
   * 0.16.0's factory differs from 0.19.0's in two ways that are easy to miss
   * because both are positional: there is no leading `circuitId`, and the
   * contract state comes third rather than fourth. Passing the 0.19 argument
   * list here fails with "'contractState' parameter ... has unexpected type",
   * which is the coin public key arriving where the state was expected.
   */
  private context(ps: PrivateState): CircuitContext<PrivateState> {
    return createCircuitContext<PrivateState>(
      CONTRACT_ADDRESS as any,
      COIN_PUBLIC_KEY as any,
      this.state as any,
      ps,
      undefined, // gasLimit
      undefined, // costModel
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
    const ctx = this.context(ps);
    const fn = (this.contract.impureCircuits as any)[circuitId];
    const res = await fn(ctx, ...args);
    // 0.16.0 exposes the query context directly on the returned context;
    // 0.19.0 nests it under `callContext`.
    this.state = res.context.currentQueryContext.state;
    return res.result as R;
  }

  // ---- convenience wrappers -----------------------------------------

  /** Only the admin may authorise an issuer. */
  async registerIssuer(adminSecret: Uint8Array, issuer: MockIssuer): Promise<void> {
    await this.call(
      'registerIssuer',
      { ...blankPrivateState(), localSecret: adminSecret },
      issuer.id,
      issuer.authDigest,
    );
  }

  /**
   * Full issuance. The issuer proves knowledge of its secret, the leaf is
   * inserted into the active set, and the holder records the issuer id and
   * leaf index it will need in order to present later.
   */
  async issue(issuer: MockIssuer, holder: Holder, atIndex?: bigint): Promise<void> {
    // The leaf index is explicit: the contract records which issuer owns
    // which slot, so it cannot derive the index itself (the tree ADT exposes
    // no in-circuit occupancy test).
    const index = atIndex ?? this.ledger().activeCredentials.firstFree();
    await this.call(
      'issueCredential',
      { ...blankPrivateState(), issuerSecret: issuer.secret },
      issuer.id,
      holder.commitment,
      holder.holderId,
      index,
    );
    holder.issuerId = issuer.id;
    holder.leaf = leafFor(holder, issuer.id);
    holder.leafIndex = index;
  }

  async revoke(issuer: MockIssuer, leafIndex: bigint): Promise<void> {
    await this.call(
      'revokeCredential',
      { ...blankPrivateState(), issuerSecret: issuer.secret },
      issuer.id,
      leafIndex,
    );
  }

  /**
   * Build the Merkle path a holder needs. This is the "refresh path" action
   * the UI exposes: it must be redone whenever the tree changes.
   */
  path(leaf: Uint8Array): MerkleTreePath<Uint8Array> {
    const p = this.ledger().activeCredentials.findPathForLeaf(leaf);
    if (p === undefined) throw new Error('leaf not present in active set');
    return p;
  }

  /** Assemble the holder's private state for a presentation. */
  presentationState(holder: Holder, path?: MerkleTreePath<Uint8Array>): PrivateState {
    if (holder.leaf === undefined) throw new Error('holder has no credential yet');
    return {
      localSecret: holder.secret,
      // A holder does not have the issuer secret and must not need one.
      // Leaving it blank here is a load-bearing part of the test: if
      // present() ever started reading it, every presentation would fail.
      issuerSecret: bytes32(0),
      attributes: holder.attributes,
      blinding: holder.blinding,
      merklePath: path ?? this.path(holder.leaf),
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
