#!/usr/bin/env bash
echo "=== proof server container ==="
docker inspect midnight-proof-server --format 'name={{.Name}} running={{.State.Running}} exit={{.State.ExitCode}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' 2>&1
echo
echo "=== last logs ==="
docker logs --tail 15 midnight-proof-server 2>&1 | tail -15
echo
echo "=== port 6300 ==="
curl -s -o /dev/null -m 5 -w 'http=%{http_code}\n' http://localhost:6300/ 2>&1 || echo "unreachable"
