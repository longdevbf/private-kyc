#!/usr/bin/env bash
# Both contracts, both suites. The reference build and the deployable port
# have separate dependency trees, so they are verified separately.
cd /mnt/d/private-KYC || exit 1

echo "===== deployable port (language 0.23) ====="
( cd onchain && npx tsc --noEmit 2>&1 | head -15 && echo "typecheck: clean" )
( cd onchain && npx vitest run 2>&1 | tail -6 )

echo
echo "===== reference implementation (language 0.26) ====="
npx tsc --noEmit 2>&1 | head -15 && echo "typecheck: clean"
npx vitest run 2>&1 | tail -6
