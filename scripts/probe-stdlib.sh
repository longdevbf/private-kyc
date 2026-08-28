#!/usr/bin/env bash
export PATH="$HOME/.local/bin:$PATH"
D="$HOME/.compact/versions/0.31.1"
echo "=== contents of the 0.31.1 toolchain ==="
find "$D" -maxdepth 3 | head -40
echo
echo "=== language version reported by 0.31.1 ==="
"$D"/compactc --version 2>&1 || "$D"/bin/compactc --version 2>&1 || true
echo
echo "=== signature-related names anywhere in the 0.31.1 stdlib ==="
grep -rn --include='*.compact' -iE 'schnorr|signature|verifySignature|signData|jubjub' "$D" 2>/dev/null | head -40
echo "(end)"
echo
echo "=== all circuits declared in the 0.31.1 std library ==="
find "$D" -name '*.compact' | head
for f in $(find "$D" -name 'std.compact' -o -name 'std*.compact' | head -3); do
  echo "--- $f ---"
  grep -nE '^\s*(export\s+)?(pure\s+)?circuit\s+\w+' "$f" | head -80
done
