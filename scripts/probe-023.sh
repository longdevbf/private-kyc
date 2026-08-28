#!/usr/bin/env bash
export PATH="$HOME/.local/bin:$PATH"
BIN="$HOME/.compact/versions/0.31.1/x86_64-unknown-linux-musl/compactc.bin"
NEW="$HOME/.compact/versions/0.34.0/x86_64-unknown-linux-musl/compactc.bin"

echo "=== crypto-ish builtins in 0.31.1 (language 0.23) ==="
strings "$BIN" | grep -xE '[a-z][A-Za-z0-9]{3,34}' | sort -u > /tmp/n031.txt
grep -iE 'sign|verif|schnorr|jubjub|curve|ecdsa|hash|commit|merkle' /tmp/n031.txt | head -40

echo
echo "=== the same in 0.34.0 (language 0.26) ==="
strings "$NEW" | grep -xE '[a-z][A-Za-z0-9]{3,34}' | sort -u > /tmp/n034.txt
grep -iE 'sign|verif|schnorr|jubjub|curve|ecdsa|hash|commit|merkle' /tmp/n034.txt | head -40

echo
echo "=== present in 0.34.0 but ABSENT from 0.31.1 (crypto subset) ==="
comm -13 /tmp/n031.txt /tmp/n034.txt | grep -iE 'sign|verif|schnorr|jubjub' | head -30
echo "(end)"

echo
echo "=== does a minimal 0.23 contract compile at all? ==="
mkdir -p /tmp/p023
cat > /tmp/p023/probe.compact <<'EOF'
pragma language_version 0.23;
import CompactStandardLibrary;

export ledger count: Counter;

export circuit bump(): [] {
  count.increment(1);
}
EOF
cd /tmp/p023 && rm -rf out && compact compile --skip-zk probe.compact out 2>&1 | head -20
echo "-- artifacts --"; ls out 2>/dev/null | head
