#!/usr/bin/env bash
# stop.sh — 停止冒烟会话（.pid 安全 kill，禁止 pkill 模式匹配）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="$PROJECT_DIR/.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  echo "[STOP] Stopping smoke (PID $PID)..."
  kill "$PID" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "[STOP] Stopped."
else
  echo "[STOP] No PID file found — nothing to stop."
fi
