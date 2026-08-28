import { useState } from 'react';
import { api, type DemoState, type Result } from '../api.js';
import { Outcome } from './Issuer.js';
import { IconInbox, IconRefresh, IconTree } from '../components/Icons.js';
import { CredentialCard } from '../components/CredentialCard.js';
import { MerklePath3D } from '../components/MerklePath3D.js';

export function HolderPanel({
  state, selected, onSelect, refresh,
}: {
  state: DemoState;
  selected?: string;
  onSelect: (n: string) => void;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Result | null>(null);
  const holder = state.holders.find((h) => h.name === selected);
  const revoked = !!holder && state.credentials.some(
    (c) => c.commitment === holder.commitment && c.revoked,
  );

  async function refreshPath() {
    if (!holder) return;
    setBusy(true);
    try {
      setLast(await api.refreshPath(holder.name));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (state.holders.length === 0) {
    return (
      <section className="panel">
        <div className="panel-head"><div><h2>Wallet</h2></div></div>
        <div className="panel-body tight">
          <div className="empty">
            <IconInbox size={26} />
            <span>No credentials held. Issue one from the Issuer view to begin.</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Wallet</h2>
            <p>
              A credential is four things: the attribute values, a blinding
              factor, an issuer signature, and a Merkle path. All four live
              here. None of them is on chain.
            </p>
          </div>
        </div>
        <div className="panel-body tight">
          <div className="tablewrap">
            <table className="t">
              <thead>
                <tr><th>Holder</th><th>Credential</th><th>Leaf</th><th>Path</th><th /></tr>
              </thead>
              <tbody>
                {state.holders.map((h) => (
                  <tr key={h.name}>
                    <td>{h.name}</td>
                    <td>{h.label}</td>
                    <td className="num">{h.leafIndex ?? '—'}</td>
                    <td>
                      {h.pathFresh
                        ? <span className="chip ok"><i className="dot" />current</span>
                        : <span className="chip warn"><i className="dot" />stale</span>}
                    </td>
                    <td className="right">
                      <button
                        className={`btn sm ${h.name === selected ? 'ghost' : 'quiet'}`}
                        onClick={() => onSelect(h.name)}
                      >
                        {h.name === selected ? 'Selected' : 'Select'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {holder && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>The credential</h2>
              <p>
                Turn it over. The front is what {holder.name} keeps — real
                values, held locally. The back is the whole of what the chain
                stores about it: one commitment. Nothing on the front can be
                recovered from the back.
              </p>
            </div>
          </div>
          <div className="panel-body two-up">
            <CredentialCard
              holder={holder}
              issuerName={state.issuerName}
              revoked={revoked}
            />

            <div className="faces">
              <div className="face-note pv">
                <span className="face-k">front · what {holder.name} keeps</span>
                <p>
                  Four attribute values, a blinding factor, an issuer
                  signature and a Merkle path. In a deployment none of this
                  leaves the device; here it lives on the demo server, which
                  is a limitation of the demo and not of the design.
                </p>
              </div>

              <div className="face-note pb">
                <span className="face-k">back · what the chain keeps</span>
                <p>
                  One 32-byte commitment, and the leaf it sits at. Hiding,
                  because of the blinding factor — the front is not
                  recoverable from it. Binding, because the commitment fixes
                  the values — they cannot be swapped behind it.
                </p>
              </div>

              <div className="face-note">
                <span className="face-k">what crossed the line</span>
                <p>
                  The commitment, and nothing else. That is the whole of the
                  disclosure at issuance.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {holder && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Non-revocation proof</h2>
              <p>
                Proving a credential is still live means proving its commitment
                sits in the active-set tree. The path below is folded back into
                a root in-circuit and compared against the chain. It changes
                whenever the tree does.
              </p>
            </div>
            <div className="head-act">
              {holder.pathFresh
                ? <span className="chip ok"><i className="dot" />path current</span>
                : <span className="chip warn"><i className="dot" />path stale</span>}
              <button className="btn ghost" disabled={busy} onClick={refreshPath}>
                <IconRefresh size={13} /> {busy ? 'Rebuilding…' : 'Refresh path'}
              </button>
            </div>
          </div>

          <div className="panel-body">
            {holder.merklePath ? (
              <MerklePath3D
                path={holder.merklePath}
                root={holder.pathRoot ?? state.public.merkleRoot}
                liveRoot={state.public.merkleRoot}
                accepted={holder.pathFresh}
              />
            ) : (
              <div className="empty">
                <IconTree size={26} />
                <span>No path exists for this commitment — the credential has been revoked.</span>
              </div>
            )}
            {last && <Outcome r={last} okText="Path rebuilt against the current root." />}
          </div>

          {!holder.pathFresh && (
            <div className="hint">
              A stale path is not a broken credential. It means the tree moved —
              somebody was issued or revoked. Rebuild it and present again. This
              is the cost of proving membership instead of publishing a blacklist,
              and it is why the active-set design leaks nothing.
            </div>
          )}
        </section>
      )}
    </>
  );
}
