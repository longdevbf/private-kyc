#!/usr/bin/env bash
# Which midnight-js release lines up with compact-runtime 0.19.0, and do
# the live network endpoints answer? Observed, not quoted.

for v in 4.1.1 5.0.0-beta.7 5.0.0-beta.1; do
  echo "=== midnight-js-contracts@$v ==="
  echo "-- peerDependencies:"; npm view "@midnight-ntwrk/midnight-js-contracts@$v" peerDependencies --json 2>&1
  echo "-- dependencies:";     npm view "@midnight-ntwrk/midnight-js-contracts@$v" dependencies --json 2>&1
  echo
done

echo "=== midnight-js-types: which compact-runtime does each expect? ==="
for v in 4.1.1 5.0.0-beta.7; do
  echo "-- @midnight-ntwrk/midnight-js-types@$v"
  npm view "@midnight-ntwrk/midnight-js-types@$v" dependencies --json 2>&1
  npm view "@midnight-ntwrk/midnight-js-types@$v" peerDependencies --json 2>&1
done

echo
echo "=== live network endpoints ==="
for url in \
  "https://rpc.testnet-02.midnight.network" \
  "https://indexer.testnet-02.midnight.network/api/v1/graphql" \
  "https://faucet.testnet-02.midnight.network" ; do
  code=$(curl -s -o /dev/null -m 12 -w '%{http_code}' "$url" 2>&1)
  echo "$code  $url"
done

echo
echo "=== testnet node runtime version (system_version / runtime_version) ==="
curl -s -m 15 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"system_version","params":[]}' \
  https://rpc.testnet-02.midnight.network 2>&1
echo
curl -s -m 15 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"state_getRuntimeVersion","params":[]}' \
  https://rpc.testnet-02.midnight.network 2>&1
echo
