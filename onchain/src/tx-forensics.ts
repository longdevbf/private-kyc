// =====================================================================
// Taking a transaction apart, and asking the ledger what is wrong with it
// =====================================================================
// Why this exists.
//
// A browser wallet balanced a transaction produced by /prepare and the
// node refused the submission with `Custom error: 182`. That number is
// retired in the current ledger, so it carries no detail; the first round
// of diagnosis had to reason backwards from it, and reasoning backwards
// from a retired opaque code is guessing with extra steps.
//
// It turns out no guessing is required. The ledger this package already
// depends on exposes `Transaction.wellFormed(state, strictness, tblock)`
// -- the same validation a node runs before accepting a transaction --
// and it throws with a NAMED reason. Running it here on the exact bytes
// the wallet produced replaces an inference with a measurement.
//
// Two details make the answer trustworthy rather than merely plausible:
//
//   * `tblock` is an argument, so the transaction can be validated as if
//     the block were now, or thirty seconds from now, or two minutes from
//     now. A failure that appears only at a later tblock is a TTL problem
//     and nothing else; one that is already there at `now` is not.
//
//   * every report is meant to be read next to a CONTROL -- a transaction
//     this project balanced itself and the chain accepted. Anything that
//     shows up in both is an artefact of validating against a blank
//     ledger state, not a defect in the wallet's work.
//
// Read-only throughout. Nothing here submits anything.
// =====================================================================

import * as ledger from '@midnight-ntwrk/ledger-v8';

/** What one intent inside a transaction carries. */
export type IntentReport = {
  segment: number;
  ttl: string;
  /** Seconds from the reference instant until this intent expires. */
  ttlInSec: number;
  actions: number;
  /** DUST spent to pay fees, and when the balancer computed it. */
  dust?: {
    /** DustActions carries its own timestamp, separate from the TTL. */
    ctime: string;
    /** Seconds between `ctime` and the reference instant. Sign matters. */
    ctimeSkewSec: number;
    spends: number;
    /** Total `vFee` across the spends, in SPECKs. */
    vFeeTotal: string;
    registrations: number;
  };
  guaranteedOffer?: OfferReport;
  fallibleOffer?: OfferReport;
};

type OfferReport = { inputs: number; outputs: number; signatures: number };

/** One run of the ledger's own validation, at one hypothetical block time. */
export type WellFormedProbe = {
  /** Seconds after the reference instant that the block was pretended to be. */
  atOffsetSec: number;
  ok: boolean;
  /** The ledger's own words. This is the whole point of the exercise. */
  error?: string;
};

export type TxReport = {
  bytes: number;
  binding: 'binding' | 'pre-binding';
  description: string;
  /** The instant every relative number in this report is measured from. */
  referenceTime: string;
  intents: IntentReport[];
  /** What the ledger says this transaction costs, in SPECKs. */
  requiredFee?: string;
  /** Total DUST offered across all intents, in SPECKs. */
  offeredFee?: string;
  /** offered - required. Negative means the fee does not cover the cost. */
  feeMargin?: string;
  feeError?: string;
  /** Non-zero token imbalances per segment, given the required fee. */
  imbalances?: Record<string, Record<string, string>>;
  wellFormed?: WellFormedProbe[];
};

// How far ahead of `now` to pretend the block is, in seconds.
//
// 0 answers "would a node accept this the instant it arrived", which is
// the question the failed submission actually asked. 30 and 120 bracket
// the inclusion times measured on preview (30-118s), so between them they
// answer "and would it still be acceptable by the time preview got to it".
const DEFAULT_HORIZONS = [0, 30, 120];

function offerReport(offer: any): OfferReport | undefined {
  if (!offer) return undefined;
  return {
    inputs: offer.inputs?.length ?? 0,
    outputs: offer.outputs?.length ?? 0,
    signatures: offer.signatures?.length ?? 0,
  };
}

function intentReport(segment: number, intent: any, now: number): IntentReport {
  const dust = intent.dustActions;
  return {
    segment,
    ttl: intent.ttl.toISOString(),
    ttlInSec: Math.round((intent.ttl.getTime() - now) / 1000),
    actions: intent.actions?.length ?? 0,
    dust: dust
      ? {
          ctime: dust.ctime.toISOString(),
          ctimeSkewSec: Math.round((dust.ctime.getTime() - now) / 1000),
          spends: dust.spends?.length ?? 0,
          vFeeTotal: String(
            (dust.spends ?? []).reduce((sum: bigint, s: any) => sum + s.vFee, 0n),
          ),
          registrations: dust.registrations?.length ?? 0,
        }
      : undefined,
    guaranteedOffer: offerReport(intent.guaranteedUnshieldedOffer),
    fallibleOffer: offerReport(intent.fallibleUnshieldedOffer),
  };
}

