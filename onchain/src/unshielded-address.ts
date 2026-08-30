// Print the unshielded (faucet) address for one or more networks.
//   npx tsx src/unshielded-address.ts preview preprod
import { resolveNetwork } from './network.js';
import { loadOrCreateSeed } from './wallet.js';
import { deriveUnshielded } from './unshielded.js';

const names = process.argv.slice(2);
for (const n of names.length ? names : ['preview']) {
  const cfg = resolveNetwork(n);
  const id = deriveUnshielded(loadOrCreateSeed(cfg.name), cfg.networkId);
  console.log(`network   ${cfg.name}`);
  console.log(`address   ${id.address}`);
  console.log(`hex       ${id.addressHex}`);
  if (cfg.faucet) console.log(`faucet    ${cfg.faucet}`);
  console.log();
}
