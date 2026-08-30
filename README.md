# Private Credential Lifecycle Engine

A credential **lifecycle** layer on [Midnight](https://midnight.network) — issuance, per-verifier unlinkability, revocation and expiry — written in Compact. KYC is the demo sitting on top, not the contribution.

**The issuer in this project is mocked.** It signs whatever attribute values it is handed and performs no identity verification of any kind. We make no claim of real-world identity assurance. What *is* real is everything underneath: the lifecycle, revocation, unlinkability and expiry are genuine contract logic, verified by 82 tests that drive the compiled circuits.

The contract is **deployed and running on Midnight preview**, at address `c301baf55617c5cb6dab9986e46eaf300561e7a156826eaa2fec4551a8333193` (deploy tx `0e82e517abe93bfceca8a9fd4b7ee9c989a0bac87bc6bb82575a0666f0a22a41`, block 647,605). Every circuit has been executed there against real block time, with a real zero-knowledge proof and real DUST fees. It is **not** on preprod yet — that network's first wallet sync is a multi-hour job (1,466,572 dust events against preview's 176,094).

---

## The problem

A person proving "I am over 18" to ten platforms today hands ten copies of their ID document to ten databases, each of which becomes a breach waiting to happen. Zero-knowledge proofs solve the disclosure half of that — but a credential you can never revoke, never expire, and that lets any two verifiers discover they served the same person is not much of an improvement.

Most zk-KYC demos stop at `prove(age > 18)`. That is the easy part. The hard part is what happens on day two: the credential needs revoking, the holder needs to stay unlinkable across verifiers, and the whole thing needs to expire. That layer is what this project builds.

---

## What is real and what is mocked

Be sceptical of any claim not in the left column.

There are **two contracts**, and the distinction matters for every row below. `contracts/src/credential.compact` is the reference version; it verifies a Schnorr attestation in-circuit but targets an on-chain runtime no live network runs yet. `onchain/contract/credential.compact` is the port that is actually deployed, and it pays for that with a weaker issuer-authentication model. Both are in the repo; neither is hidden.

| Real | Mocked or simplified |
|---|---|
| Per-verifier nullifiers, and their unlinkability | — |
| Merkle active-set membership proof, verified in-circuit | — |
| Revocation by leaf tombstone + root-history reset | — |
| Expiry enforced in-circuit against block time | — |
| Attribute values never touching public state (compiler-enforced) | — |
| Deployed on Midnight **preview**: real proofs, real DUST fees, real block inclusion | Not on **preprod** yet |
| Schnorr signature verification **inside the ZK circuit** (`jubjubSchnorrVerify`) — reference contract | The issuer's *identity assurance*. It signs on request, checks nothing |
| — | The **deployed** contract replaces that signature check with a capability secret, because Compact language 0.23 has no signature-verification primitive (RESEARCH.md §G.3). Attestations are therefore not transferable and not verifiable offline |
| 82 tests driving the real compiled circuits (54 reference, 28 port) | The test suites run against a local simulator, not a node. The on-chain path is covered by `npm run lifecycle`, which is a scripted run, not a test suite. A further 20 tests — 9 on presentation formatting, 11 on the browser-wallet path — stub what they exercise and drive no circuit |

The UI reports **proving time and total time separately**, labelled, and shows the transaction hash for anything that touched the chain. In simulator mode it reports circuit execution time and says so on screen. Nothing in this repo pretends a proof was generated when it was not.

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
contracts/src/credential.compact    the lifecycle contract (reference)
contracts/src/Predicates.compact    predicate module (add predicates here)
core/engine.ts                      simulator + mock-issuer crypto, shared by all consumers
issuer/mockIssuer.ts                the mock credential authority (labelled in the code)
tests/                              54 tests, one file per invariant — see tests/README.md
web/                                three-persona demo UI + contract host
pitch/                              video script, slide deck (deck.html), self-audit

