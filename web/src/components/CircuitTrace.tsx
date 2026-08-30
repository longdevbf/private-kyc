import { useEffect, useState } from 'react';

/**
 * What `present()` does, in the order it does it.
 *
 * This is a visualisation of work that has already finished, not a
 * progress bar for it. It is here because the order is the design: a
 * reader who sees the sequence understands what a rejection actually
 * means. In the simulator the work takes milliseconds; on chain it takes
 * as long as proving and a block take, and the footer says which.
 *
 * The `match` strings are the assertion messages from
 * contracts/src/credential.compact, so the stage a rejection lands on is
 * read from the contract's own text rather than guessed. The commitment
 * step carries no assertion — it is a recomputation, and nothing there can
 * fail on its own — so it has no match strings.
 *
 * The deployed port in onchain/ asserts almost the same words. Where it
 * does not, its message is listed alongside rather than instead: the
 * authorisation step is a signature check in one contract and a
 * proof-of-knowledge check in the other, and a stage that matched only one
 * of them would silently mis-attribute the other's rejections.
 */
const STAGES: { name: string; why: string; match: string[] }[] = [
  {
    name: 'asOf freshness',
    why: 'the public timestamp is pinned to a window around block time',
    match: ['asOf is in the future', 'asOf is stale'],
  },
  {
    name: 'commitment',
    why: 'recomputed from the private attributes and the blinding factor',
    match: [],
  },
  {
    name: 'issuer attestation',
    why: 'checked against public state, never against the prover',
    match: [
      'unregistered issuer',
      'invalid issuer signature',
      "does not hold this issuer's secret",
    ],
  },
  {
    name: 'leaf binding',
    why: 'the path leaf equals that commitment, not somebody else’s',
    match: ['Merkle path is not for this credential'],
  },
  {
    name: 'root membership',
    why: 'the folded root is one the tree still accepts',
    match: ['not in the active set', 'revoked or path stale'],
  },
  {
    name: 'expiry',
    why: 'expiresAt compared against asOf, privately',
    match: ['credential has expired'],
  },
  {
    name: 'predicate',
    why: 'the one question this verifier asked',
    match: ['predicate not satisfied'],
  },
  {
    name: 'nullifier',
    why: 'derived per verifier, checked unspent this epoch',
    match: ['nullifier already spent'],
  },
];

/** Which stage a rejection came from, or undefined if the text is unfamiliar. */
export function stageOf(reason?: string): number | undefined {
  if (!reason) return undefined;
  const i = STAGES.findIndex((s) => s.match.some((m) => reason.includes(m)));
  return i === -1 ? undefined : i;
}

export function CircuitTrace({
  running,
  ok,
  ms,
  reason,
  onchain = false,
  proveMs,
}: {
  running: boolean;
  ok: boolean | null;
  ms?: number;
  reason?: string;
  /** Whether a deployed contract produced this, which changes what
      the timing means -- and therefore what it may be called. */
  onchain?: boolean;
  proveMs?: number;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!running) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(STAGES.length);
      return;
    }
    setStep(0);
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= STAGES.length) window.clearInterval(t);
    }, 90);
    return () => window.clearInterval(t);
  }, [running]);

  const settled = !running && ok !== null;
  const failedAt = ok === false ? stageOf(reason) : undefined;
  // On an unrecognised rejection every row stays idle rather than claiming
  // a stage passed that may not have.
  const reached = settled ? (ok ? STAGES.length : failedAt ?? 0) : step;

  return (
    <div className={`trace${settled ? (ok ? ' ok' : ' bad') : ''}`}>
      <div className="trace-head">
        <span className="trace-title">what present() checks, in order</span>
        {settled && ms !== undefined && (
          <span className="trace-ms">
            {onchain
              ? `${proveMs !== undefined ? `${proveMs} ms proving` : 'proof generated'} · ${(ms / 1000).toFixed(1)}s to a block`
              : `${ms} ms · constraints enforced, no ZK proof generated`}
          </span>
        )}
      </div>

      <ol className="trace-list">
        {STAGES.map((s, i) => {
          const state =
            failedAt === i ? 'fail'
            : i < reached ? 'pass'
            : i === reached && running ? 'live'
            : 'idle';
          return (
            <li key={s.name} className={`trace-row ${state}`} style={{ ['--i' as string]: i }}>
              <span className="trace-dot" />
              <span className="trace-name">{s.name}</span>
              <span className="trace-why">
                {failedAt === i ? reason : s.why}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
