# Video script — 3:00

**Format rules.** Screen recording at 1440×900 or larger, so the hex is readable. No stock footage. No music under speech. Say the hackathon name in the first ten seconds. Everything shown must be the running system — if a claim cannot be demonstrated on screen, it does not go in the script.

**Before recording**

```bash
npm run build:contract && npm run build:web
npm run dev:chain
bash scripts/demo-seed.sh    # optional: pre-populate, or do it live
```

Open `http://localhost:4000`. Have `contracts/src/credential.compact` open in a second window at the nullifier section (around line 300).

---

## 0:00 – 0:20 · The problem, concretely

> **Shot:** you, or a plain title card. No animation.

**Say:**

"This is the Private Credential Lifecycle Engine, built for the Midnight Buildathon.

Here's the problem in one sentence. To prove you're over eighteen to ten different platforms today, you send ten copies of your ID document to ten different databases. Every one of them is a breach waiting to happen — and none of them needed your date of birth. They needed one bit: yes or no."

---

## 0:20 – 0:40 · What this is, and what it is not

> **Shot:** the app on the Issuer view. Point at the `Mock issuer · no identity checked` chip in the top bar — it is present on every screen.

**Say:**

"Zero-knowledge proofs solve the disclosure half of that. This project builds the half underneath: the lifecycle. Issuance, revocation, expiry, and making sure two verifiers can't work out they served the same person.

One thing up front, and it's on screen the whole time. **The issuer here is mocked.** It signs whatever it's given and verifies nobody's identity. We're not claiming identity assurance. What is real is everything below it — and the signature it produces is genuinely checked inside the zero-knowledge circuit."

---

## 0:40 – 2:10 · Live demo

This is the argument. Do not cut it short to make room for slides.

### 0:40 – 1:00 · Issue

> **Shot:** Issuer view. Click **Register key**, then **Sign and issue** with the default form.

**Say:**

"The admin publishes the issuer's verification key on chain. Then the issuer signs a commitment to Alice's attributes — age, country, KYC tier, expiry — and inserts it into the active set.

Watch the right-hand rail. Two panels, always on screen, in every view. Amber is private and stays on Alice's device. Cyan is the chain. Only the commitment crossed over."

### 1:00 – 1:15 · The split

> **Shot:** Holder view. The credential card, front face. Move the cursor across it once so it tilts. Then click **Show what the chain sees** and let the card turn.

**Say:**

"Here's what Alice actually holds — her birth date, her country code, her tier, sitting on her side of the line. Turn the card over.

That's the whole of what the chain stores about this credential. One commitment. The front cannot be recovered from the back: the commitment is hiding, because of the blinding factor. And it cannot be changed behind it either, because the commitment is binding. Two properties, one field.

Same split in the rail on the right, in every view. Amber is private. Cyan is the chain."

> **Shot:** scroll to the Merkle fold and let it run. If it has already played, click **Replay fold**.

**Say:**

"And this is her non-revocation proof, folding. Commitment at the top, ten levels of sibling hashes, root at the bottom — and that root is the one the chain accepts, right there in the panel beside it. That fold is `merkleTreePathRoot`, running inside the circuit."

### 1:15 – 1:40 · Present to two verifiers

> **Shot:** Verifier view. Present to Alpha Exchange with `age at least 18`. Then switch the predicate to `kyc tier at least 2` and present to Beta Lending — two different questions.

**Say:**

"Now Alice proves she's over eighteen to Alpha Exchange. Accepted — and Alpha learns exactly one bit. Now a different question, to a different verifier: is her KYC tier at least two? Same credential. Also accepted.

Underneath each one, the circuit trace: the eight things `present` checks, in the order it checks them. Freshness, commitment, issuer signature, leaf binding, root membership, expiry, predicate, nullifier. Every one of those is an assertion in the contract, and the order is the design.

Both of those ran the real compiled circuit."

> **Say the next line according to which engine is selected on screen. Do not say both, and do not say the on-chain line while the simulator is running.**
>
> **Simulator:** "The timing shown is circuit execution, not proving — we're not invoking the prover here, and the footnote on screen says so."
>
> **On chain:** "That was a real transaction on Midnight preview. The timing splits into proving and total, and the hash next to it is on the indexer right now. What's deployed is the ported contract — language 0.23, which has no in-circuit signature verification — so the issuer check there is proof of knowledge of a secret, not a Schnorr signature. The reference contract in `contracts/` is the one with the signature, and it can't be deployed until Midnight's v4 runtime ships."

