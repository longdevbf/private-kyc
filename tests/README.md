# Test suite

**54 tests, 10 files, all passing.** Every test drives the **real compiled circuits** through `@midnight-ntwrk/compact-runtime`. Nothing is stubbed — a passing test means the actual circuit accepted the input, and a failing one means an in-circuit `assert` rejected it.

```bash
npm run build:contract:fast   # compile the contract
npm test                      # run everything (~95s; the capacity test fills 1024 leaves)
```

CI runs the same three steps on every push — see `.github/workflows/ci.yml`.

## How to read a failure

Negative tests assert on the **specific** rejection message, not merely that something threw. `rejects.toThrow(/asOf is stale/)` fails if the call is rejected for the wrong reason — which matters, because several of these attacks would also be caught incidentally by a later check, and that would hide a regression in the earlier one.

## Invariants

| # | Invariant | File | Tests |
|---|---|---|---|
| I1 | Private attribute values never appear in public ledger state | `invariants/I1-attributes-never-public.test.ts` | 2 |
| I2 | A revoked credential can never produce a valid presentation | `invariants/I2-revoked-cannot-present.test.ts` | 3 |
| I3 | An expired credential can never produce a valid presentation | `invariants/I3-expired-cannot-present.test.ts` | 3 |
| I4 | A nullifier cannot be spent twice by the same verifier in one epoch | `invariants/I4-nullifier-replay.test.ts` | 4 |
| I5 | Presentations by one holder to different verifiers are unlinkable | `invariants/I5-unlinkability.test.ts` | 3 |
| I6 | A credential signed by an unregistered issuer is rejected | `invariants/I6-unregistered-issuer.test.ts` | 4 |
| I7 | A credential cannot be presented by a holder other than the bound one | `invariants/I7-credential-not-transferable.test.ts` | 3 |

### I1 — attributes never public

| Test | Property protected |
|---|---|
| leaks neither attribute values, blinding, nor holder secret | Scans the **entire** serialised public state for the byte encodings of every secret. Includes a **positive control** (the nullifier *is* found) so a clean result means "absent", not "scan broken" |
| two holders with identical attributes produce unequal commitments | The blinding factor is doing its job; identical people are not linkable by commitment |

### I2 — revocation

| Test | Property protected |
|---|---|
| rejects a presentation made with a pre-revocation Merkle path | The load-bearing one. `HistoricMerkleTree.checkRoot` accepts *any* past root, so without `resetHistory()` a revoked holder could present against an old root. This test is what catches that regression |
| leaves no path to rebuild after revocation | The leaf is genuinely tombstoned, not merely unreachable |
| revoking one holder does not permanently bar another | The honest cost of `resetHistory()` — unaffected holders recover by refreshing their path. Pins down the behaviour the UI's "refresh path" action depends on |

### I3 — expiry

| Test | Property protected |
|---|---|
| rejects a credential whose expiry is already in the past | Basic expiry enforcement |
| rejects a credential that expires while it is held | Expiry is evaluated at presentation time, not issuance time |
| accepts a credential expiring one second in the future | The boundary is not off by one in the rejecting direction |

### I4 — replay

| Test | Property protected |
|---|---|
| rejects a second presentation to the same verifier in the same epoch | Core replay detection |
| rejects a replay even when a DIFFERENT predicate is requested | The nullifier is independent of the predicate, so a holder cannot get a second bite by asking a different question |
| allows the same holder at a different verifier | Replay protection is scoped per verifier, not global |
| allows re-presentation after the epoch advances | Documents the intentional per-epoch scope |

### I5 — unlinkability

| Test | Property protected |
|---|---|
| produces unrelated nullifiers at two verifiers | The two values differ, and share no prefix or suffix — a derivation that forgot to mix in the verifier id would leave one |
| indistinguishable from two different holders, by public state alone | Two worlds ("one holder twice" vs "two holders once each") produce identically shaped public state |
| the holder secret is what protects the link | Positive control: someone *with* the secret links them trivially, isolating the secret as the sole protection |

**What I5 does not prove** is stated in the file itself: this is not a proof of computational indistinguishability, which reduces to preimage resistance of SHA-256 and cannot be established by a unit test. What it rules out are the failure modes a wrong implementation actually reaches.

### I6 — issuer authorisation

| Test | Property protected |
|---|---|
| rejects issuance under an unregistered issuer id | Registry membership is checked |
| rejects a signature from a key other than the registered one | Impersonation under a valid id fails |
| rejects presentation of a credential attested by a foreign key | Active-set membership alone is not sufficient — the attestation is checked too |
| rejects presentation naming an issuer id that does not exist | No fallback path when the registry lookup misses |

### I7 — non-transferability

| Test | Property protected |
|---|---|
| rejects a stolen credential presented with a different secret | The thief has commitment, signature, attributes, blinding and a valid path — everything but the secret |
| still rejects when the thief also holds a legitimate credential | The attacker cannot be stopped merely by absence from the active set |
| rejects a mismatched Merkle path | The explicit `path.leaf == commitment` binding stops a holder borrowing someone else's live leaf |

