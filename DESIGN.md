# DESIGN

Threat model, invariants, and the reasoning behind each cryptographic choice. Where a decision has a cost, the cost is stated rather than argued away.

---

## 1. Threat model

### 1.1 What we assume

- `persistentHash` (SHA-256) is preimage- and collision-resistant.
- Jubjub Schnorr is existentially unforgeable without the signing key.
- The Compact compiler's disclosure analysis is sound — that is, a witness-derived value cannot reach public state without a `disclose()`.
- **Witness implementations are hostile.** The language reference is explicit: *"Any DApp may provide any implementation that it wants for your `witness` functions."* Every witness value is treated as prover-chosen input.

### 1.2 Adversaries

**Malicious holder** — controls their own device, all witness implementations, and every argument to `present()`. May hold a legitimate credential of their own.

*Can:* choose any attribute values, blinding factor, signature, Merkle path, and secret to feed the circuit; choose `verifierId`, `predicateId`, `threshold` and `asOf`.

*Cannot:* pass `present()` without a genuine issuer attestation over a commitment matching the attributes they supply (I6); use another holder's credential, because the attestation binds `holderId` (I7); use a revoked credential, because no valid path to a tombstoned leaf exists post-`resetHistory()` (I2); use an expired one (I3); present twice to one verifier in one epoch (I4); back-date `asOf` to escape expiry, because it is pinned to a window around block time; forward-date it to inflate age, for the same reason.

**Two colluding verifiers** — pool everything they observe, including full chain state.

*Can see:* two nullifiers, the predicates asked, the issuer id, the Merkle root, the epoch.

*Cannot:* determine whether the two presentations came from one holder or two. Linking requires inverting `H(domain, secret, verifierId, epoch)` to recover the secret. This is I5, and it is the design's central claim.

*Caveat, stated plainly:* timing and traffic analysis are out of scope. Two verifiers who observe presentations seconds apart in a system with two users will draw the obvious conclusion. Unlinkability here is a property of the **published values**, not of the network layer.

**Compromised issuer** — signing key stolen.

*Can:* mint arbitrary credentials and revoke any credential **it issued**. It cannot revoke another issuer's credentials, and cannot revoke an empty slot (§5).

*Cannot:* recover any existing holder's attribute values, secret, or blinding factor — the issuer never learns the blinding factor and only ever sees commitments. Past presentations stay unlinkable.

*Recovery:* the admin cannot currently deregister an issuer. See §5.

**Chain observer** — reads all public state, forever.

*Sees:* the issuer registry, the Merkle root, the count of live credentials, the epoch, and every spent nullifier.

*Learns:* how many credentials exist and how many presentations occurred. Nothing about who, and nothing about any attribute value (I1).

**Malicious admin** — can register hostile issuer keys, and therefore mint arbitrary credentials. The admin is fully trusted in this design. `admin` is `sealed`, so it is fixed at deployment and cannot be transferred.

---

## 2. Invariants and the mechanism enforcing each

| # | Invariant | Mechanism |
|---|---|---|
| **I1** | Private attribute values never appear in public ledger state | Attributes only ever enter `persistentCommit`. The compiler's disclosure analysis rejects any path from a witness to a ledger write without `disclose()`, and every `disclose()` in the contract is individually justified in a comment. Verified by scanning the full serialised state |
| **I2** | A revoked credential can never produce a valid presentation | `insertIndexDefault(idx)` tombstones the leaf, so no path to the original commitment exists. `resetHistory()` then discards all prior roots, so a cached pre-revocation path fails `checkRoot` |
| **I3** | An expired credential can never produce a valid presentation | `assert(now < attrs.expiresAt)` where `now` is a public `asOf` pinned to `(blockTime − 5min, blockTime]` by two `blockTime*` assertions over public values |
| **I4** | A nullifier cannot be spent twice by one verifier in one epoch | The nullifier is deterministic in `(secret, verifierId, epoch)`; `spentNullifiers.member()` is checked before insert |
| **I5** | Two presentations by one holder to different verifiers are unlinkable | `verifierId` is hashed into the nullifier, so the two values are independent SHA-256 outputs. Correlating them requires the secret |
| **I6** | A credential signed by an unregistered issuer is rejected | The verification key is read from `issuerKeys` — **public state**, not the prover — and `jubjubSchnorrVerify` is wrapped in `assert` |
| **I7** | A credential cannot be presented by a holder other than the bound one | The attestation is signed over `(tag, commitment, holderId)`. Presenting re-derives `holderId` from the caller's secret, so a thief's signature check fails |

