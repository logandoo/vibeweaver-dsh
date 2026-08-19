#!/usr/bin/env bash
# project_build.sh — 构建 dsh-vibeweaver 插件（src → lib）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "[BUILD] Syntax check + copy src → lib"
mkdir -p "$PROJECT_DIR/lib"
for f in src/*.js; do
  node --check "$f"
  echo "[BUILD] checked: $f"
done
cp "$PROJECT_DIR"/src/*.js "$PROJECT_DIR/lib/"
echo "[BUILD] lib contents:"
ls -la "$PROJECT_DIR/lib/"
