#!/usr/bin/env bash
# Print the deployment wallet address for each network, without waiting for
# the chain scan to finish.
cd /mnt/d/private-KYC/onchain || exit 1
echo "=== typecheck ==="
npx tsc --noEmit 2>&1 | head -10 && echo "  clean"
echo
for NET in "$@"; do
  echo "=== $NET ==="
  timeout 240 npx tsx src/address.ts "$NET" 2>&1 | grep -E "^(network|address|faucet)" 
  echo
done
