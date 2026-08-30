#!/usr/bin/env bash
cd /mnt/d/private-KYC/onchain || exit 1
node --input-type=module -e "
import { convertFieldToBytes } from '@midnight-ntwrk/compact-runtime';
const hex = (u) => Buffer.from(u).toString('hex');
for (const v of [0n, 1n, 2n, 255n]) {
  const b = convertFieldToBytes(32, v, 'epoch');
  console.log(String(v).padStart(4), hex(b), 'len=' + b.length);
}
"
