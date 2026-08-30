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
/**
 * What the node's `Custom error: N` numbers mean.
 *
 * A wallet relays the node's refusal verbatim, so "Invalid Transaction:
 * Custom error: 182" is all a person sees — a number with no way to act on
 * it. Midnight publishes the table, in `midnightntwrk/midnight-expert` at
 * `plugins/midnight-status-codes/skills/status-codes/references/node-errors.md`.
 *
 * Only codes taken from that table are listed. An unlisted code is reported
 * as a number with a pointer to the table rather than guessed at.
 */
const NODE_ERROR_CODES: Record<number, string> = {
  117: 'the transaction was not in normal form — usually a fee that rounded to zero, leaving no DUST inputs',
  138: 'a token balance went negative once fees were applied — the DUST fee exceeded what the wallet had',
  173: 'not enough DUST to pay the registration fee',
  177: 'two intents claimed the same segment id',
  182: 'replay protection refused the intent. This code is retired in newer ledgers, where it splits into: TTL expired, TTL too far in the future, or an intent identifier that already exists',
  189: 'unshielded inputs were not sorted',
  192: 'the number of signatures did not match the number of inputs',
  228: 'the intent TTL had already expired',
  229: 'the intent TTL was too far in the future',
  230: 'an intent with that identifier already exists',
  242: 'the intent TTL expired between submission and validation',
  243: 'the intent TTL was too far ahead',
  244: 'an intent with that identifier already exists',
};

/**
 * Decode a node rejection if the text contains one.
 *
 * The wallet's own message is kept as well as the decoded meaning: the
 * wallet said where it failed, and the code says why the node refused.
 */
function explainNodeRejection(text: string): string | undefined {
  const m = text.match(/Custom error:\s*(\d+)/);
  if (!m) return undefined;
  const code = Number(m[1]);
  const known = NODE_ERROR_CODES[code];
  return known
    ? `the node refused it — ${known} (Custom error ${code})`
    : `the node refused it with Custom error ${code}, which is not in this build's table — look it up in midnight-expert's node-errors.md`;
}

export function explainWalletError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);

  // Both, because a connector error carries the node's words in `reason`
  // while `message` may be the wallet's own summary. The observed failure
  // put "Invalid Transaction: Custom error: 182" in the reason.
  const rejection = explainNodeRejection(
    isWalletApiError(e) ? `${text} ${e.reason}` : text,
  );
  if (rejection) return rejection;

  if (!isWalletApiError(e)) return text;
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