Each has a dedicated test file. Coverage, including what is *not* proven, is in [tests/README.md](tests/README.md).

---

## 3. Cryptographic choices

### 3.1 `persistentCommit` for the credential commitment

`commitment = persistentCommit(attrs, blinding)` — SHA-256 based, with a 32-byte random opening.

**Binding** — finding a second `(attrs', blinding')` with the same digest is a SHA-256 collision. A holder cannot change what they committed to after the fact.

**Hiding** — the attribute space is tiny and enumerable. An age, a country code and a tier is perhaps 2²⁵ combinations; a bare hash would fall to brute force instantly. The random blinding factor is what makes the commitment hiding, and the Compact compiler agrees: `persistentCommit` output may be written to the ledger **without** `disclose()`, whereas `persistentHash` output may not. That compiler behaviour is a machine-checked statement that the construction is considered hiding.

`persistent` rather than `transient` because the docs are explicit that transient variants are *"not guaranteed to persist between upgrades"* and *"should not be used to derive state data."* A credential commitment is state data with a multi-year lifetime.

**Blinding must never be reused.** The docs warn that reusing an opening across commitments makes them linkable. One fresh 32-byte value per credential.

### 3.2 The nullifier

```
nullifier = persistentHash([ pad(32,"cred:nullifier:v1"), secret, verifierId, epoch ])
```

Four components, each load-bearing:

- **domain separator** — prevents a value derived here being replayed as an identifier from another context. The contract uses `cred:admin:v1`, `cred:holder:v1`, `cred:nullifier:v1`, `cred:attest:v1` and `cred:revoke:v1`, all distinct. The security guide calls this out specifically.
- **secret** — the only thing an adversary lacks, and therefore the sole basis of unlinkability.
- **verifierId** — makes the value verifier-specific. Remove it and every verifier sees the same nullifier, which is a global user identifier: the exact failure this design exists to avoid.
- **epoch** — bounds the spent set and lets a holder present again after a revocation round.

Determinism within a `(verifier, epoch)` pair is what makes replay detectable. Independence across verifiers is what makes collusion useless. Both properties fall out of the same construction.

### 3.3 Jubjub Schnorr for attestation

Jubjub is the curve embedded in the proving system's scalar field, so verification is cheap in-circuit. The alternative available is `secp256k1EcdsaVerify`, which carries a footgun the docs flag: it *"does not constrain [`msgHash`] to any message"*, requiring the caller to hash in-circuit. Jubjub Schnorr takes the message as `Vector<n, Field>` directly and has no such gap.

**The trap we fell into.** `jubjubSchnorrVerify` is overloaded — one form asserts internally, one returns `Boolean`. With identical parameter types, the compiler resolves a bare statement call to the **Boolean** form and silently discards the result:

```js
return this._equal_0(lhs_0, rhs_0);   // a value, thrown away
```

For a while this contract compiled cleanly, read correctly, and **accepted forged issuer signatures**. The I6 and I7 tests caught it. Every call site is now `assert(jubjubSchnorrVerify<3>(...), "...")`. Recorded here because it is invisible to the compiler and to review, and only a test that actually forges a signature will find it.

### 3.4 Issuer keys stored as points, not hashes

`issuerKeys: Map<Uint<16>, JubjubPoint>`. The original design stored `persistentHash` of the key and passed the point in as a witness, asserting the hash matched. Storing the point is strictly stronger: the verification key comes from **public state**, so there is nothing for a hostile witness to substitute, and the hash-matching step disappears along with the chance of getting it wrong.

*Cost:* presenting names an `issuerId`, so an observer learns which issuer attested the credential — though not which credential. With one issuer this is vacuous; with many it partitions the anonymity set. Hiding it would need a membership proof over the issuer set, which is Wave 3 work.

### 3.5 The `asOf` indirection

This is the least obvious decision in the contract and the one most worth explaining.

The natural way to write "age ≥ 18" is:

```compact
assert(blockTimeGte(attrs.birthTimestamp + threshold), "too young");   // WRONG
```

It is a **privacy hole**. The argument to any `blockTime*` call must be disclosed, and `threshold` is public — so disclosing `birthTimestamp + threshold` reveals the birth date exactly. The compiler catches it:

