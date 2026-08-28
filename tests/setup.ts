// Test fixtures. The simulator itself lives in core/engine.ts so that the
// tests, the mock issuer service, and the web demo all share one
// implementation.

export * from '../core/engine.js';

import { bytes32, label32, noCountries, countries, MS_PER_YEAR,
         PredicateId, type CredentialAttrs, type PredicateRequest } from '../core/engine.js';

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

export const ADMIN_SECRET = bytes32(1);
export const VERIFIER_A = label32('verifier:alpha-exchange');
export const VERIFIER_B = label32('verifier:beta-lending');

/** An adult, tier 3, Vietnam (704), expiring well in the future. */
export function standardAttrs(now: bigint): CredentialAttrs {
  return {
    birthTimestamp: now - 30n * MS_PER_YEAR,
    countryCode: 704n,
    kycTier: 3n,
    expiresAt: now + 365n * 24n * 3600n * 1000n,
  };
}

export function ageAtLeast(years: bigint): PredicateRequest {
  return {
    predicateId: PredicateId.AGE_AT_LEAST,
    threshold: years * MS_PER_YEAR,
    allowedCountries: noCountries(),
  };
}

export function tierAtLeast(tier: bigint): PredicateRequest {
  return {
    predicateId: PredicateId.TIER_AT_LEAST,
    threshold: tier,
    allowedCountries: noCountries(),
  };
}

export function countryIn(...codes: bigint[]): PredicateRequest {
  return {
    predicateId: PredicateId.COUNTRY_IN_SET,
    threshold: 0n,
    allowedCountries: countries(...codes),
  };
}
