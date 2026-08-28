# RESEARCH.md — Midnight / Compact primary-source verification

**Compiled:** 2026-08-27
**Purpose:** Phase 0 of the Private Credential Lifecycle Engine build. No design, no application code — findings only.

**Method.** Every claim below was read from a page I actually fetched, not from model memory. Where the documentation site publishes a raw Markdown twin of a page (`<path>.md`), I fetched that instead of the rendered HTML so nothing was lost to summarization. Anything I could not confirm this way is marked **NOT FOUND** or listed in section E. Nothing in sections B or C is reconstructed from memory.

Two corrections to assumptions I held before reading the docs are recorded inline and marked **[CORRECTION]**.

> **Addendum, Phase 1 (2026-08-27).** Sections A–E below are the documentation-only findings. I have since installed both compilers in WSL2 and tested the open questions against the real toolchain. **Section F supersedes any conflicting claim above.** Several things the docs implied turned out to be wrong for the version we are targeting.

---

## F. EMPIRICAL VERIFICATION (WSL2, real compiler)

Environment: Ubuntu 24.04.3 LTS on WSL2, x86_64, Node v22.22.0, Docker 29.1.3, `compact` dev tool **0.5.2** (matrix says 0.5.1; installer ships 0.5.2).

### F.1 Version sets — measured from compiled artifacts

Read out of `compiler/contract-info.json` / `contract-manifest.json` after compiling the same source with each compiler:

| Compiler | `language-version` | `runtime-version` | In compatibility matrix |
|---|---|---|---|
| 0.31.1 | **0.23.0** | **0.16.0** | ✅ tested on all networks |
| 0.34.0 | **0.26.0** | **0.19.0** | ❌ newer than tested |

**This resolves UNKNOWN #7.** The 0.16.0-vs-0.19.0 `compact-runtime` discrepancy in A.8 is not a documentation error — the two numbers belong to two different *version sets*. The matrix is internally consistent.

### F.2 ⚠ Language 0.23 has NO in-circuit signature verification

The single most important Phase 1 finding. Compiling against compiler 0.31.1:

```
Exception: unbound identifier jubjubSchnorrVerify
Exception: unbound identifier JubjubSchnorrSignature
Exception: unbound identifier secp256k1EcdsaVerify
```

**Not Schnorr, not ECDSA, nothing.** The stdlib page at `/compact/standard-library/exports` documents the **0.26** stdlib and does not say which language version introduced each export. My claim in C.4 that `jubjubSchnorrVerify` "has shipped" is true only for language 0.26 / compiler 0.34.0. This is why the ZK Loan tutorial (targeting 0.22–0.23) hand-rolls a Schnorr polyfill and describes the builtin in the future tense — that tutorial is correct for its own version.

On compiler 0.34.0 the full crypto surface compiles clean, including `jubjubSchnorrVerify<1>` over a `degradeToTransient(persistentCommit(...))` digest.

**Decision taken:** target **compiler 0.34.0 / language 0.26 / runtime 0.19.0**, accepting that it sits outside the tested matrix, rather than hand-rolling signature verification in the one component whose entire job is trust. Residual risk: Preprod deployment on runtime 0.19.0 is unverified — worth proving with a throwaway deploy before the demo depends on it.

### F.3 `HistoricMerkleTree` — verified in-circuit

Compiled successfully as in-circuit operations: `insert`, `insertIndexDefault`, `resetHistory`, `checkRoot`.

