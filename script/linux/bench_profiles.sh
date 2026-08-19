#!/usr/bin/env bash
# bench_profiles.sh — 创建 headless 评测 profile（vibe-arm-a / vibe-arm-b）
# 依赖解析: 沿用 dsh healProfilesModuleFallback 模式 —— 在 profiles/node_modules
# 放置 bundle symlink, bare 包名经 Node parent-walk 解析（无需 pnpm）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
NM="$DSH_HOME/profiles/node_modules"

mkdir -p "$DSH_HOME/profiles/vibe-arm-a" "$DSH_HOME/profiles/vibe-arm-b"

# Arm-A: dsh-base + dsh-headless + 基线 bundle（全量 SKILL.md 静态注入）
cat > "$DSH_HOME/profiles/vibe-arm-a/package.json" <<EOF
{
  "name": "dsh-profile-vibe-arm-a",
  "private": true,
  "dependencies": {
    "dsh-vibeweaver-baseline": "file:$PROJECT_DIR/bench/baseline-bundle"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "dsh-vibeweaver-baseline"
      ]
    }
  }
}
EOF

# Arm-B: dsh-base + dsh-headless + 本插件
cat > "$DSH_HOME/profiles/vibe-arm-b/package.json" <<EOF
{
  "name": "dsh-profile-vibe-arm-b",
  "private": true,
  "dependencies": {
    "dsh-vibeweaver": "file:$PROJECT_DIR"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "dsh-vibeweaver"
      ]
    }
  }
}
EOF

# 扁平 node_modules: 确保两个 bundle 可被 bare name 解析
mkdir -p "$NM"
ln -sfn "$PROJECT_DIR" "$NM/dsh-vibeweaver"
ln -sfn "$PROJECT_DIR/bench/baseline-bundle" "$NM/dsh-vibeweaver-baseline"

for p in vibe-arm-a vibe-arm-b; do
  cp "$DSH_HOME/profiles/web/pnpm-workspace.yaml" "$DSH_HOME/profiles/$p/pnpm-workspace.yaml" 2>/dev/null || true
  echo "[]" > "$DSH_HOME/profiles/$p/cordis.yml"
done

echo "[BENCH] profiles ready: $DSH_HOME/profiles/vibe-arm-{a,b}"
echo "[BENCH] bundles symlinked into $NM"