> *"the call to standard-library circuit `blockTimeLt` might disclose the lower bound of the time being checked"*

Instead the caller supplies a public `asOf` timestamp, which is pinned to a window using only public values:

```compact
assert(blockTimeGte(now), "asOf is in the future");
assert(blockTimeLt((now + freshnessWindow()) as Uint<64>), "asOf is stale");
```

Every private comparison then happens against `asOf`, and its result only ever feeds an `assert`, so nothing leaks:

```compact
assert(now < attrs.expiresAt, "credential has expired");
assert(evalPredicate(request, attrs, now), "predicate not satisfied");
```

Both bounds are necessary. Without the upper bound a holder forward-dates `asOf` and appears older; without the lower bound they back-date it and resurrect an expired credential. Both attacks have tests.

*Cost:* the 5-minute window is slack in both directions — up to 5 minutes of grace past expiry, and age understated by up to 5 minutes. Narrowing it increases the chance of a legitimate proof being rejected for staleness on a slow chain.

---

## 4. Revocation: the active-set decision

### 4.1 What was chosen

`activeCredentials: HistoricMerkleTree<10, Bytes<32>>` holds the commitments of all **live** credentials. A holder proves **membership**, which implies non-revocation. Revoking removes the leaf.

### 4.2 Why not a revocation list

A public list of revoked credential ids leaks precisely what the system protects. Anyone could watch it and learn that a specific credential was revoked, and correlate that with off-chain events. Worse, checking non-membership of a public list in-circuit requires either revealing the credential id or iterating the whole list — the first defeats the purpose, the second does not fit a bounded circuit.

### 4.3 Why not a proper non-membership proof

Because the primitive does not exist. The Compact stdlib provides `merkleTreePathRoot` and `checkRoot` — **membership only**. There is no exclusion witness, no sorted-tree interval proof, nothing (RESEARCH.md §C.9). Inverting the set turns non-membership into membership, which is the problem the available primitives actually solve.

The correct long-term construction is an **indexed (sorted) Merkle tree**, where each leaf stores its own value and its successor, so a path to the leaf whose interval straddles `x` proves `x` is absent. That would remove the path-refresh burden entirely, because a holder's own leaf stops changing when unrelated credentials are revoked. Building one from scratch in Wave 1 was judged too risky; it is Wave 3.

### 4.4 Why `resetHistory()` is not optional

`HistoricMerkleTree.checkRoot` accepts *any past root*. That is normally a feature — it stops a holder's path going stale every time someone else is issued a credential. But it means a revoked holder can simply present against a root from before their revocation, and **I2 fails outright**.

So `revokeCredential` calls `resetHistory()`, discarding all prior roots. Revocation takes effect immediately.

**The cost, stated plainly:** every holder's cached Merkle path dies on every revocation, not just the revoked holder's. Everyone must refresh from public state before presenting again. The demo UI surfaces this as a visible `stale` badge and a "Refresh path" action rather than hiding it, and there is a test asserting that unaffected holders recover.

The trade this buys is worth naming precisely: between revocations, the history window still absorbs the churn from ongoing **issuance** — which is the common case, since credentials are issued constantly and revoked rarely. Only revocation clears the slate.

### 4.5 Two holes closed by the occupancy map

`leafIssuer: Map<Uint<64>, Uint<16>>` records which issuer owns which slot. It exists because the tree ADT offers **no way to test occupancy in-circuit** — `firstFree()` and `pathForLeaf()` are TypeScript-only — and without that test two attacks were possible:

- **Revoking an empty index.** The tree was unchanged, but the epoch still bumped and `resetHistory()` still fired. Any registered issuer could invalidate every holder's cached path, for free, without end. Now `assert(leafIssuer.member(idx))`.
- **Revoking another issuer's credential.** Any registered issuer could destroy a competitor's credentials. Now `assert(leafIssuer.lookup(idx) == iid)`.

A third, latent one fell out of the same change: issuance now takes an explicit `leafIndex` and asserts `!leafIssuer.member(idx)`, so an issuer cannot silently overwrite a live credential by reusing its slot.

All three have tests.

### 4.6 The issuer-side update path

