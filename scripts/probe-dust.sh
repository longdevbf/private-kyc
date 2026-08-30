#!/usr/bin/env bash
# NIGHT alone cannot pay fees; it has to be registered for DUST generation.
# Find the API that does that.
cd /mnt/d/private-KYC/onchain || exit 1
M=node_modules/@midnightntwrk

echo "=== wallet-sdk top-level exports ==="
grep -rhoE "declare (class|const|function|type|interface) [A-Za-z]+" $M/wallet-sdk/dist/*.d.ts 2>/dev/null | sort -u | head -40
ls $M/wallet-sdk/dist 2>/dev/null | head -20

echo
echo "=== anything named register / dust / generation ==="
grep -rhoiE "[a-z]*register[A-Za-z]*|[a-z]*dustGeneration[A-Za-z]*|createDust[A-Za-z]*" \
  $M/wallet-sdk/dist/*.d.ts $M/wallet-sdk-dust-wallet/dist/*.d.ts 2>/dev/null | sort -u | head -30

echo
echo "=== dust-wallet exports ==="
grep -rhoE "declare (class|const|function) [A-Za-z]+" $M/wallet-sdk-dust-wallet/dist/*.d.ts 2>/dev/null | sort -u | head -25

echo
echo "=== unshielded-wallet exports ==="
grep -rhoE "declare (class|const|function) [A-Za-z]+" $M/wallet-sdk-unshielded-wallet/dist/*.d.ts 2>/dev/null | sort -u | head -25
