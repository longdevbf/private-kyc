import { useState } from 'react';
import { api, runViaWallet, type DemoState, type Result } from '../api.js';
import { IconCheck, IconCross, IconInbox } from '../components/Icons.js';
import type { WalletSession } from '../components/WalletConnect.js';

/**
 * The result of one action, with the timing labelled for what it is.
 *
 * The label is not decoration. In the simulator the number is circuit
 * execution and no proof exists; on chain it is proving plus block
 * inclusion. Reporting the second with the first's wording would be the
 * single most misleading thing this interface could do, so the caller has
 * to say which engine produced it.
 */
export function Outcome({
  r,
  okText,
  onchain = false,
}: {
  r: Result;
  okText: string;
  onchain?: boolean;
}) {
  const receipt = r.receipt;
  return (
    <div className={`outcome ${r.ok ? 'ok' : 'bad'}`}>
      {r.ok ? <IconCheck size={15} /> : <IconCross size={15} />}
      <span className="body">
        <span>{r.ok ? okText : r.reason}</span>
        {onchain ? (
          <span className="meta">
            {receipt?.proveMs !== undefined
              ? `zero-knowledge proof generated in ${receipt.proveMs} ms`
              : 'zero-knowledge proof generated'}
            {r.ms !== undefined && ` · ${(r.ms / 1000).toFixed(1)}s including block inclusion`}
            {receipt?.txHash && ` · tx ${receipt.txHash.slice(0, 12)}…`}
            {receipt?.blockHeight && ` · block ${receipt.blockHeight}`}
          </span>
        ) : (
          r.ms !== undefined && (
            <span className="meta">
              circuit executed in {r.ms} ms · constraints enforced, no ZK proof generated
            </span>
          )
        )}
      </span>
    </div>
  );
}

