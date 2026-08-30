#!/usr/bin/env bash
# The remaining unknowns for the 0.23 port. Each is something the port
# design depends on; none is assumed.
export PATH="$HOME/.local/bin:$PATH"
compact update 0.31.1 >/dev/null 2>&1
mkdir -p /tmp/port && cd /tmp/port || exit 1

try() {
  local name="$1"; shift
  printf '%s\n' "$*" > t.compact
  local out
  out=$(compact compile --skip-zk t.compact out 2>&1 | grep -viE '^\s*$' | head -2 | tr '\n' ' ')
  rm -rf out
  if [ -z "$out" ]; then printf '  OK    %s\n' "$name"
  else printf '  FAIL  %-32s %s\n' "$name" "$(echo "$out" | cut -c1-115)"; fi
}

H='pragma language_version 0.23;
import CompactStandardLibrary;'

echo "=== casts the port needs ==="
try 'Uint<16> as Field'        "$H"$'\nexport ledger f: Field;\nexport circuit c(i: Uint<16>): [] { f.write(disclose(i as Field)); }'
try 'Counter as Uint<64>'      "$H"$'\nexport ledger e: Counter;\nexport ledger o: Uint<64>;\nexport circuit c(): [] { o.write(e as Uint<64>); }'
try 'Counter as Bytes<32>'     "$H"$'\nexport ledger e: Counter;\nexport ledger o: Bytes<32>;\nexport circuit c(): [] { o.write(e as Bytes<32>); }'
try 'Uint<64> as Bytes<32>'    "$H"$'\nexport ledger o: Bytes<32>;\nexport circuit c(i: Uint<64>): [] { o.write(disclose(i as Bytes<32>)); }'

echo
echo "=== assert on a witness-derived Boolean, no disclose ==="
try 'assert(witness == param)' "$H"$'\nwitness w(): Bytes<32>;\nexport ledger o: Boolean;\nexport circuit c(x: Bytes<32>): [] { assert(w() == x, "no"); o.write(true); }'
try 'assert(witness < param)'  "$H"$'\nwitness w(): Uint<64>;\nexport ledger o: Boolean;\nexport circuit c(x: Uint<64>): [] { assert(w() < x, "no"); o.write(true); }'
try 'assert(hash(w) == ledger)' "$H"$'\nwitness w(): Bytes<32>;\nexport ledger m: Map<Uint<16>, Bytes<32>>;\nexport circuit c(i: Uint<16>): [] { const id = disclose(i); assert(m.member(id), "a"); assert(persistentHash<Vector<2, Bytes<32>>>([pad(32, "d"), w()]) == m.lookup(id), "b"); }'

echo
echo "=== struct commitment and predicate shape ==="
try 'persistentCommit<struct>'  "$H"$'\nstruct A { birth: Uint<64>; country: Uint<16>; tier: Uint<8>; exp: Uint<64>; }\nwitness attrs(): A;\nwitness bl(): Bytes<32>;\nexport ledger o: Bytes<32>;\nexport circuit c(): [] { o.write(persistentCommit<A>(attrs(), bl())); }'
try 'enum + if/return in pure'  "$H"$'\nenum P { A, B, C }\nstruct A { birth: Uint<64>; country: Uint<16>; tier: Uint<8>; exp: Uint<64>; }\nstruct R { pid: P; thr: Uint<64>; allowed: Vector<8, Uint<16>>; }\npure circuit ev(r: R, a: A, now: Uint<64>): Boolean {\n  if (r.pid == P.A) { return (a.birth + r.thr) <= now; }\n  if (r.pid == P.B) { return (a.tier as Uint<64>) >= r.thr; }\n  if (r.pid == P.C) { return a.country == r.allowed[0] || a.country == r.allowed[1]; }\n  return false;\n}\nexport ledger o: Boolean;\nwitness attrs(): A;\nexport circuit c(r: R, now: Uint<64>): [] { assert(ev(disclose(r), attrs(), disclose(now)), "no"); o.write(true); }'

echo
echo "=== struct as an exported circuit parameter ==="
try 'struct param + disclose'   "$H"$'\nstruct R { pid: Uint<8>; thr: Uint<64>; allowed: Vector<8, Uint<16>>; }\nexport ledger o: Uint<64>;\nexport circuit c(r: R): [] { const q = disclose(r); o.write(q.thr); }'
