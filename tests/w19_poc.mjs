// R2/R3 评审 PoC 复测（dsh 侧修复后行为）；用法: node /tmp…/w19_poc.mjs <dsh 仓库路径>
import { preExecuteDecision, destructiveBlock, riskApproved } from "../src/lib.js"
const cwd = process.cwd()
const p = (t, a, cfg) => {
  const d = preExecuteDecision({ toolName: t, args: a, cwd, cfg: cfg || {} })
  return (d.deny ? "DENY" : "allow") + (d.warn.length ? " +warn" + d.warn.length : "")
}
const TR = "tr" + "uncate"
console.log("  read_image 读 auth_*.png      ->", p("read_image", { file_path: cwd + "/tests/auth_flow.png" }))
console.log("  present 展示 security_*.md   ->", p("present", { file_path: cwd + "/src/security_notes.md" }))
console.log("  pwsh 破坏性命令（Windows 面） ->", p("pwsh", { command: "git " + "clean -fdx" }))
console.log("  str_replace_editor 写 auth    ->", p("str_replace_editor", { path: cwd + "/src/auth/x.js" }))
console.log("  前导空格删检查器              ->", p("bash", { command: "   rm tests/assert_artifacts.py" }))
console.log("  复合段 mv a b && 删检查器      ->", p("bash", { command: "mv scratch.txt out.txt && rm tests/assert_artifacts.py" }))
console.log("  dd of=acceptance.md           ->", p("bash", { command: "dd if=/dev/zero of=tests/acceptance.md bs=1 count=1" }))
console.log("  一条批准解锁同行两个受保护文件 ->", p("bash", { command: "rm tests/acceptance.md tests/.evidence.lock" }))
console.log("  写 Cargo.lock（非 tests/）     ->", p("write", { file_path: cwd + "/Cargo.lock" }))
console.log("  同文件相对+绝对两写法          ->", p("write", { file_path: "src/a.js", path: cwd + "/src/a.js" }))
console.log("  warn 档未知写工具改 auth        ->", p("apply_patch", { file_path: cwd + "/src/auth/x.js" }, { gateMode: "warn" }))
const dstr = (c) => (destructiveBlock(cwd, c) ? "BLOCK" : "ALLOW")
console.log("  rm -rf /tmp/../../..          ->", dstr("rm -rf /tmp/../../.."))
console.log("  rm -rf $TMPDIR/..             ->", dstr("rm -rf $TMPDIR/.."))
console.log("  git commit -m 'fix " + TR + " handling' ->", dstr("git commit -m 'fix " + TR + " handling'"))
console.log("  " + TR + " 真命令                    ->", dstr(TR + " -s 0 app.log"))
