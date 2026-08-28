#!/usr/bin/env bash
export PATH="$HOME/.local/bin:$PATH"
echo "=== compact default toolchain ==="
compact list 2>&1 | head -5
echo
echo "=== docker (needed for proof server 8.1.0) ==="
if command -v docker >/dev/null 2>&1; then
  docker --version
  if docker ps >/dev/null 2>&1; then echo "daemon: running"; else echo "daemon: NOT running"; fi
else
  echo "docker: NOT INSTALLED"
fi
echo
echo "=== node / npm ==="
node --version; npm --version
