import type { DemoState } from '../api.js';
import { IconGlobe, IconCheck, IconLock } from './Icons.js';

const short = (h: string, n = 10) =>
  h && h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-n)}` : h;

/**
 * What this instance is, and what has actually been put on a network.
 *
 * These are two different claims and the interface keeps them apart:
 *
 *   this page      runs the compiled circuits against an in-memory ledger.
 *                  Every constraint is enforced, no ZK proof is produced,
 *                  and the millisecond figures are circuit execution.
 *
 *   the chain      a separate build of the same lifecycle engine, compiled
 *                  for the language version the live networks accept, is
 *                  deployed and has a real address and transaction.
 *
 * The deployment rows are read from onchain/deployments/*.json, which are
 * written only by an actual successful deployment. If the list is empty
 * the component says so plainly rather than implying otherwise.
 */
export function ChainStatus({ state }: { state: DemoState }) {
  const deployed = state.deployments ?? [];
  const engine = state.engine;
  const onchain = engine?.mode === 'onchain';

  return (
    <section className="chainstat">
      <div className="cs-row">
        <span className={`cs-badge ${onchain ? 'live' : 'sim'}`}>
          {onchain ? <IconCheck size={13} /> : <IconLock size={13} />}
        </span>
        <div className="cs-body">
          <h3>This page</h3>
          {onchain ? (
            <p>
              Driven by the contract deployed at{' '}
              <code title={engine.contractAddress}>{short(engine.contractAddress ?? '')}</code>{' '}
              on <b>{engine.network}</b>. Every action below generates a{' '}
              <b>real zero-knowledge proof</b> on a local proof server and submits a
              transaction that the network includes in a block, so the millisecond
              figures are {engine.timingMeans} — proving time, not circuit execution.
              Fees are paid in DUST by <code title={engine.feePayer}>{short(engine.feePayer ?? '', 8)}</code>.
            </p>
          ) : (
            <p>
              Executes the compiled Compact circuits through{' '}
              <code>{engine?.runtime ?? '@midnight-ntwrk/compact-runtime'}</code> against an
              in-memory ledger. Rejections come from in-circuit assertions, not from
              application code. <b>No zero-knowledge proof is generated here</b>, so the
              millisecond figures are {engine?.timingMeans ?? 'circuit execution'} — not
              proving time. Switch the engine in the sidebar to drive the deployed
              contract instead.
            </p>
          )}
        </div>
      </div>

      <div className="cs-row">
        <span className={`cs-badge ${deployed.length ? 'live' : 'none'}`}>
          {deployed.length ? <IconCheck size={13} /> : <IconGlobe size={13} />}
        </span>
        <div className="cs-body">
          <h3>On a real network</h3>

          {deployed.length === 0 && onchain ? (
            // The engine says it is driving a deployed contract, but no
            // deployment record exists on disk. Both facts are reported
            // rather than one of them being smoothed over: the contract is
            // real, the local record of it is missing, and that is worth
            // knowing before anyone quotes an address from this page.
            <p>
              This instance is driving <code title={engine.contractAddress}>{short(engine.contractAddress ?? '')}</code>{' '}
              on <b>{engine.network}</b>, but no deployment record was found in{' '}
              <code>onchain/deployments/</code>. The address above comes from the
              running service, not from a recorded deployment.
            </p>
          ) : deployed.length === 0 ? (
            <p>
              Not yet deployed. The live networks run Compact compiler 0.31.1
              (language 0.23), which has no in-circuit signature verification, so
              the reference contract above cannot be compiled for them. A port that
              can is in <code>onchain/</code>; once it is deployed its address and
              transaction appear here.
            </p>
          ) : (
            <>
              <p>
                The same lifecycle engine, compiled for the language version these
                networks accept, is deployed and live. Transactions there are proved
                by a real proof server and settled by consensus.
              </p>
              <div className="cs-deploys">
                {deployed.map((d) => (
                  <div className="cs-deploy" key={d.network}>
                    <div className="cs-net">
                      <span className="chip ok">
                        <i className="dot" />
                        {d.network}
                      </span>
                      <span className="cs-when">
                        {new Date(d.deployedAt).toISOString().slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                    <dl className="cs-kv">
                      <dt>contract</dt>
                      <dd title={d.contractAddress}>{short(d.contractAddress)}</dd>
                      {d.txHash && (
                        <>
                          <dt>deploy tx</dt>
                          <dd title={d.txHash}>{short(d.txHash)}</dd>
                        </>
                      )}
                      {d.blockHeight && (
                        <>
                          <dt>block</dt>
                          <dd>{d.blockHeight}</dd>
                        </>
                      )}
                      <dt>compiler</dt>
                      <dd>
                        {d.compiler} · language {d.languageVersion}
                      </dd>
                      <dt>proof server</dt>
                      <dd>{d.proofServer}</dd>
                    </dl>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Every transaction this session put on a network. Nothing here is
          narrated: each row is a hash the reader can look up. */}
      {onchain && (state.receipts?.length ?? 0) > 0 && (
        <div className="cs-row">
          <span className="cs-badge live">
            <IconCheck size={13} />
          </span>
          <div className="cs-body">
            <h3>Transactions</h3>
            <div className="tablewrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Circuit</th><th>What</th><th>Transaction</th>
                    <th>Block</th><th>Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {state.receipts!.map((r, i) => (
                    <tr key={`${r.txHash ?? r.txId ?? i}-${i}`}>
                      <td>{r.circuit}</td>
                      <td className="hash">{r.detail ?? '—'}</td>
                      <td className="hash" title={r.txHash ?? r.txId}>
                        {(r.txHash ?? r.txId)
                          ? `${(r.txHash ?? r.txId)!.slice(0, 16)}…`
                          : '—'}
                      </td>
                      <td className="num">{r.blockHeight ?? '—'}</td>
                      <td className="num">
                        {r.proveMs !== undefined ? `${r.proveMs} ms` : '—'}
                        <span className="sub">{(r.totalMs / 1000).toFixed(1)}s total</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
