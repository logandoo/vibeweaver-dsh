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

// ── 波次 A4 增例（0.2.1-rc.3 命令面：参数形态分支）───────────────────────────
// 与上面同源：字面量在文件里完整，在命令行里不出现（§F #4）。
const HARD_RESET = "git " + "reset --hard"
console.log("  run_code 递归删 src            ->", p("run_code", { code: "import shutil\nshutil.rmtree('src')", description: "clean" }))
console.log("  run_code os.system 硬复位      ->", p("run_code", { code: `import os\nos.system("${HARD_RESET}")`, description: "d" }))
console.log("  run_code subprocess rm -rf     ->", p("run_code", { code: `subprocess.run(["rm", "-rf", "src"])`, description: "d" }))
console.log("  run_code 删 node_modules（白） ->", p("run_code", { code: "import shutil\nshutil.rmtree('node_modules')", description: "d" }))
console.log("  run_code 只读程序              ->", p("run_code", { code: "print(open('src/a.js').read())", description: "d" }))
console.log("  terminal_send 硬复位           ->", p("terminal_send", { sessionId: "t1", text: HARD_RESET }))
console.log("  terminal_send 跑测试           ->", p("terminal_send", { sessionId: "t1", text: "pytest -q" }))
console.log("  working_directory cd 出根      ->", p("working_directory", { cd: "../../.." }))
console.log("  working_directory cd 项目内    ->", p("working_directory", { cd: "src" }))
console.log("  lsp 查 auth 文件（只读面）     ->", p("lsp", { operation: "goToDefinition", file_path: cwd + "/src/auth/x.js", line: 1, character: 1 }))
console.log("  create_worktree（命令面无文本）->", p("create_worktree", { name: "vw-x" }))
