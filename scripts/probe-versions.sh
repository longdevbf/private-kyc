#!/usr/bin/env bash
# Establish, empirically, whether this contract can be deployed today:
# what the toolchain produces, what the SDK expects, and what the live
# networks actually run. No claim here comes from documentation.
export PATH="$HOME/.local/bin:$PATH"
cd /mnt/d/private-KYC || exit 1

echo "=== compact CLI ==="
compact --version 2>&1
echo
echo "=== toolchain versions available ==="
compact update --list 2>&1
echo
echo "=== installed runtime deps ==="
node -e "
const p = n => { try { return require('./node_modules/'+n+'/package.json').version } catch { return 'not installed' } };
for (const n of [
  '@midnight-ntwrk/compact-runtime',
  '@midnight-ntwrk/onchain-runtime',
  '@midnight-ntwrk/onchain-runtime-v4',
  '@midnight-ntwrk/ledger',
  '@midnight-ntwrk/zswap',
  '@midnight-ntwrk/midnight-js-contracts',
  '@midnight-ntwrk/midnight-js-network-id',
  '@midnight-ntwrk/wallet',
]) console.log(n.padEnd(46), p(n));
"
echo
echo "=== what compact-runtime 0.19.0 depends on ==="
node -e "
const d = require('./node_modules/@midnight-ntwrk/compact-runtime/package.json').dependencies;
console.log(JSON.stringify(d, null, 2));
"
