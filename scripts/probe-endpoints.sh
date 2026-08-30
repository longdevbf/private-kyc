#!/usr/bin/env bash
# Can we actually talk to preview? Test the two endpoints the wallet needs
# with real queries, not just a reachability ping.
NET="${1:-preview}"
IDX="https://indexer.${NET}.midnight.network/api/v4/graphql"
RPC="https://rpc.${NET}.midnight.network"

echo "=== indexer GraphQL: block height ==="
curl -s -m 25 -X POST "$IDX" \
  -H 'content-type: application/json' \
  -d '{"query":"query { block { height hash } }"}' | head -c 600
echo; echo

echo "=== node RPC: system_chain / system_health ==="
curl -s -m 25 -X POST "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"system_chain","params":[]}' | head -c 300
echo
curl -s -m 25 -X POST "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}' | head -c 300
echo; echo

echo "=== is the address script still alive? ==="
pgrep -af "tsx src/address.ts" || echo "  no tsx process"
