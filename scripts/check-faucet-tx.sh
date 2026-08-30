#!/usr/bin/env bash
# Confirm a faucet transaction landed. The faucet reports a 33-byte
# transaction IDENTIFIER (leading 00), which is a different value from the
# 32-byte transaction HASH; the indexer offset accepts either, so try both.
NET="$1"; TX="$2"
IDX="https://indexer.${NET}.midnight.network/api/v4/graphql"

ask() {
  local field="$1" val="$2"
  local Q="query { transactions(offset: { $field: \\\"$val\\\" }) { hash block { height timestamp } unshieldedCreatedOutputs { owner value } } }"
  curl -s -m 30 -X POST "$IDX" -H 'content-type: application/json' -d "{\"query\":\"$Q\"}" \
  | node -e "
  let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    try {
      const j=JSON.parse(s);
      if (j.errors) { console.log('    error:', j.errors[0].message.slice(0,110)); return; }
      const t=j.data.transactions;
      if (!t || !t.length) { console.log('    no match'); return; }
      for (const x of t) {
        console.log('    hash  ', x.hash);
        console.log('    block ', x.block?.height, x.block?.timestamp);
        for (const o of (x.unshieldedCreatedOutputs||[])) {
          console.log('    ->', o.value, 'to', String(o.owner).slice(0,40));
        }
      }
    } catch(e){ console.log('    ', s.slice(0,200)); }
  });"
}

echo "  by identifier ($TX):";  ask identifier "$TX"
echo "  by hash (${TX#00}):";    ask hash "${TX#00}"
