#!/usr/bin/env bash
# Local proof server, pinned to the version the support matrix names for
# preview / preprod / mainnet.
#
# Two things learned the hard way:
#   * the org is `midnightntwrk`, not `midnightnetwork`. The latter is a
#     different, older repo whose tags stop at 7.0.0-rc.1, which is why
#     8.1.0 first appeared not to exist.
#   * the SRS parameters are ~hundreds of MB and are re-downloaded on every
#     start unless the cache directory is a persistent volume.
#
# An earlier version of this script passed `--network undeployed` while the
# wallet was pointed at preview. The container started, served briefly and
# then exited 255. No network flag is passed now: the server takes the
# network from each request.
set -euo pipefail

IMAGE=midnightntwrk/proof-server:8.1.0
NAME=midnight-proof-server
VOLUME=midnight-proof-cache
PORT=6300

case "${1:-start}" in
  start)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker volume create "$VOLUME" >/dev/null
    docker run -d --name "$NAME" \
      --restart unless-stopped \
      -p ${PORT}:${PORT} \
      -v "${VOLUME}:/root/.cache" \
      "$IMAGE"
    echo "waiting for :${PORT}"
    for i in $(seq 1 90); do
      if curl -s -o /dev/null -m 3 "http://localhost:${PORT}/" 2>/dev/null; then
        echo "up after ${i}s"; break
      fi
      if ! docker ps --format '{{.Names}}' | grep -q "^${NAME}$"; then
        echo "container exited:"; docker logs --tail 20 "$NAME"; exit 1
      fi
      sleep 1
    done
    docker ps --filter "name=${NAME}" --format '  {{.Names}}  {{.Status}}'
    ;;
  stop)   docker rm -f "$NAME" >/dev/null 2>&1 && echo stopped ;;
  logs)   docker logs --tail "${2:-60}" "$NAME" ;;
  status)
    docker inspect "$NAME" --format '  running={{.State.Running}} exit={{.State.ExitCode}}' 2>/dev/null || echo "  no container"
    curl -s -o /dev/null -m 5 -w '  http=%{http_code}\n' "http://localhost:${PORT}/" 2>/dev/null || echo "  unreachable"
    ;;
  *) echo "usage: $0 {start|stop|logs|status}" >&2; exit 1 ;;
esac
