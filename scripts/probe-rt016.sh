#!/usr/bin/env bash
# What does compact-runtime 0.16.0 actually export? The 0.19 engine uses
# createCircuitContext / createConstructorContext / convertBigintToBytes;
# confirm the 0.16 names before porting rather than after.
cd /mnt/d/private-KYC/onchain || exit 1
node --input-type=module -e "
import * as m from '@midnight-ntwrk/compact-runtime';
const keys = Object.keys(m).sort();
const want = ['createCircuitContext','constructorContext','createConstructorContext','convertBigintToBytes','QueryContext','emptyZswapLocalState','CompactTypeField','CompactTypeVector','sampleContractAddress','dummyContractAddress'];
console.log('--- looked-for names ---');
for (const w of want) console.log((keys.includes(w) ? '  YES  ' : '  no   ') + w);
console.log();
console.log('--- context / state related exports ---');
console.log(keys.filter(k => /context|Context|state|State|address|Address/.test(k)).join('\n'));
console.log();
console.log('--- convert / bytes helpers ---');
console.log(keys.filter(k => /convert|Bytes|bytes|encode|decode/.test(k)).join('\n'));
console.log();
console.log('total exports:', keys.length);
"
