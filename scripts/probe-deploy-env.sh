#!/usr/bin/env bash
# Confirm the installed tree actually cohered, and get a proof server up.
cd /mnt/d/private-KYC/onchain || exit 1

echo "=== resolved versions in this tree ==="
node -e "
const p = n => { try { return require('./node_modules/'+n+'/package.json').version } catch { return '-' } };
for (const n of [
  '@midnight-ntwrk/compact-runtime',
  '@midnight-ntwrk/onchain-runtime-v3',
  '@midnight-ntwrk/ledger-v8',
  '@midnight-ntwrk/midnight-js-contracts',
  '@midnight-ntwrk/midnight-js-protocol',
  '@midnight-ntwrk/wallet',
  '@midnight-ntwrk/zswap',
]) console.log('  ' + n.padEnd(44), p(n));
"
echo
echo "=== any DUPLICATE compact-runtime nested anywhere? ==="
find node_modules -path '*/@midnight-ntwrk/compact-runtime/package.json' -exec sh -c 'echo "  $(dirname {}) -> $(node -p "require(\"{}\").version")"' \;

echo
echo "=== proof server image ==="
docker image ls midnightnetwork/proof-server 2>/dev/null | head -5
echo "-- pulling 8.1.0 --"
docker pull midnightnetwork/proof-server:8.1.0 2>&1 | tail -4