### 1:40 – 2:00 · **The linkage test** — the centrepiece

> **Shot:** scroll to the Linkage test. Let the byte grids sit on screen for a beat before speaking.

**Say:**

"This is the point of the project.

Both verifiers now hold a nullifier for the same person — and they asked different questions. Each nullifier is a hash of Alice's secret salted with that verifier's identity. Compared byte by byte: **zero of thirty-two match**. A shared byte would light up red.

Alpha and Beta can pool everything they have — both nullifiers, the whole chain — and they still cannot tell they served the same person.

But present to the *same* verifier twice…"

> **Shot:** click **Present to Alpha Exchange** again.

"…and the nullifier repeats exactly. Rejected — and watch where the trace stops. Seven checks green, and it fails on the last one: nullifier already spent. Replay protection and unlinkability out of the same construction.

Try a predicate she cannot satisfy instead and the trace stops one row earlier, at the predicate, and never reaches the nullifier at all. The picture is not decoration — it is reading the assertion that fired."

### 2:00 – 2:10 · Revoke

> **Shot:** Issuer tab → **Revoke**. Then Holder tab, point at the path badge flipping to `stale`. Then Verifier tab → present → rejected.

**Say:**

"Finally, revocation. The issuer tombstones the leaf and clears the root history. Alice's cached path stops verifying — the fold now says `checkRoot` no longer accepts this root, rather than hiding it — and the presentation fails: not in the active set.

That path refresh is a real cost of proving membership instead of publishing a blacklist. A blacklist would leak exactly what we're protecting."

---

## 2:10 – 2:40 · The contract

> **Shot:** switch to the editor. Show two passages only. Scroll slowly; do not narrate line by line.

**Passage 1 — the nullifier** (`credential.compact`, `nullifierAt`):

```compact
export pure circuit nullifierAt(sk, verifierId, epoch): Bytes<32> {
  return persistentHash<Vector<4, Bytes<32>>>([
    pad(32, "cred:nullifier:v1"), sk, verifierId, epoch
  ]);
}
```

**Say:** "Four inputs. The verifier id is what makes it per-verifier — take it out and every verifier sees the same value, which is a global tracking id. The epoch bounds the spent set. Deterministic per verifier, so replay is caught; independent across verifiers, so collusion isn't."

**Passage 2 — the membership check** (`present`):

```compact
assert(path.leaf == commitment, "Merkle path is not for this credential");
const root = merkleTreePathRoot<10, Bytes<32>>(path);
assert(activeCredentials.checkRoot(disclose(root)),
       "credential is not in the active set (revoked or path stale)");
```

**Say:** "Merkle trees give membership proofs, not non-membership proofs. So we invert the set: prove you're still in the live set rather than absent from a revoked one. The stdlib has no exclusion primitive — that's why.

Fifty-three tests drive these circuits. One of them caught a real bug: `jubjubSchnorrVerify` is overloaded, and a bare call resolves to the Boolean form and throws the result away. For a while this contract accepted forged issuer signatures. It compiled clean and read correctly. Only a test that actually forges a signature finds that."

---

## 2:40 – 3:00 · What is not solved

> **Shot:** back to the app, or a plain card.

**Say:**

"What's deliberately not done yet. The demo runs the contract against an in-memory ledger, not a Midnight node — the constraints are enforced, but no proof is generated and nothing is on chain. Renewal is Wave 2, along with a verifier SDK. Replacing the mock issuer with a real credential source is Wave 3.

And the honest structural limitation: a proper non-membership proof needs an indexed Merkle tree, which the standard library doesn't provide. The active-set inversion is the right answer with the primitives that exist today. It costs every holder a path refresh on every revocation, and we surface that in the UI rather than hiding it.

Everything else you just saw is real and tested."

---

## Recording checklist

- [ ] Hackathon named within the first ten seconds
- [ ] `MOCK ISSUER` chip visible in shot during the scope statement
- [ ] Linkage test on screen for at least five seconds before narration
- [ ] The two verifiers shown asking *different* predicates, not the same one
- [ ] Credential card turned over on camera, front and back both legible
- [ ] Merkle fold played through, root matching the PUBLIC panel
- [ ] Circuit trace shown stopping on two *different* rows (nullifier, then predicate)
- [ ] Replay rejection shown, not just described
- [ ] Revocation → stale path → failed presentation shown as one continuous sequence
- [ ] Compact source legible at recording resolution
- [ ] No claim made that is not demonstrated on screen
- [ ] Under 3:00
