#!/usr/bin/env bash
echo "=== DNS / reachability ==="
for h in midnight.network rpc.testnet-02.midnight.network indexer.testnet-02.midnight.network \
         rpc.testnet.midnight.network indexer.testnet.midnight.network \
         faucet.testnet-02.midnight.network registry.npmjs.org ; do
  ip=$(getent hosts "$h" 2>/dev/null | head -1 | awk '{print $1}')
  printf '%-46s %s\n' "$h" "${ip:-NO DNS}"
done

echo
echo "=== midnight-js-protocol: what runtime does it pin? ==="
for v in 4.1.1 5.0.0-beta.7; do
  echo "-- @midnight-ntwrk/midnight-js-protocol@$v"
  npm view "@midnight-ntwrk/midnight-js-protocol@$v" dependencies --json 2>&1
done

echo
echo "=== packages in the @midnight-ntwrk scope that mention onchain runtime ==="
npm view @midnight-ntwrk/ledger versions --json 2>&1 | tr -d '\n ' | tail -c 300
echo
npm view @midnight-ntwrk/ledger@latest dependencies --json 2>&1
echo
echo "=== compact-runtime 0.16.0 (the 0.31.1-compiler line) deps ==="
npm view @midnight-ntwrk/compact-runtime@0.16.0 dependencies --json 2>&1
