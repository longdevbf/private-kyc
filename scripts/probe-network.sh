#!/usr/bin/env bash
# Probe the live Midnight networks and the npm registry. Everything here
# is observed, not quoted from docs.
export PATH="$HOME/.local/bin:$PATH"

echo "=== npm: compact-runtime versions ==="
npm view @midnight-ntwrk/compact-runtime versions --json 2>&1 | tr -d '\n ' | tail -c 400
echo; echo
echo "=== npm: compact-runtime dist-tags ==="
npm view @midnight-ntwrk/compact-runtime dist-tags --json 2>&1
echo
echo "=== npm: midnight-js-contracts versions ==="
npm view @midnight-ntwrk/midnight-js-contracts versions --json 2>&1 | tr -d '\n ' | tail -c 400
echo; echo
echo "=== npm: midnight-js-contracts@latest peer/deps ==="
npm view @midnight-ntwrk/midnight-js-contracts@latest dependencies --json 2>&1
echo
echo "=== npm: onchain-runtime-v4 (the scope compact-runtime asks for) ==="
npm view @midnightntwrk/onchain-runtime-v4 versions --json 2>&1 | tr -d '\n ' | tail -c 300
echo; echo
echo "=== npm: @midnight-ntwrk/onchain-runtime versions ==="
npm view @midnight-ntwrk/onchain-runtime versions --json 2>&1 | tr -d '\n ' | tail -c 300
echo
