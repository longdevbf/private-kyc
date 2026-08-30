#!/usr/bin/env bash
NET="${1:-preview}"
LOG="/tmp/dust-${NET}.log"
echo "log file: $LOG"
if [ -f "$LOG" ]; then
  echo "bytes: $(wc -c < "$LOG")"
  echo "--- tail ---"
  tail -30 "$LOG"
else
  echo "  (no log file)"
fi
echo
echo "--- process ---"
pgrep -af "register-dust" | head -3 || echo "  not running"
