#!/usr/bin/env bash
# smoke.sh — headless dsh 冒烟：插件可加载、契约段存在、skill 可用、注入的会话可回放
#
# 版本单一真源（A3）：冒烟钉 = package.json `engines.dsh` 的下限。dsh-app-boot 按
# engines.dsh 做兼容闸（lib/index.js:279-299，semver includePrerelease），钉与闸一旦
# 漂移，冒烟就在"发布件根本不会加载"的版本上测通过。漂移即红，不靠人记。
#
# 无模型配置时相关步骤打 SKIP 并说明原因——SKIP 不是 PASS（COV-11 非对称规则：
# 没测到 ≠ 测过）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

PROFILE="${DSH_SMOKE_PROFILE:-vibe-arm-b}"
SESSION_ROOT="${DSH_SMOKE_SESSION_ROOT:-$HOME/.dsh/sessions}"

# ── (0) 版本一致性：冒烟钉必须等于 engines.dsh 下限 ──
RANGE="$(node -p "require('./package.json').engines.dsh")"
FLOOR="${RANGE#>=}"
# 默认跑两端：下限证明向后兼容，`next` 证明当前注册表头版本（两条 BLOCKER 就住在那儿）。
# 覆盖 DSH_SMOKE_VERSIONS 时必须是显式行为，别再让"钉与闸漂移"悄悄通过（评审 R2）。
PINS="${DSH_SMOKE_VERSIONS:-$FLOOR next}"
if [ -n "${DSH_SMOKE_VERSION:-}" ] && [ "$DSH_SMOKE_VERSION" != "$FLOOR" ] && [ -z "${DSH_SMOKE_ALLOW_PIN_MISMATCH:-}" ]; then
  echo "[SMOKE] FAIL: DSH_SMOKE_VERSION=$DSH_SMOKE_VERSION 低于/偏离 engines.dsh='$RANGE' 的下限；确认过就设 DSH_SMOKE_ALLOW_PIN_MISMATCH=1" >&2
  exit 1
fi
[ -n "${DSH_SMOKE_VERSION:-}" ] && PINS="$DSH_SMOKE_VERSION"
echo "[SMOKE] (0/5) 版本一致性: engines.dsh='$RANGE' → 冒烟钉 [$PINS]"
for PIN in $PINS; do
  npm exec --yes --package=@deepseek-ai/dsh@$PIN -- dsh --version >/dev/null 2>&1 || { echo "[SMOKE] FAIL: 冒烟钉 $PIN 无法解析" >&2; exit 1; }
done

for PIN in $PINS; do
echo "[SMOKE] ── dsh $PIN ──"
DSH_BIN="npm exec --yes --package=@deepseek-ai/dsh@$PIN -- dsh"
echo "[SMOKE] (1/5) dump-config: 契约段与插件行"
$DSH_BIN --profile "$PROFILE" --dump-config 2>&1 | grep -iE "vibeweaver|vibeweaver-covenant" || echo "[SMOKE] grep not found in dump (checking log) >> tests/smoke_dump_$PIN.txt"
$DSH_BIN --profile "$PROFILE" --dump-config > tests/smoke_dump_$PIN.txt 2>&1 || true

echo "[SMOKE] (2/5) headless 单句任务（验证 pre-step 注入 + skill 工具）"
START_TS=$(date +%s)
$DSH_BIN --profile "$PROFILE" "请用一条消息回答:当前会话中有哪些 skill 可用（只列名字）" > tests/smoke_run_$PIN.txt 2>&1 || true
tail -5 tests/smoke_run_$PIN.txt 2>/dev/null || true
grep -qi "vibeweaver" tests/smoke_run_$PIN.txt && echo "[SMOKE] PASS: vibeweaver 出现在会话输出" || echo "[SMOKE] WARN: 未在输出中见 vibeweaver（多半无模型配置，见 tests/smoke_run_$PIN.txt）"

