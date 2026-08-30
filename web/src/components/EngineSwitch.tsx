import { useEffect, useState } from 'react';
import { api, type EngineStatus } from '../api.js';
import { IconGlobe, IconLock } from './Icons.js';

/**
 * Choose which engine drives the demo.
 *
 * The two options are not cosmetic variants of each other and the control
 * does not pretend they are:
 *
 *   Simulator   circuits execute in the demo process against an in-memory
 *               ledger. Every assert is enforced; no proof is produced.
 *
 *   On chain    a deployed contract on a live network. Each action costs a
 *               real proof and a real transaction, so it is slow, and the
 *               control says so before it is clicked rather than after.
 *
 * When no on-chain service is answering, the option is disabled and the
 * reason is shown. It is never silently unavailable, and clicking it never
 * quietly falls back to the simulator.
 */
export function EngineSwitch({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setStatus(await api.engine());
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    void load();
    // The on-chain service can come up after the page does. Re-probing
    // means the option appears on its own rather than needing a reload.
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, []);

  if (!status) return null;

  const pick = async (mode: 'simulator' | 'onchain') => {
    if (mode === status.mode || busy) return;
    setBusy(true);
    setError(null);
    const r = await api.setEngine(mode);
    setBusy(false);
    if (!r.ok) {
      setError(r.reason ?? 'could not switch engine');
      return;
    }
    await load();
    onChange();
  };

  const live = status.chain.available;

  return (
    <div className="engsw">
      <div className="nav-label">Engine</div>

      <div className="engsw-opts" role="radiogroup" aria-label="Engine">
        <button
          role="radio"
          aria-checked={status.mode === 'simulator'}
          className="engsw-opt"
          disabled={busy}
          onClick={() => void pick('simulator')}
        >
          <IconLock size={13} />
          <span className="engsw-name">Simulator</span>
          <span className="engsw-sub">in memory · no proof</span>
        </button>

        <button
          role="radio"
          aria-checked={status.mode === 'onchain'}
          className="engsw-opt"
          disabled={busy || !live}
          title={
            live
              ? `${status.chain.network} · ${status.chain.contractAddress}`
              : `no on-chain service at ${status.chainUrl}`
          }
          onClick={() => void pick('onchain')}
        >
          <IconGlobe size={13} />
          <span className="engsw-name">
            {live ? status.chain.network : 'On chain'}
          </span>
          <span className="engsw-sub">
            {live ? 'real proof · real tx' : 'service not running'}
          </span>
        </button>
      </div>

      {status.mode === 'onchain' && (
        <p className="engsw-note">
          Each action now generates a zero-knowledge proof and waits for a block.
          Expect tens of seconds, not milliseconds.
        </p>
      )}
      {error && <p className="engsw-err">{error}</p>}
    </div>
  );
}
