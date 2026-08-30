// =====================================================================
// Deploy the credential lifecycle engine to a live Midnight network
// =====================================================================
//   npx tsx src/deploy.ts preview
//   npx tsx src/deploy.ts preprod
//
// Prerequisites, all of which this script checks rather than assumes:
//   * the contract is built            (npm run build, produces managed/)
//   * a local proof server is running  (../scripts/proof-server.sh start)
//   * the wallet holds NIGHT registered for DUST generation
//                                      (npx tsx src/register-dust.ts <net>)
//
// On success the contract address and the deploy transaction are written
// to deployments/<network>.json, which is the only thing the web UI will
// treat as evidence that a deployment happened.
// =====================================================================

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import * as CompiledContract from '@midnight-ntwrk/compact-js/effect/CompiledContract';

import { Contract } from '../managed/contract/index.js';
import { resolveNetwork, PROOF_SERVER } from './network.js';
import { loadOrCreateAuthority } from './authority.js';
import { loadOrCreateSeed, ONCHAIN_ROOT } from './wallet.js';
import { openFacade, saveWalletCache, waitSynced } from './facade.js';
import { buildProviders } from './providers.js';
import { bytes32, blankPrivateState, type PrivateState } from './engine.js';

// ---------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------

const cfg = resolveNetwork(process.argv[2]);
const MANAGED = join(ONCHAIN_ROOT, 'managed');
const PRIVATE_STATE_ID = 'credential-lifecycle';

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!existsSync(join(MANAGED, 'keys'))) {
  fail(
    'managed/keys is missing, so there are no proving keys to deploy with.\n' +
      'Build the contract first:  cd onchain && npm run build',
  );
}

const proofCode = await fetch(PROOF_SERVER)
  .then((r) => r.status)
  .catch(() => 0);
if (proofCode === 0) {
  fail(
    `no proof server answering at ${PROOF_SERVER}.\n` +
      'Start one:  bash scripts/proof-server.sh start',
  );
}

// midnight-js reads this global when building transactions. Setting it
// wrong produces transactions the node rejects for reasons that do not
// mention the network, so it is set explicitly and early.
setNetworkId(cfg.networkId);

// ---------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------

const seed = loadOrCreateSeed(cfg.name);
const open = await openFacade(cfg, seed);

