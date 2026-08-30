#!/usr/bin/env bash
IDX="https://indexer.${1:-preview}.midnight.network/api/v4/graphql"
echo "=== TransactionOffset input fields ==="
curl -s -m 30 -X POST "$IDX" -H 'content-type: application/json' \
 -d '{"query":"query { __type(name: \"TransactionOffset\") { inputFields { name type { name kind ofType { name } } } } }"}' \
 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);for(const f of j.data.__type.inputFields){console.log('  '+f.name+' : '+(f.type.name||f.type.ofType?.name||f.type.kind))}}catch(e){console.log(s.slice(0,300))}})"
echo
echo "=== Transaction type fields (full) ==="
curl -s -m 30 -X POST "$IDX" -H 'content-type: application/json' \
 -d '{"query":"query { __type(name: \"Transaction\") { fields { name type { name kind ofType { name } } } } }"}' \
 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);for(const f of j.data.__type.fields){console.log('  '+f.name+' : '+(f.type.name||f.type.ofType?.name||f.type.kind))}}catch(e){console.log(s.slice(0,300))}})"
