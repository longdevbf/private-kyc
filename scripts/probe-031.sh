#!/usr/bin/env bash
# The support matrix says every live network runs compiler 0.31.1 /
# compact-runtime 0.16.0. The only question that matters now is whether
# that line can express this contract at all -- specifically whether it
# has Jubjub Schnorr verification, which the whole issuer model rests on.
export PATH="$HOME/.local/bin:$PATH"

echo "=== live endpoints ==="
for h in rpc.preview.midnight.network indexer.preview.midnight.network \
         rpc.preprod.midnight.network indexer.preprod.midnight.network ; do
  ip=$(getent hosts "$h" 2>/dev/null | head -1 | awk '{print $1}')
  printf '%-42s %s\n' "$h" "${ip:-NO DNS}"
done
echo
echo "-- HTTP status --"
printf '%-58s %s\n' 'https://rpc.preview.midnight.network' "$(curl -s -o /dev/null -m 20 -w '%{http_code}' https://rpc.preview.midnight.network)"
printf '%-58s %s\n' 'https://indexer.preview.midnight.network/api/v4/graphql' "$(curl -s -o /dev/null -m 20 -w '%{http_code}' https://indexer.preview.midnight.network/api/v4/graphql)"
printf '%-58s %s\n' 'https://rpc.preprod.midnight.network' "$(curl -s -o /dev/null -m 20 -w '%{http_code}' https://rpc.preprod.midnight.network)"

echo
echo "=== does compact-runtime 0.16.0 expose Jubjub Schnorr signing? ==="
tmp=$(mktemp -d)
cd "$tmp" || exit 1
npm init -y >/dev/null 2>&1
npm install --no-audit --no-fund @midnight-ntwrk/compact-runtime@0.16.0 >/dev/null 2>&1
if [ -d node_modules/@midnight-ntwrk/compact-runtime ]; then
  echo "-- installed --"
  node -e "
    const m = require('@midnight-ntwrk/compact-runtime');
    const keys = Object.keys(m).sort();
    const hit = keys.filter(k => /jubjub|schnorr|sign|verif/i.test(k));
    console.log('exports matching jubjub/schnorr/sign/verify:', hit.length ? hit : 'NONE');
    console.log('total exports:', keys.length);
  " 2>&1
  echo "-- grep the type declarations --"
  grep -rioh 'jubjub[A-Za-z]*' node_modules/@midnight-ntwrk/compact-runtime/dist/*.d.ts 2>/dev/null | sort -u | head -20
  echo "(end grep)"
else
  echo "INSTALL FAILED"
fi
cd / && rm -rf "$tmp"