try {
  console.log('\nsyncing wallet — a fresh wallet scans the whole chain');
  await waitSynced(open);
  const st: any = await open.wallet.waitForSyncedState();
  console.log('synced');
  await saveWalletCache(cfg, open);

  // DustWalletState.balance is a function of time -- dust accrues -- so it
  // is asked for a moment, not read as a field.
  const nightUtxos: any[] = [...(st.unshielded?.availableCoins ?? [])];
  const registered = nightUtxos.filter((u) => u.meta?.registeredForDustGeneration);
  const dustBalance: bigint = st.dust?.balance ? st.dust.balance(new Date()) : 0n;

  console.log(`\naddress      ${open.address}`);
  console.log(`NIGHT utxos  ${nightUtxos.length} (${registered.length} registered for DUST)`);
  console.log(`DUST         ${dustBalance}`);

  if (dustBalance === 0n) {
    fail(
      'This wallet holds no DUST, so it cannot pay for a deployment.\n' +
        'NIGHT does not pay fees; it has to be registered for DUST generation:\n' +
        `  npx tsx src/register-dust.ts ${cfg.name}\n` +
        (nightUtxos.length === 0 && cfg.faucet
          ? `and it needs NIGHT first — fund ${open.address}\nat ${cfg.faucet}\n`
          : ''),
    );
  }

  // -------------------------------------------------------------------
  // Providers
  // -------------------------------------------------------------------

  // The private state store is encrypted at rest and the library enforces a
  // password policy on it (16+ chars, 3 of 4 character classes). For a
  // testnet demo the password comes from the environment so it is never
  // committed; a fixed default keeps the happy path one command.
  const password =
    process.env.MIDNIGHT_PRIVATE_STATE_PASSWORD ?? 'Demo-Credential-Lifecycle-2026!';

  const providers = buildProviders(cfg, open, {
    managedDir: MANAGED,
    privateStateId: PRIVATE_STATE_ID,
    password,
  });

  // -------------------------------------------------------------------
  // The contract
  // -------------------------------------------------------------------

  // The admin secret is what the contract checks preimage knowledge
  // against. Generated on first use into `.authority.<network>.json`, which
  // is gitignored: it is not derivable from anything published, and losing
  // the file means losing control of the deployment, because the digest is
  // sealed into ledger state and no circuit here can rotate it.
  const adminSecret = loadOrCreateAuthority(cfg.name).adminSecret;

  const initialPrivateState: PrivateState = {
    ...blankPrivateState(),
    localSecret: adminSecret,
  };

  // Witnesses are the DApp's own implementation, exactly as in the
  // simulator: they surface whatever is in private state.
  const witnesses = {
    localSecret: (ctx: any) => [ctx.privateState, ctx.privateState.localSecret],
    issuerSecret: (ctx: any) => [ctx.privateState, ctx.privateState.issuerSecret],
    attributes: (ctx: any) => [ctx.privateState, ctx.privateState.attributes],
    blinding: (ctx: any) => [ctx.privateState, ctx.privateState.blinding],
    merklePath: (ctx: any) => [ctx.privateState, ctx.privateState.merklePath],
  };

  // `withWitnesses` and `withCompiledFileAssets` type their second argument
  // with a conditional that reads the remaining requirements out of the
  // first. Once the pipeline's head is widened at all, that conditional has
  // nothing to match and collapses to `never`, so every later argument is
  // rejected. Widening the functions instead of their arguments keeps the
  // runtime behaviour identical and the error away.
  const make = CompiledContract.make as unknown as (t: string, c: unknown) => unknown;
  const withWitnesses = CompiledContract.withWitnesses as unknown as (
    self: unknown,
    w: unknown,
  ) => unknown;
  const withAssets = CompiledContract.withCompiledFileAssets as unknown as (
    self: unknown,
    p: string,
  ) => unknown;

  const compiledContract = withAssets(
    withWitnesses(make(PRIVATE_STATE_ID, Contract), witnesses),
    MANAGED,
  );

  // -------------------------------------------------------------------
  // Deploy
  // -------------------------------------------------------------------

  console.log('\ndeploying — this generates a real proof and can take a while');
  const started = Date.now();

  const deployed = await deployContract(providers as any, {
    compiledContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  } as any);

  const elapsed = Date.now() - started;
  const pub = (deployed as any).deployTxData.public;
  const address = pub.contractAddress;

  console.log(`\ndeployed in ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`contract     ${address}`);
  console.log(`tx           ${pub.txHash ?? pub.txId}`);
  console.log(`block        ${pub.blockHeight}`);

  const outDir = join(ONCHAIN_ROOT, 'deployments');
  mkdirSync(outDir, { recursive: true });
  const record = {
    network: cfg.name,
    networkId: cfg.networkId,
    contractAddress: address,
    txId: pub.txId,
    txHash: pub.txHash,
    blockHeight: pub.blockHeight === undefined ? undefined : String(pub.blockHeight),
    deployedAt: new Date().toISOString(),
    deployMs: elapsed,
    compiler: '0.31.1',
    languageVersion: '0.23.0',
    compactRuntime: '0.16.0',
    midnightJs: '4.1.1',
    proofServer: '8.1.0',
    node: cfg.node,
    indexer: cfg.indexer,
  };
  writeFileSync(join(outDir, `${cfg.name}.json`), JSON.stringify(record, null, 2) + '\n');
  console.log(`\nrecorded in onchain/deployments/${cfg.name}.json`);
} finally {
  await (open.wallet as any).stop?.();
}
