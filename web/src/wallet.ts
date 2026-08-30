// =====================================================================
// Browser wallet, over the Midnight DApp Connector API
// =====================================================================
// Types here mirror `@midnight-ntwrk/dapp-connector-api` v4.0.1 exactly.
// They are declared rather than imported for one reason: the package
// contributes nothing at runtime -- it is types plus a `window.midnight`
// declaration -- and a wallet either injects that object or it does not.
// Declaring the shape keeps the dependency list honest about what is
// actually being used.
//
// The v4 API is the one preview and preprod wallets implement. It differs
// from v3 in ways that matter here: `enable()` is gone in favour of
// `connect(networkId)`, and `state()` is gone in favour of the granular
// getters below.
// =====================================================================

export type ConnectedWallet = {
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  getShieldedAddresses(): Promise<{
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }>;
  getDustAddress(): Promise<{ dustAddress: string }>;
  getUnshieldedBalances(): Promise<Record<string, bigint>>;
  getShieldedBalances(): Promise<Record<string, bigint>>;
  getDustBalance(): Promise<{ cap: bigint; balance: bigint }>;
  getConnectionStatus(): Promise<
    { status: 'connected'; networkId: string } | { status: 'disconnected' }
  >;
  getConfiguration(): Promise<{
    indexerUri: string;
    indexerWsUri: string;
    substrateNodeUri: string;
    networkId: string;
    proverServerUri?: string;
  }>;
  /** Takes Transaction<SignatureEnabled, Proof, PreBinding> as hex. */
  balanceUnsealedTransaction(
    tx: string,
    options?: { payFees?: boolean },
  ): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<void>;
  hintUsage(methodNames: string[]): Promise<void>;
};

/**
 * The error shape the connector throws.
 *
 * Deliberately not a class extending Error: the published package says so,
 * and says why -- `instanceof` cannot work reliably across the extension
 * boundary. The documented check is `error.type === 'DAppConnectorAPIError'`,
 * so that is the check used here.
 */
export type WalletApiError = Error & {
  type: 'DAppConnectorAPIError';
  code: 'InternalError' | 'Rejected' | 'InvalidRequest' | 'PermissionRejected' | 'Disconnected';
  reason: string;
};

function isWalletApiError(e: unknown): e is WalletApiError {
  return Boolean(e) && (e as WalletApiError).type === 'DAppConnectorAPIError';
}

/**
 * Turn a wallet failure into a sentence that says what to do next.
 *
 * Without this the UI shows whatever string the extension happened to put
 * in `message`, and the two failures a person actually hits -- declining a
 * prompt, and not having granted a permission -- are indistinguishable
 * from a bug in this demo.
 */
export function explainWalletError(e: unknown): string {
  if (!isWalletApiError(e)) return e instanceof Error ? e.message : String(e);
  switch (e.code) {
    case 'Rejected':
      return 'you declined the request in the wallet';
    case 'PermissionRejected':
      return 'the wallet has not been given permission for this action';
    case 'Disconnected':
      return 'the wallet disconnected — connect it again';
    case 'InvalidRequest':
      return `the wallet rejected the request as malformed: ${e.reason}`;
    case 'InternalError':
      return `the wallet failed to process the request: ${e.reason}`;
    default:
      // A code this build has not seen. Show it rather than swallowing it:
      // an unknown code is information, and the connector API is versioned.
      return `${e.code}: ${e.reason}`;
  }
}

export type WalletHandle = {
  /** Reverse-DNS identifier, e.g. `io.lace`. Stable across releases. */
  rdns: string;
  /** Display name. Wallet-supplied, so render as text, never as HTML. */
  name: string;
  /** URL or data URL. Render in an <img>, never inlined as markup. */
  icon: string;
  apiVersion: string;
  connect(networkId: string): Promise<ConnectedWallet>;
};

declare global {
  interface Window {
    midnight?: Record<string, WalletHandle>;
  }
}

/**
 * Every wallet currently injected.
 *
 * Injection is not synchronous with page load -- an extension can install
 * itself after React has already rendered -- so callers poll rather than
 * reading once and concluding no wallet exists.
 */
export function discoverWallets(): WalletHandle[] {
  const injected = window.midnight;
  if (!injected) return [];
  return Object.values(injected).filter(
    (w): w is WalletHandle =>
      Boolean(w) && typeof (w as WalletHandle).connect === 'function',
  );
}

/**
 * Format an atomic-unit balance for display.
 *
 * The six-decimal default is an UNVERIFIED assumption -- see the note on
 * `formatDust` in onchain/src/wallet.ts. Balances shown through this may be
 * off by a power of ten; nothing computed depends on it.
 */
export function formatUnits(v: bigint, decimals = 6): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
