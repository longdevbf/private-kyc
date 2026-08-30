#!/usr/bin/env bash
# Register NIGHT for DUST generation.
#
# Detached with setsid + nohup: without it the node process is killed by
# SIGHUP the moment this script's shell exits, which is why an earlier
# version left a zero-byte log and no running process.
NET="${1:-preview}"
LOG="/tmp/dust-${NET}.log"
cd /mnt/d/private-KYC/onchain || exit 1

pkill -f "register-dust" >/dev/null 2>&1
sleep 1
: > "$LOG"
setsid nohup stdbuf -oL -eL npx tsx src/register-dust.ts "$NET" >> "$LOG" 2>&1 < /dev/null &
disown
sleep 3
echo "log: $LOG"
pgrep -af "register-dust" | head -2 || echo "  FAILED to start"
