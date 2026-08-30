// =====================================================================
// Live network endpoints
// =====================================================================
// Taken from the Midnight docs' "Networks and environments" page and then
// checked by hand: every host below resolves and answers (HTTP 405 to a
// GET, which is correct for a POST-only JSON-RPC or GraphQL endpoint).
//
// The `testnet-02` endpoints that older tutorials use are retired and no
// longer resolve at all -- see RESEARCH.md §G.1.
// =====================================================================

import { NetworkId as ZswapNetworkId } from '@midnight-ntwrk/zswap';

export type NetworkName = 'preview' | 'preprod' | 'undeployed';

export type NetworkConfig = {
  name: NetworkName;
  /** The identifier midnight-js is told to use. */
  networkId: string;
  /** The identifier the wallet is told to use. */
  zswapNetworkId: ZswapNetworkId;
  node: string;
  indexer: string;
  indexerWs: string;
  /** Where to get tDUST. Not automatable: it is a web form. */
  faucet?: string;
};

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  preview: {
    name: 'preview',
    networkId: 'preview',
    zswapNetworkId: ZswapNetworkId.TestNet,
    node: 'https://rpc.preview.midnight.network',
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWs: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
  },
  preprod: {
    name: 'preprod',
    networkId: 'preprod',
    zswapNetworkId: ZswapNetworkId.TestNet,
    node: 'https://rpc.preprod.midnight.network',
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWs: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
  },
  undeployed: {
    name: 'undeployed',
    networkId: 'undeployed',
    zswapNetworkId: ZswapNetworkId.Undeployed,
    node: 'http://localhost:9944',
    indexer: 'http://localhost:8088/api/v4/graphql',
    indexerWs: 'ws://localhost:8088/api/v4/graphql/ws',
  },
};

/** Locally hosted, per the support matrix. Never a remote prover. */
export const PROOF_SERVER = process.env.PROOF_SERVER ?? 'http://localhost:6300';

export function resolveNetwork(name: string | undefined): NetworkConfig {
  const key = (name ?? 'preview') as NetworkName;
  const cfg = NETWORKS[key];
  if (!cfg) {
    throw new Error(
      `unknown network "${name}". Expected one of: ${Object.keys(NETWORKS).join(', ')}`,
    );
  }
  return cfg;
}
