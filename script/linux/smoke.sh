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
# 判据 #7 的两条断言（注入形状 / 会话可重载）都发生在**模型调用之前**，因此不需要真实
# 额度；但 dsh 在缺凭据时连会话都不会建。DSH_SMOKE_FAKE_KEY=1 用占位 key 越过这一层，
# 让这两条断言能真跑。默认关闭——不让"没配凭据"被静默掩盖。
if [ "${DSH_SMOKE_FAKE_KEY:-}" = "1" ] && [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  export DEEPSEEK_API_KEY="sk-smoke-placeholder-not-a-real-key"
  echo "[SMOKE] 注意: 使用占位 key（仅验证注入与重载，模型调用必然 401）"
fi
SESSION_ROOT="${DSH_SMOKE_SESSION_ROOT:-$HOME/.dsh/sessions}"

# ── (0) 版本一致性：冒烟钉必须等于 engines.dsh 下限 ──
RANGE="$(node -p "require('./package.json').engines.dsh")"
FLOOR="${RANGE#>=}"; FLOOR="${FLOOR%% *}"   # 范围串形如 ">=0.1.0-rc.6 <0.3.0"，下限取第一段
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
if [ -n "${DSH_BIN_OVERRIDE:-}" ]; then
  DSH_BIN="$DSH_BIN_OVERRIDE"
else
  DSH_BIN="npm exec --yes --package=@deepseek-ai/dsh@$PIN -- dsh"
fi
echo "[SMOKE] (1/5) dump-config: 契约段与插件行"
$DSH_BIN --profile "$PROFILE" --dump-config 2>&1 | grep -iE "vibeweaver|vibeweaver-covenant" || echo "[SMOKE] grep not found in dump (checking log) >> tests/smoke_dump_$PIN.txt"
$DSH_BIN --profile "$PROFILE" --dump-config > tests/smoke_dump_$PIN.txt 2>&1 || true

echo "[SMOKE] (2/5) headless 单句任务（验证 pre-step 注入 + skill 工具）"
START_TS=$(date +%s)
# 提示必须以"看起来像代码文件名"结尾，才会触发 pre-step 激活（isCodingIntent）；只读，避免真模型去改文件
$DSH_BIN --profile "$PROFILE" "请阅读 src/index.js" > tests/smoke_run_$PIN.txt 2>&1 || true
tail -5 tests/smoke_run_$PIN.txt 2>/dev/null || true
grep -qi "vibeweaver" tests/smoke_run_$PIN.txt && echo "[SMOKE] PASS: vibeweaver 出现在会话输出" || echo "[SMOKE] WARN: 未在输出中见 vibeweaver（多半无模型配置，见 tests/smoke_run_$PIN.txt）"

# ── (3) A3 核心：注入后重启加载该会话 ──
# 这一步本来就能抓到 A1 类回归：注入消息的 source.kind 若被读侧拒绝，会话在**加载期**
# 就 SessionFormatError，后面的回合根本不会开始。--session-id 自 0.2.x 才有（rc.6 的
# headless app 不认识该旗标），能力探测后再跑。
echo "[SMOKE] (3/5) 注入后重启加载会话（A1 类持久化回归）"
# dsh 的会话目录名 = "--" + 去首斜杠的 cwd（非字母数字→"-"）+ "--"
SLUG="--$(pwd | sed 's|^/||; s|[^A-Za-z0-9]|-|g')--"
SID=""
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
  # `set -e` 下赋值里的命令替换会透传退出码（评审实证：rc=2 直接终止，SKIP/FAIL 分支成死代码）
  E2E_RC=0
  E2E_OUT="$(node tests/e2e_session_check.mjs "$SESSION_ROOT" "$SLUG" "$START_TS" 2>&1)" || E2E_RC=$?
  echo "$E2E_OUT"
  SID="$(printf '%s\n' "$E2E_OUT" | sed -n 's/^SESSION=//p' | head -1)"
  if [ "$E2E_RC" = "0" ]; then
    echo "[SMOKE] PASS: 注入消息落盘且带 id + role（读侧可接受的身份）"
  elif [ "$E2E_RC" = "2" ]; then
    echo "[SMOKE] SKIP: 本轮没有落盘会话（无模型凭据）——注入形状与重载断言均未执行，不是通过"
  else
    echo "[SMOKE] FAIL: 注入消息缺失或缺 id/role —— 读侧会拒绝该会话" >&2
    exit 1
  fi
  if [ -z "$SID" ]; then
    echo "[SMOKE] SKIP: 未取得本轮 session id——重载断言未执行，不是通过"
  else
    echo "[SMOKE] 重载会话: $SID"
    if $DSH_BIN --profile "$PROFILE" --session-id "$SID" "只回复 OK" > tests/smoke_reload_$PIN.txt 2>&1; then
      echo "[SMOKE] PASS: 注入过的会话可重新加载"
    elif grep -qiE "SessionFormatError|producer-owned source kind|is corrupt|lacks an identified message|invalid source" tests/smoke_reload_$PIN.txt; then
      echo "[SMOKE] FAIL: 注入的会话无法重新加载（消息信封/源种类被读侧拒绝）— 见 tests/smoke_reload_$PIN.txt" >&2
      grep -iE "SessionFormatError|producer-owned|is corrupt|identified message" tests/smoke_reload_$PIN.txt | head -3 >&2 || true
      exit 1
    elif grep -qiE "AUTH:|MISSING_CREDENTIAL" tests/smoke_reload_$PIN.txt; then
      # 只有"装载成功、随后模型鉴权失败"才会走到这里：损坏的会话在装载期就抛，根本到不了模型调用
      echo "[SMOKE] PASS: 会话装载成功（随后模型鉴权失败，与持久化无关）"
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

# ── (4b) 真 cordis 容器探针：可选依赖的语义与时序（评审 R2 + FCV M7 的守卫）──────
echo "[SMOKE] (4b) real-cordis 探针（ctx.inject 可选依赖 / 服务缺席回退）"
if [ -n "$V3_ROOT" ] && [ -d "$V3_ROOT/@deepseek-ai/cordis" ]; then
  node tests/real_cordis_probe.mjs "$V3_ROOT" || { echo "[SMOKE] FAIL: 真容器里可选依赖语义不成立" >&2; exit 1; }
else
  echo "[SMOKE] SKIP: 真 cordis 不可得（同上 DSH_V3_MODULES）"
fi

echo "[SMOKE] (5/5) 检查产物"
grep -qi "vibeweaver" tests/smoke_run_$PIN.txt 2>/dev/null && echo "[SMOKE] PASS: vibeweaver 出现在会话产物" || echo "[SMOKE] WARN: 未在产物中见 vibeweaver（查看 tests/smoke_run_$PIN.txt）"
done
echo "[SMOKE] done"
