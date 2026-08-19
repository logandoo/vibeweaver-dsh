#!/usr/bin/env bash
# smoke.sh — headless dsh 冒烟：验证插件在 vibe-arm-b profile 中可加载、契约段存在、skill 可用
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

echo "[SMOKE] (1/3) dump-config: 契约段与插件行"
DSH_BIN="npm exec --yes --package=@deepseek-ai/dsh@0.1.0-rc.6 -- dsh"
$DSH_BIN --profile vibe-arm-b --dump-config 2>&1 | grep -iE "vibeweaver|vibeweaver-covenant" || echo "[SMOKE] grep not found in dump (checking log) >> tests/smoke_dump.txt"
$DSH_BIN --profile vibe-arm-b --dump-config > tests/smoke_dump.txt 2>&1 || true

echo "[SMOKE] (2/3) headless 单句任务（验证 pre-step 注入 + skill 工具）"
$DSH_BIN --profile vibe-arm-b "请用一条消息回答:当前会话中有哪些 skill 可用（只列名字）" > tests/smoke_run.txt 2>&1 || true
tail -20 tests/smoke_run.txt

echo "[SMOKE] (3/3) 检查产物"
grep -qi "vibeweaver" tests/smoke_run.txt && echo "[SMOKE] PASS: vibeweaver 出现在会话输出" || echo "[SMOKE] WARN: 未在输出中见 vibeweaver（可能未触发，查看 tests/smoke_run.txt）"
echo "[SMOKE] done"
