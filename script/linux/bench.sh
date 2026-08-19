#!/usr/bin/env bash
# bench.sh — 运行 A/B 评测（Arm-A 强制注入 vs Arm-B 插件）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

# 优先 homebrew python（tomllib 支持），回退系统 python3
if /opt/homebrew/bin/python3.11 -c "import tomllib" 2>/dev/null; then
  PY=/opt/homebrew/bin/python3.11
elif python3.11 -c "import tomllib" 2>/dev/null; then
  PY=python3.11
else
  PY=python3
fi
echo "[BENCH] using $PY"

echo "[BENCH] Ensuring bench profiles exist..."
bash "$SCRIPT_DIR/bench_profiles.sh"

echo "[BENCH] Running bench..."
"$PY" tests/bench/run_bench.py --config config.toml 2>&1 | tee tests/bench/bench_run.log
echo "[BENCH] Report: tests/bench/report.md"
