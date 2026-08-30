#!/usr/bin/env bash
# What query returns unshielded balances for an address? Introspect the
# indexer schema rather than guessing field names.
IDX="https://indexer.${1:-preview}.midnight.network/api/v4/graphql"

echo "=== root query fields ==="
curl -s -m 30 -X POST "$IDX" -H 'content-type: application/json' \
 -d '{"query":"query { __schema { queryType { fields { name args { name type { name kind ofType { name } } } } } } }"}' \
 | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
 try{const j=JSON.parse(s);
  for(const f of j.data.__schema.queryType.fields){
    const a=f.args.map(x=>x.name+':'+(x.type.name||x.type.ofType?.name||x.type.kind)).join(', ');
    console.log('  '+f.name+'('+a+')');
  }
 }catch(e){console.log(s.slice(0,400))}
});"
