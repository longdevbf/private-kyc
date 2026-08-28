# Self-audit against the judging rubric

Written adversarially. Scores are not rounded up, and every number is justified by something in the repo rather than by intent.

**Weighted total: 7.76 / 10**

| Criterion | Weight | Score | Contribution |
|---|---|---|---|
| Technical & implementation | 40% | 8 | 3.20 |
| QA & reliability | 15% | 9 | 1.35 |
| Product & vision | 15% | 7.5 | 1.13 |
| UX & design | 15% | 8 | 1.20 |
| Communication | 10% | 6 | 0.60 |
| Business viability | 5% | 5.5 | 0.28 |

---

## Technical & implementation — 8 / 10 (40%)

**Does it compile from a clean clone?** Yes. `npm install && npm run build:contract` produces four circuits with proving keys in ~15s. Verified by running the documented commands, which is how the `$HOME/.compact/bin` vs `$HOME/.local/bin` documentation bug was found and fixed.

**Is the private state real or decorative?** Real. Five witnesses, and attribute values genuinely never reach the ledger — enforced by the compiler's disclosure analysis, not convention. All 18 `disclose()` sites carry an individual justification comment. The scan test in I1 confirms it against the full serialised state with a positive control.

**Does it show understanding of the dual-state model, or just use the syntax?** This is where the score is earned. Three decisions could only come from actually fighting the model:

- The `asOf` indirection, because `blockTimeLt(privateExpiry)` discloses a bound on the expiry date and the compiler says so.
- The active-set inversion, because the stdlib has membership proofs and no exclusion primitive.
- `resetHistory()` on revoke, because `checkRoot` accepts *any* past root and I2 fails silently without it.

**Is the repo organised?** Yes. Contract, shared engine, mock issuer, tests, web, and four documents each doing one job. `core/engine.ts` was extracted specifically so tests, issuer and web share one simulator rather than three copies.

**What costs it two points**

- **Nothing has ever been deployed** — and now we know it *cannot* be, on this version set. Compiler 0.34.0 targets `onchain-runtime-v4 4.0.0-rc.3` while every live network runs v3, with the v4 proof server still at `9.0.0-rc.7`. For a blockchain submission that is a real gap, though it is now a precisely explained one rather than an omission.
- 515 lines of Compact is competent, not large.

---

## QA & reliability — 9 / 10 (15%)

**Do tests run real circuits?** Yes, through `@midnight-ntwrk/compact-runtime`. 54 tests, 10 files, all passing in ~4s. Nothing is stubbed.

**Does every invariant have a test?** Yes, one file per invariant I1–I7, plus 24 edge cases. CI (`.github/workflows/ci.yml`) installs the toolchain, compiles and runs the suite on every push.

**Do edge cases fail for the right reason?** Negative tests assert the specific rejection message, not merely that something threw. This matters: several attacks would be caught incidentally by a later check, which would mask a regression in the earlier one.

**The strongest evidence for this score:** the suite found four real bugs that had already passed compilation and review.

1. `jubjubSchnorrVerify` resolving to the Boolean overload, so **forged issuer signatures were accepted**.
2. Revoking an empty leaf index — free, unlimited denial of service against every holder.
3. One issuer revoking another issuer's credentials.
4. An issuer overwriting a live credential by reusing its slot.

**What costs it a point**

- No integration test against a real node — and on this version set there cannot be one.
- I1 is partial: `countryCode` and `kycTier` are too small to scan for meaningfully.

---

## Product & vision — 7.5 / 10 (15%)

The lifecycle framing is correct and genuinely differentiated. The link to Midnight is not incidental: this design is only possible because of the dual-state model, `HistoricMerkleTree`, and in-circuit signature verification. Ported to a transparent chain it would leak everything.

Scope discipline held — renewal, the SDK and a real issuer are all named and deferred rather than half-built.

**What costs it 2.5 points**

- The wedge is narrow. "Other Midnight dApps needing gated access" is a small market, and the honest ordering says so.
- The mock issuer is a hard ceiling. Nothing here is deployable until a real credential source exists, and that is a partnership problem this project cannot solve.
- No design partner, no user conversations, no evidence of demand beyond a plausible story.

---

## UX & design — 8 / 10 (15%)

**Is it intuitive?** Yes. A proper product shell — persona rail, contextual header with live chain stats, and a persistent state inspector. The public/private split is carried by colour semantics (amber = never leaves the device, cyan = world-readable) applied consistently across every surface, so the trust domain of any value on screen is never in doubt.

Three things do explanatory work that prose could not:

- **The credential has a front and a back.** Turning the card puts the holder's real attributes and the single commitment the chain stores on two faces of one object. Hiding and binding stop being adjectives.
- **The Merkle path folds.** Leaf to root, one level at a time, ending on the root `checkRoot` accepts. When a path goes stale the panel says which root the chain stopped accepting and why, rather than showing a red badge.
- **The circuit trace reads the contract.** After a presentation it shows the eight things `present()` checks in order, and a rejection lands on the row that actually fired: the reason strings it matches on are the assert messages in `credential.compact`, so a replay stops on `nullifier` while an unsatisfiable predicate stops one row earlier and leaves `nullifier` untouched. Verified by driving the UI over the DevTools Protocol, not by inspection.

**Does it connect to the real contract?** Yes — every action executes the compiled circuits and every rejection is an in-circuit assert.

**What costs it two points, honestly**

