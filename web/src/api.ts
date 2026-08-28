// Thin client over the demo backend. Every call reaches a real circuit.

export type PublicState = {
  issuers: string[];
  merkleRoot: string;
  nextLeafIndex: string;
  revocationEpoch: string;
  spentNullifiers: string[];
  admin: string;
  chainTime: number;
};

export type MerklePathView = {
  leaf: string;
  entries: { sibling: string; goesLeft: boolean }[];
};

export type HolderView = {
  name: string;
  label?: string;
  commitment: string;
  hasCredential: boolean;
  pathFresh: boolean;
  merklePath: MerklePathView | null;
  /** The root the cached path folds to — not necessarily the current root. */
  pathRoot: string | null;
  leafIndex: string | null;
  privateAttributes: {
    birthTimestamp: string;
    countryCode: string;
    kycTier: string;
    expiresAt: string;
  } | null;
};

export type CredentialView = {
  commitment: string;
  leafIndex: string;
  label?: string;
  revoked: boolean;
};

export type Presentation = {
  at: number;
  verifierId: string;
  nullifier: string;
  predicate: string;
  accepted: boolean;
  reason?: string;
  ms: number;
};

export type DemoState = {
  mockWarning: string;
  issuerRegistered: boolean;
  issuerName: string;
  public: PublicState;
  credentials: CredentialView[];
  holders: HolderView[];
  presentations: Presentation[];
};

export type Result = { ok: boolean; reason?: string; ms?: number };

async function post(path: string, body?: unknown): Promise<Result> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return (await r.json()) as Result;
}

export const api = {
  state: async (): Promise<DemoState> => (await fetch('/api/state')).json(),
  reset: () => post('/api/reset'),
  registerIssuer: () => post('/api/issuer/register'),
  issue: (b: {
    holderName: string; label: string; ageYears: number;
    countryCode: number; kycTier: number; validDays: number;
  }) => post('/api/issuer/issue', b),
  revoke: (commitment: string) => post('/api/issuer/revoke', { commitment }),
  refreshPath: (holderName: string) => post('/api/holder/refresh', { holderName }),
  present: (b: {
    holderName: string; verifierId: string; predicateId: number;
    threshold: string; allowedCountries: number[];
  }) => post('/api/verifier/present', b),
};
