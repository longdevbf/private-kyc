import { useEffect, useRef, useState } from 'react';
import type { MerklePathView } from '../api.js';

const short = (h: string, n = 8) =>
  h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-n)}` : h;

const isVoid = (h: string) => /^0+$/.test(h);

/**
 * The membership path, given depth and made to move.
 *
 * Ten sibling hashes and ten left/right decisions is exactly what
 * `merkleTreePathRoot` folds in-circuit. Drawing the fold — one level
 * lighting after the next, leaf at the front of the stack and root at the
 * back — turns the non-revocation proof from an assertion into something
 * a viewer watches happen.
 */
export function MerklePath3D({
  path,
  root,
  liveRoot,
  accepted,
}: {
  path: MerklePathView;
  /** The root this path folds to. Not always the current one. */
  root: string;
  /** The root the chain is publishing right now. */
  liveRoot: string;
  /**
   * Whether `checkRoot` still accepts the folded root. The tree keeps its
   * past roots, so this stays true after somebody else is issued and only
   * goes false when a revocation clears the history.
   */
  accepted: boolean;
}) {
  const [step, setStep] = useState(-1);
  const timer = useRef<number | undefined>(undefined);

  const run = () => {
    window.clearInterval(timer.current);
    setStep(0);
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1;
      setStep(i);
      if (i > path.entries.length) window.clearInterval(timer.current);
    }, 110);
  };

  // Fold once on mount, and again whenever the path itself changes —
  // which is precisely when the tree moved under this holder.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setStep(path.entries.length + 1); return; }
    run();
    return () => window.clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.leaf, path.entries.map((e) => e.sibling).join('')]);

  const done = step > path.entries.length;

  return (
    <div className="mt">
      <div className="mt-bar">
        <span className="mt-cap">
          folding <b>{path.entries.length}</b> levels · leaf → root
        </span>
        <button className="btn quiet sm" onClick={run}>Replay fold</button>
      </div>

      <div className="mt-stage">
        <div className="mt-deck">
          <div className={`mt-node leaf${step >= 0 ? ' lit' : ''}`} style={{ ['--i' as string]: 0 }}>
            <span className="mt-lvl">leaf</span>
            <span className="mt-role">commitment</span>
            <span className="mt-hash" title={path.leaf}>{short(path.leaf, 10)}</span>
          </div>

          {path.entries.map((e, i) => (
            <div
              key={i}
              className={`mt-node${step > i ? ' lit' : ''}${isVoid(e.sibling) ? ' void' : ''}`}
              style={{ ['--i' as string]: i + 1 }}
            >
              <span className="mt-lvl">L{String(i).padStart(2, '0')}</span>
              <span
                className={`mt-dir ${e.goesLeft ? 'l' : 'r'}`}
                title={e.goesLeft ? 'this node is the left child; sibling hashes on the right' : 'this node is the right child; sibling hashes on the left'}
              >
                {e.goesLeft ? 'L' : 'R'}
              </span>
              {isVoid(e.sibling) ? (
                <span className="mt-hash void">empty subtree</span>
              ) : (
                <span className="mt-hash" title={e.sibling}>{short(e.sibling, 10)}</span>
              )}
              <span className="mt-spark" />
            </div>
          ))}

          <div
            className={`mt-node root${done ? ' lit' : ''}`}
            style={{ ['--i' as string]: path.entries.length + 1 }}
          >
            <span className="mt-lvl">root</span>
            <span className="mt-role">folds to</span>
            <span className="mt-hash" title={root}>{short(root, 10)}</span>
          </div>
        </div>
      </div>

      <div className={`mt-verdict${done ? ' shown' : ''}${accepted ? ' ok' : ' bad'}`}>
        {accepted ? (
          <>
            <code>checkRoot</code> accepts this root, so the credential proves
            as a member of the active set.
            {root !== liveRoot && (
              <> It is not the current root — the tree has moved since this path
              was built — but <code>HistoricMerkleTree</code> keeps the roots it
              has published, and this is one of them.</>
            )}
          </>
        ) : (
          <>
            <code>checkRoot</code> no longer accepts this root. A revocation
            cleared the tree&rsquo;s root history, which invalidates every
            cached path at once, including those of holders who were not
            revoked. Rebuild it and present again.
          </>
        )}
      </div>
    </div>
  );
}