/**
 * Deserialize a transaction, whichever binding state it is in.
 *
 * A transaction out of /prepare is proved but not yet bound; one a wallet
 * has balanced is sealed. Which of the two a blob turns out to be is
 * itself a finding, so both are tried and the one that parses is reported.
 */
function parse(raw: Uint8Array): {
  tx: any;
  binding: 'binding' | 'pre-binding';
  description: string;
} {
  const attempts: Array<['binding' | 'pre-binding', string]> = [
    ['binding', 'sealed - signed and cryptographically bound'],
    ['pre-binding', 'unsealed - proved but not yet bound'],
  ];
  for (const [marker, description] of attempts) {
    try {
      const tx = ledger.Transaction.deserialize('signature', 'proof', marker, raw);
      return { tx, binding: marker, description };
    } catch {
      // Try the other marker before giving up.
    }
  }
  throw new Error('could not deserialize as a transaction under either binding');
}

export type AnalyseOptions = {
  /** Measure every relative time from here. Defaults to now. */
  at?: Date;
  /** Which block times to validate against, in seconds after `at`. */
  horizons?: number[];
  /** Network id for the blank reference state. */
  networkId?: string;
  /**
   * Verifying contract proofs is slow and needs verifier keys a blank
   * state does not have. Off by default: the questions being asked here
   * are about TTL, fees, signatures and structure.
   */
  verifyProofs?: boolean;
};

export function analyseTransaction(txHex: string, opts: AnalyseOptions = {}): TxReport {
  if (!/^[0-9a-fA-F]+$/.test(txHex)) throw new Error('txHex must be a hex string');
  const raw = Uint8Array.from(Buffer.from(txHex, 'hex'));
  const { tx, binding, description } = parse(raw);

  const reference = opts.at ?? new Date();
  const now = reference.getTime();

  const intents: IntentReport[] = [
    ...((tx.intents as Map<number, any>) ?? new Map()).entries(),
  ].map(([segment, intent]) => intentReport(segment, intent, now));

  const report: TxReport = {
    bytes: raw.length,
    binding,
    description,
    referenceTime: reference.toISOString(),
    intents,
  };

  // ---- what it costs, against what it offers --------------------------
  //
  // `fees()` is the ledger's own price for this transaction. Comparing it
  // with the DUST the balancer actually attached separates "the wallet
  // underpaid" from every other explanation, and that distinction was not
  // available before.
  const params = ledger.LedgerParameters.initialParameters();
  try {
    const required = tx.fees(params) as bigint;
    const offered = intents.reduce(
      (sum, i) => sum + BigInt(i.dust?.vFeeTotal ?? '0'),
      0n,
    );
    report.requiredFee = String(required);
    report.offeredFee = String(offered);
    report.feeMargin = String(offered - required);

    const imbalances: Record<string, Record<string, string>> = {};
    for (const i of intents) {
      try {
        const m = tx.imbalances(i.segment, required) as Map<unknown, bigint>;
        const nonZero: Record<string, string> = {};
        for (const [token, value] of m.entries()) {
          if (value !== 0n) nonZero[String(token)] = String(value);
        }
        if (Object.keys(nonZero).length > 0) imbalances[String(i.segment)] = nonZero;
      } catch {
        // Not every segment id is valid for imbalances; skip quietly.
      }
    }
    if (Object.keys(imbalances).length > 0) report.imbalances = imbalances;
  } catch (e) {
    report.feeError = e instanceof Error ? e.message : String(e);
  }

  // ---- the ledger's own verdict ---------------------------------------
  const strictness = new ledger.WellFormedStrictness();
  strictness.enforceBalancing = true;
  strictness.verifySignatures = true;
  strictness.enforceLimits = true;
  strictness.verifyNativeProofs = false;
  strictness.verifyContractProofs = opts.verifyProofs ?? false;

  const state = ledger.LedgerState.blank(opts.networkId ?? 'preview');

  report.wellFormed = (opts.horizons ?? DEFAULT_HORIZONS).map((offset) => {
    try {
      tx.wellFormed(state, strictness, new Date(now + offset * 1000));
      return { atOffsetSec: offset, ok: true };
    } catch (e) {
      return {
        atOffsetSec: offset,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  return report;
}

/** The ledger's full text dump of a transaction. Long; for reading by hand. */
export function dumpTransaction(txHex: string, compact = false): string {
  const raw = Uint8Array.from(Buffer.from(txHex, 'hex'));
  return parse(raw).tx.toString(compact);
}