# ── (3) A3 核心：注入后重启加载该会话 ──
# 这一步本来就能抓到 A1 类回归：注入消息的 source.kind 若被读侧拒绝，会话在**加载期**
# 就 SessionFormatError，后面的回合根本不会开始。--session-id 自 0.2.x 才有（rc.6 的
# headless app 不认识该旗标），能力探测后再跑。
echo "[SMOKE] (3/5) 注入后重启加载会话（A1 类持久化回归）"
SLUG="$(pwd | sed 's|[^A-Za-z0-9]|-|g')"
SID=""
if [ -d "$SESSION_ROOT/$SLUG" ]; then
  SID="$(find "$SESSION_ROOT/$SLUG" -maxdepth 1 -type d -name 'session-*' -newermt "@$START_TS" 2>/dev/null | sort | tail -1 | xargs -I{} basename {} || true)"
fi
# 能力探测：--session-id 自 0.2 起才有。`--profile X --help` 打的是启动器帮助（不含 app
# 旗标），grep 永远落空——因此以版本号为主、help 为辅（评审 R2：这一步曾永远 SKIP）。
ver="$($DSH_BIN --version 2>/dev/null | tail -1)"
major="${ver%%.*}"; minor="${ver#*.}"; minor="${minor%%.*}"
supports_reload=no
case "$major.$minor" in
  [0-9]*.[0-9]*) if [ "$major" -gt 0 ] || [ "$minor" -ge 2 ]; then supports_reload=yes; fi ;;
esac
if [ "$supports_reload" = no ] && $DSH_BIN --profile "$PROFILE" --help 2>&1 | grep -q -- "--session-id"; then
  supports_reload=yes
fi
echo "[SMOKE] dsh $ver 支持 --session-id: $supports_reload"
if [ "$supports_reload" = yes ]; then
  if [ -z "$SID" ]; then
    echo "[SMOKE] SKIP: 未取得本轮 session id（上一轮未落会话，多半无模型配置）——重载断言未执行，不是通过"
  else
    echo "[SMOKE] 重载会话: $SID"
    if $DSH_BIN --profile "$PROFILE" --session-id "$SID" "只回复 OK" > tests/smoke_reload_$PIN.txt 2>&1; then
      echo "[SMOKE] PASS: 注入过的会话可重新加载"
    elif grep -qiE "SessionFormatError|producer-owned source kind|is corrupt|lacks an identified message|invalid source" tests/smoke_reload_$PIN.txt; then
      echo "[SMOKE] FAIL: 注入的会话无法重新加载（消息信封/源种类被读侧拒绝）— 见 tests/smoke_reload_$PIN.txt" >&2
      grep -iE "SessionFormatError|producer-owned|is corrupt|identified message" tests/smoke_reload_$PIN.txt | head -3 >&2
      exit 1
    else
      echo "[SMOKE] WARN: 重载未成功但不是格式拒绝（多半无模型配置）— 见 tests/smoke_reload_$PIN.txt"
    fi
  fi
else
  echo "[SMOKE] SKIP: dsh $PIN 无 --session-id（0.2.x 起才有）——重载断言未执行，不是通过"
fi

# ── (4) 上游读侧 admission 探针（无需模型，认证 src 真正发出的 source 形状） ──
echo "[SMOKE] (4/5) v4 admission 探针（@deepseek-ai/dsh-session-format-v3-to-v4）"
V3_ROOT="${DSH_V3_MODULES:-}"
if [ -z "$V3_ROOT" ]; then
  for c in $HOME/.npm/_npx/*/node_modules; do
    [ -d "$c/@deepseek-ai/dsh-session-format-v3-to-v4" ] && V3_ROOT="$c" && break
  done
fi
if [ -n "$V3_ROOT" ]; then
  node tests/v3_compat_probe.mjs "$V3_ROOT" || { echo "[SMOKE] FAIL: 上游读侧拒绝本插件的消息源" >&2; exit 1; }
else
  echo "[SMOKE] SKIP: 上游 0.2.x 读侧不可得（设 DSH_V3_MODULES 指向装好 @deepseek-ai/dsh@0.2.x 的 node_modules）"
fi

echo "[SMOKE] (5/5) 检查产物"
grep -qi "vibeweaver" tests/smoke_run_$PIN.txt 2>/dev/null && echo "[SMOKE] PASS: vibeweaver 出现在会话产物" || echo "[SMOKE] WARN: 未在产物中见 vibeweaver（查看 tests/smoke_run_$PIN.txt）"
done
echo "[SMOKE] done"
