// Thin client over the demo backend. Every call reaches a real circuit.

import { explainWalletError } from './wallet.js';

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
  /** On chain only: time inside the proof server, and where it landed. */
  proveMs?: number;
  balanceMs?: number;
  txHash?: string;
  txId?: string;
  blockHeight?: string;
};

/** One network this contract has actually been deployed to. */
export type DeploymentRecord = {
  network: string;
  contractAddress: string;
  txId?: string;
  txHash?: string;
  blockHeight?: string;
  deployedAt: string;
  compiler: string;
  languageVersion: string;
  proofServer: string;
  indexer?: string;
};

/** One transaction this demo actually put on a network. */
export type ChainReceipt = {
  at: number;
  action: string;
  detail?: string;
  circuit: string;
  txId?: string;
  txHash?: string;
  blockHeight?: string;
  totalMs: number;
  proveMs?: number;
  balanceMs?: number;
};

export type DemoState = {
  mockWarning: string;
  issuerRegistered: boolean;
  issuerName: string;
  /** What this instance is, so the UI never has to guess. */
  engine: {
    mode: 'simulator' | 'onchain';
    proofsGenerated: boolean;
    timingMeans: string;
    runtime: string;
    /** Present only when the on-chain engine is driving. */
    network?: string;
    contractAddress?: string;
    feePayer?: string;
    node?: string;
    indexer?: string;
  };
  deployments: DeploymentRecord[];
  public: PublicState;
  credentials: CredentialView[];
  holders: HolderView[];
  presentations: Presentation[];
  /** Present only on chain: every transaction, newest first. */
  receipts?: ChainReceipt[];
};

export type Result = {
  ok: boolean;
  reason?: string;
  ms?: number;
  /** On chain: the receipt for the transaction this action produced. */
  receipt?: {
    circuit: string;
    txId?: string;
    txHash?: string;
    blockHeight?: string;
    totalMs: number;
    proveMs?: number;
    balanceMs?: number;
  };
  presentation?: Presentation;
};

/** Which engine is driving, and whether the on-chain one is reachable. */
export type EngineStatus = {
  mode: 'simulator' | 'onchain';
  chainUrl: string;
  chain: {
    available: boolean;
    network?: string;
    contractAddress?: string;
    walletAddress?: string;
    reason?: string;
  };
};

async function post(path: string, body?: unknown): Promise<Result> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return (await r.json()) as Result;
}

/**
 * Run one lifecycle action, paid for and relayed by a connected wallet.
 *
 * Three hops, and each one is somebody different's job:
 *
 *   1. the demo backend builds the call and PROVES it, producing a
 *      Transaction<SignatureEnabled, Proof, PreBinding>;
 *   2. the wallet balances it -- adding the fee from the visitor's own
 *      DUST -- and seals it;
 *   3. the wallet submits it.
 *
 * Step 3 is where it becomes irreversible, so the backend is only told to
 * commit the off-chain half of the action (a new holder's secret, say)
 * after the wallet reports the submission succeeded. Abandoning the wallet
 * prompt therefore leaves no trace, which is the correct outcome.
 */
export async function runViaWallet(
  wallet: { balanceUnsealedTransaction(tx: string): Promise<{ tx: string }>; submitTransaction(tx: string): Promise<void> },
  action: Record<string, unknown>,
): Promise<Result> {
  const started = Date.now();

  const prepared = (await post('/api/chain/prepare', action)) as Result & {
    txHex?: string;
    circuit?: string;
    proveMs?: number;
  };
  if (!prepared.ok || !prepared.txHex) return prepared;

  let balanced: { tx: string };
  try {
    balanced = await wallet.balanceUnsealedTransaction(prepared.txHex);
  } catch (e) {
    return { ok: false, reason: `the wallet refused to balance it: ${msg(e)}` };
  }

  try {
    await wallet.submitTransaction(balanced.tx);
  } catch (e) {
    // Send what the wallet built to the backend to be described. The
    // failure that motivated this is invisible from either side alone: the
    // transaction handed to the wallet is known good -- the same bytes were
    // accepted when the demo's own wallet balanced them -- so whatever the
    // node objected to was introduced during balancing, and nothing showed
    // what that was. Best effort: a diagnostic must never replace the real
    // error, so this cannot throw and cannot change the message.
    void post('/api/chain/inspect', { txHex: balanced.tx }).catch(() => undefined);
    return { ok: false, reason: `the wallet refused to submit it: ${msg(e)}` };
  }

  await post('/api/chain/confirm', { txHex: prepared.txHex, proveMs: prepared.proveMs });

  // Shaped like every other result so the outcome banner and the trace
  // read it the same way, whoever paid for the transaction.
  //
  // `submitTransaction` on the connector returns void: the wallet relays
  // and does not wait for a block, so there is no hash and no height to
  // report here. They appear on the next state read, from the chain.
  return {
    ok: true,
    ms: Date.now() - started,
    receipt: {
      circuit: prepared.circuit ?? String(action.action ?? ''),
      totalMs: Date.now() - started,
      proveMs: prepared.proveMs,
    },
  };
}

// A wallet failure carries a documented `code` that says whether the person
// declined, lacks a permission, or hit a wallet bug. Reading it is the
// difference between "you declined the request in the wallet" and whatever
// free text the extension chose to put in `message`.
const msg = (e: unknown) => explainWalletError(e);

export const api = {
  state: async (): Promise<DemoState> => {
    let r: Response;
    try {
      r = await fetch('/api/state');
    } catch {
      // The demo backend itself is unreachable. Distinct from the backend
      // answering with a problem, and it sends the reader to a different
      // terminal, so it keeps its own message.
      throw new Error(
        'Cannot reach the contract host on port 4000. Start it with npm run dev:chain.',
      );
    }
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.reason ?? `state request failed (${r.status})`);
    }
    return r.json();
  },
  engine: async (): Promise<EngineStatus> => (await fetch('/api/engine')).json(),
  setEngine: (mode: 'simulator' | 'onchain') => post('/api/engine', { mode }),
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
