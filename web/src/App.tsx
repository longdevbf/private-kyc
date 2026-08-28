import { useCallback, useEffect, useState } from 'react';
import { api, type DemoState } from './api.js';
import { PrivateRegister, PublicRegister } from './components/Inspector.js';
import { Ambient } from './components/Ambient.js';
import { Counter } from './components/Counter.js';
import { IconIssuer, IconHolder, IconVerifier, IconLock, IconRefresh } from './components/Icons.js';
import { IssuerPanel } from './panels/Issuer.js';
import { HolderPanel } from './panels/Holder.js';
import { VerifierPanel } from './panels/Verifier.js';

type Persona = 'issuer' | 'holder' | 'verifier';

function readHash(): Persona {
  const h = window.location.hash.replace('#', '');
  return h === 'holder' || h === 'verifier' ? h : 'issuer';
}

const TABS: {
  id: Persona;
  label: string;
  crumb: string;
  title: string;
  Icon: (p: { size?: number }) => JSX.Element;
}[] = [
  { id: 'issuer',   label: 'Issuer',   crumb: 'Credential authority', title: 'Issue and revoke credentials', Icon: IconIssuer },
  { id: 'holder',   label: 'Holder',   crumb: 'Wallet',               title: 'Held credentials',             Icon: IconHolder },
  { id: 'verifier', label: 'Verifier', crumb: 'Relying party',        title: 'Verify and compare',           Icon: IconVerifier },
];

const short = (h: string, n = 6) =>
  h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-n)}` : h;

export function App() {
  const [state, setState] = useState<DemoState | null>(null);
  const [persona, setPersona] = useState<Persona>(readHash());
  const [selected, setSelected] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      setState(s);
      setError(null);
      setSelected((cur) => (cur && s.holders.some((h) => h.name === cur) ? cur : s.holders[0]?.name));
    } catch {
      setError('Cannot reach the contract host on port 4000. Start it with npm run dev:chain.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onHash = () => setPersona(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const choose = (p: Persona) => { window.location.hash = p; setPersona(p); };

  if (error) {
    return (
      <div className="boot">
        <Ambient />
        <div style={{ textAlign: 'center', maxWidth: 420, lineHeight: 1.7 }}>{error}</div>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="boot">
        <Ambient />
        connecting to contract host…
      </div>
    );
  }

  const tab = TABS.find((t) => t.id === persona)!;
  const holder = state.holders.find((h) => h.name === selected);
  const p = state.public;

  return (
    <>
    <Ambient />

    <div className="shell">

      {/* ------------------------------------------------------- nav */}
      <nav className="nav">
        <div className="brand">
          <span className="brand-mark"><IconLock size={14} /></span>
          <span className="brand-text">
            <b>CREDENTIAL</b>
            <span>lifecycle engine</span>
          </span>
        </div>

        <div>
          <div className="nav-label">Personas</div>
          <div className="nav-items" role="tablist" aria-label="Persona">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                role="tab"
                className="nav-item"
                aria-selected={persona === id}
                onClick={() => choose(id)}
              >
                <Icon size={15} />
                {label}
                {id === 'holder' && state.holders.length > 0 && (
                  <span className="tail">{state.holders.length}</span>
                )}
                {id === 'verifier' && state.presentations.length > 0 && (
                  <span className="tail">{state.presentations.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="nav-foot">
          {/* The colour system is doing real work, so it is stated rather
              than left to be inferred. */}
          <div className="legend">
            <div className="nav-label">Trust domains</div>
            <div className="legend-row">
              <span className="swatch pv" />
              <b>private</b>
              <span>stays with the holder</span>
            </div>
            <div className="legend-row">
              <span className="swatch pb" />
              <b>public</b>
              <span>published on chain</span>
            </div>
          </div>

          <div className="netcard">
            <div className="netrow">
              <span className="pulse" />
              <span className="k">LOCAL LEDGER</span>
            </div>
            <div className="netrow"><span className="k">epoch</span><span className="v">{p.revocationEpoch}</span></div>
            <div className="netrow">
              <span className="k">leaves</span>
              <span className="v"><Counter value={Number(p.nextLeafIndex)} /> / 1024</span>
            </div>
            <div className="netrow"><span className="k">root</span><span className="v" title={p.merkleRoot}>{short(p.merkleRoot, 5)}</span></div>
          </div>
          <button className="btn quiet sm" onClick={async () => { await api.reset(); setSelected(undefined); await refresh(); }}>
            <IconRefresh size={13} /> Reset demo
          </button>
        </div>
      </nav>

      {/* ------------------------------------------------------ main */}
      <div className="main">
        <header className="topbar">
          <div>
            <span className="crumb">{tab.crumb}</span>
            <h1>{tab.title}</h1>
          </div>

          <div className="topbar-stats">
            <span className="stat pub">
              root <b title={p.merkleRoot}>{short(p.merkleRoot, 5)}</b>
            </span>
            <span className="stat pub">
              epoch <b><Counter value={Number(p.revocationEpoch)} /></b>
            </span>
            <span className="stat">
              nullifiers <b><Counter value={p.spentNullifiers.length} /></b>
            </span>
            <span className="mockchip" title={state.mockWarning}>
              <IconLock size={12} /> Mock issuer · no identity checked
            </span>
          </div>
        </header>

        <main className="work">
          {persona === 'issuer' && <IssuerPanel state={state} refresh={refresh} />}
          {persona === 'holder' && (
            <HolderPanel state={state} selected={selected} onSelect={setSelected} refresh={refresh} />
          )}
          {persona === 'verifier' && (
            <VerifierPanel state={state} selected={selected} refresh={refresh} />
          )}

          <p className="footnote">
            Every action on this page executes the compiled Compact circuits
            through <code>@midnight-ntwrk/compact-runtime</code>. Rejections are
            produced by in-circuit assertions, not by application code. The
            contract runs against an in-memory ledger rather than a Midnight
            node, so constraints are enforced but no zero-knowledge proof is
            generated — reported times are circuit execution, not proving.
          </p>
        </main>
      </div>

      {/* ------------------------------------------------- inspector */}
      <aside className="inspector">
        <PrivateRegister persona={persona} holder={holder} issuerName={state.issuerName} />
        <PublicRegister state={state} />
      </aside>
    </div>
    </>
  );
}