- **The rubric asks for "a real end-to-end functional experience", and there is no chain.** A judge can reasonably read that as requiring on-chain calls. We run real circuits against an in-memory ledger — better than a mock, weaker than a deployment. This is the single largest scoring risk in the submission.
- **The holder's "private" state actually lives on the demo server.** It is labelled as such in the code and in the UI copy, but it is not on a device, and a careful judge will notice.
- No wallet integration. No Lace, no signing, no transaction.
- Responsive layout verified by screenshot at 600px and 1440px and correct at both. **Below ~500px it remains unverified** — headless Chrome enforces a minimum layout viewport, so a true phone width could not be rendered with the tooling available. The narrow-width CSS is written and reasoned about but not seen.
- ~~Only one predicate is reachable from the UI.~~ **Fixed.** All three (age / tier / country) are now selectable, and the linkage test is stronger for it: two verifiers can ask *different* questions of the same person and still fail to link them.

---

## Communication — 6 / 10 (10%)

The script and deck are written, timed, and structured so the demo carries the argument. The honest-scope framing appears in the first twenty seconds and on the title slide.

**What costs it four points:** neither the video nor the deck exists yet. A script is not a recording. Until they are produced this score is a forecast, and it is scored at the value of the plan, not the artefact.

---

## Business viability — 5.5 / 10 (5%)

Adopters are named and ordered by realism, and the adoption path (verifier SDK, not a consumer app) is the right one. The "why not build it yourself" argument is concrete — the signature-verification bug is good evidence that the lifecycle is harder than it looks.

**What costs it 4.5 points:** no market sizing, no pricing, no revenue model, no named prospect. The mock-issuer blocker is acknowledged but not solved even directionally — there is no plan for how an Identus partnership would actually happen.

---

# Direct answers

### What is the single weakest part?

**Nothing has touched a chain, and on this version set nothing can.** Compiler 0.34.0 compiles against `onchain-runtime-v4 4.0.0-rc.3`; the networks run v3, and the v4 proof server is still a release candidate. It weakens the 40% criterion and arguably the 15% UX criterion ("end-to-end").

What changed during the audit is the *quality* of the answer. "We ran out of time" is weak. "The builtin signature verification we depend on only exists in language 0.26, whose runtime targets a protocol version still in RC — here is the dependency trace, and here is what hand-rolling the alternative would have cost" is a defensible engineering position. It does not make the gap disappear, but it converts it from an omission into a documented ecosystem constraint.

### What would a judge who has seen twenty zk-KYC demos say?

Probably three things, in this order:

> *"Finally, one that revokes."* The active-set inversion with a stated reason for why non-membership was not used is the thing that separates this from the pile. Most demos have no revocation story at all.

> *"But you never deployed it."* And they would be right. The rebuttal — that the circuits are real and 54 tests drive them — is true but does not fully answer the objection.

> *"Your issuer is fake, so what have you actually proved?"* The honest answer, which the repo already gives: the lifecycle is real and the identity assurance is not, and the two are separable concerns. A judge who has seen twenty demos will have seen nineteen that blurred this, so saying it plainly is worth more than it costs.

The risk is being read as "a good engineering exercise that isn't a product". That reading is fair.

### Does anything overclaim?

I went looking specifically for this. Three things were checked and are clean:

- README title paragraph says the issuer is mocked in sentence two, and the real-vs-mocked table puts "no ZK proof, not on chain" in the **mocked** column.
- The UI reports "circuit executed in N ms · constraints enforced, no ZK proof generated" rather than faking a proving progress bar.
- The I5 test file states explicitly what it does *not* prove.

One phrase is doing more work than it should. From the README:

> *"the lifecycle, revocation, unlinkability and expiry logic are genuine on-chain behaviour with a test suite to prove it."*

**"genuine on-chain behaviour" is too strong.** The logic is genuine *contract* behaviour, and it has never run on a chain. The sentence is technically defensible — this is what the contract would do on chain — but it invites exactly the misreading the rest of the document works to avoid. It should read "genuine contract logic, verified by a test suite against the compiled circuits".

**Fixed** — the README now reads *"genuine contract logic, verified by a 54-test suite that drives the compiled circuits. It has not yet been deployed to a network."*

Also worth flagging: the ecosystem section says "designed to interoperate with" rather than "integrated with", which is correct, but slide 7 needs the same care when spoken aloud.

### Three things fixable in under four hours, ranked by score impact

**1. Decide the version question deliberately, and say so in the video.** (~15 min, or half a day if you port.) Deploying this contract is not possible on 0.34.0 — the v4 stack is in RC. The two real options are (a) ship as-is and state the constraint precisely, which is now documented end to end, or (b) port back to 0.31.1 and hand-roll Jubjub Schnorr in both Compact and TypeScript to become deployable. Option (a) is the better use of the remaining time; the contract is stronger with audited builtins, and the constraint is explicable. Either way the *decision* should be visible in the pitch rather than looking like an oversight.

**2. ~~Fix the overclaiming sentence and expose the other two predicates in the UI.~~ Done.** Both were applied during the audit. The predicate picker also improved the centrepiece: the linkage test now shows two verifiers asking different questions and still unable to correlate.

**3. Record the video.** (~1h.) It is 10% of the score sitting at zero until it exists, and the script is already shot-listed against a running demo.

If only one is possible, do **1**. It is the difference between "well-engineered" and "it works".