onchain/contract/credential.compact the deployable port — see "Two contracts"
onchain/src/chain.ts                the same four circuits, against a live network
onchain/src/providers.ts            wallet adapter: DUST-era fees for midnight-js
onchain/src/service.ts              HTTP front for the deployed contract (:4100)
onchain/src/lifecycle-demo.ts       the whole demo on chain, printing tx hashes
onchain/tests/                      37 tests for the port
onchain/deployments/                one file per network actually deployed to

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
> **The cost is real and worth stating plainly.** Compiler 0.34.0 pulls `compact-runtime` 0.19.0, which depends on `onchain-runtime-v4 4.0.0-rc.3` — a release candidate. Every live network runs on-chain runtime **3.0.0**, and the newest stable proof server is `8.1.0` against `9.0.0-rc.7` for v4. **The reference contract therefore cannot be deployed to any live network** until Midnight's v4 stack leaves release candidate. It targets the next protocol version, not the current one. See [RESEARCH.md §F.7c](RESEARCH.md) for the full dependency trace.
>
> That is why there is a second contract — see [Two contracts](#two-contracts) below. It gives up the signature check to reach the networks that exist today, and says so in its own header.

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

That is the simulator. Everything so far runs locally and generates no proofs.

### 5. Run it against the real chain

The contract is already deployed on preview, so this drives the existing
deployment rather than making a new one. You need Docker for the proof server
and a funded wallet.

```bash
docker run -d -p 6300:6300 midnightntwrk/proof-server:8.1.0

cd onchain
npm install
npm run build                  # compiles the port and generates proving keys
npm run address -- preview     # prints the wallet address and the faucet URL
```

Paste that address into the faucet it prints, wait for the NIGHT to arrive,
then:

```bash
npm run provision -- preview   # sync, register NIGHT for DUST, deploy
npm run lifecycle -- preview   # the nine-step demo, on chain
npm run service   -- preview   # HTTP front on :4100 for the web UI
```

With the service running, the web UI's engine selector switches from
**Simulator** to **On chain**; the on-chain option stays disabled, with the
reason shown, when :4100 is not answering. In on-chain mode every action
displays its transaction hash and reports proving time separately from total
time.

Three things about that flow are worth knowing before you start it.

**The first sync is slow and it is not a hang.** A fresh wallet streams every
dust event on the network — about 176,000 on preview, roughly an hour. Progress
is printed each minute. It is cached to `onchain/.wallet-cache.<network>.json`
afterwards, so later runs start in seconds.

**`provision` is one command on purpose.** `register-dust` and `deploy` each
open a wallet and wait for a full sync; running them in sequence syncs twice.
Every step of `provision` checks whether it is needed, so it is safe to re-run
after a failure.

**NIGHT cannot pay fees.** It has to be registered for DUST generation first,
which is a transaction of its own, and then DUST accrues over time. `provision`
does this and waits.

**Deploying generates `onchain/.authority.<network>.json` and that file is the
authority.** The contract has no signature to check — an issuer proves it knows
a secret whose digest is in ledger state — so whoever holds the file can issue
and revoke, and nobody else can. It is gitignored. Losing it makes the
deployment unadministrable, because the digests are sealed at deploy time and
no circuit here can rotate them; deploying again is the only recovery.

---

## On chain

Deployed on Midnight **preview**:

| | |
|---|---|
| Contract | `c301baf55617c5cb6dab9986e46eaf300561e7a156826eaa2fec4551a8333193` |
| Deploy tx | `0e82e517abe93bfceca8a9fd4b7ee9c989a0bac87bc6bb82575a0666f0a22a41` |
| Block | 647,605 |
| Indexer | `https://indexer.preview.midnight.network/api/v4/graphql` |

Every claim here is a transaction you can look up. `npm run lifecycle -- preview`
runs the nine-step demo from §5 against that contract. This is its output, with
`@polkadot` transport log lines removed and nothing else changed:

```
1. Register the issuer
   tx      e71127704da8d7e044b91c34fc04cb03265cc9c7be680772a5925ae92fa6a044
   block   647631
   timing  1433 ms proving · 88.5s to inclusion

2. Issue a credential to Alice
   tx      2034c020c3fdbf85687d29cd6d0f13a8aa64c6821ca5e9b0029b1b146542a71d
   block   647638
   timing  1958 ms proving · 50.1s to inclusion
   leaf    0
   the ledger received a commitment. The age, country and tier did not.

3. Present to Alpha Exchange — "is Alice over 18?"
   tx      d974178483245cbae747c32743203aebfe083fbb6bdd7604b5a57c7fb57b966c
   block   647648
   timing  3450 ms proving · 41.7s to inclusion
   asOf    41s old — 14% of the 300s freshness window
   nullifier 5f0336db2f26f674e249ae1245ffd254cf6709b5324143ce26b0f0dd1d3b0300

4. Present to Beta Lending — same person, same question
   tx      5a983f567556c8c4196b507148660d668638eb8279ce6cc626d2fd35643254dd
   block   647655
   timing  4893 ms proving · 35.6s to inclusion
   asOf    37s old — 12% of the 300s freshness window
   nullifier e42d95ed995ccd5a8fb3e0a5270b193279dc1cd7a208f95de76e10f89ee8185e

5. Linkage test — can the two verifiers tell it was the same person?
   bytes in common: 0 of 32
   ✓ nothing links them

6. Present to Alpha again — must be refused (I4)
   ✓ refused: failed assert: nullifier already spent this epoch

7. Keep a copy of the Merkle path, then revoke Alice
   tx      a7fe7640e7ec603f983b44663186a48f4b7b44a5c4188865994c5aef5450456a
   block   647662
   timing  1591 ms proving · 35.3s to inclusion
   root history cleared, epoch advanced

8. Present with the pre-revocation path — must be refused (I2)
   ✓ refused: failed assert: credential is not in the active set (revoked or path stale)

9. Rebuilding the path is impossible — the leaf is gone
   ✓ leaf not present in the active set

All steps behaved as specified, on a live network.
```

That is the first run against a fresh deployment, so step 1 actually registers
the issuer. Re-running skips it and says so: every step checks whether it is
needed, which is what makes the script safe against a chain that keeps its
state. Holder and verifier key material is random per run, so a second run's
presentations do not collide with the first run's nullifiers.

Step 1 is also the check that matters most about this particular deployment.
The issuer secret is not in this repository — it is generated into
`onchain/.authority.<network>.json` — so a `registerIssuer` that lands is the
contract confirming the holder of that file, and nobody else, is the authority.

Three things in that transcript are worth reading closely.

**Steps 6 and 8 are the point.** A run that only shows the happy path shows
very little. The script exits non-zero if either refusal fails to happen, and
it checks the *message*, not merely that something was thrown — a refusal
arriving from a later check than the intended one would hide a regression in
the earlier one.

**Proving takes 1.4–4.9 seconds; inclusion takes 35–89.** The proof is not the
bottleneck — the chain is. `present()` is the most expensive circuit, which is
what six checks inside one proof costs; across every run recorded here it has
ranged 3,080–5,076 ms, against 1,225–2,482 ms for the other three circuits.

The same flow was then driven through the demo UI's own HTTP routes, in
on-chain mode, because the script and the interface are different code paths
and only one of them was proven by the run above — issuance in block 647,699
(tx `6cea5a30…`), presentations to the two verifiers in blocks 647,706 and
647,713 with unrelated nullifiers (`69fe88b8…` and `6a46cfdc…`), revocation in
block 647,720 (tx `705c55d0…`), and the presentation after it refused with
`leaf not present in the active set`.

That last refusal comes from the holder's side rather than from the circuit:
once the leaf is gone, no Merkle path can be built, so there is nothing to
prove and no transaction is sent. The in-circuit refusal — a holder who kept a
path from before the revocation and tries it anyway — is step 8 above.

**`asOf` was 48 seconds old — 16% of the 300-second window.** That percentage
is why the first deployment was discarded rather than kept: it shipped a window
of 300,000 seconds (3.5 days), because the codebase treated block time as
milliseconds and a self-consistent simulator cannot detect a unit error at its
own boundary. 54 tests passed against it. The superseded deployment record is
kept, with its reason, in `onchain/deployments/superseded/`.

---

## Ecosystem context

This is the layer *below* credential applications, and it is designed to interoperate with the Midnight identity work rather than compete with it. To be clear about the current state: these are design affinities, not shipped integrations.

- **Midnames** — DID and naming. A holder identifier here is `H(domain, secret)`; binding it to a Midname-resolved DID instead is a change to one derivation circuit. Midnames answers *who a name refers to*; this answers *whether their credential is still valid, without saying which one it is*.
- **Identus** — verifiable credential issuance and registry. Identus is the natural replacement for the mock issuer: its credential format would supply the attributes this contract commits to. It has no on-chain revocation accumulator or per-verifier nullifier scheme; that is the gap this fills.
- **Triple Play** — ZK predicate circuits for compliance. Complementary in the other direction: our predicate module is deliberately small and pluggable, and richer compliance predicates would slot into `Predicates.compact` without touching the lifecycle core.

The thing none of them provide is the lifecycle: issue, prove-unlinkably, revoke, expire. That is the contribution.

---

## Two contracts

This repository contains the lifecycle engine twice, and the difference
between the two copies is the whole story of what it costs to deploy
something today.

| | `contracts/src/credential.compact` | `onchain/contract/credential.compact` |
|---|---|---|
| Role | **Reference** — the design as intended | **Deployable port** |
| Compiler / language | 0.34.0 / 0.26 | 0.31.1 / **0.23** |
| Runtime | compact-runtime 0.19.0 → on-chain runtime v4 (RC) | compact-runtime 0.16.0 → on-chain runtime **v3** |
| Deployable | No — every live network runs v3 | Yes; that is why it exists |
| Issuer authority | Jubjub Schnorr signature, verified in-circuit | **Proof of knowledge** of a secret whose digest is in ledger state |
| Tests | 54 | 37 (28 lifecycle + 9 formatting) |

**Why the mechanism had to change.** Compiler 0.31.1 accepts only language
0.23, and language 0.23 has no in-circuit signature verification of any
kind. Nine candidate builtin names were tried; all nine are unbound
([RESEARCH.md §G.3](RESEARCH.md)). So the port replaces the signature with
a capability secret.

**What that costs, stated rather than implied.** A capability secret is
not a public key. There is no transferable attestation, nothing a third
party can verify offline, and anyone who learns the secret can issue and
revoke. The invariants survive with different mechanics — I6 and I7 become
secret-knowledge tests instead of forgery tests — but the security
argument is weaker, and the file's own header says so.

### Deploying it

Fees on the current stack are paid in DUST, which is generated by
registering NIGHT; NIGHT alone cannot pay for anything. Each step below
checks its own preconditions rather than assuming them.

```bash
bash scripts/proof-server.sh start        # local prover, never a remote one
cd onchain
npm install
npm run build                             # compile + proving keys

npm run address   -- preview              # print the address to fund
#   fund it at the faucet, then:
npm run provision -- preview              # register DUST and deploy, one sync
npm run lifecycle -- preview              # the whole demo, on chain, with tx hashes
```

**Why `provision` rather than `dust` then `deploy`.** Those two commands
exist and still work, but each opens a wallet and waits for a full sync.
A fresh wallet applies every event on the chain, and doing that twice is
the single most expensive mistake available here. `provision` syncs once
and then does both, skipping whichever step is already done, so it is safe
to re-run.

**How slow the first sync is depends on the network.** Measured on one
machine: preview's dust stream is about 176,000 events and took roughly an
hour; preprod's is about 1,467,000 and takes many hours. The dust stream is
the bottleneck by an order of magnitude — the shielded wallet finished
preprod's 1,466,444 events in about nine minutes. Wallet state is cached to
`onchain/.wallet-cache.<network>.json` the moment the first sync completes,
so every later run starts in seconds.

Driving the deployed contract from the demo UI needs one more process:

```bash
npm run service -- preview                # on-chain service on :4100
```

With it running, the sidebar's engine switch offers the network. Every
action then generates a real proof and waits for a real block, and the
interface relabels its timings accordingly — proving time, not circuit
execution.

---

## Roadmap

**Wave 1 (this submission)** — issuance, one predicate family, per-verifier nullifiers with unlinkability tests, Merkle-based non-revocation, expiry, 82 tests, three-persona demo, and the port deployed and exercised on preview.

**Wave 2**
- Credential renewal without full re-issuance
- Verifier SDK so a third party can integrate without reading the contract
- **Lace signs the contract calls.** The DApp Connector path is written but has never run against an installed wallet; today the service's own wallet pays and signs
- Preprod, once its faucet can be reached without a human in a browser
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
- **The reference contract cannot be deployed to any live network.** It compiles against the v4 on-chain runtime, which is still a release candidate; the networks run v3. What is deployed is the language-0.23 port in `onchain/`.
- **The deployed port authenticates issuers with a shared capability secret, not a signature.** Anyone who learns that secret can issue and revoke. This is a real weakening, forced by the absence of any signature primitive in language 0.23, and it is recorded in the header of the contract file itself.
- **Whoever holds `onchain/.authority.<network>.json` controls that deployment**, and there is no way to rotate it: the digests are sealed into ledger state when the contract is deployed, and no circuit here can change them. Lose the file and the deployment is unadministrable. It is generated on first use and gitignored. *(An earlier deployment derived these from `bytes32(1)` and `makeIssuer(1n)` — constants in this repository — which meant any reader could issue and revoke on it. That deployment is recorded in `onchain/deployments/superseded/`.)*
- The `asOf` freshness window grants up to 5 minutes of grace past expiry.
- **Preview is the only network targeted.** Preprod was scoped out deliberately, for two measured reasons: its first wallet sync is 1,466,572 dust events against preview's 176,094, and its faucet is behind a Cloudflare Turnstile captcha, so provisioning it cannot be automated. Nothing in the code is preview-specific — `onchain/src/network.ts` carries preprod's endpoints, and `npm run provision -- preprod` is the same command — but it has not been run, so do not claim it works.
- Wallet state is cached to `onchain/.wallet-cache.<network>.json` so a failure late in a long sync does not cost a full rescan. That cache is a convenience, not a security boundary — delete it if you do not trust its contents.

## Licence

MIT.
