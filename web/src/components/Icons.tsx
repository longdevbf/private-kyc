// Inline SVG, drawn on a 16px grid at 1.5 stroke so they sit correctly
// against 12–13px mono text. No icon font, no emoji.

type P = { size?: number };
const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/** Issuer — a seal being stamped. */
export const IconIssuer = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="8" cy="6" r="3.2" />
    <path d="M5.6 8.9 4.8 14l3.2-1.6 3.2 1.6-.8-5.1" />
  </svg>
);

/** Holder — a wallet holding something closed. */
export const IconHolder = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="1.8" y="3.8" width="12.4" height="8.6" rx="1.6" />
    <path d="M1.8 6.6h12.4" />
    <circle cx="11.2" cy="9.6" r="0.9" />
  </svg>
);

/** Verifier — an eye that checks, not one that watches. */
export const IconVerifier = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8Z" />
    <path d="m6.4 8 1.2 1.3 2.4-2.6" />
  </svg>
);

export const IconLock = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="3.2" y="7" width="9.6" height="6.4" rx="1.4" />
    <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
  </svg>
);

export const IconGlobe = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4M8 1.8c1.7 1.8 2.6 4 2.6 6.2S9.7 12.4 8 14.2C6.3 12.4 5.4 10.2 5.4 8S6.3 3.6 8 1.8Z" />
  </svg>
);

export const IconCheck = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="m5.4 8.2 1.8 1.8 3.4-3.8" />
  </svg>
);

export const IconCross = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="m6 6 4 4M10 6l-4 4" />
  </svg>
);

export const IconRefresh = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8" />
    <path d="M13.6 2.6v3.2h-3.2" />
  </svg>
);

export const IconInbox = ({ size = 24 }: P) => (
  <svg {...base(size)}>
    <path d="M1.8 9.2h3.6l1 1.8h3.2l1-1.8h3.6" />
    <path d="M3.4 3.4h9.2l1.8 5.8v3.6a1.4 1.4 0 0 1-1.4 1.4H3a1.4 1.4 0 0 1-1.4-1.4V9.2Z" />
  </svg>
);

/** A leaf sitting in a tree — used for the Merkle path. */
export const IconTree = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M8 2v3.4M8 5.4 4 8.2v2M8 5.4l4 2.8v2" />
    <circle cx="8" cy="1.9" r="1.1" />
    <circle cx="4" cy="11.4" r="1.1" />
    <circle cx="12" cy="11.4" r="1.1" />
  </svg>
);
