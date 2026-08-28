#!/usr/bin/env bash
# Seed the demo with a realistic tree: three credentials, and two
# presentations of the same one so the linkage test has something to compare.
B=http://localhost:4000

issue() {
  curl -s -X POST $B/api/issuer/issue -H 'content-type: application/json' \
    -d "{\"holderName\":\"$1\",\"label\":\"$2\",\"ageYears\":$3,\"countryCode\":$4,\"kycTier\":$5,\"validDays\":365}" >/dev/null
}
present() {
  curl -s -X POST $B/api/verifier/present -H 'content-type: application/json' \
    -d "{\"holderName\":\"$1\",\"verifierId\":\"$2\",\"predicateId\":$3,\"threshold\":\"$4\",\"allowedCountries\":[]}" >/dev/null
}

curl -s -X POST $B/api/reset >/dev/null
curl -s -X POST $B/api/issuer/register >/dev/null

issue alice   "Alice - national ID"   30 704 3
issue bao     "Bao - national ID"     41 704 2
issue clara   "Clara - residence permit" 24 840 4

# Same holder, two verifiers, two different questions.
present alice alpha-exchange 0 567648000000
present alice beta-lending   1 2

echo "seeded: 3 credentials, alice presented to both verifiers"
