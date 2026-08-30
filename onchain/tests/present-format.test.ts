// =====================================================================
// What the UI says about a presentation
// =====================================================================
// These are the two places where the on-chain engine could describe an
// action differently from the simulator. The demo's argument is a
// side-by-side comparison of the two, and it does not survive them
// disagreeing about what happened.
//
// Both defects below were real, and both were found by running the demo
// against preview rather than by reading the code.
// =====================================================================

import { describe, expect, it } from 'vitest';

import { describePredicate, refusalReason } from '../src/present-format.js';
import { PredicateId } from '../src/engine.js';

describe('describePredicate', () => {
  it('renders an age threshold in years, not in seconds', () => {
    // 18 years expressed the way the circuit compares it. Printed raw this
    // read "age at least 567648000", against the simulator's "age >= 18".
    expect(describePredicate(PredicateId.AGE_AT_LEAST, '567648000', [])).toBe('age >= 18');
  });

  it('agrees with the simulator on a tier threshold', () => {
    expect(describePredicate(PredicateId.TIER_AT_LEAST, '2', [])).toBe('kycTier >= 2');
  });

  it('lists only the countries actually requested', () => {
    // The request is padded to eight slots with zeroes, because Compact has
    // no dynamic arrays. Those zeroes are padding, not a country.
    expect(describePredicate(PredicateId.COUNTRY_IN_SET, '0', [704, 840, 0, 0, 0, 0, 0, 0]))
      .toBe('country in {704, 840}');
  });

  it('names an unknown predicate rather than pretending to know it', () => {
    expect(describePredicate(99, '0', [])).toBe('unknown predicate 99');
  });
});

describe('refusalReason', () => {
  it('extracts the contract assertion from the runtime wrapper', () => {
    const wrapped = new Error(
      "Unexpected error executing scoped transaction '<unnamed>': Error: " +
        'failed assert: nullifier already spent this epoch — ' +
        "Error executing circuit 'present'",
    );
    expect(refusalReason(wrapped)).toBe('nullifier already spent this epoch');
  });

  it('reads an assertion carried in a nested cause', () => {
    const inner = new Error('failed assert: credential is not in the active set (revoked or path stale)');
    const outer = new Error('proving failed', { cause: inner });
    expect(refusalReason(outer)).toBe(
      'credential is not in the active set (revoked or path stale)',
    );
  });

  it('keeps an infrastructure failure whole', () => {
    // Not an assertion, so truncating it would throw away the only detail
    // that says what to fix.
    const e = new Error('connect ECONNREFUSED 127.0.0.1:6300');
    expect(refusalReason(e)).toBe('connect ECONNREFUSED 127.0.0.1:6300');
  });

  it('does not repeat a message that appears at several levels', () => {
    const inner = new Error('same message');
    const outer = new Error('same message', { cause: inner });
    expect(refusalReason(outer)).toBe('same message');
  });

  it('says something rather than nothing for an empty failure', () => {
    expect(refusalReason(undefined)).toBe('unknown error');
  });
});
