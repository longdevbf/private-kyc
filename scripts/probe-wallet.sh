#!/usr/bin/env bash
echo "=== @midnight-ntwrk/wallet versions ==="
npm view @midnight-ntwrk/wallet versions --json 2>&1 | tr -d '\n ' | tail -c 300
echo; echo
echo "=== which wallet pins ledger-v8 / zswap what ==="
for v in 4.0.0 4.1.0 5.0.0; do
  echo "-- wallet@$v"
  npm view "@midnight-ntwrk/wallet@$v" dependencies --json 2>&1 | head -14
done
echo
echo "=== midnight-js-contracts@4.1.1 peerDependencies ==="
npm view @midnight-ntwrk/midnight-js-contracts@4.1.1 peerDependencies --json 2>&1
echo "=== midnight-js-types@4.1.1 peerDependencies ==="
npm view @midnight-ntwrk/midnight-js-types@4.1.1 peerDependencies --json 2>&1
echo
echo "=== zswap versions ==="
npm view @midnight-ntwrk/zswap versions --json 2>&1 | tr -d '\n ' | tail -c 200
