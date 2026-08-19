#!/usr/bin/env bash
# restart.sh — 重启冒烟会话
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[RESTART] Restarting smoke..."
bash "$SCRIPT_DIR/stop.sh"
sleep 1
bash "$SCRIPT_DIR/start.sh"
echo "[RESTART] Done."
