// =====================================================================
// How a presentation reads in the UI
// =====================================================================
// Two pure functions, in their own module so they can be tested. They
// used to live in service.ts, which opens a wallet and binds a port at
// import time -- importing that from a test starts a server.
//
// Both exist because the same action must read identically whether it ran
// in the simulator or on chain. The demo's whole argument is a comparison
// between those two, and it does not survive the two of them describing
// one request in different words.
// =====================================================================

import { PredicateId } from './engine.js';

/** Seconds in a 365-day year, matching the contract's own arithmetic. */
const SECONDS_PER_YEAR = 31_536_000n;

/**
 * Describe a predicate request the way the simulator backend describes it.
 *
 * The age threshold is an age in SECONDS, because that is the unit the
 * circuit compares in. Printed raw it reads `age at least 567648000`, which
 * is true and useless.
 */
export function describePredicate(
  id: number,
  threshold: string,
  countries: number[],
): string {
  switch (id) {
    case PredicateId.AGE_AT_LEAST:
      return `age >= ${Number(BigInt(threshold) / SECONDS_PER_YEAR)}`;
    case PredicateId.TIER_AT_LEAST:
      return `kycTier >= ${threshold}`;
    case PredicateId.COUNTRY_IN_SET:
      return `country in {${countries.filter((c) => c !== 0).join(', ')}}`;
    default:
      return `unknown predicate ${id}`;
  }
}

/**
 * Reduce a thrown error to the sentence a person can act on.
 *
 * A refused circuit arrives wrapped several layers deep:
 *
 *   Unexpected error executing scoped transaction '<unnamed>': Error:
 *   failed assert: nullifier already spent this epoch — ... — Error
 *   executing circuit 'present'
 *
 * The contract's own assertion is the only part that carries meaning, and
 * it is what the simulator shows. Anything that is not a failed assertion
 * is passed through whole rather than truncated: an infrastructure failure
 * needs its detail.
 */
export function refusalReason(e: unknown): string {
  const parts: string[] = [];
  let cur: any = e;
  while (cur) {
    const m = cur.message ?? String(cur);
    if (m && !parts.includes(m)) parts.push(m);
    cur = cur.cause;
  }
  const full = parts.join(' — ') || 'unknown error';

  const assertion = full.match(/failed assert:\s*([^—\n]+?)\s*(?:—|$)/);
  return assertion ? assertion[1] : full;
}
