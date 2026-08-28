import { useState } from 'react';
import { api, type DemoState, type Presentation, type Result } from '../api.js';
import { Outcome } from './Issuer.js';
import { IconInbox } from '../components/Icons.js';
import { Dial } from '../components/Dial.js';
import { CircuitTrace } from '../components/CircuitTrace.js';

const YEAR_MS = 31_536_000_000n;

const VERIFIERS = [
  { id: 'alpha-exchange', name: 'Alpha Exchange', initials: 'AX' },
  { id: 'beta-lending',   name: 'Beta Lending',   initials: 'BL' },
];

type Kind = 'age' | 'tier' | 'country';

function buildRequest(kind: Kind, value: string) {
  if (kind === 'age') {
    return {
      predicateId: 0,
      threshold: (BigInt(value || '0') * YEAR_MS).toString(),
      allowedCountries: [] as number[],
    };
  }
  if (kind === 'tier') {
    return { predicateId: 1, threshold: value || '0', allowedCountries: [] as number[] };
  }
  return {
    predicateId: 2,
    threshold: '0',
    allowedCountries: value
      .split(',')
      .map((c) => Number(c.trim()))
      .filter((c) => Number.isFinite(c) && c > 0)
      .slice(0, 8),
  };
}

function describe(kind: Kind, value: string): string {
  if (kind === 'age') return `age >= ${value}`;
  if (kind === 'tier') return `kycTier >= ${value}`;
  return `country in {${value}}`;
}

/** 32 bytes, one cell each. A byte shared with the other side lights up. */
function ByteGrid({ hex, other }: { hex: string; other?: string }) {
  const mine = hex.match(/../g) ?? [];
  const theirs = other?.match(/../g);
  return (
    <div className="bytes">
      {mine.map((b, i) => (
        <span
          key={i}
          className={`byte${theirs && theirs[i] === b ? ' match' : ''}`}
          style={{ ['--i' as string]: i }}
        >
          {b}
        </span>
      ))}
    </div>
  );
}

