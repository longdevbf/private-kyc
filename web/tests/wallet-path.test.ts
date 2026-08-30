// =====================================================================
// The browser-wallet path, with the wallet stubbed
// =====================================================================
// These tests do NOT touch a chain and do NOT drive a circuit, which is
// why they are not in `tests/` -- that suite's claim is that nothing in it
// is stubbed, and it needs to stay true.
//
// What they do cover is the ordering property `runViaWallet` documents and
// which nothing else can check: the backend is told to commit the
// off-chain half of an action ONLY after the wallet reports a successful
// submission. Get that wrong and abandoning a wallet prompt leaves a
// holder secret recorded for a credential that was never issued.
//
// Running this against a real Lace extension is still required, and still
// outstanding. A stub cannot tell you the extension implements the API it
// documents; it can only tell you this side calls it in the right order.
// =====================================================================

import { describe, expect, it, beforeEach, vi } from 'vitest';

import { runViaWallet } from '../src/api.js';
import { explainWalletError } from '../src/wallet.js';

/** The calls the backend saw, in the order it saw them. */
let calls: { path: string; body: any }[];

function backend(prepare: unknown) {
  return vi.fn(async (path: string, init: any) => {
    calls.push({ path, body: JSON.parse(init.body) });
    const answer = path === '/api/chain/prepare' ? prepare : { ok: true };
    return { json: async () => answer } as unknown as Response;
  });
}

const PREPARED = {
  ok: true,
  txHex: 'deadbeef',
  circuit: 'present',
  proveMs: 1234,
};

/** A wallet that does what it is asked. */
function goodWallet() {
  return {
    balanceUnsealedTransaction: vi.fn(async (tx: string) => ({ tx: `${tx}-balanced` })),
    submitTransaction: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  calls = [];
});

describe('runViaWallet', () => {
  it('proves on the backend, balances and submits in the wallet, then confirms', async () => {
    global.fetch = backend(PREPARED) as never;
    const wallet = goodWallet();

    const result = await runViaWallet(wallet, { action: 'present', holderName: 'Alice' });

    expect(result.ok).toBe(true);

    // The wallet balances what the backend proved, and submits what the
    // wallet balanced -- not the other way round, and not the unbalanced
    // transaction.
    expect(wallet.balanceUnsealedTransaction).toHaveBeenCalledWith('deadbeef');
    expect(wallet.submitTransaction).toHaveBeenCalledWith('deadbeef-balanced');

    expect(calls.map((c) => c.path)).toEqual([
      '/api/chain/prepare',
      '/api/chain/confirm',
    ]);
    // Confirm identifies the transaction by the hex that was prepared, and
    // carries the proving time, which the wallet does not know.
    expect(calls[1].body).toEqual({ txHex: 'deadbeef', proveMs: 1234 });
  });

  it('reports the proving time it was given rather than inventing one', async () => {
    global.fetch = backend(PREPARED) as never;
    const result = await runViaWallet(goodWallet(), { action: 'present' });
    expect(result.receipt?.proveMs).toBe(1234);
    expect(result.receipt?.circuit).toBe('present');
  });

  it('commits nothing when the wallet refuses to balance', async () => {
    global.fetch = backend(PREPARED) as never;
    const wallet = goodWallet();
    wallet.balanceUnsealedTransaction = vi.fn(async () => {
      throw new Error('user declined');
    });

    const result = await runViaWallet(wallet, { action: 'present' });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/refused to balance/);
    expect(result.reason).toMatch(/user declined/);
    expect(wallet.submitTransaction).not.toHaveBeenCalled();
    // The important half: no confirm, so the backend recorded nothing.
    expect(calls.map((c) => c.path)).toEqual(['/api/chain/prepare']);
  });

  it('commits nothing when the wallet refuses to submit', async () => {
    global.fetch = backend(PREPARED) as never;
    const wallet = goodWallet();
    wallet.submitTransaction = vi.fn(async () => {
      throw new Error('user declined');
    });

    const result = await runViaWallet(wallet, { action: 'present' });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/refused to submit/);
    expect(calls.map((c) => c.path)).toEqual(['/api/chain/prepare']);
  });

  it('never reaches the wallet when proving fails', async () => {
    global.fetch = backend({ ok: false, reason: 'leaf not present in the active set' }) as never;
    const wallet = goodWallet();

    const result = await runViaWallet(wallet, { action: 'present' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('leaf not present in the active set');
    expect(wallet.balanceUnsealedTransaction).not.toHaveBeenCalled();
    expect(wallet.submitTransaction).not.toHaveBeenCalled();
  });

  it('treats a prepare that succeeds without a transaction as a failure', async () => {
    // A backend that answers ok but omits txHex would otherwise have the
    // wallet balance `undefined`, and the error would surface from inside
    // the extension rather than from here.
    global.fetch = backend({ ok: true }) as never;
    const wallet = goodWallet();

    const result = await runViaWallet(wallet, { action: 'present' });

    expect(result.ok).toBe(true); // the backend's own answer is passed through
    expect(wallet.balanceUnsealedTransaction).not.toHaveBeenCalled();
  });
});

describe('explainWalletError', () => {
  const apiError = (code: string, reason: string) =>
    Object.assign(new Error('some internal string'), {
      type: 'DAppConnectorAPIError',
      code,
      reason,
    });

  it('says what a declined prompt is, rather than showing the raw message', () => {
    expect(explainWalletError(apiError('Rejected', 'user said no')))
      .toBe('you declined the request in the wallet');
  });

  it('distinguishes a missing permission from a refusal', () => {
    expect(explainWalletError(apiError('PermissionRejected', 'no grant')))
      .toMatch(/permission/);
  });

  it('keeps the wallet reason when the wallet itself failed', () => {
    expect(explainWalletError(apiError('InternalError', 'prover unavailable')))
      .toMatch(/prover unavailable/);
  });

  it('surfaces an unrecognised code instead of swallowing it', () => {
    // The connector API is versioned; a code this build has never seen is
    // information, not noise.
    expect(explainWalletError(apiError('SomethingNew', 'from a later API')))
      .toBe('SomethingNew: from a later API');
  });

  it('passes ordinary errors through untouched', () => {
    expect(explainWalletError(new Error('network down'))).toBe('network down');
  });
});
