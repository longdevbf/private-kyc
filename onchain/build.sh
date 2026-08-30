#!/usr/bin/env bash
# Build the deployable (language 0.23) port.
#
# `compact compile` has no per-invocation version flag and `compact update`
# changes the global default, which would break the reference build. So the
# pinned 0.31.1 binary is invoked directly and the default is left alone.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VER=0.31.1
ARCH=x86_64-unknown-linux-musl
CC="$HOME/.compact/versions/$VER/$ARCH/compactc"

if [ ! -x "$CC" ]; then
  echo "compiler $VER not installed. Run: compact update $VER --no-set-default" >&2
  exit 1
fi

# zkir lives beside the compiler; without it on PATH the compiler silently
# skips proving-key generation.
export PATH="$HOME/.compact/versions/$VER/$ARCH:$PATH"

echo "compiler:  $("$CC" --version 2>&1)"
echo "language:  $("$CC" --language-version 2>&1)"
echo "runtime:   $("$CC" --runtime-version 2>&1)"
echo "ledger:    $("$CC" --ledger-version 2>&1)"
echo

rm -rf "$HERE/managed"
"$CC" ${SKIP_ZK:+--skip-zk} "$HERE/contract/credential.compact" "$HERE/managed"
echo
echo "artifacts:"
ls -1 "$HERE/managed"
