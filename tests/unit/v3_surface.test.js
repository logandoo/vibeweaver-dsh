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

// ── 评审 R1 修复钉（Important-2/3 + Minor）─────────────────────────────────
test("R1: 省略接收者的递归删除同样在册（from shutil import rmtree 曾漏网）", () => {
  const root = project()
  const cases = [
    "from shutil import rmtree\nrmtree('src')",
    "import { rmSync } from 'node:fs'\nrmSync('src', { recursive: true })",
    "import { rm } from 'fs/promises'\nawait rm('src', { recursive: true })",
    "import subprocess\nsubprocess.run('rm -rf src', shell=True)",
    "import subprocess\nsubprocess.getoutput('rm -rf src')",
    `require("child_process").spawn("rm", ["-rf", "src"])`,
    "import os\nos.spawnl(os.P_WAIT, '/bin/rm', '-rf', 'src')",
  ]
  for (const code of cases) {
    const d = decide(root, "run_code", { code, description: "d" })
    assert.ok(d.deny, `应拦：${code.split("\n")[1] || code}`)
  }
  // 白名单与"不带 recursive"仍放行（补覆盖面不等于宁可错杀）
  assert.equal(decide(root, "run_code", { code: "from shutil import rmtree\nrmtree('node_modules')", description: "d" }).deny, null)
  assert.equal(decide(root, "run_code", { code: "import os\nos.rmdir('empty-dir')", description: "d" }).deny, null)
  rmSync(root, { recursive: true, force: true })
})

test("R1: run_code 的写/删落点交回路径守卫（受保护证据 + 风险路径）", () => {
  const root = project()
  const prot = decide(root, "run_code", { code: "import os\nos.remove('tests/acceptance.md')", description: "d" })
  assert.ok(prot.deny, "os.remove 受保护判据必须 DENY（写面同动作被拦，命令面不能豁免）")
  const trunc = decide(root, "run_code", { code: `open('tests/acceptance.md','w').close()`, description: "d" })
  assert.ok(trunc.deny, "open(...,'w') 截断受保护判据必须 DENY")
  const risk = decide(root, "run_code", { code: `open('src/auth/r.py','w').write('x')`, description: "d" })
  assert.ok(risk.deny, "代码里写风险级路径与写面同判")
  const lock = decide(root, "run_code", { code: "import os\nos.remove('tests/.evidence.lock')", description: "d" })
  assert.ok(lock.deny, "锁只能由脚本写")
  // 读不算动作
  assert.equal(decide(root, "run_code", { code: `print(open('tests/acceptance.md').read())`, description: "d" }).deny, null)
  assert.equal(decide(root, "run_code", { code: `open('src/a.js').read()`, description: "d" }).deny, null)
  rmSync(root, { recursive: true, force: true })
})

test("R1: 多行文本逐行补扫（terminal_send 粘贴两行是常态）", () => {
  const root = project()
  const g = "git " + "reset --hard"
  assert.ok(decide(root, "terminal_send", { sessionId: "t", text: `echo hi\n${g}` }).deny, "第二行的破坏性命令必须看见")
  assert.ok(decide(root, "bash", { command: `true\nrm -rf src` }).deny, "bash 多行同判")
  assert.equal(decide(root, "bash", { command: "echo hi\ngit status" }).deny, null)
  rmSync(root, { recursive: true, force: true })
})

test("R1: 注释行不参与抽取（拦无害文本的代价是让人学会忽略门禁）", () => {
  const root = project()
  const d = decide(root, "run_code", { code: "# 注意：不要 shutil.rmtree('src')\nprint(1)", description: "d" })
  assert.equal(d.deny, null, "注释里提到破坏动作不是动作")
  const d2 = decide(root, "run_code", { code: "// rm -rf src 是禁止的\nconsole.log(1)", description: "d" })
  assert.equal(d2.deny, null)
  rmSync(root, { recursive: true, force: true })
})

test("R1: create_worktree 换目录必须提示（它同样会摘掉门禁）", () => {
  const root = project()
  const d = decide(root, "create_worktree", { name: "vw-x" })
  assert.equal(d.deny, null)
  assert.equal(d.warn.length, 1)
  assert.match(d.warn[0], /create_worktree/)
  rmSync(root, { recursive: true, force: true })
})

