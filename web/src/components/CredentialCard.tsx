import { useState } from 'react';
import type { HolderView } from '../api.js';
import { useTilt } from './useTilt.js';
import { IconLock, IconGlobe } from './Icons.js';

const day = (ms: string) => new Date(Number(ms)).toISOString().slice(0, 10);

const COUNTRY: Record<string, string> = {
  '704': 'VNM', '840': 'USA', '392': 'JPN', '410': 'KOR',
  '702': 'SGP', '276': 'DEU', '250': 'FRA', '826': 'GBR',
};

/** Guilloche — the interference pattern on a printed security document.
 *  Two families of rotated ellipses, drawn once and tiled by CSS. */
function Guilloche() {
  return (
    <svg className="cc-guilloche" viewBox="0 0 400 240" aria-hidden="true">
      <defs>
        <radialGradient id="ccFade" cx="30%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#fff" stopOpacity=".55" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="ccMask">
          <rect width="400" height="240" fill="url(#ccFade)" />
        </mask>
      </defs>
      <g mask="url(#ccMask)" fill="none" stroke="currentColor" strokeWidth=".5">
        {Array.from({ length: 22 }, (_, i) => (
          <ellipse
            key={`a${i}`}
            cx="120" cy="120" rx={30 + i * 7} ry={92 - i * 1.5}
            transform={`rotate(${i * 8} 120 120)`}
          />
        ))}
        {Array.from({ length: 14 }, (_, i) => (
          <ellipse
            key={`b${i}`}
            cx="300" cy="150" rx={20 + i * 9} ry={64 - i * 2}
            transform={`rotate(${-i * 12} 300 150)`}
          />
        ))}
      </g>
    </svg>
  );
}

/** The contact pad on a smartcard. Pure geometry, no bitmap. */
function Chip() {
  return (
    <svg className="cc-chip" viewBox="0 0 34 26" aria-hidden="true">
      <rect x=".6" y=".6" width="32.8" height="24.8" rx="3.4" />
      <path d="M12 .6V8H2M12 25.4V18H2M22 .6V8h10M22 25.4V18h10M12 8h10v10H12z" />
    </svg>
  );
}

/**
 * The credential as an object you can hold and turn over.
 *
 * The two faces carry the argument of the whole project. The front is what
 * the holder has: real attribute values, in amber, the private hue. The back
 * is what the chain has: one commitment, in cyan. Turning the card is the
 * fastest way to show that the second cannot be run backwards into the first.
 */
export function CredentialCard({
  holder,
  issuerName,
  revoked = false,
}: {
  holder: HolderView;
  issuerName: string;
  revoked?: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const tilt = useTilt(9);
  const a = holder.privateAttributes;

  return (
    <div className="cc-stage">
      <div
        ref={tilt.ref}
        className={`cc${flipped ? ' is-flipped' : ''}${revoked ? ' is-revoked' : ''}`}
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
      >
        {/* ---------------------------------------------------- front */}
        <div className="cc-face cc-front">
          <Guilloche />
          <span className="cc-holo" />
          <span className="cc-edge" />

          <div className="cc-top">
            <span className="cc-crest">
              <IconLock size={12} />
            </span>
            <span className="cc-issuer">
              <b>{issuerName}</b>
              <i>bearer credential · v1</i>
            </span>
            <span className="cc-mock">MOCK</span>
          </div>

          <div className="cc-name">{holder.name}</div>
          <div className="cc-label">{holder.label ?? 'unlabelled credential'}</div>

          {a ? (
            <div className="cc-attrs">
              <span><i>born</i><b>{day(a.birthTimestamp)}</b></span>
              <span><i>country</i><b>{COUNTRY[a.countryCode] ?? a.countryCode}</b></span>
              <span><i>kyc tier</i><b>{a.kycTier}</b></span>
              <span><i>expires</i><b>{day(a.expiresAt)}</b></span>
            </div>
          ) : (
            <div className="cc-attrs muted">attributes unavailable</div>
          )}

          <div className="cc-foot">
            <Chip />
            <span className="cc-strip">
              <IconLock size={10} /> private · never leaves the device
            </span>
          </div>

          {revoked && <span className="cc-stamp">REVOKED</span>}
        </div>

        {/* ----------------------------------------------------- back */}
        <div className="cc-face cc-back">
          <span className="cc-mag" />
          <div className="cc-top">
            <span className="cc-crest pb"><IconGlobe size={12} /></span>
            <span className="cc-issuer">
              <b>what the chain holds</b>
              <i>public state · world-readable</i>
            </span>
          </div>

          <div className="cc-hex">
            <span className="cc-hex-k">commitment</span>
            <span className="cc-hex-v">
              {(holder.commitment.match(/.{1,8}/g) ?? []).map((g, i) => (
                <em key={i}>{g}</em>
              ))}
            </span>
          </div>

          <div className="cc-attrs pb">
            <span><i>leaf</i><b>{holder.leafIndex ?? '—'}</b></span>
            <span><i>in active set</i><b>{holder.merklePath ? 'yes' : 'no'}</b></span>
          </div>

          <p className="cc-note">
            This is the entire public record of the credential. It is a hiding
            commitment: the values on the front cannot be recovered from it,
            and it is binding, so they cannot be changed behind it either.
          </p>
        </div>
      </div>

      <button className="cc-turn" onClick={() => setFlipped((f) => !f)}>
        {flipped ? 'Show what the holder keeps' : 'Show what the chain sees'}
      </button>
    </div>
  );
}
