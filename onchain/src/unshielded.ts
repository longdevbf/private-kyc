// =====================================================================
// Unshielded address derivation
// =====================================================================
// The faucet dispenses tNIGHT, which is an UNSHIELDED token, and it
// rejects shielded addresses outright ("Provided address is invalid").
// The address it wants looks like `mn_addr_preview1...` -- note that the
// human-readable part carries the network NAME, not the generic `test`
// that @midnight-ntwrk/wallet produces for its shielded addresses.
//
// So the same seed has to be taken down a different derivation path:
//
//   HDWallet.fromSeed(seed)
//     .selectAccount(0)
//     .selectRole(Roles.NightExternal)
//     .deriveKeyAt(0)
//   -> createKeystore(key, networkId) -> getBech32Address()
//
// Note the npm org here is `@midnightntwrk` with no hyphen, which is a
// different org from the `@midnight-ntwrk` packages used elsewhere in this
// package. Both are real and both are needed.
// =====================================================================

import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnightntwrk/wallet-sdk-unshielded-wallet';

export type UnshieldedIdentity = {
  /** Bech32m, what the faucet wants. */
  address: string;
  /** Hex form, what the ledger uses internally. */
  addressHex: string;
  /** Kept so the same identity can later sign the DUST registration. */
  secretKey: Uint8Array;
};

/**
 * Derive the unshielded identity for a seed on a given network.
 *
 * `account` and `index` are both 0, matching what a wallet shows as the
 * first receiving address. Changing either produces a different, equally
 * valid address -- but then the faucet would fund one the deployer is not
 * watching, so they are fixed here rather than made configurable.
 */
export function deriveUnshielded(seedHex: string, networkId: string): UnshieldedIdentity {
  const seed = Uint8Array.from(Buffer.from(seedHex, 'hex'));

  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') {
    throw new Error(`seed rejected by HDWallet: ${JSON.stringify(hd)}`);
  }

  const derived = hd.hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);
  if (derived.type !== 'keyDerived') {
    throw new Error(`key derivation failed: ${derived.type}`);
  }

  const keystore = createKeystore(derived.key, networkId as never);

  // Clear the root key material once the leaf key is out, as the SDK asks.
  hd.hdWallet.clear();

  return {
    address: String(keystore.getBech32Address()),
    addressHex: String(keystore.getAddress()),
    secretKey: derived.key,
  };
}