export function IssuerPanel({
  state,
  refresh,
  wallet,
}: {
  state: DemoState;
  refresh: () => Promise<void>;
  wallet?: WalletSession | null;
}) {
  const [form, setForm] = useState({
    holderName: 'alice', label: 'Alice · national ID',
    ageYears: 30, countryCode: 704, kycTier: 3, validDays: 365,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<(Result & { what: string }) | null>(null);

  const onchain = state.engine?.mode === 'onchain';

  /**
   * Run one action.
   *
   * If a wallet is connected, connecting IS the opt-in: the action goes
   * through it and the visitor pays the fee. There is no second toggle,
   * because a connected wallet that silently pays for nothing would be
   * the confusing option, not the safe one.
   */
  async function run(
    what: string,
    fn: () => Promise<Result>,
    walletAction?: Record<string, unknown>,
  ) {
    setBusy(what);
    try {
      const r =
        wallet && walletAction
          ? await runViaWallet(wallet.api, walletAction)
          : await fn();
      setLast({ ...r, what });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({
      ...form,
      [k]: k === 'holderName' || k === 'label' ? e.target.value : Number(e.target.value),
    });

  const live = state.credentials.filter((c) => !c.revoked).length;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Authorised issuers</h2>
            <p>
              {onchain ? (
                <>
                  Publishes a digest of the issuer&rsquo;s secret on chain. The
                  deployed contract is compiled for language 0.23, which has no
                  in-circuit signature verification, so authority is proof of
                  knowledge of that secret rather than a signature. The digest is
                  read from public state, never from the party calling.
                </>
              ) : (
                <>
                  Publishes the issuer&rsquo;s Jubjub verification key on chain. The
                  contract reads that key from public state when checking an
                  attestation, never from the party presenting — so there is nothing
                  for a hostile prover to substitute.
                </>
              )}
            </p>
          </div>
          <div className="head-act">
            {state.issuerRegistered ? (
              <span className="chip ok"><i className="dot" />issuer 1 · key published</span>
            ) : (
              <>
                <span className="chip muted">none registered</span>
                <button
                  className="btn primary"
                  disabled={busy !== null}
                  onClick={() => run('register', api.registerIssuer, { action: 'registerIssuer' })}
                >
                  {busy === 'register' ? 'Publishing…' : onchain ? 'Register issuer' : 'Register key'}
                </button>
              </>
            )}
          </div>
        </div>
        {last?.what === 'register' && (
          <div className="panel-body"><Outcome r={last} onchain={onchain} okText={onchain ? "Issuer registered on chain." : "Verification key published to the issuer registry."} /></div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Issue a credential</h2>
            <p>
              {onchain ? (
                <>
                  The issuer proves it holds the registered secret, and a leaf
                  binding the commitment to this holder is inserted. Only that leaf
                  reaches the chain — the values below stay off it and are not
                  recoverable from public state.
                </>
              ) : (
                <>
                  The issuer signs a commitment to these attributes, bound to the
                  holder. Only the commitment reaches the chain — the values below
                  stay with the holder and are never recoverable from public state.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="panel-body">
          <div className="grid-fields">
            <div className="field">
              <label htmlFor="hn">Holder</label>
              <input id="hn" value={form.holderName} onChange={set('holderName')} />
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="lb">Label</label>
              <input id="lb" value={form.label} onChange={set('label')} />
            </div>
          </div>

          <div className="grid-fields" style={{ marginTop: 14 }}>
            <div className="field">
              <label htmlFor="ag">Age · years</label>
              <input id="ag" type="number" value={form.ageYears} onChange={set('ageYears')} />
            </div>
            <div className="field">
              <label htmlFor="cc">Country · ISO</label>
              <input id="cc" type="number" value={form.countryCode} onChange={set('countryCode')} />
            </div>
            <div className="field">
              <label htmlFor="kt">KYC tier</label>
              <input id="kt" type="number" value={form.kycTier} onChange={set('kycTier')} />
            </div>
            <div className="field">
              <label htmlFor="vd">Valid · days</label>
              <input id="vd" type="number" value={form.validDays} onChange={set('validDays')} />
            </div>
            <button
              className="btn primary"
              disabled={!state.issuerRegistered || busy !== null}
              onClick={() => run('issue', () => api.issue(form), { action: 'issue', ...form })}
            >
              {busy === 'issue' ? (onchain ? 'Proving…' : 'Signing…') : 'Sign and issue'}
            </button>
          </div>

          {last?.what === 'issue' && (
            <Outcome r={last} onchain={onchain} okText={onchain ? "Credential leaf inserted into the active set on chain." : "Attestation signed and commitment inserted into the active set."} />
          )}
        </div>
        {!state.issuerRegistered && (
          <div className="hint">Register the issuer key first — an unregistered signature will not verify.</div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Issued credentials</h2>
            <p>
              Revoking tombstones the leaf and clears the tree&rsquo;s root
              history, so every cached Merkle path — including those of
              unaffected holders — stops verifying until refreshed. That cost is
              real and is not hidden here.
            </p>
          </div>
          <div className="head-act">
            <span className="chip muted">{live} live</span>
            {state.credentials.length - live > 0 && (
              <span className="chip bad">{state.credentials.length - live} revoked</span>
            )}
          </div>
        </div>

        <div className="panel-body tight">
          {state.credentials.length === 0 ? (
            <div className="empty">
              <IconInbox size={26} />
              <span>No credentials issued yet.</span>
            </div>
          ) : (
            <div className="tablewrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Leaf</th><th>Label</th><th>Commitment</th><th>Status</th><th />
                  </tr>
                </thead>
                <tbody>
                  {state.credentials.map((c) => (
                    <tr key={c.commitment}>
                      <td className="num">{c.leafIndex}</td>
                      <td>{c.label}</td>
                      <td className="hash" title={c.commitment}>{c.commitment.slice(0, 16)}…</td>
                      <td>
                        {c.revoked
                          ? <span className="chip bad"><i className="dot" />revoked</span>
                          : <span className="chip ok"><i className="dot" />active</span>}
                      </td>
                      <td className="right">
                        <button
                          className="btn danger sm"
                          disabled={c.revoked || busy !== null}
                          onClick={() => run('revoke', () => api.revoke(c.commitment), { action: 'revoke', commitment: c.commitment })}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {last?.what === 'revoke' && (
          <div className="panel-body">
            <Outcome r={last} onchain={onchain} okText="Revoked. Leaf tombstoned, root history cleared, epoch advanced." />
          </div>
        )}
      </section>
    </>
  );
}