export function VerifierPanel({
  state, selected, refresh,
}: {
  state: DemoState;
  selected?: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<Record<string, Result>>({});
  const [kind, setKind] = useState<Kind>('age');
  const [value, setValue] = useState('18');
  // Which verifier the trace below the buttons is describing.
  const [traceFor, setTraceFor] = useState<string | null>(null);

  const holder = state.holders.find((h) => h.name === selected);

  function onKind(k: Kind) {
    setKind(k);
    setValue(k === 'age' ? '18' : k === 'tier' ? '2' : '704, 840');
  }

  async function present(verifierId: string) {
    if (!holder) return;
    setBusy(verifierId);
    setTraceFor(verifierId);
    try {
      const r = await api.present({ holderName: holder.name, verifierId, ...buildRequest(kind, value) });
      setLast({ ...last, [verifierId]: r });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const accepted = (v: string): Presentation | undefined =>
    [...state.presentations].reverse().find((p) => p.verifierId === v && p.accepted);

  const a = accepted('alpha-exchange');
  const b = accepted('beta-lending');

  const matching = a && b
    ? (a.nullifier.match(/../g) ?? []).filter((x, i) => x === (b.nullifier.match(/../g) ?? [])[i]).length
    : 0;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Request a proof</h2>
            <p>
              {holder
                ? <>Ask <b>{holder.name}</b> one question. Whichever you choose, the verifier learns only whether it held — never the birth date, the country, the tier, or which credential was used.</>
                : <>Select a holder in the Wallet view first.</>}
            </p>
          </div>
        </div>

        <div className="panel-body">
          <div className="grid-fields">
            <div className="field">
              <label htmlFor="pk">Predicate</label>
              <select id="pk" value={kind} onChange={(e) => onKind(e.target.value as Kind)}>
                <option value="age">age at least</option>
                <option value="tier">kyc tier at least</option>
                <option value="country">country in set</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="pv">
                {kind === 'age' ? 'Years' : kind === 'tier' ? 'Minimum tier' : 'ISO codes · max 8'}
              </label>
              <input id="pv" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="field">
              <label>Circuit asserts</label>
              <input readOnly value={describe(kind, value)} tabIndex={-1} style={{ color: 'var(--dim)' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            {VERIFIERS.map((v) => (
              <button
                key={v.id}
                className="btn primary"
                disabled={!holder || busy !== null}
                onClick={() => present(v.id)}
              >
                {busy === v.id ? 'Proving…' : `Present to ${v.name}`}
              </button>
            ))}
          </div>

          {VERIFIERS.map((v) =>
            last[v.id] ? <Outcome key={v.id} r={last[v.id]} okText={`${v.name} accepted the proof.`} /> : null,
          )}

          {traceFor && (
            <CircuitTrace
              running={busy === traceFor}
              ok={busy === traceFor ? null : last[traceFor]?.ok ?? null}
              ms={last[traceFor]?.ms}
              reason={last[traceFor]?.reason}
            />
          )}
        </div>
      </section>

      {/* ------------------------------------------- the centrepiece */}
      <section className="panel" style={{ background: 'transparent', border: 0, boxShadow: 'none' }}>
        <div className="section-head">
          <div>
            <span className="kicker">the property this exists to prove</span>
            <h2>Linkage test</h2>
          </div>
        </div>
        <p className="section-sub">
          Both verifiers now hold a nullifier for the same person. Each is
          <code> H(holder secret, verifier id, epoch)</code> — the same secret,
          salted differently. Compared byte by byte below; a shared byte lights
          up red.
        </p>

        {a && b ? (
          <div className="linkage-hero">
            <div className="lk-grid">
              <div className="lk-side">
                <div className="lk-who">
                  <span className="avatar">AX</span>
                  <h3>Alpha Exchange</h3>
                </div>
                <div className="lk-asked">saw · {a.predicate}</div>
                <ByteGrid hex={a.nullifier} other={b.nullifier} />
              </div>

              <div className="lk-mid">
                <span className="meter" />
                <Dial matching={matching} alarm={matching >= 8} />
                <span className="meter down" />
              </div>

              <div className="lk-side">
                <div className="lk-who">
                  <span className="avatar">BL</span>
                  <h3>Beta Lending</h3>
                </div>
                <div className="lk-asked">saw · {b.predicate}</div>
                <ByteGrid hex={b.nullifier} other={a.nullifier} />
              </div>
            </div>

            <div className="lk-readout">
              <div className="cell">
                <span className="lbl">bytes in common</span>
                <span className={`val${matching === 0 ? ' good' : ''}`}>{matching} / 32</span>
              </div>
              <div className="cell">
                <span className="lbl">expected by chance</span>
                <span className="val">~0.13</span>
              </div>
              <div className="cell">
                <span className="lbl">verdict</span>
                <span className={`val${matching >= 8 ? '' : ' good'}`}>
                  {matching >= 8 ? 'CORRELATED' : 'unlinkable'}
                </span>
              </div>
              <div className="cell">
                <span className="lbl">to invert</span>
                <span className="val">SHA-256</span>
              </div>
            </div>

            <div className="hint">
              The two verifiers can pool everything they hold and still cannot
              tell they served the same person. Present the same credential to
              the <i>same</i> verifier twice, though, and the nullifier repeats
              exactly — which is how replay gets caught.
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="empty">
              <IconInbox size={26} />
              <span>Present to both verifiers to run the comparison.</span>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Presentation log</h2>
            <p>Everything both verifiers have seen, accepted or not.</p>
          </div>
        </div>
        <div className="panel-body tight">
          {state.presentations.length === 0 ? (
            <div className="empty">
              <IconInbox size={26} />
              <span>No presentations yet.</span>
            </div>
          ) : (
            <div className="tablewrap">
              <table className="t">
                <thead>
                  <tr><th>Verifier</th><th>Asked</th><th>Outcome</th><th>Nullifier</th><th>Circuit</th></tr>
                </thead>
                <tbody>
                  {[...state.presentations].reverse().map((p, i) => (
                    <tr key={i}>
                      <td>{p.verifierId}</td>
                      <td className="hash">{p.predicate}</td>
                      <td>
                        {p.accepted
                          ? <span className="chip ok"><i className="dot" />accepted</span>
                          : <span className="chip bad"><i className="dot" />rejected</span>}
                        {!p.accepted && <div className="reason">{p.reason}</div>}
                      </td>
                      <td className="hash" title={p.nullifier}>
                        {p.nullifier === '-' ? '—' : `${p.nullifier.slice(0, 14)}…`}
                      </td>
                      <td className="num">{p.ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
