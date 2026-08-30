#!/usr/bin/env bash
cd /mnt/d/private-KYC || exit 1
echo "=== typecheck ==="
npx tsc --noEmit 2>&1 | head -15
echo "(typecheck done)"
echo
echo "=== build ==="
npm run build:web 2>&1 | tail -4
echo
echo "=== restart + seed ==="
bash scripts/dev-restart.sh 2>&1 | tail -3
bash scripts/demo-seed.sh 2>&1 | tail -1
curl -s -o /dev/null -m 5 -w 'root=%{http_code}\n' http://localhost:4000/
