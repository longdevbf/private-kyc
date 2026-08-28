#!/usr/bin/env bash
# Exercise all three predicates through the same API path the UI uses.
B=http://localhost:4000
curl -s -X POST $B/api/reset >/dev/null
curl -s -X POST $B/api/issuer/register >/dev/null
curl -s -X POST $B/api/issuer/issue -H 'content-type: application/json' \
  -d '{"holderName":"alice","label":"Alice - national ID","ageYears":30,"countryCode":704,"kycTier":3,"validDays":365}' >/dev/null

p() { echo -n "  $1 -> "; curl -s -X POST $B/api/verifier/present -H 'content-type: application/json' -d "$2"; echo; }

echo "== age >= 18 (alpha) =="
p "age18" '{"holderName":"alice","verifierId":"alpha-exchange","predicateId":0,"threshold":"567648000000","allowedCountries":[]}'
echo "== kycTier >= 2 (beta) =="
p "tier2" '{"holderName":"alice","verifierId":"beta-lending","predicateId":1,"threshold":"2","allowedCountries":[]}'
echo "== country in {704,840} (alpha, replay -> expect reject) =="
p "country" '{"holderName":"alice","verifierId":"alpha-exchange","predicateId":2,"threshold":"0","allowedCountries":[704,840]}'
echo "== kycTier >= 9 (fresh verifier, expect predicate failure) =="
curl -s -X POST $B/api/verifier/present -H 'content-type: application/json' \
  -d '{"holderName":"alice","verifierId":"beta-lending","predicateId":1,"threshold":"9","allowedCountries":[]}'; echo
