#!/usr/bin/env bash
# The docs point at @midnightntwrk/wallet-sdk (no hyphen in the org) for
# programmatic NIGHT -> DUST registration. That is a different package from
# @midnight-ntwrk/wallet. Confirm it exists and what it needs.
echo "=== @midnightntwrk/wallet-sdk ==="
npm view @midnightntwrk/wallet-sdk versions --json 2>&1 | tr -d '\n ' | tail -c 300
echo; echo
npm view @midnightntwrk/wallet-sdk dist-tags --json 2>&1
echo
echo "=== its dependencies (latest) ==="
npm view @midnightntwrk/wallet-sdk@latest dependencies --json 2>&1 | head -25
echo
echo "=== sibling packages in that org ==="
for p in wallet-sdk wallet-sdk-hd wallet-sdk-address-format wallet ledger-v9; do
  v=$(npm view "@midnightntwrk/$p" dist-tags.latest 2>/dev/null)
  printf '  %-40s %s\n' "@midnightntwrk/$p" "${v:-NOT FOUND}"
done
echo
echo "=== hyphenated org, for comparison ==="
for p in wallet-sdk wallet-sdk-hd; do
  v=$(npm view "@midnight-ntwrk/$p" dist-tags.latest 2>/dev/null)
  printf '  %-40s %s\n' "@midnight-ntwrk/$p" "${v:-NOT FOUND}"
done
