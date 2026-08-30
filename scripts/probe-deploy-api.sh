#!/usr/bin/env bash
cd /mnt/d/private-KYC/onchain || exit 1
M=node_modules/@midnight-ntwrk

echo "=== midnight-js-contracts exports ==="
cat $M/midnight-js-contracts/dist/index.d.ts 2>/dev/null | head -20
ls $M/midnight-js-contracts/dist/*.d.ts 2>/dev/null | head -20

echo
echo "=== deployContract signature ==="
grep -rn -A22 "declare function deployContract\|declare const deployContract" $M/midnight-js-contracts/dist/*.d.ts 2>/dev/null | head -40

echo
echo "=== DeployContractOptions / DeployedContract ==="
grep -rn -A18 "DeployContractOptions" $M/midnight-js-contracts/dist/*.d.ts 2>/dev/null | head -40
