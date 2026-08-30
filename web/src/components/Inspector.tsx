// The state inspector: the two trust domains, side by side, always visible.
// This is the teaching device of the whole interface — a reader should never
// have to ask which side of the boundary a value sits on.

import type { DemoState, HolderView } from '../api.js';
import { IconLock, IconGlobe } from './Icons.js';

const short = (h: string, n = 8) =>
  h.length > n * 2 ? `${h.slice(0, n)}…${h.slice(-n)}` : h;

// Timestamps cross the wire in SECONDS, because that is the unit the
// contract's blockTime comparisons use. JavaScript's Date wants
// milliseconds, so the conversion happens here, at the one place that
// renders them.
const day = (seconds: string) =>
  new Date(Number(seconds) * 1000).toISOString().slice(0, 10);

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="kv-row">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

/** What the active persona holds that the chain must never see. */
export function PrivateRegister({
  persona,
  holder,
  issuerName,
}: {
  persona: 'issuer' | 'holder' | 'verifier';
  holder?: HolderView;
  issuerName: string;
}) {
  return (
    <section className="reg private">
      <div className="reg-head">
        <IconLock size={13} />
        <span>Private</span>
        <span className="where">never leaves the device</span>
      </div>

      {persona === 'issuer' && (
        <div className="kv">
          <Row k="custodian" v={issuerName} />
          <Row k="signing key" v={<span className="sealed"><IconLock size={11} /> jubjub sk · withheld</span>} />
          <Row k="used for" v="attestation + revocation" />
        </div>
      )}

      {persona === 'holder' && (
        holder?.privateAttributes ? (
          <div className="kv">
            <Row k="secret" v={<span className="sealed"><IconLock size={11} /> 32 bytes · withheld</span>} />
            <Row k="blinding" v={<span className="sealed"><IconLock size={11} /> 32 bytes · withheld</span>} />
            <Row k="born" v={day(holder.privateAttributes.birthTimestamp)} />
            <Row k="country" v={holder.privateAttributes.countryCode} />
            <Row k="kyc tier" v={holder.privateAttributes.kycTier} />
            <Row k="expires" v={day(holder.privateAttributes.expiresAt)} />
            <Row
              k="path"
              v={holder.pathFresh
                ? <span className="chip ok"><i className="dot" />current</span>
                : <span className="chip warn"><i className="dot" />stale</span>}
            />
          </div>
        ) : (
          <p className="empty-note">
            No credential held. Issue one and the attribute values appear
            here — on the holder&rsquo;s side of the line, where they stay.
          </p>
        )
      )}

      {persona === 'verifier' && (
        <p className="empty-note">
          Nothing. A verifier holds no secrets and learns no attribute values —
          only whether the predicate held, and a nullifier scoped to itself.
          This panel stays empty by design.
        </p>
      )}
    </section>
  );
}

/** What anyone can read off the chain. */
export function PublicRegister({ state }: { state: DemoState }) {
  const p = state.public;
  return (
    <section className="reg public">
      <div className="reg-head">
        <IconGlobe size={13} />
        <span>Public</span>
        <span className="where">on chain, world-readable</span>
      </div>
      <div className="kv">
        <Row k="issuers" v={p.issuers.length ? p.issuers.join(', ') : '—'} />
        <Row k="root" v={<span title={p.merkleRoot}>{short(p.merkleRoot)}</span>} />
        <Row k="leaves" v={p.nextLeafIndex} />
        <Row k="epoch" v={p.revocationEpoch} />
        <Row k="admin" v={<span title={p.admin}>{short(p.admin, 6)}</span>} />
        <Row
          k="nullifiers"
          v={
            p.spentNullifiers.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {p.spentNullifiers.map((n) => (
                  <span key={n} title={n}>{short(n, 7)}</span>
                ))}
              </div>
            ) : '—'
          }
        />
      </div>
    </section>
  );
}
