// =====================================================================
// Sync once, then do everything that needs a synced wallet
// =====================================================================
//   npx tsx src/provision.ts preview
//   npx tsx src/provision.ts preprod
//
// register-dust.ts and deploy.ts each open a wallet and wait for a full
// sync. Run one after the other, that is two full scans of the chain.
//
// That is merely slow on preview, where the dust stream is about 176,000
// events. On preprod it is about 1,467,000, and doing it twice is the
// difference between an afternoon and a day. So this does both halves in
// one process, against one synced wallet:
//
//   1. wait for the sync, and cache the wallet state immediately
//   2. register NIGHT for DUST generation, if it is not already
//   3. wait until DUST actually arrives
//   4. deploy the contract, if it is not already deployed
//
// Every step is skippable and checks whether it is needed, so this is
// safe to re-run. A failure in a later step never costs the earlier ones.
// =====================================================================

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { join } from 'node:path';

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import * as CompiledContract from '@midnight-ntwrk/compact-js/effect/CompiledContract';

import { Contract } from '../managed/contract/index.js';
import { resolveNetwork, PROOF_SERVER } from './network.js';
import { loadOrCreateSeed, ONCHAIN_ROOT } from './wallet.js';
import { openFacade, saveWalletCache, waitSynced } from './facade.js';
import { buildProviders } from './providers.js';
import { readDeployment, deploymentPath } from './chain.js';
import { bytes32, blankPrivateState, type PrivateState } from './engine.js';