1. The issuer records each credential's `leafIndex` at issuance and passes it to `issueCredential`. This is unavoidable: `HistoricMerkleTree` has **no `remove` method**, so revocation is `insertIndexDefault(index)`, which requires knowing the index.
2. To revoke, the issuer signs `(tagRevoke, leafIndex, epoch)` and calls `revokeCredential`.
3. The contract checks the slot is occupied and owned by that issuer, tombstones the leaf, drops the `leafIssuer` entry, clears root history, and increments the epoch.
4. Every holder rebuilds their path with `findPathForLeaf(commitment)` against the new root. A holder whose own leaf was tombstoned gets `undefined` and cannot proceed — which is the intended outcome.

Depth 10 gives 1024 credentials. Raising it is a one-line change plus a proving-key rebuild; in-circuit path verification cost scales with depth.

---

## 5. Known limitations

Exhaustive and unflattering, because these are the questions a technical judge will ask.

**Trust**

1. **The issuer is mocked.** It signs whatever it is given. There is no identity assurance anywhere in this system.
2. **The admin is fully trusted** and cannot be changed — `admin` is `sealed`. A malicious admin registers a hostile issuer key and mints arbitrary credentials.
3. **No issuer deregistration.** A compromised issuer key cannot be revoked. Credentials it already minted stay valid until individually revoked. This is a genuine gap and should be Wave 2 work.

**Revocation**

4. **Revocation invalidates every holder's path**, as argued in §4.4. This is inherent to `resetHistory()` and remains the design's main cost.
5. **An issuer can still grief by revoking its own live credentials.** Each such revocation resets history for everyone. This cannot be removed without batching revocations, because revocation must genuinely take effect. Bounded, though: it destroys the issuer's own credentials to do it, unlike the free version that used to exist (see below).
6. **Tree capacity is 1024** and is not extensible after deployment.

**Replay scope**

7. **Any revocation resets replay protection for everyone.** The nullifier is scoped to `revocationEpoch`, so when *any* credential is revoked the epoch advances and every holder gets a fresh nullifier at every verifier. For the "has this person already been served in this window" use case that is fine. For **sybil resistance** — "one account per person, ever" — it is not: a holder who waits for any revocation can present again to the same verifier and appear to be a new person. A verifier relying on nullifiers for one-account-per-person must therefore also track them across epochs itself.

    This is a genuine design tension, not an oversight to be patched away. Permanent nullifiers would give sybil resistance but would stop a holder ever legitimately re-verifying with the same verifier. Decoupling the nullifier epoch from the revocation epoch — a time-based epoch on a fixed schedule — is the better answer and is Wave 2 work.

**Privacy**

8. **The issuer id is disclosed** at presentation (§3.4).
9. **Presentation counts are public.** An observer sees how many presentations happened and in which epoch. With few users this is revealing.
10. **Timing correlation is out of scope.** Unlinkability is a property of published values, not of network traffic.
11. **The spent-nullifier set grows monotonically within an epoch** and is never pruned.

**Implementation**

12. **The contract targets a pre-release protocol version and cannot be deployed today.** Compiler 0.34.0 → `compact-runtime` 0.19.0 → `onchain-runtime-v4 4.0.0-rc.3`. Every live network runs on-chain runtime 3.0.0, and the stable proof server is 8.1.0 against 9.0.0-rc.7 for v4. This was a deliberate trade: the deployable compiler (0.31.1 / language 0.23) has no in-circuit signature verification of any kind, and `compact-runtime` 0.16.0 has no signing primitives either, so staying deployable would have meant hand-rolling Jubjub Schnorr on both sides of the boundary. Full trace in RESEARCH.md §F.7c.
13. **Block-time units are assumed to be milliseconds.** Unconfirmed against a live chain. If wrong, the freshness window is the wrong size, though the ordering logic still holds.
14. **The demo generates no ZK proofs.** Circuits execute and every constraint is enforced, but the prover is not invoked and nothing touches a chain. Runtime proving latency is unmeasured.
15. **Only eight allowed countries** per predicate request, fixed at compile time — Compact has no dynamic arrays.
16. **No renewal path.** An expiring credential must be re-issued from scratch. Deferred to Wave 2.
17. **I1 is only partially demonstrated.** The state scan is strong for multi-byte values, but `countryCode` and `kycTier` are too small to scan for meaningfully; those are argued structurally rather than shown.
18. **I5 cannot be fully proven by testing.** The tests rule out every reachable implementation error, but the property itself reduces to SHA-256 preimage resistance, which is an assumption.
