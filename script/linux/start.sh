#!/usr/bin/env bash
# start.sh — 启动插件开发冒烟服务（headless dsh 冒烟会话，.pid 守护）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

PID_FILE="$PROJECT_DIR/.pid"

if [ -f "$PID_FILE" ]; then
  echo "[START] Already running (PID $(cat "$PID_FILE")). Restart first." >&2
  exit 1
fi

echo "[START] Starting headless smoke session..."
nohup bash "$SCRIPT_DIR/smoke.sh" > tests/smoke.log 2>&1 &
echo $! > "$PID_FILE"
echo "[START] Smoke PID: $(cat "$PID_FILE") — log: tests/smoke.log"
