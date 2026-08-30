#!/usr/bin/env bash
# The image is midnightntwrk/proof-server, not midnightnetwork/proof-server.
# The latter is a different (older) repo and is why 8.x looked missing.
echo "=== midnightntwrk/proof-server tags ==="
curl -s "https://hub.docker.com/v2/repositories/midnightntwrk/proof-server/tags?page_size=100" \
  | node -e "
let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
  try {
    const j = JSON.parse(s);
    if (j.message) { console.log('  ' + j.message); return; }
    const t = (j.results||[]).map(r=>({n:r.name,d:(r.last_updated||'').slice(0,10)}));
    t.sort((a,b)=> b.d.localeCompare(a.d));
    for (const x of t.slice(0,30)) console.log('  ' + x.d + '  ' + x.n);
    console.log('  total tags:', j.count);
  } catch(e) { console.log('  parse failed:', s.slice(0,200)); }
});"
