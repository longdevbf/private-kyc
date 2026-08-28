#!/usr/bin/env bash
# The definitive test: compile the real contract with the compiler every
# live network runs, and read the actual errors.
export PATH="$HOME/.local/bin:$PATH"
cd /mnt/d/private-KYC || exit 1

echo "=== default toolchain now ==="
compact --version 2>&1
compact list 2>&1 | head -4
echo
echo "=== language version accepted by 0.31.1 ==="
grep -n 'pragma' contracts/src/credential.compact | head -3
echo
echo "=== signature names present in the 0.31.1 compiler binary ==="
strings "$HOME/.compact/versions/0.31.1/x86_64-unknown-linux-musl/compactc.bin" 2>/dev/null \
  | grep -iE '^(jubjub|schnorr)[A-Za-z]*$|SchnorrVerify|signatureVerifying|sampleSigning' | sort -u | head -20
echo "(end strings)"
echo
echo "=== compiling with 0.31.1 (zk skipped) ==="
rm -rf /tmp/out031
compact compile --skip-zk contracts/src/credential.compact /tmp/out031 2>&1 | head -60
echo "exit: $?"