## Other coverage

### `smoke.test.ts` (4)

Deployment, issuer registration, issuance, and **the critical composition test**: a Merkle path built off-chain via `findPathForLeaf` verifying in-circuit through `merkleTreePathRoot` against `checkRoot`. No documentation demonstrates this composition, so it was the project's largest unverified assumption until this test passed.

### `happy.test.ts` (4)

Full lifecycle; all three predicates on one credential; five holders under one issuer; two issuers side by side.

### `edge-cases.test.ts` (24)

| Group | Covers |
|---|---|
| access control | non-admin registration, duplicate issuer id, revocation by an unregistered issuer, **revoking an empty leaf index**, **one issuer revoking another issuer's credential**, **overwriting a live credential by slot reuse** |
| predicate boundaries | age exactly at / one second below / well above threshold; birth timestamp in the future; tier at, below and above; country outside the set; **zero padding in the allowed-country list must not match**; unknown predicate id fails closed |
| `asOf` freshness | future `asOf`; `asOf` older than the window; `asOf` just inside the window; **back-dating `asOf` to resurrect an expired credential** |
| malformed Merkle paths | tampered sibling; flipped direction bits; path for a never-issued credential |
| attribute tampering | altered `kycTier`; swapped blinding factor |
| capacity | fills all 1024 leaves and confirms the 1025th issuance is refused |

## A bug this suite caught

Before these tests existed, the contract compiled cleanly and looked correct, but **signature verification enforced nothing**. `jubjubSchnorrVerify` is overloaded — one form asserts internally, one returns `Boolean` — and with identical parameter types the compiler resolved the bare statement call to the **Boolean** form, whose result was silently discarded:

```js
return this._equal_0(lhs_0, rhs_0);   // a value, thrown away
```

Forged issuer signatures were accepted. I6 and I7 failed, which is how it was found. The fix is `assert(jubjubSchnorrVerify<3>(...), "...")` at every call site.

This is the exact trap the Midnight docs warn about — *"To actually enforce that a signature is valid in a Compact circuit, use an `assert` that the result is true"* — and it is invisible to the compiler, invisible to review, and only visible to a test that actually forges a signature.

## Honest coverage assessment

**Fully proven by tests:** I2, I3, I4, I6, I7. Each has a test that constructs the attack and confirms rejection for the correct reason.

**Partially proven:** 

- **I1** — the scan covers the full serialised public state and has a positive control, so it is strong. But `countryCode` (704) and `kycTier` (3) are too small to scan for meaningfully: a one- or two-byte pattern occurs by chance in any state dump. Those two are argued structurally — they only ever enter `persistentCommit` — rather than demonstrated by scan.
- **I5** — see above. The reachable failure modes are ruled out; the underlying cryptographic assumption is not, and cannot be, tested.

**Asserted in the design but not covered here:**

- **Runtime proving.** The simulator executes circuit logic and enforces every `assert`, but does not generate real ZK proofs. Circuit semantics are verified here; proving is exercised by `npm run lifecycle -- preview` in the `onchain/` package instead, which measured 1.2–5.1 seconds per circuit against the deployed contract.
- **On-chain behaviour.** No test in this suite touches a network. Transaction finalisation and fees are covered by the lifecycle script, not by a test; concurrent access is covered by nothing.
- **Block-time units.** ~~The suite is internally consistent in milliseconds, but nothing here confirms the chain's `blockTime` uses the same unit.~~

  **This limitation was real, and it fired.** Block time is seconds. The suite was internally consistent in milliseconds and 54 tests passed for weeks, because the simulator supplies its own clock: milliseconds in, milliseconds compared, everything agrees. `freshnessWindow()` returned `300000`, which the chain reads as three and a half days rather than five minutes, and a deployment was discarded over it.

  The general lesson is worth more than the fix: **a self-consistent simulator cannot detect a unit error at its own interface.** No test written against it could have caught this, however adversarial. What caught it was a real chain rejecting a real call. The units are now checked in CI instead — a test suite was the wrong tool, so the guard belongs somewhere a test suite is not.

## A second round of bugs the suite surfaced

Writing the adversarial cases turned up three more holes, all now fixed and all now covered by tests that assert rejection:

1. **Revoking an empty leaf index succeeded.** The tree was unchanged, but the epoch bumped and `resetHistory()` fired, so any registered issuer could invalidate every holder's cached Merkle path, for free, indefinitely.
2. **One issuer could revoke another issuer's credentials.** Both legitimately registered; nothing stopped either destroying the other's.
3. **An issuer could overwrite a live credential** by reusing its leaf slot, silently destroying it.

The fix is a `leafIssuer: Map<Uint<64>, Uint<16>>` occupancy-and-ownership map, needed because the Merkle tree ADT exposes no in-circuit occupancy test. See DESIGN.md §4.5.
