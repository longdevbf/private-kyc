#!/usr/bin/env bash
# One copy of each native/WASM package, or nothing works.
#
# These packages export classes backed by a WASM instance. Two copies in a
# dependency tree produce two distinct class identities, so a value built
# by one fails `instanceof` in the other:
#
#   Error: expected instance of StateValue
#       at _assertClass (.../onchain-runtime-v3/..._bg.js)
#       at new ChargedState (...)
#
# This actually happened here. `compact-runtime@0.16.0` asks for
# `^3.0.0` and `midnight-js-protocol@4.1.1` pins exactly `3.0.0`, so npm
# hoisted 3.1.0 for one and nested 3.0.0 for the other. Deployment still
# worked -- it takes a different path -- and every contract CALL failed.
# The fix is an `overrides` entry plus `npm dedupe`; this is the check that
# stops it coming back.
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES="onchain-runtime-v3 onchain-runtime-v4 ledger-v8 compact-runtime zswap"
status=0

for root in "$HERE" "$HERE/onchain"; do
  [ -d "$root/node_modules" ] || continue
  echo "== ${root#"$HERE"/}${root:+ }node_modules"

  for pkg in $PACKAGES; do
    # -not -path avoids matching a directory that merely contains the name.
    copies=$(find "$root/node_modules" -type d -name "$pkg" 2>/dev/null | sort)
    count=$(printf '%s' "$copies" | grep -c . || true)
    [ "$count" -eq 0 ] && continue

    if [ "$count" -gt 1 ]; then
      echo "  FAIL $pkg — $count copies:"
      printf '%s\n' "$copies" | sed "s|$root/|    |"
      status=1
    else
      ver=$(node -p "require('$copies/package.json').version" 2>/dev/null || echo '?')
      echo "  ok   $pkg@$ver"
    fi
  done
done

if [ "$status" -ne 0 ]; then
  echo
  echo "Fix: add an \"overrides\" entry pinning the package, then \`npm dedupe\`." >&2
fi
exit $status
