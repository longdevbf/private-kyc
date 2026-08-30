import { useCallback, useEffect, useState } from 'react';
import { api, type DemoState } from './api.js';
import { PrivateRegister, PublicRegister } from './components/Inspector.js';
import { Ambient } from './components/Ambient.js';
import { Counter } from './components/Counter.js';
import { ChainStatus } from './components/ChainStatus.js';
import { EngineSwitch } from './components/EngineSwitch.js';
import { WalletConnect, type WalletSession } from './components/WalletConnect.js';
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
  // A connected wallet is a live object with permissions attached, not
  // serialisable state, so it is held here and passed down rather than
  // reconstructed per panel.
  const [wallet, setWallet] = useState<WalletSession | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      setState(s);
      setError(null);
      setSelected((cur) => (cur && s.holders.some((h) => h.name === cur) ? cur : s.holders[0]?.name));
    } catch (e) {
      // Two different failures reach here and they need different fixes,
      // so the message is the one the backend actually gave when there is
      // one. Reporting "start the contract host" while the contract host
      // is running and the CHAIN service is down sends the reader to the
      // wrong terminal.
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'Cannot reach the contract host on port 4000. Start it with npm run dev:chain.',
      );
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
          <EngineSwitch onChange={refresh} />

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
              <span className={`pulse${state.engine?.mode === 'onchain' ? ' live' : ''}`} />
              <span className="k">
                {state.engine?.mode === 'onchain'
                  ? String(state.engine.network ?? 'network').toUpperCase()
                  : 'LOCAL LEDGER'}
              </span>
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
            {/* What is driving THIS page, which is a different claim from
                what has been deployed somewhere. Never merged. */}
            <span
              className={`chainchip${state.engine?.mode === 'onchain' ? ' live' : ''}`}
              title={
                state.engine?.mode === 'onchain'
                  ? `${state.engine.network} · ${state.engine.contractAddress}\n` +
                    `fees paid by ${state.engine.feePayer}`
                  : 'The circuits run locally against an in-memory ledger. No proof is generated here.'
              }
            >
              {state.engine?.mode === 'onchain'
                ? `${state.engine.network} · real proof, real tx`
                : 'simulator · no proof generated'}
            </span>
            <span className="mockchip" title={state.mockWarning}>
              <IconLock size={12} /> Mock issuer · no identity checked
            </span>
          </div>
        </header>

        <main className="work">
          {/* Only shown on chain: in the simulator there is nothing for a
              wallet to pay for, and a connect button that does nothing is
              worse than no button. */}
          {state.engine?.mode === 'onchain' && (
            <WalletConnect state={state} session={wallet} onSession={setWallet} />
          )}

          {persona === 'issuer' && (
            <IssuerPanel state={state} refresh={refresh} wallet={wallet} />
          )}
          {persona === 'holder' && (
            <HolderPanel state={state} selected={selected} onSelect={setSelected} refresh={refresh} />
          )}
          {persona === 'verifier' && (
            <VerifierPanel state={state} selected={selected} refresh={refresh} wallet={wallet} />
          )}

          <ChainStatus state={state} />
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
