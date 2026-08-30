// What address forms does the wallet actually expose? The faucet rejected
// the shielded address, so the question is which of these it wants.
import { firstValueFrom } from 'rxjs';
import { resolveNetwork } from './network.js';
import { loadOrCreateSeed, openWallet } from './wallet.js';

const cfg = resolveNetwork(process.argv[2]);
const wallet = await openWallet(cfg, loadOrCreateSeed(cfg.name), { waitForSync: false, quiet: true });
try {
  const s: any = await firstValueFrom(wallet.state());
  const show = (k: string) => {
    const v = s[k];
    if (v === undefined) return;
    const str = typeof v === 'string' ? v : JSON.stringify(v);
    console.log(`${k.padEnd(26)} ${String(str).slice(0, 160)}`);
  };
  console.log('--- all top-level state keys ---');
  console.log(Object.keys(s).join(', '));
  console.log();
  console.log('--- address-ish fields ---');
  for (const k of Object.keys(s)) {
    if (/address|key|public/i.test(k)) show(k);
  }
} finally {
  await wallet.close();
}