// ── 评审 R1 复评修复钉 ──────────────────────────────────────────────────────
const TQ = '"' + '"' + '"'   // 三引号，写成拼接避免源码里出现三连字符
const tq = (p) => `os.remove(${TQ}${p}${TQ})`

test("R1复评: 双参写/搬 API 的落点是目标参数（反向覆盖受保护证据曾放行）", () => {
  const root = project()
  const evil = "/tmp/evil.txt"
  const cases = [
    `import shutil\nshutil.copyfile('${evil}', 'tests/acceptance.md')`,
    `import shutil\nshutil.copy('${evil}', 'tests/acceptance.md')`,
    `import os\nos.replace('${evil}', 'tests/acceptance.md')`,
    `import os\nos.rename('${evil}', 'tests/acceptance.md')`,
    `fs.copyFileSync('${evil}', 'tests/acceptance.md')`,
    `import shutil\nshutil.copytree('/tmp/x', 'src/auth')`,
    `import os\nos.symlink('${evil}', 'tests/acceptance.md')`,
  ]
  for (const code of cases) {
    const d = decide(root, "run_code", { code, description: "d" })
    assert.ok(d.deny, `应拦目标参数：${code.split("\n").pop()}`)
  }
  // 源只是读：把风险文件备份出去不是改写风险路径（复评的误拦实例）
  const backup = decide(root, "run_code", { code: `import shutil\nshutil.copyfile('src/auth/r.py', '/tmp/bak.py')`, description: "d" })
  assert.equal(backup.deny, null, "copy 的源是读，不该按风险路径写拦")
  // 但搬走（源消失）仍要拦：move/rename 两头都是动作
  const moved = decide(root, "run_code", { code: `import shutil\nshutil.move('tests/acceptance.md', '/tmp/bak')`, description: "d" })
  assert.ok(moved.deny, "move 会让受保护判据消失")
  rmSync(root, { recursive: true, force: true })
})

test("R1复评: 三引号载荷不是盲区（三连引号曾被两个抽取器读成空串）", () => {
  const root = project()
  const g = "git " + "reset --hard"
  assert.ok(decide(root, "run_code", { code: tq("tests/acceptance.md"), description: "d" }).deny, "os.remove(\"\"\"…\"\"\")")
  assert.ok(decide(root, "run_code", { code: `open(${TQ}tests/acceptance.md${TQ}, "w")`, description: "d" }).deny, "open(\"\"\"…\"\"\", \"w\")")
  assert.ok(decide(root, "run_code", { code: `os.system(${TQ}${g}${TQ})`, description: "d" }).deny, "os.system(\"\"\"…\"\"\")")
  assert.ok(decide(root, "run_code", { code: "execSync(```rm -rf src```)", description: "d" }).deny, "execSync(```…```)")
  assert.ok(decide(root, "run_code", { code: tq("src") + "\nimport shutil\nshutil.rmtree(" + TQ + "src" + TQ + ")", description: "d" }).deny)
  rmSync(root, { recursive: true, force: true })
})

test("R1复评: 字符串里的『提到』不是动作（掩码），真调用仍在字符串外命中", () => {
  const root = project()
  const mention = decide(root, "run_code", { code: `cases = ["shutil.rmtree('src') must deny"]\nprint(cases)`, description: "d" })
  assert.equal(mention.deny, null, "测试数据里的命令文本不是动作")
  const doc = decide(root, "run_code", { code: `check("os.remove('tests/acceptance.md') is blocked")`, description: "d" })
  assert.equal(doc.deny, null)
  const real = decide(root, "run_code", { code: "import shutil\nshutil.rmtree('src')", description: "d" })
  assert.ok(real.deny, "掩码不得把真调用一起掩掉")
  rmSync(root, { recursive: true, force: true })
})

test("R1复评: 读模式与同名方法不误拦", () => {
  const root = project()
  assert.equal(decide(root, "run_code", { code: `print(pathlib.Path('tests/acceptance.md').open().read())`, description: "d" }).deny, null, "Path(...).open() 默认读")
  assert.ok(decide(root, "run_code", { code: `pathlib.Path('tests/acceptance.md').open("w").close()`, description: "d" }).deny, "Path(...).open(\"w\") 是写")
  assert.equal(decide(root, "run_code", { code: `cursor.execute("select 1")\ndb.exec("truncate table users")`, description: "d" }).deny, null, "同名 exec 不是 shell")
  assert.equal(decide(root, "run_code", { code: "os.removedirs('empty/a')", description: "d" }).deny, null, "removedirs 只删空目录，与 rmdir -p 同判")
  rmSync(root, { recursive: true, force: true })
})

