#!/usr/bin/env bash
# Establish the exact stdlib surface of language 0.23 before porting.
#
# The first run of this probe reported almost everything as missing. That
# was wrong: 0.23 already has the disclose() taint system, and an exported
# circuit's parameters are witness-tainted, so writing one to the ledger
# without disclose() fails for a reason that has nothing to do with the
# construct under test. Every probe below wraps its parameters.
export PATH="$HOME/.local/bin:$PATH"
compact update 0.31.1 >/dev/null 2>&1
mkdir -p /tmp/surface && cd /tmp/surface || exit 1

try() {
  local name="$1"; shift
  printf '%s\n' "$*" > t.compact
  local out
  out=$(compact compile --skip-zk t.compact out 2>&1 | grep -viE '^\s*$' | head -2 | tr '\n' ' ')
  rm -rf out
  if [ -z "$out" ]; then
    printf '  OK       %s\n' "$name"
  else
    printf '  FAIL     %-24s %s\n' "$name" "$(echo "$out" | cut -c1-120)"
  fi
}

HDR='pragma language_version 0.23;
import CompactStandardLibrary;'

echo "=== ledger types ==="
try 'Counter'            "$HDR"$'\nexport ledger c: Counter;\nexport circuit f(): [] { c.increment(1); }'
try 'Map insert'         "$HDR"$'\nexport ledger m: Map<Uint<16>, Bytes<32>>;\nexport circuit f(k: Uint<16>, v: Bytes<32>): [] { m.insert(disclose(k), disclose(v)); }'
try 'Map member/lookup'  "$HDR"$'\nexport ledger m: Map<Uint<16>, Bytes<32>>;\nexport ledger o: Bytes<32>;\nexport circuit f(k: Uint<16>): [] { assert(m.member(disclose(k)), "x"); o.write(m.lookup(disclose(k))); }'
try 'Map remove'         "$HDR"$'\nexport ledger m: Map<Uint<64>, Uint<16>>;\nexport circuit f(k: Uint<64>): [] { m.remove(disclose(k)); }'
try 'sealed ledger'      "$HDR"$'\nexport sealed ledger a: Bytes<32>;\nconstructor(x: Bytes<32>) { a = disclose(x); }'
try 'HistoricMerkleTree' "$HDR"$'\nexport ledger t: HistoricMerkleTree<10, Bytes<32>>;\nexport circuit f(v: Bytes<32>): [] { t.insert(disclose(v)); }'
try 'insertIndex'        "$HDR"$'\nexport ledger t: HistoricMerkleTree<10, Bytes<32>>;\nexport circuit f(v: Bytes<32>, i: Uint<64>): [] { t.insertIndex(disclose(v), disclose(i)); }'
try 'insertIndexDefault' "$HDR"$'\nexport ledger t: HistoricMerkleTree<10, Bytes<32>>;\nexport circuit f(i: Uint<64>): [] { t.insertIndexDefault(disclose(i)); }'
try 'resetHistory'       "$HDR"$'\nexport ledger t: HistoricMerkleTree<10, Bytes<32>>;\nexport circuit f(): [] { t.resetHistory(); }'
try 'isFull'             "$HDR"$'\nexport ledger t: HistoricMerkleTree<10, Bytes<32>>;\nexport ledger b: Boolean;\nexport circuit f(): [] { b.write(t.isFull()); }'

echo
echo "=== merkle proof path ==="
try 'merkleTreePathRoot' "$HDR"$'\nwitness p(): MerkleTreePath<10, Bytes<32>>;\nexport ledger t: HistoricMerkleTree<10, Bytes<32>>;\nexport circuit f(): [] { assert(t.checkRoot(disclose(merkleTreePathRoot<10, Bytes<32>>(p()))), "x"); }'
try 'path.leaf field'    "$HDR"$'\nwitness p(): MerkleTreePath<10, Bytes<32>>;\nexport ledger b: Boolean;\nexport circuit f(c: Bytes<32>): [] { b.write(disclose(p().leaf == c)); }'

echo
echo "=== hashing and commitment ==="
try 'persistentHash'     "$HDR"$'\nexport ledger b: Bytes<32>;\nexport circuit f(x: Bytes<32>): [] { b.write(disclose(persistentHash<Vector<2, Bytes<32>>>([x, x]))); }'
try 'persistentHash x4'  "$HDR"$'\nexport ledger b: Bytes<32>;\nexport circuit f(x: Bytes<32>): [] { b.write(disclose(persistentHash<Vector<4, Bytes<32>>>([x, x, x, x]))); }'
try 'persistentCommit'   "$HDR"$'\nexport ledger b: Bytes<32>;\nexport circuit f(x: Bytes<32>, r: Bytes<32>): [] { b.write(persistentCommit<Bytes<32>>(x, r)); }'
try 'pad'                "$HDR"$'\nexport ledger b: Bytes<32>;\nexport circuit f(): [] { b.write(pad(32, "hello")); }'

echo
echo "=== disclosure and time ==="
try 'blockTimeGte'       "$HDR"$'\nexport circuit f(t: Uint<64>): [] { assert(blockTimeGte(disclose(t)), "x"); }'
try 'blockTimeLt'        "$HDR"$'\nexport circuit f(t: Uint<64>): [] { assert(blockTimeLt(disclose(t)), "x"); }'

echo
echo "=== language features the port needs ==="
try 'enum'               "$HDR"$'\nexport enum E { A, B }\nexport ledger b: Boolean;\nexport circuit f(e: E): [] { b.write(disclose(e == E.A)); }'
try 'struct + Vector'    "$HDR"$'\nexport struct S { a: Uint<64>; b: Uint<16>; }\nexport ledger x: Uint<64>;\nexport circuit f(s: S, v: Vector<8, Uint<16>>): [] { x.write(disclose(s.a + v[0] as Uint<64>)); }'
try 'module, not export' "$HDR"$'\nmodule M {\n  export struct S { a: Uint<64>; }\n}\nexport ledger x: Uint<64>;\nexport circuit f(s: M.S): [] { x.write(disclose(s.a)); }'
try 'witness Bytes'      "$HDR"$'\nwitness sk(): Bytes<32>;\nexport ledger b: Bytes<32>;\nexport circuit f(): [] { b.write(disclose(persistentHash<Vector<2, Bytes<32>>>([pad(32, "d"), sk()]))); }'
