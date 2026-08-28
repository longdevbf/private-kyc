#!/usr/bin/env bash
# Try every plausible name for signature verification under language 0.23.
# "unknown identifier" means it does not exist; anything else means it does.
export PATH="$HOME/.local/bin:$PATH"
mkdir -p /tmp/sig023 && cd /tmp/sig023 || exit 1

for name in verifySignature signatureVerify checkSignature jubjubSchnorrVerify \
            schnorrVerify verify signVerify ecVerify eddsaVerify ; do
  cat > t.compact <<EOF
pragma language_version 0.23;
import CompactStandardLibrary;
export ledger flag: Boolean;
export circuit probe(a: Bytes<32>, b: Bytes<32>): [] {
  flag.write($name(a, b));
}
EOF
  out=$(compact compile --skip-zk t.compact out 2>&1 | grep -viE '^\s*$' | head -3)
  printf '%-22s %s\n' "$name" "$(echo "$out" | tr '\n' ' ' | cut -c1-130)"
  rm -rf out
done

echo
echo "=== what the 0.23 standard library actually exports (from the shipped artifact) ==="
A="$HOME/.compact/versions/0.31.1/x86_64-unknown-linux-musl/artifact.zip"
if [ -f "$A" ]; then
  mkdir -p /tmp/art && cd /tmp/art && rm -rf ./* && unzip -o -q "$A" 2>/dev/null
  find . -name '*.compact' | head
  for f in $(find . -name '*.compact' | head -5); do
    echo "--- $f ---"
    grep -nE 'circuit [A-Za-z]' "$f" | grep -iE 'sign|verif|jubjub|schnorr' | head -20
  done
fi
