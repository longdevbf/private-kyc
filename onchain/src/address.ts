// =====================================================================
// Print the deployment wallet's address, so it can be funded
// =====================================================================
//   npx tsx src/address.ts preview
//   npx tsx src/address.ts preprod
//   npx tsx src/address.ts preview --balance   (waits for a full sync)
//
// The faucet is a web form with a human check, so this is the one step in
// the deployment that cannot be automated.
//
// By default this does NOT wait for the wallet to sync: the address is
// known immediately, and a fresh wallet has several hundred thousand
// blocks to scan on preview. Fund the address while the sync runs.
// Pass --balance when you want the confirmed balance instead.
// =====================================================================

import { firstValueFrom } from 'rxjs';
import { resolveNetwork } from './network.js';
import { loadOrCreateSeed, openWallet, walletInfo, formatDust } from './wallet.js';

const args = process.argv.slice(2);
const wantBalance = args.includes('--balance');
const cfg = resolveNetwork(args.find((a) => !a.startsWith('--')));
const seed = loadOrCreateSeed(cfg.name);

const wallet = await openWallet(cfg, seed, { waitForSync: wantBalance });

try {
  // The first emission carries the address whether or not the scan is done.
  const s = await firstValueFrom(wallet.state());

  console.log();
  console.log('network      ', cfg.name);
  console.log('address      ', s.address);
  if (cfg.faucet) console.log('faucet       ', cfg.faucet);

  if (wantBalance) {
    const info = await walletInfo(wallet);
    console.log('balance      ', formatDust(info.balance), 'tDUST');
    console.log();
    console.log(
      info.balance === 0n
        ? 'Still unfunded. Paste the address into the faucet and try again.'
        : `Funded. Ready to deploy:  npx tsx src/deploy.ts ${cfg.name}`,
    );
  } else {
    console.log();
    console.log('Paste that address into the faucet. To check the balance later:');
    console.log(`  npx tsx src/address.ts ${cfg.name} --balance`);
  }
} finally {
  await wallet.close();
}
