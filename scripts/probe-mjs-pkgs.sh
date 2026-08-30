#!/usr/bin/env bash
# Confirm which midnight-js packages exist at the 4.1.1 line before any of
# them go into a package.json. No package name here is assumed.
for p in \
  midnight-js-contracts midnight-js-types midnight-js-utils \
  midnight-js-network-id midnight-js-protocol \
  midnight-js-indexer-public-data-provider \
  midnight-js-node-zk-config-provider \
  midnight-js-fetch-zk-config-provider \
  midnight-js-http-client-proof-provider \
  midnight-js-level-private-state-provider \
  midnight-js-in-memory-private-state-provider ; do
  v=$(npm view "@midnight-ntwrk/$p@4.1.1" version 2>/dev/null)
  printf '%-46s %s\n' "@midnight-ntwrk/$p" "${v:-NOT AT 4.1.1}"
done

echo
echo "=== wallet / ledger / zswap ==="
for p in wallet wallet-sdk-hd wallet-api zswap ledger ledger-v8 compact-runtime; do
  latest=$(npm view "@midnight-ntwrk/$p" dist-tags.latest 2>/dev/null)
  printf '%-46s latest=%s\n' "@midnight-ntwrk/$p" "${latest:-NOT FOUND}"
done

echo
echo "=== what @midnight-ntwrk/wallet@latest depends on ==="
npm view @midnight-ntwrk/wallet@latest dependencies --json 2>&1 | head -30
