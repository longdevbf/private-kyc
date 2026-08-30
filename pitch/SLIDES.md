# Slide deck — 8 slides

Speaker notes are what you say; slide content is what appears. Keep the slides sparse — the video carries the demo, the deck carries the argument.

**A presentable version of this deck is [pitch/deck.html](deck.html)** — open it in a browser, toggle Speaker notes, and use Print / PDF to export the eight slides as pages. It inherits the demo's visual identity and renders the real nullifier bytes from an actual demo run.

---

## 1 · Title

> **Private Credential Lifecycle Engine**
> Issuance, unlinkability, revocation and expiry on Midnight
>
> Midnight Buildathon · Wave 1
> *The issuer is mocked. The lifecycle is real.*

**Notes:** Put the scope caveat on the title slide. A judge who has seen twenty zk-KYC demos is looking for overclaiming; disarming it in the first five seconds buys you the rest of the deck.

---

## 2 · The problem

> Ten platforms. Ten copies of your ID.
> Every one of them needed **one bit**, not a document.
>
> And a credential you can't revoke is worse than no credential.

**Notes:** Two ideas, no more. First the disclosure problem, which is well understood. Then the one that isn't: the day-two problem. Revocation, expiry, and the fact that verifiers can collude.

---

## 3 · Where zk-KYC demos stop

> `prove(age > 18)` — solved, repeatedly
>
> Not solved:
> · revoke without leaking who was revoked
> · stop two verifiers linking the same person
> · expire, in-circuit
>
> **This project is that layer. KYC is the demo on top.**

**Notes:** Be specific rather than dismissive. Predicate proofs are genuinely the easy part — the circuits are small and the pattern is well documented. The lifecycle is where the design decisions bite, and it is the part every demo skips.

---

## 4 · Architecture — one boundary

```
  PUBLIC LEDGER            issuerKeys · activeCredentials (Merkle)
                           spentNullifiers · leafIssuer · epoch
  ═══════════════════════  disclose() gates every crossing
  HOLDER, ON DEVICE        secret · attributes · blinding
                           issuer signature · Merkle path
```

> Attribute values never cross. The **compiler** enforces it, not a convention.

**Notes:** The Compact compiler refuses to build if a witness-derived value reaches public state without an explicit `disclose()`. Every `disclose()` in the contract carries a comment justifying that specific crossing. This is a machine-checked privacy boundary, not a code-review one.

---

## 5 · The three things that are actually hard

> **Per-verifier unlinkability**
> `H(secret, verifierId, epoch)` — same person, unrelated values
>
> **Revocation without leaking**
> Merkle gives membership, not non-membership → invert the set
>
> **Expiry, in-circuit**
> `blockTimeLt(expiresAt)` leaks the expiry date → public `asOf` instead

**Notes:** Take the third one if there is time — it is the least obvious and shows real engagement with the language. Comparing a private timestamp against block time forces you to disclose a bound on it, and the compiler says so. The fix is to pin a public `asOf` to a window around block time and do every private comparison against that.

---

## 6 · Real vs mocked

| Real | Mocked |
|---|---|
| Nullifiers, unlinkability | — |
| Merkle membership, in-circuit | — |
| Revocation, expiry | — |
| **Deployed on preview**: real proofs, real DUST fees, real blocks | Not on preprod |
| Schnorr verified **in-circuit** — *reference contract* | Issuer identity assurance |
| — | The **deployed** contract has no signature check at all: language 0.23 has no such primitive, so an issuer proves knowledge of a secret |
| 82 tests driving real circuits (54 + 28) | No test touches a network; 20 more cover formatting and the wallet path, and those stub |

**Notes:** Do not soften this, and do not merge the two contracts into one claim. What runs on preview is the **port**, and it gives up the in-circuit signature to get there. Asked "is it deployed?", the true answer is "the port is — here is the address and the block", never a plain yes that lets them assume it is the reference version.

---

## 7 · Ecosystem fit

> **Midnames** — DID / naming → could supply the holder identifier
> **Identus** — credential issuance → the natural replacement for our mock
> **Triple Play** — compliance predicates → slot into our predicate module
>
> None of them provide the lifecycle. That is the gap.

**Notes:** Say "designed to interoperate with", not "integrated with" — these are design affinities, not shipped integrations, and a judge will ask. Our predicate module is deliberately small and pluggable precisely so richer compliance logic can sit on top without touching the lifecycle core.

---

## 8 · Roadmap

> **Wave 2** — renewal · **verifier SDK** · Preprod deployment · batched revocation
> **Wave 3** — real issuer (Identus) · indexed Merkle tree · design-partner pilot
>
> The SDK is the adoption path: integrate without reading the contract.

**Notes:** The indexed Merkle tree is the honest end state — it gives true non-membership proofs and removes the path-refresh cost entirely. We did not attempt it in Wave 1 because building one from scratch was too risky next to a working active-set design.

---

# Business viability

Keep this to sixty seconds. It is 5% of the score and padding it looks worse than being brief.

**Who adopts this, in order of realism**

1. **Other Midnight dApps needing gated access** — token sales, DAOs, regulated DeFi. They already need "is this user eligible" and already accept on-chain verification. Lowest integration cost, no compliance sign-off needed.
2. **Regional exchanges** — genuine repeated-KYC pain and real cost per re-verification, but they need a real issuer first.
3. **Regulated fintech** — largest need, longest sales cycle, hard requirements we do not meet yet.

**The adoption path is the verifier SDK, not a consumer app.** Nobody downloads a credential wallet for its own sake. A verifier integrates because checking eligibility is cheaper than collecting and storing documents, and because not holding PII removes a liability.

**Why integrate rather than build it themselves.** The predicate proof is a weekend. The lifecycle is not: per-verifier nullifier derivation, an accumulator whose revocation semantics actually hold, and the disclosure analysis needed to keep attributes off-chain. The signature-verification bug our tests caught — where a bare `jubjubSchnorrVerify` call silently accepts forgeries — is a good illustration of what a team rolling their own would hit.

**The blocker, stated plainly.** The mock issuer is what stands between this and production. Without a real credential source there is nothing to be assured *of*. That is a partnership problem, not an engineering one, and it is why Wave 3 targets Identus rather than more contract features.
