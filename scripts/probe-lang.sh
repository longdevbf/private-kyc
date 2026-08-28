#!/usr/bin/env bash
# Install the 0.31.1 toolchain alongside the current one and inspect its
# standard library directly. The question is narrow: does the language
# version that ships with the compiler every live network runs have a
# signature-verification builtin?
export PATH="$HOME/.local/bin:$PATH"

echo "=== compact update --help ==="
compact update --help 2>&1
echo
echo "=== currently installed toolchains ==="
compact list 2>&1 || ls -1 "$HOME/.compact" 2>&1 || true
echo
echo "=== installing 0.31.1 ==="
compact update 0.31.1 2>&1 | tail -20
echo
echo "=== toolchain dirs on disk ==="
find "$HOME" -maxdepth 6 -type d -name '*0.31*' 2>/dev/null | head
find "$HOME" -maxdepth 6 -type d -name '*compact*' 2>/dev/null | head -20
