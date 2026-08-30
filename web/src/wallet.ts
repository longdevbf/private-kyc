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

/** tNIGHT and tDUST carry six decimal places, the way the faucet shows them. */
export function formatUnits(v: bigint, decimals = 6): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
