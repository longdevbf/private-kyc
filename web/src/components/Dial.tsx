import { Counter } from './Counter.js';

const TICKS = 32;

/**
 * The correlation dial. One tick per byte of the nullifier, so the ring is a
 * direct picture of the comparison rather than an ornament: a tick lights
 * only when that byte is shared between the two verifiers.
 *
 * An empty ring is the result the design is claiming, so the empty state has
 * to look deliberate — not like something failed to load.
 */
export function Dial({ matching, alarm }: { matching: number; alarm: boolean }) {
  const r = 58;
  const cx = 64;
  const cy = 64;

  return (
    <div className={`dial${alarm ? ' alarm' : ''}`}>
      <svg viewBox="0 0 128 128" className="dial-svg" aria-hidden="true">
        <circle className="dial-track" cx={cx} cy={cy} r={r} />
        <circle className="dial-sweep" cx={cx} cy={cy} r={r} />

        {Array.from({ length: TICKS }, (_, i) => {
          const on = i < matching;
          const ang = (i / TICKS) * 360 - 90;
          return (
            <line
              key={i}
              className={`dial-tick${on ? ' on' : ''}`}
              x1={cx + (r - 9) * Math.cos((ang * Math.PI) / 180)}
              y1={cy + (r - 9) * Math.sin((ang * Math.PI) / 180)}
              x2={cx + (r + 1) * Math.cos((ang * Math.PI) / 180)}
              y2={cy + (r + 1) * Math.sin((ang * Math.PI) / 180)}
              style={{ ['--i' as string]: i }}
            />
          );
        })}
      </svg>

      <div className="dial-core">
        <span className="dial-num"><Counter value={matching} /></span>
        <span className="dial-den">of 32 bytes</span>
      </div>

      <span className="dial-verdict">
        {alarm ? 'correlated' : 'no correlation'}
      </span>
    </div>
  );
}