// ── 遗留项收口（评审列出的四类已知豁免）────────────────────────────────────
test("遗留项: /bin/rm 与 /usr/bin/rm 绝对路径形式同样在册", () => {
  const root = project()
  assert.ok(decide(root, "bash", { command: "/bin/rm -rf src" }).deny, "/bin/rm 与 rm 是同一个动作")
  assert.ok(decide(root, "bash", { command: "true && /usr/bin/rm -rf src" }).deny, "复合段里的绝对路径也要认出")
  assert.equal(decide(root, "bash", { command: "/bin/rm -rf /tmp/vw-scratch" }).deny, null, "白名单目标仍然放行")
  rmSync(root, { recursive: true, force: true })
})

test("遗留项: 反斜杠续行先归一化再扫描", () => {
  const root = project()
  assert.ok(decide(root, "bash", { command: "rm -rf \\\n src" }).deny, "rm -rf \\ + 换行 + 目标")
  assert.ok(decide(root, "bash", { command: "rm \\\n -rf src" }).deny, "参数被换行拆开")
  assert.ok(decide(root, "bash", { command: "rm -\\\nrf src" }).deny, "shell 语义是删除反斜杠+换行（不是换空格）")
  assert.equal(decide(root, "bash", { command: "echo a \\\n b" }).deny, null, "无害续行不误拦")
  rmSync(root, { recursive: true, force: true })
})

test("遗留项: require('rimraf').sync(x) 形态", () => {
  const root = project()
  assert.ok(decide(root, "run_code", { code: `require('rimraf').sync('src')`, description: "d" }).deny, "包名与调用被引号隔开也要认出")
  assert.ok(decide(root, "run_code", { code: `import rimraf from 'rimraf'\nrimraf.sync('src')`, description: "d" }).deny, "import 后的裸调用同样在册")
  assert.equal(decide(root, "run_code", { code: `require('rimraf').sync('node_modules')`, description: "d" }).deny, null, "白名单目标放行")
  rmSync(root, { recursive: true, force: true })
})

test("遗留项: os.exec*/spawn* 的 argv 载荷", () => {
  const root = project()
  const g = "git " + "reset --hard"
  assert.ok(decide(root, "run_code", { code: `import os
os.execvp("/bin/sh", ["-c", "rm -rf src"])`, description: "d" }).deny, "命令藏在 argv 的 -c 后面")
  assert.ok(decide(root, "run_code", { code: `import os
os.execvp("/bin/sh", ["-c", "${g}"])`, description: "d" }).deny, "argv 里的破坏性命令同判")
  assert.equal(decide(root, "run_code", { code: `import os
os.execvp("/bin/sh", ["-c", "git status"])`, description: "d" }).deny, null, "无害 argv 不误拦")
  assert.ok(decide(root, "run_code", { code: `import os\nos.posix_spawn("/bin/sh", ["-c", "rm -rf src"], os.environ)`, description: "d" }).deny, "posix_spawn 形态")
  assert.ok(decide(root, "run_code", { code: `import os\nos.spawnv(os.P_WAIT, "/bin/sh", ["-c", "rm -rf src"])`, description: "d" }).deny, "spawnv(mode, prog, argv) 形态")
  rmSync(root, { recursive: true, force: true })
})

test("R1复评: 多行补扫只把『多条命令』当命令，跨行字符串与 heredoc 是数据", () => {
  const root = project()
  const g = "git " + "reset --hard"
  assert.ok(decide(root, "terminal_send", { sessionId: "t", text: `echo hi\n${g}` }).deny, "两条命令必须逐行看")
  assert.equal(decide(root, "bash", { command: "cat > docs.md <<'EOF'\nNever run\nrm -rf src\nEOF" }).deny, null, "heredoc 体是数据")
  // 已知豁免（刻意保留）：硬复位那条规则不锚定命令位，所以提交说明里出现该短语同样被拦。
  // 锚定后 `bash -c "<硬复位>"` 会一起放过——权衡下选择继续拦。实测真值见
  // tests/dsh-a-boundaries.log：bash -c 形态 DENY、heredoc 形态 allow。
  rmSync(root, { recursive: true, force: true })
})
