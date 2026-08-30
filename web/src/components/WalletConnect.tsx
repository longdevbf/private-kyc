import { useCallback, useEffect, useState } from 'react';
import type { DemoState } from '../api.js';
import {
  discoverWallets,
  formatUnits,
  type ConnectedWallet,
  type WalletHandle,
} from '../wallet.js';
import { IconGlobe, IconCheck, IconRefresh } from './Icons.js';

const short = (s: string, n = 10) =>
  s && s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s;

export type WalletSession = {
  handle: WalletHandle;
  api: ConnectedWallet;
  networkId: string;
  unshieldedAddress: string;
  dust: { balance: bigint; cap: bigint };
  night: bigint;
};

/**
 * Connect a real Midnight browser wallet, over DApp Connector API v4.
 *
 * What connecting buys, precisely: transactions prepared by the demo can
 * then be balanced and relayed by the visitor's own wallet, so the fee is
 * paid from their DUST and the submission is theirs. What it does not buy,
 * and the panel says so rather than implying otherwise: the zero-knowledge
 * proof is still produced by the demo's local proof server against the
 * proving keys in `onchain/managed`, and the holder's private attributes
 * still live in the demo backend.
 *
 * The network the wallet is asked for is the network the deployed contract
 * is on. Connecting to a different one would produce transactions the node
 * rejects for reasons that never mention the network, so the mismatch is
 * checked here and reported in those words.
 */
export function WalletConnect({
  state,
  session,
  onSession,
}: {
  state: DemoState;
  session: WalletSession | null;
  onSession: (s: WalletSession | null) => void;
}) {
  const [wallets, setWallets] = useState<WalletHandle[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wanted = state.engine?.network;

  useEffect(() => {
    // Extensions inject asynchronously, so this looks more than once
    // rather than concluding "no wallet" from the first empty read.
    const scan = () => setWallets(discoverWallets());
    scan();
    const t = setInterval(scan, 1500);
    return () => clearInterval(t);
  }, []);

  const readBalances = useCallback(
    async (handle: WalletHandle, api: ConnectedWallet): Promise<WalletSession> => {
      const status = await api.getConnectionStatus();
      if (status.status !== 'connected') throw new Error('the wallet reports it is disconnected');

      const [{ unshieldedAddress }, dust, unshielded] = await Promise.all([
        api.getUnshieldedAddress(),
        api.getDustBalance(),
        api.getUnshieldedBalances(),
      ]);

      // NIGHT is the native unshielded token. Summing the record avoids
      // hard-coding a token type that differs between networks.
      const night = Object.values(unshielded).reduce((a, b) => a + b, 0n);

      return {
        handle,
        api,
        networkId: status.networkId,
        unshieldedAddress,
        dust,
        night,
      };
    },
    [],
  );

  async function connect(handle: WalletHandle) {
    if (!wanted) {
      setError('Switch the engine to the deployed network first — there is nothing on chain to connect to.');
      return;
    }
    setBusy(handle.rdns);
    setError(null);
    try {
      const api = await handle.connect(wanted);
      // Asking up front lets the wallet gather every permission in one
      // prompt instead of interrupting later, mid-flow.
      await api.hintUsage([
        'getUnshieldedAddress',
        'getDustBalance',
        'getUnshieldedBalances',
        'balanceUnsealedTransaction',
        'submitTransaction',
      ]).catch(() => {});
      const s = await readBalances(handle, api);
      if (s.networkId !== wanted) {
        throw new Error(
          `the wallet connected to "${s.networkId}" but the contract is on "${wanted}". ` +
            'Switch networks in the wallet and try again.',
        );
      }
      onSession(s);
    } catch (e) {
      onSession(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function reread() {
    if (!session) return;
    setBusy('refresh');
    try {
      onSession(await readBalances(session.handle, session.api));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Your wallet</h2>
          <p>
            Connect a Midnight wallet and the transactions below are balanced and
            relayed by it — the fee comes out of your DUST, and the submission is
            yours. The proof is still produced by this demo's proof server, and the
            holder's private attributes still live in its backend.
          </p>
        </div>
      </div>

      <div className="panel-body">
        {!wanted && (
          <div className="wc-note">
            The simulator has no chain to connect to. Switch the engine to the
            deployed network in the sidebar first.
          </div>
        )}

        {wanted && !session && wallets.length === 0 && (
          <div className="empty">
            <IconGlobe size={26} />
            <span>
              No Midnight wallet is injected on this page. Install one — Lace has a
              Midnight preview build — then reload.
            </span>
          </div>
        )}

        {wanted && !session && wallets.length > 0 && (
          <div className="wc-list">
            {wallets.map((w) => (
              <button
                key={w.rdns}
                className="wc-item"
                disabled={busy !== null}
                onClick={() => void connect(w)}
              >
                {/* Wallet-supplied strings. The name goes in a text node
                    and the icon in an img src; neither is ever inlined as
                    markup. */}
                <img className="wc-icon" src={w.icon} alt="" width={22} height={22} />
                <span className="wc-name">{w.name}</span>
                <span className="wc-meta">
                  {w.rdns} · api {w.apiVersion}
                </span>
                <span className="wc-act">
                  {busy === w.rdns ? 'connecting…' : `connect to ${wanted}`}
                </span>
              </button>
            ))}
          </div>
        )}

        {session && (
          <>
            <div className="wc-live">
              <span className="chip ok">
                <i className="dot" />
                {session.handle.name} · {session.networkId}
              </span>
              <button className="btn quiet sm" disabled={busy !== null} onClick={() => void reread()}>
                <IconRefresh size={13} /> Refresh balances
              </button>
              <button className="btn quiet sm" onClick={() => onSession(null)}>
                Disconnect
              </button>
            </div>

            <dl className="cs-kv" style={{ marginTop: 14 }}>
              <dt>address</dt>
              <dd title={session.unshieldedAddress}>{short(session.unshieldedAddress)}</dd>
              <dt>NIGHT</dt>
              <dd>{formatUnits(session.night)}</dd>
              <dt>DUST</dt>
              <dd>
                {formatUnits(session.dust.balance)}
                <span className="sub"> of {formatUnits(session.dust.cap)} cap</span>
              </dd>
            </dl>

            {session.dust.balance === 0n && (
              <div className="wc-note warn" style={{ marginTop: 14 }}>
                This wallet holds no DUST, so it cannot pay a fee yet. NIGHT does not
                pay fees on its own — register it for DUST generation in the wallet
                first.
              </div>
            )}

            {session.dust.balance > 0n && (
              <div className="wc-note ok" style={{ marginTop: 14 }}>
                <IconCheck size={13} /> Ready. Actions marked “pay from my wallet” will
                be balanced and submitted by {session.handle.name}.
              </div>
            )}
          </>
        )}

        {error && <div className="wc-note warn" style={{ marginTop: 14 }}>{error}</div>}
      </div>
    </section>
  );
}
