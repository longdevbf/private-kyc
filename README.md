# Private Credential Lifecycle Engine

A credential **lifecycle** layer on [Midnight](https://midnight.network) — issuance, per-verifier unlinkability, revocation and expiry — written in Compact. KYC is the demo sitting on top, not the contribution.

**The issuer in this project is mocked.** It signs whatever attribute values it is handed and performs no identity verification of any kind. We make no claim of real-world identity assurance. What *is* real is everything underneath: the Schnorr attestation is verified inside the zero-knowledge circuit, and the lifecycle, revocation, unlinkability and expiry are genuine contract logic, verified by a 54-test suite that drives the compiled circuits. It has not yet been deployed to a network.

---

## The problem

A person proving "I am over 18" to ten platforms today hands ten copies of their ID document to ten databases, each of which becomes a breach waiting to happen. Zero-knowledge proofs solve the disclosure half of that — but a credential you can never revoke, never expire, and that lets any two verifiers discover they served the same person is not much of an improvement.

Most zk-KYC demos stop at `prove(age > 18)`. That is the easy part. The hard part is what happens on day two: the credential needs revoking, the holder needs to stay unlinkable across verifiers, and the whole thing needs to expire. That layer is what this project builds.

---

## What is real and what is mocked

Be sceptical of any claim not in the left column.

| Real | Mocked or simplified |
|---|---|
| Schnorr signature verification **inside the ZK circuit** (`jubjubSchnorrVerify`) | The issuer's *identity assurance*. It signs on request, checks nothing |
| Per-verifier nullifiers, and their unlinkability | — |
| Merkle active-set membership proof, verified in-circuit | — |
| Revocation by leaf tombstone + root-history reset | — |
| Expiry enforced in-circuit against block time | — |
| Attribute values never touching public state (compiler-enforced) | — |
| All four circuits compile and produce proving keys | The demo runs the contract against an **in-memory ledger, not a Midnight node**. Constraints are enforced; no ZK *proof* is generated and nothing is on chain |
| 54 tests driving the real compiled circuits | No test deploys to Preprod |

The UI reports **circuit execution time**, not proving time, and says so on screen. Nothing in this repo pretends a proof was generated when it was not.

---

## Architecture

The security boundary is the public/private split. Everything below the line stays on the holder's device; everything above it is world-readable.

```
                    ┌──────────────────────────────────────────┐
   MOCK ISSUER      │            PUBLIC LEDGER STATE           │
   ┌───────────┐    │                                          │
   │ jubjub sk │    │  issuerKeys        Map<Uint16,JubjubPt>  │
   │  (never   │───▶│  activeCredentials HistoricMerkleTree<10>│
   │  on chain)│    │  spentNullifiers   Map<Bytes32,Boolean>  │
   │  leafIssuer        Map<Uint64,Uint16>    │
   └───────────┘    │  revocationEpoch   Counter               │
      signs         │  admin             sealed Bytes32        │
   attestation      └──────────────────────────────────────────┘
        │                        ▲            ▲
        │                        │            │
        │            commitment  │            │  nullifier
        │            (hiding)    │            │  (one-way)
════════╪════════════════════════╪════════════╪═══════════════════
        │        the privacy boundary — disclose() gates it
        ▼                        │            │
   ┌──────────────────────────────────────────────────────┐
   │            HOLDER PRIVATE STATE (witnesses)          │
   │                                                      │
   │  localSecret()  attributes()  blinding()             │
   │  issuerSig()    merklePath()                         │
   │                                                      │
   │  birthTimestamp / countryCode / kycTier / expiresAt  │
   │  never cross the line in any form                    │
   └──────────────────────────────────────────────────────┘
```

`present()` proves, in one circuit and without revealing which credential is being used:

1. an **authorised issuer** attested this commitment (key read from public state, not from the prover),
2. the attestation is **bound to this holder** (a stolen credential is useless),
3. the commitment is **still in the active set** (therefore not revoked),
4. it has **not expired**,
5. the requested **predicate holds**,
6. the **nullifier** for this (holder, verifier, epoch) has not been spent.

---

## Repository layout

```
contracts/src/credential.compact    the lifecycle contract
contracts/src/Predicates.compact    predicate module (add predicates here)
core/engine.ts                      simulator + mock-issuer crypto, shared by all consumers
issuer/mockIssuer.ts                the mock credential authority (labelled in the code)
tests/                              54 tests, one file per invariant — see tests/README.md
web/                                three-persona demo UI + contract host
pitch/                              video script, slide deck (deck.html), self-audit
RESEARCH.md                         verified Compact API surface (Phase 0)
DESIGN.md                           threat model, invariants, cryptographic choices
```

---

## Running it from a clean machine

**Windows users:** the Midnight toolchain is not supported natively on Windows. Everything below must run inside WSL2.

### 1. Prerequisites

- Linux, macOS, or **WSL2** on Windows
- Node.js 22+
- The Compact toolchain:

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.34.0
export PATH="$HOME/.local/bin:$PATH"    # see note below
```

> The Midnight docs give the manual PATH line as `$HOME/.compact/bin`, but the
> current installer actually places the binary in `$HOME/.local/bin`. If
> `compact: not found` appears during the build, that is why.

> **Why 0.34.0, and what it costs.** The matrix pins `compact compile` 0.31.1 for all networks, but that compiler is Compact **language 0.23**, which has *no in-circuit signature verification at all* — not Schnorr, not ECDSA (verified empirically, [RESEARCH.md §F.2](RESEARCH.md)). This targets 0.34.0 / language 0.26, where `jubjubSchnorrVerify` is a stdlib builtin.
>
> **The cost is real and worth stating plainly.** Compiler 0.34.0 pulls `compact-runtime` 0.19.0, which depends on `onchain-runtime-v4 4.0.0-rc.3` — a release candidate. Every live network runs on-chain runtime **3.0.0**, and the newest stable proof server is `8.1.0` against `9.0.0-rc.7` for v4. **This contract therefore cannot be deployed to Preprod or Mainnet until Midnight's v4 stack leaves release candidate.** It targets the next protocol version, not the current one. See [RESEARCH.md §F.7c](RESEARCH.md) for the full dependency trace.
>
> The alternative was hand-rolling Jubjub Schnorr in both Compact *and* TypeScript — `compact-runtime` 0.16.0 exports no signing primitives at all — which is bespoke elliptic-curve code in the component whose entire job is trust.

### 2. Build and test

```bash
git clone <this repo> && cd private-KYC
npm install
npm run build:contract     # compiles + generates proving keys (~15s)
npm test                   # 54 tests against the real circuits
```

### 3. Run the demo

```bash
npm run build:web
npm run dev:chain          # http://localhost:4000
```

Then open **http://localhost:4000**. For frontend hot-reload during development use `npm run dev` instead, which runs the contract host on :4000 and Vite on :5173.

### 4. Walk the demo

| Step | Where |
|---|---|
| Register the mock issuer's key, then issue a credential | Issuer tab |
| Inspect the attribute values — note they appear only in the private register | Holder tab |
| Present to Alpha Exchange, then to Beta Lending | Verifier tab |
| **The linkage test**: two nullifiers, byte-by-byte, 0 of 32 in common | Verifier tab |
| Present to the same verifier twice — replay is caught | Verifier tab |
| Revoke, watch the path go stale, try to present again | Issuer → Holder |

`scripts/demo-seed.sh` drives the same flow over HTTP if you want it pre-populated.

---

## Ecosystem context

This is the layer *below* credential applications, and it is designed to interoperate with the Midnight identity work rather than compete with it. To be clear about the current state: these are design affinities, not shipped integrations.

- **Midnames** — DID and naming. A holder identifier here is `H(domain, secret)`; binding it to a Midname-resolved DID instead is a change to one derivation circuit. Midnames answers *who a name refers to*; this answers *whether their credential is still valid, without saying which one it is*.
- **Identus** — verifiable credential issuance and registry. Identus is the natural replacement for the mock issuer: its credential format would supply the attributes this contract commits to. It has no on-chain revocation accumulator or per-verifier nullifier scheme; that is the gap this fills.
- **Triple Play** — ZK predicate circuits for compliance. Complementary in the other direction: our predicate module is deliberately small and pluggable, and richer compliance predicates would slot into `Predicates.compact` without touching the lifecycle core.

The thing none of them provide is the lifecycle: issue, prove-unlinkably, revoke, expire. That is the contribution.

---

## Roadmap

**Wave 1 (this submission)** — issuance, one predicate family, per-verifier nullifiers with unlinkability tests, Merkle-based non-revocation, expiry, 51-test suite, three-persona demo.

**Wave 2**
- Credential renewal without full re-issuance
- Verifier SDK so a third party can integrate without reading the contract
- Deployment to Preprod, retiring the "runtime 0.19.0 untested on chain" risk
- Batched revocation, to amortise the path-refresh cost

**Wave 3**
- Replace the mock issuer with a real credential source (Identus)
- Indexed/sorted Merkle tree for true non-membership proofs, removing the path-refresh burden entirely
- Design-partner pilot

---

## Known limitations

Summarised here, argued in full in [DESIGN.md](DESIGN.md).

- The issuer is mocked. No identity is verified.
- Revocation invalidates **every** holder's cached Merkle path, not just the revoked one. Holders must refresh.
- An issuer can still cause churn by revoking its own live credentials, since every revocation resets history for everyone.
- Presenting discloses **which issuer** attested the credential, though not which credential.
- **The contract cannot currently be deployed to any live network.** It compiles against the v4 on-chain runtime, which is still a release candidate; the networks run v3. The demo therefore runs against an in-memory ledger and generates no ZK proofs.
- The `asOf` freshness window grants up to 5 minutes of grace past expiry.
- Block-time units are assumed to be milliseconds; unconfirmed against a live chain.

## Licence

MIT.