- **There is no `remove` method.** Removal is `insertIndexDefault(index)`, documented as *"can be used to emulate a removal from the tree."* Tombstoning is not a workaround, it is the mechanism. **The issuer must therefore track each credential's leaf index** to be able to revoke it.
- **`resetHistory()` is callable in-circuit** — *"Resets the history for this Merkle tree, leaving only the current root valid."* This means revocation latency from the historical-root window is **optional, not forced**: a revocation can atomically invalidate every stale path. The cost inverts to availability — all holders must refresh, not just the revoked one.
- The history window length remains undocumented (UNKNOWN #12 stands), but `resetHistory()` makes it controllable regardless.

### F.4 Merkle composition — **UNKNOWN #2 and #3 resolved**

My highest-risk unknown. The full loop is real, confirmed from generated bindings:

```ts
// generated Witnesses type
merklePath(context): [PS, { leaf: Uint8Array,
                            path: { sibling: { field: bigint }, goes_left: boolean }[] }]

// generated Ledger type
activeCredentials.pathForLeaf(index: bigint, leaf: Uint8Array): MerkleTreePath<Uint8Array>
activeCredentials.findPathForLeaf(leaf: Uint8Array): MerkleTreePath<Uint8Array> | undefined
activeCredentials.checkRoot(rt: { field: bigint }): boolean
activeCredentials.history(): Iterator<MerkleTreeDigest>
```

⚠ The TypeScript path-entry field is **`goes_left`** (snake_case), not `goesLeft` as the Compact struct spells it.

### F.5 `JubjubPoint` in ledger state — **works directly**

Both of these compile and surface in TypeScript as `__compactRuntime.JubjubPoint`:

```compact
export ledger issuerPoint: JubjubPoint;
export ledger issuerPointMap: Map<Uint<16>, JubjubPoint>;
```

The "native types cannot be exported from the top level" rule in B.2 applies to **type and circuit exports**, not to ledger fields typed with a native type. No hash-indirection workaround is needed.

### F.6 Two disclosure rules the docs do not make obvious

**Exported circuit parameters require `disclose()`.** Not only witness return values:

```
potential witness-value disclosure must be declared but is not:
  the value of parameter c of exported circuit probeInsert
  ledger operation might disclose the witness value
```

This contradicts the natural assumption that circuit arguments are already public transaction inputs. The compiler is conservative and taints them.

**Comparing a private timestamp against block time leaks a bound:**

```
the call to standard-library circuit blockTimeLt might disclose the lower bound
of the time being checked the witness value
```

So `blockTimeLt(attributes().expiresAt)` on a *private* `expiresAt` does not compile without `disclose()`. Enforcing expiry in-circuit over a private expiry timestamp is not free — it discloses a bound on it. A real design decision, not a formality.

### F.7 Proving-key generation cost — **partially resolves UNKNOWN #1**

Full ZK compile (no `--skip-zk`) of the 4-circuit probe, depth-10 tree: **7.31 s total.**

| Circuit | Prover key |
|---|---|
| `probeCheckPath` (Merkle membership verify) | 280 KB |
| `probeResetHistory` | 14 KB |
| `probeInsert` (tree insert) | 2.82 MB |
| `probeTombstone` (insertIndexDefault) | 2.81 MB |

In-circuit **path verification is an order of magnitude cheaper than tree mutation**. Holder-side presentation is the light operation; issuer-side writes are heavy. This is the opposite of the intuitive guess and is good news for demo responsiveness.

Caveat: key *generation* time is a proxy for circuit size, **not** a measurement of runtime proof generation, which happens in the proof server. Runtime proving latency is still unmeasured.

### F.7b Installer PATH discrepancy

The [installation guide](https://docs.midnight.network/getting-started/installation) gives the manual PATH fallback as:

```bash
export PATH="$HOME/.compact/bin:$PATH"
```

The installer actually reports `installing to /home/<user>/.local/bin`, and that is where the `compact` binary lands. `$HOME/.compact` exists but holds the downloaded compiler toolchains, not the dev-tool binary. Exporting the documented path alone produces `compact: not found`. Correct line:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### F.7c ⚠ The 0.34.0 stack is pre-release and no live network runs it

This is the most consequential finding of the whole project, and it was not visible from the documentation.

Resolving the actual npm dependency chain:

| compact-runtime | depends on | status |
|---|---|---|
| **0.16.0** (compiler 0.31.1) | `@midnight-ntwrk/onchain-runtime-v3` `^3.0.0` | stable |
| **0.19.0** (compiler 0.34.0) | `@midnightntwrk/onchain-runtime-v4` `^4.0.0-rc.3` | **release candidate** |

The [compatibility matrix](https://docs.midnight.network/relnotes/support-matrix) lists **on-chain runtime 3.0.0** for Preview, Preprod *and* Mainnet. Docker Hub tells the same story for the prover: `proof-server:8.1.0` is the newest stable tag (2026-05-13), while every v4-era build is `9.0.0-rc.1` … `9.0.0-rc.7`.

So the entire v4 stack — `onchain-runtime 4.0.0-rc.3`, proof server `9.0.0-rc.7` — is in release candidate, and **no live Midnight network runs it**. A contract compiled with compiler 0.34.0 is therefore not deployable to Preprod or Mainnet today. This is a stronger statement than "outside the tested matrix", which is how F.2 originally characterised it.

**What the alternative would cost.** Compiling the full contract against 0.31.1 / language 0.23 succeeds for *everything except signature verification* — `HistoricMerkleTree` with `resetHistory`/`insertIndex`/`insertIndexDefault`, `Map<Uint<16>, JubjubPoint>`, `persistentCommit` over a struct, `blockTime*`, `merkleTreePathRoot`, enums and module imports all compile fine (verified by stripping only the Schnorr calls and building). But going back would require hand-rolling Jubjub Schnorr on **both** sides:

- in Compact, the ~80-line polyfill from the ZK Loan tutorial, whose own documentation warns that an under-constrained quotient there permits signature forgery;
- in TypeScript, the signing half from scratch — `compact-runtime 0.16.0` exports only `constructJubjubPoint`, `jubjubPointX`, `jubjubPointY` and `CompactTypeJubjubPoint`. There is **no `jubjubSchnorrSign`, no `jubjubSchnorrVerifyingKey`, no `jubjubSampleScalar`**.

That is bespoke elliptic-curve code in the one component whose entire job is trust, on both sides of the boundary.

### F.8 Build ergonomics

- Compiling on `/mnt/d` from WSL2 takes **0.38 s** for a small contract — the 9P penalty is negligible for the compiler itself. The repo can stay on the Windows drive where the IDE sees it. (`npm install` into `/mnt/d/node_modules` is a separate matter and may still be slow.)
- `compact compile +0.34.0 ...` pins a version per invocation without changing the default. Useful for A/B testing against 0.31.1.
- `--skip-zk` inner loop is ~0.35 s. Fast enough to compile after every edit, as the working style requires.

---

## A. TOOLCHAIN

### A.1 Compiler and dev tool

Two separate things share the name "Compact", and conflating them causes version confusion:

| Thing | What it is | Version |
|---|---|---|
| `compact` | The dev tool / version manager. Installs and switches compilers. | **0.5.1** |
| `compact compile` | The actual compiler toolchain (historically `compactc`). | **0.31.1** (pinned) / 0.34.0 (latest) |
| Compact *language* | The language spec the compiler accepts. | 0.26.0 ships with compiler 0.34.0 |

**Which compiler version to target: 0.31.1.**

This is the single most important toolchain finding, and the docs disagree with themselves:

- The [compiler release notes](https://docs.midnight.network/relnotes/compact) list **0.34.0** as *Latest*, corresponding to Compact language 0.26.0.
- The [compatibility matrix](https://docs.midnight.network/relnotes/support-matrix) pins **`compact compile` 0.31.1** as the tested version for **all three networks** — Preview, Preprod, and Mainnet alike.
- The [installation guide](https://docs.midnight.network/getting-started/installation) literally instructs `compact update 0.31.1`, even under a heading that says "Update to the latest compiler version".

The matrix carries the note: *"This matrix only reflects the latest tested versions. Earlier versions may still work, but we do not guarantee compatibility or provide support for them."* Since 0.34.0 is *newer* than the tested version rather than older, that note does not cover it. **Target 0.31.1** and pin it explicitly. The dev tool supports per-invocation pinning: `compact compile +0.31.1 ...`.

### A.2 Installation

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh

compact update 0.31.1        # download compiler 0.31.1, set as default
compact --version            # dev tool version
compact compile --version    # compiler version
```

Installs to `$HOME/.compact/bin`, which the installer appends to `PATH`.

Source: [Install the toolchain](https://docs.midnight.network/getting-started/installation)

### A.3 ⚠ Platform — this affects us directly

> *"Development is supported on Linux and Mac. **Windows is not supported natively at this time**, if you are using Windows, development through WSL is recommended."*
> — [Install the toolchain](https://docs.midnight.network/getting-started/installation)

**This machine is Windows 11 and the project directory is `d:\private-KYC`.** The entire toolchain needs to run inside WSL2. Two consequences worth deciding on before any code is written:

1. Building on `/mnt/d/...` from inside WSL works but is slow — the 9P filesystem bridge makes `node_modules` installs and compiler I/O painful. Keeping the repo on the WSL native filesystem (`~/private-KYC`) is materially faster.
2. Docker Desktop needs WSL2 integration enabled for the proof server to be reachable from inside the distro.

I have not verified whether the compiler will run under native Windows anyway — the docs simply say unsupported, which is not the same as non-functional. Listed in section E.

### A.4 Runtime dependencies

- **Node.js 22+** ([quickstart](https://docs.midnight.network/getting-started/quickstart))
- **Docker Desktop** with Compose v2
- **Proof server**, required for local proving:
  ```bash
  docker run -p 6300:6300 midnightntwrk/proof-server:8.1.0 midnight-proof-server -v
  ```
  Listens on `http://localhost:6300`. Lace's Midnight settings must be pointed at `Local (http://localhost:6300)` — the docs state local is *"currently the only option supported within Lace."*

### A.5 Networks and test tokens

From [Environments and endpoints](https://docs.midnight.network/relnotes/network):

| | Preview | Preprod |
|---|---|---|
| Node RPC | `https://rpc.preview.midnight.network` | `https://rpc.preprod.midnight.network` |
| Indexer (GraphQL) | `https://indexer.preview.midnight.network/api/v4/graphql` | `https://indexer.preprod.midnight.network/api/v4/graphql` |
| Faucet UI | `https://midnight-tmnight-preview.nethermind.dev/` | `https://midnight-tmnight-preprod.nethermind.dev/` |
| Explorer | `https://preview.midnightexplorer.com/` | `https://preprod.midnightexplorer.com/` |

Preview is described as *"early-stage development and experimentation"*; Preprod as *"final testing before mainnet deployment"*. Both have faucets. Mainnet has no faucet, as expected.

**Note:** the build prompt says "preprod vs mainnet" — but **Preview also exists** and is the one the docs point at for experimentation. Which of Preview/Preprod the Buildathon requires is not something I could verify (section E).

### A.6 Project scaffold

```bash
npx create-mn-app [project-name]     # v0.5.0
```

Prompts for project type, then template:

- **Contract** → `hello-world` (bundles a local devnet, supports `--network`) or `battleship`
- **Full DApp** → `bboard` (bulletin board) or `leaderboard` (**React + Lace browser DApp with in-browser ZK proving**)

The `leaderboard` template is the closest fit to a three-persona browser UI requirement, since it already solves Lace wallet connection and browser-side proving. `dex` and `midnight-kitties` show as *coming soon*.

Source: [Create a Midnight DApp](https://docs.midnight.network/getting-started/quickstart)

### A.7 Compiler outputs and iteration speed

`compact compile` produces, per exported circuit, a **prover key** and **verifier key** in `<targetdir>/keys/<circuitname>.prover|.verifier`, plus the TypeScript bindings.

```bash
compact compile --skip-zk src/foo.compact managed/foo
```

`--skip-zk` skips proving-key generation. The docs state plainly: *"Generating proving keys can be time-consuming, so this option is useful when debugging only the Typescript output."* This is the fast inner loop for iterating on contract logic and TypeScript integration; full builds only when proofs are actually needed.

Source: [Compact compiler usage](https://docs.midnight.network/compact/compilation-and-tooling/compiler-usage), [dev tool usage](https://docs.midnight.network/compact/compilation-and-tooling/dev-tool-usage)

### A.8 npm packages — verified live against the registry

Queried `registry.npmjs.org` directly on 2026-08-27:

| Package | npm `latest` | Matrix says |
|---|---|---|
| `@midnight-ntwrk/compact-runtime` | **0.19.0** | 0.16.0 ⚠ |
| `@midnight-ntwrk/midnight-js-contracts` | 4.1.1 | 4.1.1 ✓ |
| `@midnight-ntwrk/midnight-js-types` | 4.1.1 | 4.1.1 ✓ |
| `@midnight-ntwrk/dapp-connector-api` | 4.0.1 | 4.0.1 ✓ |
| `@midnight-ntwrk/testkit-js` | 4.1.1 | 4.1.1 ✓ |
| `create-mn-app` | 0.5.0 | — |

`compact-runtime` is the one mismatch: npm's latest is 0.19.0, the matrix tested 0.16.0. The API reference documents the v0.19.0 surface. **Let the scaffold pick the version** rather than pinning by hand, and note that the API docs describe 0.19.0.

### A.9 Anti-hallucination tooling — recommended

Midnight ships **Midnight Expert**, a suite of Claude Code plugins that compile generated Compact against the real compiler and iterate on genuine compiler errors rather than trusting model memory:

```bash
curl -fsSL https://midnightntwrk.expert/install.sh | bash
# or: claude plugin marketplace add https://midnightntwrk.expert
```

`/midnight-verify:verify` compiles a small test contract and returns Confirmed / Refuted / Inconclusive with evidence. Given the explicit "never fabricate an API" rule in the build prompt, **installing this is worth doing before Phase 1.**

Source: [Midnight Expert](https://docs.midnight.network/ai-integration/midnight-expert)

---

## B. LANGUAGE REFERENCE (verified only)

Primary sources for this whole section: [Compact reference](https://docs.midnight.network/compact/reference/compact-reference), [Writing a contract](https://docs.midnight.network/compact/reference/writing), [Ledger data types](https://docs.midnight.network/compact/data-types/ledger-adt), [Explicit disclosure](https://docs.midnight.network/compact/reference/explicit-disclosure).

Compact is described as *"a strongly typed, statically typed, bounded programming language for writing smart contracts."* "Bounded" is load-bearing — see B.6.

### B.1 A real, complete contract, quoted verbatim

From [Writing a contract](https://docs.midnight.network/compact/reference/writing) (note: that page's own pragma is `0.16`, which is stale relative to the 0.26 language — the *structure* is what I am citing, not the version):

```compact
pragma language_version 0.16;

import CompactStandardLibrary;

enum State {
  UNSET,
  SET
}

export ledger authority: Bytes<32>;
export ledger value: Uint<64>;
export ledger state: State;
export ledger round: Counter;

constructor(sk: Bytes<32>, v: Uint<64>) {
  authority = disclose(publicKey(round, sk));
  value = disclose(v);
  state = State.SET;
}

circuit publicKey(round: Field, sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>(
           [pad(32, "midnight:examples:lock:pk"), round as Bytes<32>, sk]);
}
```

A second, more current example — the ZK Loan tutorial, which declares `pragma language_version >= 0.22 && <= 0.23`:

```compact
export ledger blacklist: Set<UserPublicKey>;
export ledger loans: Map<Bytes<32>, Map<Uint<16>, LoanApplication>>;
export ledger contractAdmin: AdminPublicKey;
export ledger providers: Map<Uint<16>, JubjubPoint>;

witness getAttestedScoringWitness(): [Applicant, Schnorr_SchnorrSignature, Uint<16>];
witness getUserSecret(): UserSecretKey;
```

Source: [ZK Loan smart contract](https://docs.midnight.network/tutorials/zk-loan/smart-contract)

### B.2 Declaration forms (grammar, quoted)

| Construct | Form |
|---|---|
| Pragma | `pragma` *id* *version-expr* `;` where *id* ∈ {`compiler_version`, `language_version`} |
| Module | `export`opt `module` *name* *gparams*opt `{` *program-element* … `}` |
| Contract | `export`opt `contract` *name* `{` *circuit-declaration* `;`… `}` |
| Circuit | `export`opt `pure`opt `circuit` *name* *gparams*opt `(`*typed-pattern*,…`)` `:` *type* *block* |
| Constructor | `constructor` `(`*typed-pattern*,…`)` *block* |
| Ledger field | `export`opt `sealed`opt `ledger` *id* `:` *type* `;` |
| Witness | `export`opt `witness` *id* *gparams*opt `(`*typed-id*,…`)` `:` *type* `;` |

Version expressions support `&&`, `||`, `!`, `<`, `<=`, `>=`, `>`, and parentheses; versions are 1–3 dot-separated naturals. Example from the reference: `pragma compiler_version >= 1.0.0 && !1.0.5;`

**Top-level export rules** (these bite):

- Exported top-level circuits are the contract's on-chain entry points.
- It is a **static error to export a generic circuit** from the top level.
- It is a static error to export two top-level circuits with the same name (overloading is otherwise allowed).
- Exported ledger field names become visible to the generated TypeScript `ledger()` function.
- **Native** stdlib types and functions (e.g. `JubjubPoint`, `ecAdd`) **cannot be exported from the top level** — it is a compiler error. Workaround given in the docs: export a type alias and a wrapping non-generic circuit.

  ```compact
  import { JubjubPoint as nativeJubjubPoint, ecAdd as nativeEcAdd } from CompactStandardLibrary;
  export type JubjubPoint = nativeJubjubPoint;
  export pure circuit ecAdd(a: JubjubPoint, b: JubjubPoint): JubjubPoint {
    return nativeEcAdd(a, b);
  }
  ```

### B.3 Type system

**Primitive types:**

| Type | Meaning |
|---|---|
| `Boolean` | two-valued |
| `Field` | unsigned integer up to the native ZK field order |
| `Uint<n>` | unsigned integer in *n* bits |
| `Uint<0..n>` | bounded unsigned integer, 0 to *n* |
| `Bytes<n>` | fixed-length byte vector |
| `Vector<n, T>` | homogeneous fixed-size tuple |
| `[T₁, …, Tₙ]` | heterogeneous tuple |
| `Opaque<"tag">` | opaque tagged value |

**Program-defined:** `struct` (named typed fields), `enum` (named variants), type aliases (structural, or nominal with `new`), and contract types.

- **Structure types must not be recursive.**
- Generic params can be types or sizes; size params are written `#n` and are dropped from the exported TypeScript type.
- `pad(n, "string")` is a **reserved word** producing `Bytes<n>` — the UTF-8 encoding of the string, zero-padded to *n*. This is the idiomatic domain-separator constructor.

**Hard numeric limits** (reference, "Implementation-specific limits"):

- max `Field` = 52435875175126190479447740508185965837690552500527637822603658699938581184512 (BLS12-381 scalar field order − 1)
- max `Uint` = 452312848583266388373324160190187140051835877600158453279131187530910662655 (2^248 − 1; 31 bytes fit in a `Field`)
- max vector / byte-vector length = 16777216 — *"this value dictates the possible range for a `for` loop."*

### B.4 The dual-state model — exact keywords

This is the part the build prompt asks to be quoted precisely, so here it is with the real keywords.

**Public state → `ledger`.** Each on-chain field is one `ledger` declaration. Ledger fields are not plain variables; they are typed **ADTs** with methods (section C.5).

```compact
export ledger counter: Counter;
export ledger spent: Set<Bytes<32>>;
sealed ledger config: Uint<32>;
```

**`sealed`** makes a ledger field immutable after initialization:

> *"A sealed field can only be set during contract deployment by the constructor or helper circuits that the constructor calls. After initialization, no exported circuit can modify sealed fields."*

```compact
sealed ledger field1: Uint<32>;
export sealed ledger field2: Uint<32>;

circuit init(x: Uint<32>): [] {
  field2 = x;  // Valid: called by constructor
}

constructor(x: Uint<16>) {
  field1 = 2 * x;  // Valid: in constructor
  init(x);         // Valid: helper circuit
}

export circuit modify(): [] {
  field1 = 10;  // ❌ Compilation error: sealed field
}
```

Enforced at compile time.

**Private state → `witness`.** Witnesses are **callback functions implemented in TypeScript**, declared without a body in Compact:

```compact
witness W(x: Uint<16>): Bytes<32>;
```

> *"A user's private state should be maintained in some secure way by the TypeScript driver of a smart contract and never stored directly in the public state of the contract."*

And the warning that governs the whole threat model:

> **danger** — *"Do not assume in your contract that the code of any `witness` function is the code that you wrote in your own implementation. Any DApp may provide any implementation that it wants for your `witness` functions. Results from them should be treated as untrusted input."*

Witness declarations may appear anywhere among a module's program elements or at the contract top level. Private state can also enter via ordinary circuit arguments and leave via return values.

**The boundary → `disclose()`.** Compact tracks witness-derived values through the dataflow and **refuses to compile** if one reaches a public boundary without an explicit `disclose()` wrapper. The tutorial states the semantics carefully, and this is worth internalizing:

> *"`disclose()` does not itself make anything public — it is a compile-time annotation that marks a witness-derived value as safe to leave the private domain. A value only becomes public when it crosses a public boundary: written to a ledger field, or returned from an exported circuit, or passed to another contract via a cross-contract call."*

The compiler follows indirect assignments and conditional expressions, not just direct ones. Best practice per the docs: place `disclose()` as narrowly as possible, on the specific value crossing the boundary, not on a broad upstream expression.

**[CORRECTION]** I had assumed `disclose()` was a runtime reveal operation. It is not — it is purely a static annotation that satisfies the compiler's taint analysis. Getting this backwards would produce a contract that looks privacy-preserving but discloses via a ledger write, or one that fails to compile for no apparent reason.

### B.5 `ownPublicKey()` is a witness, not an identity

Flagged in the security guide under its own heading. `ownPublicKey()` comes from the local Zswap state, which the DApp controls. The ZK Loan tutorial spells out the consequence — there is *"no cryptographic binding to the transaction signer"* — and instead derives identity from a witness secret:

```compact
assert(contractAdmin == deriveAdminPublicKey(getUserSecret()), "Only admin can ...");
```

> *"Inside the ZK proof, this enforces that the caller knows the 32-byte preimage of the public value stored in `contractAdmin`. The ledger value alone is useless to an attacker: they could copy it into their proof input, but they cannot supply a witness whose hash matches without knowing the secret."*

**Consequence for us:** caller identity must be a hash-preimage-knowledge proof over a witness secret. `ownPublicKey()` is not an authentication mechanism.

### B.6 Control flow — what IS and IS NOT allowed

**Allowed:**

```compact
if (expr-seq) stmt
if (expr-seq) stmt0 else stmt

for (const x of expr)          // over Vector, tuple-with-vector-type, or Bytes
for (const i of start .. end)  // start/end must be literal uints or generic nat params
```

Ternary conditional expressions, short-circuit `&&`/`||`, `map` and `fold` expressions.

**Not allowed:**

- **Recursion is disallowed.** Flat prohibition.
- **Unbounded loops.** *"the number of iterations is bounded either by constant numeric bounds or by size of an object of constant size. This restriction is motivated by the need for the compiler to generate finite proving circuits."* In the range form, *start* and *end* **must be literals or generic nat params** — not runtime values.
- **`return` inside a `for`.** *"It is a static error for stmt to be a `return` statement or for a `return` statement to appear within stmt (except where it appears nested within an anonymous circuit)."* Loops must accumulate into a variable and return after.
- Recursive struct types.
- Bypassing the type system via missing declarations or unsafe casts.

**Consequence, stated as fact rather than design:** any iteration count must be a compile-time constant. Anything sized by runtime data (a variable-length allowed-set, a variable-depth tree) has to be modelled as a fixed-size structure with padding, or moved out of the loop entirely.

### B.7 Assertions

```compact
assert(e, "message")
```

*e* must be Boolean (static error otherwise). Type of the form is `[]`. On false it is a **dynamic error** that *"halts computation of the enclosing top-level circuit or constructor with the message"*.

> *"Each assertion is checked at run time and constrained in-circuit."*

Both halves matter: the assertion is enforced inside the proof, so a malicious prover cannot skip it, **and** it aborts locally during witness execution.

Note the asymmetry in the stdlib: some verification functions return `Boolean` and some assert internally. `secp256k1EcdsaVerify` **returns a Boolean** and the docs warn explicitly: *"To actually enforce that a signature is valid in a Compact circuit, use an `assert` that the result is true."* A bare call whose result is discarded enforces nothing.

### B.8 Pure vs impure circuits

`pure` circuits do not touch ledger state. The generated TypeScript separates them — the test example accesses `contract.impureCircuits.increment(context)`. Ledger-reading/writing circuits are impure.

### B.9 Compiler outputs to TypeScript

Per exported circuit: a prover key and a verifier key under `keys/`, plus TypeScript bindings. Exported ledger fields are readable through a generated `ledger()` function. Exported top-level types become TypeScript types, with size generics dropped.

---

## C. STANDARD LIBRARY INVENTORY

Source: [Compact standard library](https://docs.midnight.network/compact/standard-library) and [Detailed API reference](https://docs.midnight.network/compact/standard-library/exports). Signatures below are quoted verbatim.

### C.1 Hash functions — **VERIFIED**

```compact
circuit transientHash<T>(value: T): Field;
circuit persistentHash<T>(value: T): Bytes<32>;
circuit keccak256<T>(value: T): Bytes<32>;
circuit degradeToTransient(x: Bytes<32>): Field;
circuit upgradeFromTransient(x: Field): Bytes<32>;
```

- `transientHash` — circuit-efficient compression to a field element. **Not guaranteed to persist across protocol upgrades.** *"It should not be used to derive state data, but can be used for consistency checks."*
- `persistentHash` — SHA-256 based, `Bytes<32>` out. *"It is guaranteed to persist between upgrades … It should be used to derive state data."*
- `keccak256` — Keccak-256, 32-byte digest.
- `degradeToTransient` / `upgradeFromTransient` convert between the two representations.

**Neither hash protects its input from disclosure.** Explicit in the docs: if the input contains a witness value, the result crossing a public boundary requires `disclose()`. Hashing is not hiding, because the preimage space may be guessable.

### C.2 Commitment helpers — **VERIFIED**

```compact
circuit transientCommit<T>(value: T, rand: Field): Field;
circuit persistentCommit<T>(value: T, rand: Bytes<32>): Bytes<32>;
```

These **do** count as hiding, and the compiler knows it:

> *"Unlike `transientHash`, this function is considered sufficient to protect its input from disclosure, under the assumption that the `rand` argument is sufficiently random. Thus, even if its input contains a value or values returned from one or more witnesses, the program need not acknowledge disclosure (via a `disclose` wrapper)."*

So `persistentCommit` output can be written to the ledger **without** `disclose()`. That is a compiler-enforced signal that the construction is considered hiding.

Security properties, as the docs define them:

- **Hiding** — *"The hash reveals nothing about the original value; observers cannot determine what you committed."*
- **Binding** — *"After creating a commitment, you cannot change the value; the commitment permanently binds to the original data."*

Explicit warning:

> **Randomness reuse** — *"Never reuse randomness across commitments. Reusing a random value with different commitment values enables linking the commitments, breaking a degree of privacy."*

Selection table from the security guide:

| Primitive | Use case | Persistence | Disclosure protection |
|---|---|---|---|
| `transientHash` | Temporary checks | No guarantee | No |
| `transientCommit` | Temporary hiding | No guarantee | Yes |
| `persistentHash` | State derivation, authentication | Guaranteed | No |
| `persistentCommit` | Long-term hiding | Guaranteed | Yes |

### C.3 Merkle tree support — **VERIFIED, and stronger than expected**

The build prompt anticipated this might be missing. It is not. **[CORRECTION]** — my prior assumption was that Merkle support would have to be hand-rolled. It is provided on both sides: as a ledger ADT and as in-circuit path verification.

**Ledger ADT** — [Ledger data types](https://docs.midnight.network/compact/data-types/ledger-adt):

`MerkleTree<n, value_type>`, *"a bounded Merkle tree of depth nat where 2 <= nat <= 32"*. (The language reference states the bound as `1 < n ≤ 32` — equivalent.)

Callable **from a circuit**:

| Method | Signature |
|---|---|
| `checkRoot` | `checkRoot(rt: MerkleTreeDigest): Boolean` — *"Tests if the given Merkle tree root is the root for this Merkle tree."* |
| `insert` | `insert(item: value_type): []` — at first free index |
| `insertHash` | `insertHash(hash: Bytes<32>): []` |
| `insertIndex` | `insertIndex(item: value_type, index: Uint<64>): []` |
| `insertHashIndex` | `insertHashIndex(hash: Bytes<32>, index: Uint<64>): []` |
| `insertIndexDefault` | `insertIndexDefault(index: Uint<64>): []` — *"Inserts a default value leaf at a specific index. **This can be used to emulate a removal from the tree.**"* |
| `isFull` | `isFull(): Boolean` |
| `resetToDefault` | `resetToDefault(): []` |

Callable **only from TypeScript** (not in-circuit) — this distinction is critical:

| Method | Signature | Note |
|---|---|---|
| `findPathForLeaf` | `findPathForLeaf(leaf): MerkleTreePath \| undefined` | *"**this is O(n) and should be avoided for large trees**"* |
| `pathForLeaf` | `pathForLeaf(index: bigint, leaf): MerkleTreePath` | error if leaf is not at that index |
| `firstFree` | `firstFree(): bigint` | |
| `root` | `root(): MerkleTreeDigest` | |

`HistoricMerkleTree<n, value_type>` — same ADT plus history. The one behavioural difference is decisive:

> `checkRoot` — *"Tests if the given Merkle tree root is **one of the past roots** for this Merkle tree."*

plus `history(): Iterator<MerkleTreeDigest>` (TypeScript only).

**Stdlib types and in-circuit verification:**

```compact
struct MerkleTreeDigest { field: Field; }

struct MerkleTreePathEntry {
  sibling: MerkleTreeDigest;
  goesLeft: Boolean;
}

struct MerkleTreePath<#n, T> {
  leaf: T;
  path: Vector<n, MerkleTreePathEntry>;
}

circuit merkleTreePathRoot<#n, T>(path: MerkleTreePath<n, T>): MerkleTreeDigest;
circuit merkleTreePathRootNoLeafHash<#n>(path: MerkleTreePath<n, Bytes<32>>): MerkleTreeDigest;
```

`MerkleTreePath` is documented as *"constructed from `witness`es that use the compiler output's `findPathForLeaf` and `pathForLeaf` functions."* `...NoLeafHash` assumes leaves are pre-hashed.

So the full loop is available: TypeScript computes the path off-chain and feeds it in as a witness → `merkleTreePathRoot` recomputes the root in-circuit → `checkRoot` compares against ledger state.

**Two facts that constrain what can be built with this, stated without proposing a design:**

1. **Membership is what these primitives verify.** `merkleTreePathRoot` + `checkRoot` proves *"this leaf is in the tree with this root."* There is **no non-membership primitive** in the stdlib — no sorted-list/interval proof, no exclusion witness. Non-membership over this API has to be reduced to a membership statement about something else.
2. **`HistoricMerkleTree.checkRoot` accepting any past root is a double-edged tool.** It solves witness staleness — a holder whose path was computed before someone else's update still verifies. But *any* past root being acceptable means a party whose status changed can also present against a pre-change root. Whether that is benign or fatal depends entirely on which direction the tree is used in, and that is a Phase 1 decision.

### C.4 Field / curve arithmetic and signatures — **VERIFIED**

**Curves:** `JubjubPoint`, `JubjubScalar`, `Secp256k1Point`, `Secp256k1Base`, `Secp256k1Scalar`, `NativePoint`.

**Operations:** `ecAdd`, `ecNeg`, `ecMul`, `ecMulGenerator`, `hashToCurve`, `constructJubjubPoint`, `jubjubPointX`, `jubjubPointY`, `secp256k1PointX`, `secp256k1PointY`, and field helpers `neg`, `inv`.

**Signature verification — both curves:**

```compact
// asserting form
circuit jubjubSchnorrVerify<#n>(msg: Vector<n, Field>,
                                signature: JubjubSchnorrSignature,
                                vk: JubjubPoint): [];

// boolean form
circuit jubjubSchnorrVerify<#N>(msg: Vector<N, Field>,
                                signature: JubjubSchnorrSignature,
                                pk: JubjubPoint): Boolean;

circuit secp256k1EcdsaVerify(msgHash: Bytes<32>,
                             sig: Secp256k1EcdsaSignature,
                             pk: Secp256k1Point): Boolean;

circuit secp256k1EthereumAddress(pk: Secp256k1Point): Bytes<20>;
```

`jubjubSchnorrVerify` is **overloaded** — one form asserts internally, one returns `Boolean`. Both are documented on the same page.

⚠ **`secp256k1EcdsaVerify` does not bind the message.** Quoted:

> *"The circuit takes `msgHash` as given and does not constrain it to any message. The caller is expected to bind it to the actual message by hashing that message in-circuit (e.g. with `keccak256` … or `persistentHash` …)."*

Hashing the message in-circuit is mandatory, not optional. Jubjub Schnorr takes the message as a `Vector<n, Field>` directly and does not have this footgun.

**Note on the ZK Loan tutorial:** it hand-rolls a Schnorr verifier as a *"temporary polyfill"* and says outright that *"The Midnight team is building `jubjubSchnorrVerify` directly into the Compact Standard Library … Once that ships, this entire module gets replaced by a single built-in function call."* **It has shipped** — it is in the current exports list. Use the builtin; treat the tutorial's `schnorr.compact` module as obsolete. Reading its "Constrain witness values fully" callout is still worthwhile as a lesson about unconstrained witness inputs.

### C.5 Sets, maps, counters in ledger state — **VERIFIED**

All are ledger ADTs with in-circuit methods.

| ADT | Methods |
|---|---|
| `Cell<T>` | `read()`, `write(value)`, `writeCoin(...)`, `resetToDefault()` |
| `Counter` | `read(): Uint<64>`, `increment(amount: Uint<16>)`, `decrement(...)`, `lessThan(...)`, `resetToDefault()` |
| `Set<T>` | `insert(elem)`, `member(elem): Boolean`, `remove(elem)`, `isEmpty(): Boolean`, `size(): Uint<64>`, `resetToDefault()`, `[Symbol.iterator]()` |
| `Map<K,V>` | `insert(key, value)`, `lookup(key): V`, `member(key): Boolean`, `remove(key)`, `insertDefault(key)`, `isEmpty()`, `size()`, `resetToDefault()`, `[Symbol.iterator]()` |
| `List<T>` | `head()`, `pushFront`, `popFront`, `length()`, `isEmpty()` |
| `MerkleTree<n,T>`, `HistoricMerkleTree<n,T>` | see C.3 |

`Map` supports **nested state types** — the reference has a dedicated section, and the ZK Loan contract uses `Map<Bytes<32>, Map<Uint<16>, LoanApplication>>` in production.

`Counter.increment` takes a `Uint<16>`, which caps a single increment at 65535 while `read()` returns `Uint<64>`.

### C.6 Block time — **VERIFIED**

```compact
circuit blockTimeLt(time: Uint<64>): Boolean;
circuit blockTimeLte(time: Uint<64>): Boolean;
circuit blockTimeGt(time: Uint<64>): Boolean;
circuit blockTimeGte(time: Uint<64>): Boolean;
```

Comparison only — **there is no `blockTime()` accessor that returns the current time as a value.** You can constrain against a bound; you cannot read the clock into a variable. Relevant to anything epoch- or expiry-shaped.

### C.7 Nullifier pattern — **VERIFIED as an officially documented pattern**

The security guide documents this directly, under "Double-spend prevention with nullifiers":

```compact
export ledger usedNullifiers: Set<Bytes<32>>;

circuit nullifier(secretKey: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([
    pad(32, "nullifier-domain"),
    secretKey
  ]);
}

export circuit spend(secretKey: Bytes<32>): [] {
  const nul = nullifier(secretKey);
  assert(!usedNullifiers.member(nul), "Already spent");
  usedNullifiers.insert(disclose(nul));
}
```

With the accompanying rule: *"Use domain separation (different prefixes like `\"nullifier-my-dapp-1\"` vs `\"commitment-my-dapp-2\"`) to prevent hash collision attacks across different purposes."*

Note `disclose(nul)` is required on the ledger write — `persistentHash` is not hiding, so the compiler demands the annotation.

### C.8 Other verified exports

- **Data types:** `Maybe`, `Either`, with constructors `some`, `none`, `left`, `right`.
- **Identity:** `ContractAddress`, `ZswapCoinPublicKey`, `UserAddress`, `ownPublicKey()`.
- **Serialization:** `serialize<T,#n>(x: T): Bytes<n>`, `deserialize<T,#n>(x: Bytes<n>): T` — **only instantiable for event types**, per the docs.
- **Events:** `ShieldedSpend/Receive/Mint/Burn`, `UnshieldedSpend/Receive/Mint/Burn`, `Paused`, `Unpaused`, `Misc`.
- **Tokens:** full Zswap shielded/unshielded suite (`mintShieldedToken`, `sendShielded`, `unshieldedBalanceGte`, `evolveNonce`, …). Not needed for a credential engine, but present.

### C.9 NOT FOUND

Searched the stdlib exports page, the ledger ADT page, and the full language reference. These do **not** exist:

| Wanted | Status |
|---|---|
| RSA / bilinear-pairing accumulator | **NOT FOUND** |
| Merkle **non-membership** / exclusion proof primitive | **NOT FOUND** |
| Sorted-Merkle-tree or interval-proof helper | **NOT FOUND** |
| Nullifier-specific stdlib circuit | **NOT FOUND** — it is a documented *pattern* built from `persistentHash` + `Set`, not a library function |
| Poseidon (by name) | **NOT FOUND** — `transientHash` is *"circuit-efficient"* but the docs never name the algorithm |
| BLS / Ed25519 signature verification | **NOT FOUND** — only Jubjub Schnorr and secp256k1 ECDSA |
| Range-proof helper circuit | **NOT FOUND** — done with `Uint<n>` typing and `assert` comparisons |
| `blockTime()` value accessor | **NOT FOUND** — comparison predicates only (C.6) |
| Dynamic / growable arrays in-circuit | **NOT FOUND** — everything is fixed-size (B.6) |

---

## D. LIMITS AND GOTCHAS

### D.1 Circuit size and proving time

**Largely NOT FOUND, and this is a real gap.** The docs give hard *datatype* limits (B.3) but I found **no published constraint-count ceiling, no proving-time benchmarks, and no guidance on how circuit complexity maps to proving latency.** The only acknowledgement is indirect: `--skip-zk` exists because *"generating proving keys can be time-consuming."*

Practical consequence: **proving cost has to be measured empirically, early.** There is no table to design against. Worth building the largest plausible circuit shape first and timing it before committing to a structure.

### D.2 Constraints that would break a design

1. **No recursion, no runtime-bounded loops.** Loop bounds must be literals or generic nat params. Anything variable-length must be fixed-size-with-padding.
2. **No `return` inside `for`.** Accumulate, then return.
3. **Merkle path depth is a compile-time generic.** `MerkleTreePath<#n, T>` fixes *n* at compile time; tree depth is not runtime-variable.
4. **`findPathForLeaf` is O(n) and TypeScript-only.** The docs explicitly warn it *"should be avoided for large trees."* `pathForLeaf(index, leaf)` is the scalable form — but it requires the caller to already know the index, which means the index must be tracked in private state.
5. **Native stdlib types cannot be top-level exported** (B.2).
6. **`JubjubPoint` cannot be compared with `==`.** From the ZK Loan tutorial: *"Since Compact language version 0.22, two `JubjubPoint` values can no longer be compared with `==`. The compiler emits JS reference equality for struct equality, which is always `false` for freshly constructed points and would make the assertion **silently impossible to satisfy**."* Compare `jubjubPointX()` / `jubjubPointY()` explicitly. Silent-failure bugs like this are the expensive kind.
7. **`secp256k1EcdsaVerify` does not bind its message hash** (C.4).
8. **Boolean-returning verifiers enforce nothing unless asserted** (B.7).
9. **`Counter.increment` takes `Uint<16>`** — max 65535 per call.
10. **Windows is unsupported** (A.3).

### D.3 Things the docs explicitly warn about

- **Witness results are untrusted input.** The `danger` callout in B.4. Any DApp can substitute its own witness implementation. Every witness value must be constrained in-circuit until only honest values satisfy it.
- The ZK Loan tutorial generalizes this into the best single sentence in the documentation: *"witness values are prover-controlled inputs — constrain them until only honest values can satisfy the circuit."* Its worked example is instructive: an under-constrained `Field` quotient would have allowed **forging attestation signatures**, and the fix was typing it `Uint<7>` plus an explicit range assert.
- **Never reuse commitment randomness** (C.2).
- **Use domain separation** across every hash purpose (C.7).
- **`ownPublicKey()` is not authentication** (B.5).
- **Place `disclose()` narrowly**, on the value crossing the boundary.
- `transientHash` / `transientCommit` are **not upgrade-stable** — never derive persisted state from them.

### D.4 Documentation quality caveats

Worth knowing before trusting any single page:

- **Version skew across pages is common.** "Writing a contract" uses `pragma language_version 0.16`; ZK Loan uses `>= 0.22 && <= 0.23`; current language is 0.26. Structure is reliable; pragmas and some APIs are not.
- **The compiler version is genuinely ambiguous** — 0.31.1 vs 0.34.0 (A.1).
- **Some URLs from search results are dead.** `/develop/reference/compact/lang-ref` and `/develop/tutorial/building` return the SPA shell. The live tree is under `/compact/...`. The authoritative index is `https://docs.midnight.network/llms.txt` (1804 lines), and appending `.md` to any doc path yields clean source.
- **The generic test examples on the test-and-debug page look idealized.** Its `CircuitContext` is written as a bare object literal `{ privateState, ledgerState: { round: 0n } }`, whereas the runtime API documents `createCircuitContext(...)` with eleven parameters. **Trust the API reference and the tutorial test suites over that page's snippets.**

### D.5 Testing surface — VERIFIED

Two distinct approaches exist:

**In-process simulation** via `@midnight-ntwrk/compact-runtime` (v0.19.0). All primitives confirmed present in the API reference:

```
createCircuitContext(circuitId, contractAddress, coinPublicKeyOrZswapState,
                     contractState, privateState, stateProvider?, gasLimit?,
                     costModel?, time?, parentBlockHash?, reentrancyGuard?)
constructorContext(initialPrivateState, coinPublicKey)
createConstructorContext(...)   createInitialQueryContext(...)
copyCircuitContext(...)         createWitnessContext(...)
emptyZswapLocalState(coinPublicKey)
sampleContractAddress()         dummyContractAddress()
QueryContext   CircuitContext   ConstructorContext   WitnessContext
```

Note `createCircuitContext` takes an optional **`time?`** parameter — that is the hook for testing anything block-time-dependent deterministically, without waiting on a real chain.

**Full integration** via `@midnight-ntwrk/testkit-js` (4.1.1) + `deployContract` / `submitCallTx` from `@midnight-ntwrk/midnight-js-contracts`, against a real network. This is what the Battleship test suite does.

**Test runner:** both **Vitest** and **Jest** appear in official material — Battleship uses Vitest (`vitest/config`, `import { describe, it, expect, beforeAll, afterAll } from 'vitest'`); the test-and-debug page uses `@jest/globals`. Either works; Vitest matches the more current tutorial.

---

## E. UNKNOWNS

Everything I could not confirm from a primary source. Listed honestly rather than guessed.

1. **Circuit size ceiling and proving times.** No constraint-count limit, no benchmarks, no complexity→latency guidance published. **The largest single risk to scoping** — must be measured, not designed around. (D.1)

2. **No worked example of the Merkle-path-through-a-circuit flow.** The ADT is documented, the stdlib circuits are documented, but **I found zero documented contracts that actually wire `pathForLeaf` (TypeScript) → witness → `merkleTreePathRoot` → `checkRoot` together.** I grepped every example and tutorial I downloaded. Each piece is individually verified; the composition is not demonstrated anywhere I could find. This is the highest-risk unverified assumption for anything Merkle-based, and it should be spiked in isolation before being built on.

3. **Exact witness signature shape for returning a `MerkleTreePath`.** Follows from (2). How `MerkleTreePath<#n, T>` is declared as a witness return type and what the TypeScript side must hand back is not shown in any example.

4. **Whether `MerkleTree` ledger ADT `insert` is callable in-circuit in practice.** The ADT page lists `insert`/`insertHash` without the *"callable only from TypeScript"* marker that `root`/`pathForLeaf` carry, which implies in-circuit availability — but no example confirms it, and the gas/constraint cost of an in-circuit insert is unknown.

5. **What `transientHash` actually is.** Described only as *"circuit-efficient"*. Algorithm unnamed. Cannot state its collision resistance or field behaviour from primary sources.

6. **Whether the language-0.26 / compiler-0.34 pairing works against Preprod.** The matrix tests 0.31.1 only. Untested newer versions are plausibly fine, but unverified. (A.1)

7. **`compact-runtime` 0.16.0 vs 0.19.0.** Matrix says one, npm and the API docs say the other. Which the scaffold actually installs — unverified. (A.8)

8. **Whether Compact runs natively on Windows.** Docs say unsupported; that is not the same as non-functional. I did not test it. WSL2 is the safe assumption. (A.3)

9. **Buildathon specifics — dates, rubric, required network.** I confirmed the Midnight Buildathon is a three-month, three-Wave program hosted on AKINDO, but **could not verify the Wave 1 window (27 Aug – 16 Sep 2026) or the exact judging percentages** from a primary source. Taking those from the brief as given. A separate 48-hour Midnight Hackathon around 28–30 Aug also appears in results — **worth confirming these are not being conflated.**

10. **Whether Preview or Preprod is the expected submission target.** The brief says "preprod vs mainnet"; the docs also describe Preview as the experimentation network. Unresolved.

11. **DUST / fee model for contract calls.** A "Sponsor transaction fees with DUST" guide exists and mainnet has a cNgD DApp, implying fees matter. I did not read the DUST model. Unknown whether it affects testnet demo flows.

12. **`Set` / `Map` scaling costs.** No published guidance on ledger-state size limits or per-operation cost as a `Set` grows. Relevant to anything that accumulates entries monotonically.

13. **Whether OpenZeppelin's `compact-contracts` has anything reusable.** It targets Compact 0.31.0 / language >= 0.21.0 and provides Ownable, Pausable, FungibleToken. I saw no Merkle or accumulator module, but I only read the repo landing page, not the full module tree. It self-describes as *"highly experimental"*, *"never been audited"*, and not for production.

---

## Sources

All fetched 2026-08-27.

- [Midnight Docs index (`llms.txt`)](https://docs.midnight.network/llms.txt) — authoritative page list; append `.md` to any path for source
- [Compact reference](https://docs.midnight.network/compact/reference/compact-reference)
- [Writing a contract](https://docs.midnight.network/compact/reference/writing)
- [Explicit disclosure](https://docs.midnight.network/compact/reference/explicit-disclosure)
- [Ledger data types](https://docs.midnight.network/compact/data-types/ledger-adt)
- [Compact standard library](https://docs.midnight.network/compact/standard-library) · [Detailed API reference](https://docs.midnight.network/compact/standard-library/exports)
- [Smart contract security](https://docs.midnight.network/compact/smart-contract-security)
- [Test and debug](https://docs.midnight.network/compact/test-and-debug)
- [Compiler usage](https://docs.midnight.network/compact/compilation-and-tooling/compiler-usage) · [Dev tool usage](https://docs.midnight.network/compact/compilation-and-tooling/dev-tool-usage)
- [Install the toolchain](https://docs.midnight.network/getting-started/installation) · [Quickstart](https://docs.midnight.network/getting-started/quickstart)
- [Environments and endpoints](https://docs.midnight.network/relnotes/network) · [Compatibility matrix](https://docs.midnight.network/relnotes/support-matrix) · [Compiler release notes](https://docs.midnight.network/relnotes/compact)
- [ZK Loan smart contract](https://docs.midnight.network/tutorials/zk-loan/smart-contract) · [Attestation API](https://docs.midnight.network/tutorials/zk-loan/attestation-api)
- [Battleship test suite](https://docs.midnight.network/tutorials/bship/test-suite) · [Bulletin board contract](https://docs.midnight.network/tutorials/bboard/smart-contract)
- [Private guest list example](https://docs.midnight.network/examples/contracts/private-guest-list)
- [Midnight Expert](https://docs.midnight.network/ai-integration/midnight-expert)
- [OpenZeppelin/compact-contracts](https://github.com/OpenZeppelin/compact-contracts)
- npm registry, queried directly for package versions

---

## G. Deployment feasibility, re-verified 2026-08-27

Section F recorded that the contract could not be deployed. That finding
was re-tested from scratch rather than trusted, because it decides whether
the project can show a real transaction. The conclusion holds, and one
claim in the earlier notes turned out to be wrong.

### G.1 What the live networks actually run

`testnet-02` has been retired and its hostnames no longer resolve. The
live networks are `preview`, `preprod` and `mainnet`; all three resolve
and answer (HTTP 405 to a GET, which is correct for a POST-only JSON-RPC
and GraphQL endpoint):

    rpc.preview.midnight.network        52.30.195.195     405
    indexer.preview.midnight.network    108.133.181.124   405
    rpc.preprod.midnight.network        52.210.96.56      405

The official support matrix gives one stack for all three:

| Component        | preview | preprod | mainnet |
|------------------|---------|---------|---------|
| Node             | 1.0.1   | 1.0.2   | 1.0.2   |
| Compact compiler | 0.31.1  | 0.31.1  | 0.31.1  |
| Compact runtime  | 0.16.0  | 0.16.0  | 0.16.0  |
| On-chain runtime | 3.0.0   | 3.0.0   | 3.0.0   |
| Midnight.js      | 4.1.1   | 4.1.1   | 4.1.1   |
| Proof server     | 8.1.0   | 8.1.0   | 8.1.0   |

This contract is compiled with 0.34.0, whose runtime is compact-runtime
0.19.0, which depends on `@midnightntwrk/onchain-runtime-v4@^4.0.0-rc.3`.
Checked on the npm registry, that package has published only release
candidates: `4.0.0-rc.1`, `-rc.2`, `-rc.3`. `midnight-js-protocol@4.1.1`
pins `compact-runtime@0.16.0` and `onchain-runtime-v3@3.0.0`; the SDK line
that pins 0.19.0 is `midnight-js@5.0.0-beta.7`, still a beta.

### G.2 Correction to an earlier claim

Section F stated that reverting to the 0.31.1 line was impractical because
`compact-runtime@0.16.0` exports no signing primitives. That is wrong. It
was installed and inspected directly, and it exports:

    sampleSigningKey, signData, signatureVerifyingKey,
    signingKeyFromBip340, verifySignature,
    constructJubjubPoint, jubjubPointX, jubjubPointY

So the TypeScript side of a mock issuer *can* sign on the 0.31.1 line.

### G.3 The blocker that does hold, and where it is

The compiler is the blocker, not the runtime. Compiler 0.31.1 accepts
**language version 0.23 only** -- compiling this contract against it fails
at the pragma:

    Exception: credential.compact line 19 char 1:
      language version 0.23.0 mismatch

and language 0.23 has no signature verification of any kind. Every
plausible name was tried and every one is unbound:

    verifySignature, signatureVerify, checkSignature, jubjubSchnorrVerify,
    schnorrVerify, verify, signVerify, ecVerify, eddsaVerify
    -> "unbound identifier" for all nine

Comparing identifiers in the two compiler binaries, `convertNumericToJubjubScalar`
and the Schnorr machinery appear in 0.34.0 and are absent from 0.31.1.
Language 0.23 has the `JubjubPoint` type and `jubjubPointX` -- the curve,
but not the signature scheme.

A minimal 0.23 contract does compile and produce artifacts, so the
toolchain itself is sound; it is the language feature that is missing.

### G.4 What this means

Deploying to a live network requires language 0.23, which cannot express
`verifyIssuerAttestation` as written. The issuer-authorisation model would
have to be rebuilt on a primitive 0.23 does have -- proof of knowledge of
an issuer secret against a hash commitment in public state -- which is a
different security argument from a public-key signature and would
invalidate the I6 and I7 tests as written.

That is a real decision with a real cost, not a configuration change. It
is recorded here so the trade-off is visible rather than implied.
