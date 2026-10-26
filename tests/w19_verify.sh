#!/usr/bin/env bash
# w19.0 同步波验收证据跑（判据 #1-#12 一次性重放）。用法: bash tests/w19_verify.sh
set -uo pipefail
cd "$(dirname "$0")/.."
VW=../vibeweaver

echo "=== [C1] assert canonical 逐字节 + fixed-local 语义在盘可指认 ==="
shasum -a 256 tests/assert_artifacts.py "$VW/scripts/assert_artifacts.py" | awk '{print $1}' | uniq -c
for m in 'class contradiction' '_named' 'doc_skip' 'soffice missing' '_unquote_git' 'group("22")' '--self-check' '"--root"'; do
  printf '  %-22s mainline=%s dsh=%s\n' "$m" "$(grep -c -F -- "$m" "$VW/scripts/assert_artifacts.py")" "$(grep -c -F -- "$m" tests/assert_artifacts.py)"
done
python3 tests/assert_artifacts.py --existing | tail -1

echo "=== [C2] 捆绑脚本字节同步 ==="
for f in mm_probe.py ui_fidelity.py backlog_check.py evidence_lock.py; do
  a=$(shasum -a 256 "$VW/scripts/$f" | awk '{print $1}'); b=$(shasum -a 256 "scripts/$f" | awk '{print $1}')
  if [ "$a" = "$b" ]; then echo "  OK  $f  ${a:0:12}"; else echo "  MISMATCH $f"; fi
done

echo "=== [C3] 契约卡锚词 + 12 组合字节帽 ==="
node -e '
import("./src/lib.js").then(m=>{const c=m.covenantCard({});
for(const t of ["COV-0 交付契约","final_gate_line","A7.7.1 无人值守","awaiting decision","组1-22","evidence_lock","基线三行默认写 tests/verification_log.md"]) console.log("  anchor", t, c.includes(t)?"OK":"MISSING");
const cs=[{},{skillSourceDir:"/tmp/skills"},{skillSourceDir:"/tmp/skills",steerBudget:5},{skillSourceDir:"/private/var/folders/longer-than-production-path-0123456789/skills/vibeweaver",probeScript:"/opt/vw/scripts/mm_probe.py"}];
const b=[];for(const x of cs)for(const g of [undefined,"warn","off"])b.push(Buffer.byteLength(m.covenantCard({...x,gateMode:g}),"utf8"));
console.log("  bytes min/max", Math.min(...b)+"/"+Math.max(...b), Math.max(...b)<8000?"ALL <8000 OK":"OVER BUDGET");});'

echo "=== [C4] 真仓 pin 实测（篡改副本 → BAD；还原 → 恢复） ==="
cp tests/assert_artifacts.py /tmp/w19-assert.bak
printf '\n# tamper\n' >> tests/assert_artifacts.py
node -e '
import("./src/lib.js").then(m=>{const r=m.verifyChecker(process.cwd(),{});console.log("  tampered ok="+r.ok+" reason="+(r.reason||"").slice(0,72));});'
cp /tmp/w19-assert.bak tests/assert_artifacts.py
node -e '
import("./src/lib.js").then(m=>{const r=m.verifyChecker(process.cwd(),{});console.log("  restored ok="+r.ok+" warning="+(r.warning?r.warning.slice(0,40):"(none)"));});'
cmp -s tests/assert_artifacts.py "$VW/scripts/assert_artifacts.py" && echo "  副本已还原（与主线仍逐字节一致）"

echo "=== [C5-C10] 决策面实测（本仓真根） ==="
node -e '
import("./src/lib.js").then(m=>{
  const cwd=process.cwd();
  const probe=(t,a,cfg)=>{const d=m.preExecuteDecision({toolName:t,args:a,cwd,cfg:cfg||{}});return d.deny?"DENY":"allow"};
  console.log("  write src/auth/x.js            ->", probe("write",{file_path:cwd+"/src/auth/x.js"}));
  console.log("  write src/lib.js               ->", probe("write",{file_path:cwd+"/src/lib.js"}));
  console.log("  Bash 递归删非白名单（大写宿主名）->", probe("Bash",{command:"rm -rf "+"sr"+"c"}));
  console.log("  bash rm -rf node_modules        ->", probe("bash",{command:"rm -rf node_modules"}));
  console.log("  bash rm -rf $HOME/.config       ->", probe("bash",{command:"rm -rf "+"$HOME/.config"}));
  console.log("  bash 删受保护锁                 ->", probe("bash",{command:"rm tests/.evidence.lo"+"ck"}));
  console.log("  write tests/acceptance.md       ->", probe("write",{file_path:cwd+"/tests/acceptance.md"}));
  console.log("  read  src/auth/x.js（只读豁免）  ->", probe("read",{file_path:cwd+"/src/auth/x.js"}));
  console.log("  warn 档 bash 破坏性命令         ->", probe("bash",{command:"git "+"clean -fdx"},{gateMode:"warn"}));
});'

echo "=== [C5-C10 补充] 迭代 5 绕过面 PoC（R2/R3 评审实证项） ==="
node tests/w19_poc.mjs

echo "=== [C11] 构建 + 镜像 + 全量单测 ==="
bash script/linux/project_build.sh >/dev/null 2>&1 && echo "  build exit 0"
for f in index lib baseline; do
  if cmp -s lib/$f.js src/$f.js; then echo "  mirror OK lib/$f.js"; else echo "  MIRROR DIFF lib/$f.js"; fi
done
node --test tests/unit/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"

echo "=== [C12] 文档/记忆在盘面 + --final ==="
grep -c "2026-10-26" README.md README_en.md
ls -1 memory/project_mainline_w19_port_20261026.md docs/PLAN_w19_port_20261026.md >/dev/null && echo "  docs/memory 在盘 OK"
python3 tests/assert_artifacts.py --existing --final 2>&1 | tail -2
