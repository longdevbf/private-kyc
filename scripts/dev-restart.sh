#!/usr/bin/env bash
# Restart the demo contract host in the background and wait for it to answer.
cd /mnt/d/private-KYC || exit 1
pkill -f "tsx web/server" >/dev/null 2>&1
sleep 1
setsid nohup ./node_modules/.bin/tsx web/server.ts >/tmp/chain.log 2>&1 </dev/null &
disown
for i in $(seq 1 25); do
  if curl -s -m 3 -o /dev/null http://localhost:4000/api/state; then echo "backend up (${i}s)"; exit 0; fi
  sleep 1
done
echo "backend did not start"; cat /tmp/chain.log; exit 1
