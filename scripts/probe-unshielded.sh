#!/usr/bin/env bash
# How do we derive an unshielded address from a seed, with the right
# network HRP? Read the SDK's own surface rather than guessing.
cd /mnt/d/private-KYC/onchain || exit 1
M=node_modules/@midnightntwrk

echo "=== wallet-sdk-hd exports ==="
grep -rhoE "declare (class|const|function|enum) [A-Za-z]+" $M/wallet-sdk-hd/dist/*.d.ts 2>/dev/null | sort -u | head -20
ls $M/wallet-sdk-hd/dist 2>/dev/null | head

echo
echo "=== Roles / key types (what can be derived) ==="
grep -rn -A14 "enum Roles\|declare enum Role" $M/wallet-sdk-hd/dist/*.d.ts 2>/dev/null | head -22

echo
echo "=== address-format: UnshieldedAddress codec + NetworkId ==="
grep -rn -A6 "declare const NetworkId\|NetworkId = {" $M/wallet-sdk-address-format/dist/*.d.ts 2>/dev/null | head -18
grep -rn "Bech32mCodec<UnshieldedAddress>\|encode\|decode" $M/wallet-sdk-address-format/dist/index.d.ts 2>/dev/null | head -12

echo
echo "=== unshielded-wallet package present? ==="
ls -d $M/wallet-sdk-unshielded-wallet 2>/dev/null && \
  grep -rhoE "declare (class|const|function) [A-Za-z]+" $M/wallet-sdk-unshielded-wallet/dist/*.d.ts 2>/dev/null | sort -u | head -20