const cfg = resolveNetwork(process.argv[2]);
const MANAGED = join(ONCHAIN_ROOT, 'managed');
const PRIVATE_STATE_ID = 'credential-lifecycle';

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function step(n: number, title: string) {
  console.log(`\n${'─'.repeat(66)}\n${n}. ${title}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Is this a transport failure rather than the chain saying no?
 *
 * The two need different handling and they arrive looking similar. A
 * rejection from the node ("1010: Invalid Transaction") means the
 * transaction was seen and refused, and retrying it unchanged will be
 * refused again. A dropped socket means it may never have arrived.
 *
 * The node client connects on demand and disconnects when the submission
 * stream ends (`PolkadotNodeClient.sendMidnightTransaction`), so a closure
 * message in the cause chain is normal at the END of a submission and only
 * interesting when the send itself rejected.
 */
function isTransportFailure(e: unknown): boolean {
  // Rendered with `inspect` rather than by walking `.cause`. Effect wraps
  // failures in a FiberFailure whose cause chain is an Effect `Cause`
  // value, not a plain `Error.cause`, so the obvious loop stops at the
  // first link and reads only "Transaction submission error" -- which
  // matches neither branch below and silently classifies every transport
  // failure as a chain rejection. `inspect` renders the whole thing,
  // exactly as it appears in the log.
  const text = inspect(e, { depth: 8 });
  if (/Invalid Transaction|Custom error|BalanceCheck|Overspend/i.test(text)) return false;
  return /disconnect|Normal Closure|socket|ECONN|timeout|WebSocket/i.test(text);
}

/**
 * Submit something, and on a transport failure ask the chain whether it
 * landed anyway before trying again.
 *
 * Blind retries are wrong here: a submission that failed on the way back
 * may have succeeded on the way out. `verify` is what makes the retry
 * safe -- it reads the resulting state rather than assuming.
 */
async function submitWithRetry(
  label: string,
  attempt: () => Promise<string>,
  verify: () => Promise<boolean>,
  attempts = 4,
): Promise<string | 'already-done'> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (!isTransportFailure(e)) throw e;

      console.log(`   ${label}: attempt ${i} lost its connection — checking whether it landed`);
      await sleep(12_000);
      if (await verify()) {
        console.log(`   ${label}: it landed after all`);
        return 'already-done';
      }
      if (i === attempts) throw e;
      console.log(`   ${label}: it did not land, retrying`);
      await sleep(5_000);
    }
  }
  throw new Error('unreachable');
}

// ---------------------------------------------------------------------
// Preflight — cheap checks before an expensive sync
// ---------------------------------------------------------------------

if (!existsSync(join(MANAGED, 'keys'))) {
  fail(
    'managed/keys is missing, so there are no proving keys to deploy with.\n' +
      'Build the contract first:  cd onchain && npm run build',
  );
}

const proofCode = await fetch(PROOF_SERVER).then((r) => r.status).catch(() => 0);
if (proofCode === 0) {
  fail(
    `no proof server answering at ${PROOF_SERVER}.\n` +
      'Start one:  bash scripts/proof-server.sh start',
  );
}

setNetworkId(cfg.networkId);

const seed = loadOrCreateSeed(cfg.name);
const open = await openFacade(cfg, seed);
const { wallet, keystore } = open;

try {
  // -------------------------------------------------------------------
  step(1, 'Sync the wallet');
  await waitSynced(open);
  await wallet.waitForSyncedState();
  console.log('   synced');

  // Written before anything that can throw. A full scan costs tens of
  // minutes on preview and hours on preprod; losing it to a later error
  // is the exact failure this cache exists to prevent.
  await saveWalletCache(cfg, open);
  console.log('   wallet state cached — later runs start in seconds');

  // -------------------------------------------------------------------
  step(2, 'Register NIGHT for DUST generation');

  const dustNow = async (): Promise<bigint> => {
    const s: any = await wallet.waitForSyncedState();
    return s.dust?.balance ? s.dust.balance(new Date()) : 0n;
  };

  // UtxoWithMeta is { utxo, meta }; the registration flag is on `meta`.
  // Read one level up and every utxo looks unregistered, because
  // `undefined !== true`.
  const unregisteredNow = async (): Promise<any[]> => {
    const st: any = await wallet.waitForSyncedState();
    const night: any[] = [...(st.unshielded?.availableCoins ?? [])];
    return night.filter((u) => u.meta?.registeredForDustGeneration !== true);
  };

  {
    const st: any = await wallet.waitForSyncedState();
    const night: any[] = [...(st.unshielded?.availableCoins ?? [])];
    console.log(`   NIGHT utxos    ${night.length}`);

    if (night.length === 0) {
      fail(
        'No NIGHT in this wallet, so it can never pay a fee.\n' +
          `Fund ${open.address}\n` +
          (cfg.faucet ? `at ${cfg.faucet}\n` : '') +
          'then run this again.',
      );
    }

    let unregistered = await unregisteredNow();
    console.log(`   unregistered   ${unregistered.length}`);

    if (unregistered.length === 0) {
      console.log('   already registered — nothing to do');
    } else {
      const result = await submitWithRetry(
        'registration',
        async () => {
          // Rebuilt on every attempt. A failed submission unbooks the
          // UTxOs it reserved, so the previous recipe is no longer valid
          // to resubmit.
          const utxos = await unregisteredNow();
          const est: any = await (wallet as any).estimateRegistration(utxos);
          console.log(`   fee            ${est?.fee}`);

          if (est?.fee) {
            console.log('   waiting for enough generated dust to cover it…');
            await (wallet as any).waitForGeneratedDust(utxos, est.fee, {
              timeoutMs: 30 * 60_000,
            });
            console.log('   covered');
          }

          // NOT signed here. `registerNightUtxosForDustGeneration`
          // delegates to `createDustActionTransaction`, whose step 5
          // already runs the recipe through `signRecipe`. Signing again
          // stamps a transaction that is already signed, and the node
          // rejects it as invalid.
          const recipe = await (wallet as any).registerNightUtxosForDustGeneration(
            utxos,
            keystore.getPublicKey(),
            (payload: Uint8Array) => keystore.signData(payload),
          );
          const tx = await (wallet as any).finalizeRecipe(recipe);
          return (await (wallet as any).submitTransaction(tx)) as string;
        },
        async () => (await unregisteredNow()).length === 0,
      );

      console.log(
        result === 'already-done'
          ? '   registered (confirmed by reading the chain)'
          : `   registered. tx ${result}`,
      );
    }
  }

  // -------------------------------------------------------------------
  step(3, 'Wait for DUST to arrive');

  // Registration only starts generation; the balance follows. Deploying
  // against a zero balance fails for reasons that never mention dust, so
  // this waits for a number rather than assuming one.
  let dust = await dustNow();
  const deadline = Date.now() + 20 * 60_000;
  while (dust === 0n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000));
    dust = await dustNow();
    process.stdout.write(`\r   dust balance   ${dust}          `);
  }
  console.log(`\n   dust balance   ${dust}`);
  if (dust === 0n) {
    fail('No DUST arrived within 20 minutes. Nothing can pay a fee yet; re-run later.');
  }

  // -------------------------------------------------------------------
  step(4, 'Deploy the contract');

  const already = readDeployment(cfg.name);
  if (already) {
    console.log(`   already deployed at ${already.contractAddress}`);
    console.log(`   (delete ${deploymentPath(cfg.name)} to deploy a second instance)`);
  } else {
    const password =
      process.env.MIDNIGHT_PRIVATE_STATE_PASSWORD ?? 'Demo-Credential-Lifecycle-2026!';

    const providers = buildProviders(cfg, open, {
      managedDir: MANAGED,
      privateStateId: PRIVATE_STATE_ID,
      password,
    });

    // The admin secret the contract checks preimage knowledge against.
    // Derived deterministically so the demo is reproducible — a DEMO
    // shortcut, stated as one.
    const initialPrivateState: PrivateState = {
      ...blankPrivateState(),
      localSecret: bytes32(1),
    };

    const witnesses = {
      localSecret: (ctx: any) => [ctx.privateState, ctx.privateState.localSecret],
      issuerSecret: (ctx: any) => [ctx.privateState, ctx.privateState.issuerSecret],
      attributes: (ctx: any) => [ctx.privateState, ctx.privateState.attributes],
      blinding: (ctx: any) => [ctx.privateState, ctx.privateState.blinding],
      merklePath: (ctx: any) => [ctx.privateState, ctx.privateState.merklePath],
    };

    // Widening the builder functions rather than their arguments: the
    // Effect combinators type each argument with a conditional that reads
    // the remaining requirements out of the pipeline head, so widening the
    // head collapses every later argument to `never`.
    const make = CompiledContract.make as unknown as (t: string, c: unknown) => unknown;
    const withWitnesses = CompiledContract.withWitnesses as unknown as (
      s: unknown, w: unknown,
    ) => unknown;
    const withAssets = CompiledContract.withCompiledFileAssets as unknown as (
      s: unknown, p: string,
    ) => unknown;

    const compiledContract = withAssets(
      withWitnesses(make(PRIVATE_STATE_ID, Contract), witnesses),
      MANAGED,
    );

    console.log('   deploying — a real proof, then a real block');
    const started = Date.now();
    const deployed = await deployContract(providers as any, {
      compiledContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
    } as any);
    const elapsed = Date.now() - started;

    const pub = (deployed as any).deployTxData.public;
    console.log(`   deployed in ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`   contract   ${pub.contractAddress}`);
    console.log(`   tx         ${pub.txHash ?? pub.txId}`);
    console.log(`   block      ${pub.blockHeight}`);

    const outDir = join(ONCHAIN_ROOT, 'deployments');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, `${cfg.name}.json`),
      JSON.stringify(
        {
          network: cfg.name,
          networkId: cfg.networkId,
          contractAddress: pub.contractAddress,
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
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`   recorded in onchain/deployments/${cfg.name}.json`);
  }

  console.log(`\n${'─'.repeat(66)}`);
  console.log(`${cfg.name} is provisioned. Next:`);
  console.log(`  npm run lifecycle -- ${cfg.name}    the whole demo, on chain`);
  console.log(`  npm run service   -- ${cfg.name}    serve it to the web UI`);
} catch (e) {
  console.error('\nprovisioning failed');
  console.error(e);
  process.exit(1);
} finally {
  await (wallet as any).stop?.();
}
