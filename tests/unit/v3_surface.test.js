// 波次 A4 单测钉：0.2.1-rc.3 命令面/只读面分类 + 参数形态分支。
//
// 纪律（FIXES §A4）：禁止 `^terminal_` / `^mcp__` 前缀通配——通配等于给未来工具发
// 免检牌（本波刚以同样理由拆掉 session_*/agent_*）。工具名与参数名全部按 0.2.1-rc.3
// 实测逐个列：dsh-tool-working-directory{cd} / dsh-tool-terminal{sessionId,text} /
// dsh-tools:955 run_code{code} / dsh-experimental-tool-worktree{name} /
// dsh-tool-schedule{prompt,...} / @deepseek-ai/dsh-tool-lsp{operation,file_path}（只读）。
import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  preExecuteDecision,
  isCommandTool,
  isReadOnlyTool,
  isGuardedTool,
  commandTextFromArgs,
  programTextFromArgs,
  dirTargetFromArgs,
  codeCommandTexts,
} from "../../src/lib.js"

function project() {
  const root = mkdtempSync(join(tmpdir(), "vwsurf-"))
  mkdirSync(join(root, "tests"), { recursive: true })
  writeFileSync(join(root, "tests", "verification_log.md"), "## Task\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n")
  writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n")
  mkdirSync(join(root, "src"), { recursive: true })
  return root
}
const decide = (root, toolName, args) => preExecuteDecision({ toolName, args, cwd: root, cfg: {} })

test("A4: V3 命令面工具名逐个在册（无前缀通配）", () => {
  for (const n of ["run_code", "working_directory", "create_worktree", "schedule_create",
    "schedule_update", "terminal_open", "terminal_send", "terminal_signal", "bash", "pwsh"]) {
    assert.ok(isCommandTool(n), `${n} 应归命令面`)
  }
  // 通配禁令：同族但不在册的名字不得因为前缀像而被认成命令面
  assert.ok(!isCommandTool("terminal_teleport"), "^terminal_ 前缀通配 = 免检牌")
  assert.ok(!isCommandTool("mcp__foo__bar"), "mcp__ 前缀不得通配（未知名字归写面）")
  assert.ok(!isReadOnlyTool("terminal_teleport"))
})

test("A4: lsp 归只读面（0.0.1-rc.1 参数 operation/file_path/line/character，纯导航）", () => {
  assert.ok(isReadOnlyTool("lsp"), "lsp 是查询工具，不是命令面")
  assert.ok(!isCommandTool("lsp"))
  assert.ok(!isGuardedTool("lsp"), "只读面两个门都不进：每次 lsp 查询都跑一遍后置门禁是误伤")
})

test("A4: 命令面文本按参数形态取（bash.command / terminal_send.text / run_code.code）", () => {
  assert.equal(commandTextFromArgs("bash", { command: "ls" }), "ls")
  assert.equal(commandTextFromArgs("terminal_send", { sessionId: "t1", text: "ls" }), "ls")
  // run_code 的 code 是程序不是 shell：走 programTextFromArgs + codeCommandTexts
  assert.equal(commandTextFromArgs("run_code", { code: "print(1)", description: "d" }), "")
  assert.equal(programTextFromArgs("run_code", { code: "print(1)", description: "d" }), "print(1)")
  assert.equal(programTextFromArgs("bash", { command: "ls" }), "")
  // 形态错配不得串台：str_replace_editor 也有个叫 command 的参数（view/create/...）
  assert.equal(commandTextFromArgs("str_replace_editor", { command: "str_replace", path: "/x" }), "")
  assert.equal(commandTextFromArgs("working_directory", { cd: "../.." }), "")
})

test("A4: run_code 程序里的递归删除走与 shell 同一张表（判据 #8）", () => {
  const root = project()
  const d = decide(root, "run_code", { code: "import shutil\nshutil.rmtree('src')", description: "clean" })
  assert.ok(d.deny, "run_code 递归删非白名单路径必须 DENY（今天命令文本抽不出来 → 放行）")
  assert.match(d.deny, /destructive|破坏性/i)
  // 白名单与 shell 面同源：删 node_modules 不拦
  const ok = decide(root, "run_code", { code: "import shutil\nshutil.rmtree('node_modules')", description: "d" })
  assert.equal(ok.deny, null, "白名单目标（node_modules）不得误拦")
  // 非递归删除（等价 rm -f）不拦——与 shell 面 rm -f 同判
  const single = decide(root, "run_code", { code: "import os\nos.remove('src/a.txt')", description: "d" })
  assert.equal(single.deny, null, "单文件删除与 rm -f 同级，不在破坏性表内")
  rmSync(root, { recursive: true, force: true })
})

test("A4: run_code 起 shell（os.system / child_process.exec）继承 shell 面全部规则", () => {
  const root = project()
  const g = "git " + "reset --hard"
  const d = decide(root, "run_code", { code: `import os\nos.system("${g}")`, description: "d" })
  assert.ok(d.deny, "os.system 里的破坏性命令必须与 bash 同判")
  const nested = decide(root, "run_code", { code: `require("child_process").execSync("rm -rf src")`, description: "d" })
  assert.ok(nested.deny, "child_process.exec 里的 rm -rf 同判")
  const safe = decide(root, "run_code", { code: `os.system("git status")`, description: "d" })
  assert.equal(safe.deny, null, "非破坏性 shell 调用不得误拦")
  rmSync(root, { recursive: true, force: true })
})

test("A4: terminal_send{text} 继承 shell 面规则（判据 #8）", () => {
  const root = project()
  const g = "git " + "reset --hard"
  const d = decide(root, "terminal_send", { sessionId: "t1", text: g })
  assert.ok(d.deny, "往常驻 shell 写破坏性命令与 bash 同判")
  const d2 = decide(root, "terminal_send", { sessionId: "t1", text: "pytest -q" })
  assert.equal(d2.deny, null)
  rmSync(root, { recursive: true, force: true })
})

test("A4: working_directory{cd} 出项目根 → 提示不 deny；项目内 cd 完全静默（判据 #8）", () => {
  const root = project()
  const out = decide(root, "working_directory", { cd: "../../.." })
  assert.equal(out.deny, null, "cd 是 dsh 的正常能力，门禁无权拦路")
  assert.equal(out.warn.length, 1, "但必须提示：门禁按项目根归属，切出去就不再生效")
  assert.match(out.warn[0], /项目根|working_directory/)
  const inside = decide(root, "working_directory", { cd: "src" })
  assert.equal(inside.warn.length, 0, "项目内 cd 不得刷屏")
  assert.equal(dirTargetFromArgs("working_directory", { cd: "src" }), "src")
  assert.equal(dirTargetFromArgs("terminal_open", { type: "shell", cwd: "src" }), "src")
  assert.equal(dirTargetFromArgs("working_directory", {}), null, "只读当前目录不带 cd → 无目标")
  rmSync(root, { recursive: true, force: true })
})

test("A4: codeCommandTexts 只抽等价破坏动作，不当字符串解析器", () => {
  assert.deepEqual(codeCommandTexts("shutil.rmtree('src')"), ["rm -rf src"])
  assert.deepEqual(codeCommandTexts('fs.rmSync("build", { recursive: true })'), ["rm -rf build"])
  assert.deepEqual(codeCommandTexts('fs.rmSync("x.txt")'), [], "无 recursive:true 不算递归删除")
  assert.deepEqual(codeCommandTexts('os.system("rm -rf src")'), ["rm -rf src"])
  assert.deepEqual(codeCommandTexts("print('hello')"), [])
  assert.deepEqual(codeCommandTexts(""), [])
})
