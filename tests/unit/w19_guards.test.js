// w19.0 同步波新增机制的单测钉（checker pin / 风险路径 / 破坏性守卫 / 激活标记 /
// DOC 类守卫 / 符号链接安全路径 / warn 档 / canonical 组 22 与 --root 在位）
import test from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  verifyChecker,
  checkGate,
  resolveWritePath,
  relativeUnderRoot,
  riskPathBlock,
  riskCommandBlock,
  destructiveBlock,
  classGuardBlock,
  preExecuteDecision,
  isPlausibleAssertScript,
  isGuardedTool,
  isReadOnlyTool,
  protectedEvidenceCheck,
  riskApproved,
  findProjectRoot,
  runAssert,
  invalidateGateCache,
  inlineCheck,
  pythonBin,
  assertTimeoutMs,
  covenantCard,
} from "../../src/lib.js"

const REPO_ASSERT = readFileSync(new URL("../../tests/assert_artifacts.py", import.meta.url), "utf8")
const PNG640 = Buffer.from("89504e470d0a1a0a0000000d4948445200000280000001900806000000" + "00".repeat(32), "hex")

function tmp() {
  return mkdtempSync(join(tmpdir(), "vww19-"))
}
function project({ log = "## Task\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n", assertScript = REPO_ASSERT } = {}) {
  const root = tmp()
  mkdirSync(join(root, "tests"), { recursive: true })
  writeFileSync(join(root, "tests", "verification_log.md"), log)
  writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n")
  if (assertScript !== null) writeFileSync(join(root, "tests", "assert_artifacts.py"), assertScript)
  return root
}
function fullProject() {
  // 与 lib.test.js 的 makeFullProject 同构：满足 canonical 全组证据
  const root = project({ log: "## Task\n- class: CODE — t\n- Baseline verified GREEN\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" })
  mkdirSync(join(root, "memory"), { recursive: true })
  mkdirSync(join(root, "script", "linux"), { recursive: true })
  writeFileSync(join(root, ".gitignore"), ".DS_Store\nnode_modules/\n.venv/\n.env\n__pycache__/\n")
  writeFileSync(join(root, "memory", "MEMORY.md"), "# Index\n- [T](topic.md) — t\n")
  writeFileSync(join(root, "memory", "topic.md"), "# T\n")
  for (const s of ["start.sh", "stop.sh", "restart.sh", "project_build.sh"]) {
    const p = join(root, "script", "linux", s)
    writeFileSync(p, "#!/usr/bin/env bash\ntrue\n")
    chmodSync(p, 0o755)
  }
  for (const d of ["FLOW_DESIGN.html", "DATABASE_DESIGN.html", "BACKEND_DESIGN.html", "PAGE_DESIGN.html"]) {
    writeFileSync(join(root, d), "<html>doc</html>\n")
  }
  writeFileSync(join(root, "README.md"), "# R\n")
  writeFileSync(join(root, "requirements.txt"), "\n")
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root })
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: root })
  execFileSync("git", ["config", "user.name", "t"], { cwd: root })
  execFileSync("git", ["add", "-A"], { cwd: root })
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: root })
  return root
}

// ───────────────────────── checker pin（主线 W0 Task 2） ─────────────────────────
test("checker pin: 副本摘要 ≠ 正源 pin → not ok 且给出修复指引", () => {
  const root = project()
  writeFileSync(join(root, "tests", "assert_artifacts.py"), "# verification_log acceptance cap=5 marker\nprint('all 99 checks pass')\n")
  const pinHome = tmp()
  mkdirSync(join(pinHome, "scripts"), { recursive: true })
  writeFileSync(join(pinHome, "scripts", "assert_artifacts.sha256"),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  assert_artifacts.py\n")
  const r = verifyChecker(root, { skillSourceDir: pinHome })
  assert.equal(r.ok, false, "digest mismatch must fail closed")
  assert.match(r.reason, /digest .* != pinned /)
  assert.match(r.reason, /checker was modified or is a stub/)
  rmSync(root, { recursive: true, force: true })
  rmSync(pinHome, { recursive: true, force: true })
})

test("checker pin: 副本与正源一致 → ok 无 warning", () => {
  const root = project()
  const digest = execFileSync("shasum", ["-a", "256", join(root, "tests", "assert_artifacts.py")], { encoding: "utf8" }).trim().split(/\s+/)[0]
  const pinHome = tmp()
  mkdirSync(join(pinHome, "scripts"), { recursive: true })
  writeFileSync(join(pinHome, "scripts", "assert_artifacts.sha256"), digest + "  assert_artifacts.py\n")
  const r = verifyChecker(root, { skillSourceDir: pinHome })
  assert.equal(r.ok, true)
  assert.equal(r.warning, "")
  rmSync(root, { recursive: true, force: true })
  rmSync(pinHome, { recursive: true, force: true })
})

test("checker pin: pin 文件缺失 → ok + warning（legacy 一版宽限）", () => {
  const root = project()
  const pinHome = tmp()
  const r = verifyChecker(root, { skillSourceDir: pinHome })
  assert.equal(r.ok, true, "missing pin must not block legacy projects")
  assert.match(r.warning, /checker pin unavailable/)
  rmSync(root, { recursive: true, force: true })
  rmSync(pinHome, { recursive: true, force: true })
})

test("checker pin: 无 tests/assert_artifacts.py → ok（交给内联检查）", () => {
  const root = project({ assertScript: null })
  const r = verifyChecker(root, { skillSourceDir: tmp() })
  assert.equal(r.ok, true)
  rmSync(root, { recursive: true, force: true })
})

test("checker pin: ALLOW_CUSTOM_CHECKER 豁免；CI 环境下豁免失效", () => {
  const root = project()
  writeFileSync(join(root, "tests", "assert_artifacts.py"), "# verification_log acceptance cap=5 marker\nimport sys\nsys.exit(0)\n")
  const pinHome = tmp()
  mkdirSync(join(pinHome, "scripts"), { recursive: true })
  writeFileSync(join(pinHome, "scripts", "assert_artifacts.sha256"), "f".repeat(64) + "  assert_artifacts.py\n")
  process.env.VIBEWEAVER_ALLOW_CUSTOM_CHECKER = "1"
  delete process.env.CI
  assert.equal(verifyChecker(root, { skillSourceDir: pinHome }).ok, true, "host override must be honoured")
  assert.match(verifyChecker(root, { skillSourceDir: pinHome }).warning, /custom checker allowed/)
  process.env.CI = "true"
  const ci = verifyChecker(root, { skillSourceDir: pinHome })
  assert.equal(ci.ok, false, "override is forbidden in CI")
  assert.match(ci.reason, /forbidden in CI/)
  delete process.env.VIBEWEAVER_ALLOW_CUSTOM_CHECKER
  delete process.env.CI
  rmSync(root, { recursive: true, force: true })
  rmSync(pinHome, { recursive: true, force: true })
})

test("checkGate: 带 marker 的伪副本被 pin 拦在运行之前", () => {
  const root = project()
  writeFileSync(join(root, "tests", "assert_artifacts.py"),
    "# verification_log acceptance.md cap=5 — 三标记齐全的空壳（专测 pin 层，不是空壳层）\nprint('assert_artifacts.py: all 40 checks pass (exit 0)')\n")
  const pinHome = tmp()
  mkdirSync(join(pinHome, "scripts"), { recursive: true })
  writeFileSync(join(pinHome, "scripts", "assert_artifacts.sha256"), "a".repeat(64) + "  assert_artifacts.py\n")
  const gate = checkGate(root, { skillSourceDir: pinHome })
  assert.ok(gate && gate.blocking.length > 0, "a stub that prints the success shape must block")
  assert.match(gate.blocking[0], /pinned/)
  rmSync(root, { recursive: true, force: true })
  rmSync(pinHome, { recursive: true, force: true })
})

// ───────────────────── 风险路径 / 破坏性命令（主线 W1） ─────────────────────
function withApprovals(root, text) {
  writeFileSync(join(root, "tests", "decisions.md"), text)
  return root
}

test("风险路径: write 命中 auth/security/payment/migration/acl → block 文案给出 risk-approved", () => {
  const root = project()
  for (const p of ["src/auth/login.js", "db/migrations/0002.sql", "pay/Payments.go", "lib/acl.py", "core/crypto.ts"]) {
    const msg = riskPathBlock(root, join(root, p))
    assert.ok(msg, p + " must be gated")
    assert.match(msg, /risk-path gate/)
    assert.match(msg, new RegExp("risk-approved: " + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }
  assert.equal(riskPathBlock(root, join(root, "src/lib.js")), null)
  rmSync(root, { recursive: true, force: true })
})

test("风险路径: tests/decisions.md 的 risk-approved 行放行；env 关闸放行", () => {
  const root = withApprovals(project(), "D-1 | x\n- risk-approved: src/auth/login.js — 用户批准的登录修复\n")
  assert.equal(riskPathBlock(root, join(root, "src/auth/login.js")), null)
  assert.ok(riskPathBlock(root, join(root, "src/auth/admin.js")), "批准不扩展到兄弟路径")
  process.env.VIBEWEAVER_RISK_GATE = "off"
  assert.equal(riskPathBlock(root, join(root, "src/auth/admin.js")), null)
  delete process.env.VIBEWEAVER_RISK_GATE
  rmSync(root, { recursive: true, force: true })
})

test("风险路径: rm / git rm 删除风险目录同样需批准（命令面）", () => {
  const root = project()
  assert.match(riskCommandBlock(root, "rm -rf src/auth"), /risk-path gate/)
  assert.match(riskCommandBlock(root, "git rm -r db/migrations"), /risk-approved/)
  assert.equal(riskCommandBlock(root, "rm -f notes.txt"), null)
  rmSync(root, { recursive: true, force: true })
})

test("破坏性守卫: 主线六条规则 + 白名单逐例镜像", () => {
  const root = project()
  const blocked = [
    "git add -A",
    "git add --all .",
    "git reset --hard HEAD~1",
    "git clean -fdx",
    "git checkout -- .",
    "git restore -- .",
    "truncate -s 0 app.log",
    "rm -rf src",
    "rm -r -f secret_dir",
  ]
  for (const c of blocked) assert.ok(destructiveBlock(root, c), c + " must block")
  const allowed = [
    "git add -u",
    "git add src/lib.js",
    "rm -rf node_modules",
    "rm -rf .venv dist build coverage __pycache__",
    "rm -rf $TMPDIR/vw-run/foo",
    "rm -rf /tmp/x",
    "rm -f file.txt",
    "git commit -m x",
  ]
  for (const c of allowed) assert.equal(destructiveBlock(root, c), null, c + " must pass")
  rmSync(root, { recursive: true, force: true })
})

test("破坏性守卫: destructive-approved ADR 行放行该命令", () => {
  const root = withApprovals(project(), "- destructive-approved: git add -A — 用户要求全量入库并已知风险\n")
  assert.equal(destructiveBlock(root, "git add -A"), null)
  assert.ok(destructiveBlock(root, "git reset --hard"), "批准不外溢到其它破坏性命令")
  rmSync(root, { recursive: true, force: true })
})

// ───────────────────────── DOC 类降级守卫（主线 W1） ─────────────────────────
test("DOC 类守卫: 当前块 class:DOC + 源码扩展名写入 → block；prose/升类放行", () => {
  const docRoot = project({ log: "## Task\n- class: DOC — basis: 文档改写\n- iter 1 PASS: x\n" })
  assert.match(classGuardBlock(docRoot, join(docRoot, "src/app.py")), /class guard/)
  assert.match(classGuardBlock(docRoot, join(docRoot, "script/linux/start.sh")), /class guard/)
  assert.equal(classGuardBlock(docRoot, join(docRoot, "README.md")), null)
  assert.equal(classGuardBlock(docRoot, join(docRoot, "docs/PLAN.md")), null)
  const codeRoot = project({ log: "## Task\n- class: CODE — basis: 代码\n" })
  assert.equal(classGuardBlock(codeRoot, join(codeRoot, "src/app.py")), null)
  const noClass = project()
  assert.equal(classGuardBlock(noClass, join(noClass, "src/app.py")), null)
  rmSync(docRoot, { recursive: true, force: true })
  rmSync(codeRoot, { recursive: true, force: true })
  rmSync(noClass, { recursive: true, force: true })
})

// ───────────────────── 符号链接安全路径（主线 D3/BL-7 + 评审 R2） ─────────────────────
test("resolveWritePath: 目标自身符号链接 / 悬空链接 / 深层新建路径均归一到真实落点", () => {
  const root = tmp()
  const real = realpathSync(root)
  mkdirSync(join(root, "tests"), { recursive: true })
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "src", "app.py"), "print(1)\n")
  symlinkSync(join(root, "src", "app.py"), join(root, "tests", "escape.py"))
  assert.equal(resolveWritePath(join(root, "tests", "escape.py")), join(real, "src", "app.py"))
  symlinkSync(join(root, "src", "gone.py"), join(root, "tests", "dangling.py"))
  assert.equal(resolveWritePath(join(root, "tests", "dangling.py")), join(real, "src", "gone.py"))
  assert.equal(resolveWritePath(join(root, "tests", "new", "x.md")), join(real, "tests", "new", "x.md"))
  // 符号链接目录 tests -> real_tests：相对根归属按真实落点算，不再冒充 tests/ 证据面
  const root2 = realpathSync(tmp())
  mkdirSync(join(root2, "real_tests"), { recursive: true })
  symlinkSync(join(root2, "real_tests"), join(root2, "tests"))
  assert.equal(relativeUnderRoot(root2, join(root2, "tests", "a.md")), "real_tests/a.md")
  rmSync(root, { recursive: true, force: true })
  rmSync(root2, { recursive: true, force: true })
})

// ───────────────────────── 门禁激活标记 + GATE-INACTIVE ─────────────────────────
test("findProjectRoot: .vibeweaver/project.json 是第二激活标记", () => {
  const root = tmp()
  mkdirSync(join(root, ".vibeweaver"), { recursive: true })
  writeFileSync(join(root, ".vibeweaver", "project.json"), "{}\n")
  assert.equal(findProjectRoot(join(root, "src", "x.js")), root)
  rmSync(root, { recursive: true, force: true })
})

test("GATE-INACTIVE: 有标记无 verification_log → 仅 warning（一次性），绝不静默拦截", () => {
  const root = tmp()
  mkdirSync(join(root, ".vibeweaver"), { recursive: true })
  writeFileSync(join(root, ".vibeweaver", "project.json"), "{}\n")
  const g1 = checkGate(root, { skillSourceDir: tmp() })
  assert.ok(g1, "must report the inactive state instead of returning null twice in a row")
  assert.equal(g1.blocking.length, 0, "inactive gate must never block")
  assert.match(g1.warnings.join("\n"), /GATE-INACTIVE/)
  invalidateGateCache(root) // 绕开 1s 结果缓存，测"一次性"提示本身
  const g2 = checkGate(root, { skillSourceDir: tmp() })
  assert.ok(g2 === null || g2.warnings.length === 0, "the notice is one-per-session, not per-write")
  rmSync(root, { recursive: true, force: true })
})

// ───────────────────────── canonical 组 22 / --root 在位 ─────────────────────────
test("canonical 组 22: 项目缺 evidence_lock.py → WARN evidence-lock（不阻断）", () => {
  const root = fullProject()
  writeFileSync(join(root, "tests", "assert_artifacts.py"), REPO_ASSERT)
  const out = execFileSync("python3", [join(root, "tests", "assert_artifacts.py"), "--existing"], {
    cwd: root, encoding: "utf8", env: { ...process.env, VIBEWEAVER_HOME: root },
  })
  assert.match(out, /evidence lock: evidence_lock\.py not installed/)
  rmSync(root, { recursive: true, force: true })
})

test("canonical --root: 脚本可从他处对项目根执行（未知旗标即回归）", () => {
  const root = fullProject()
  const elsewhere = tmp()
  writeFileSync(join(elsewhere, "assert_artifacts.py"), REPO_ASSERT)
  let out = ""
  try {
    out = execFileSync("python3", [join(elsewhere, "assert_artifacts.py"), "--root", root, "--existing"], { encoding: "utf8" }).trim()
  } catch (e) {
    out = String(e.stdout || "") + String(e.stderr || "")
  }
  assert.doesNotMatch(out, /unrecognized arguments: --root/)
  assert.match(out, /assert_artifacts\.py: |^\{"ok"/)
  rmSync(root, { recursive: true, force: true })
  rmSync(elsewhere, { recursive: true, force: true })
})

// ───────────────────────── inlineCheck 文法 + 运行器 env 覆盖 ─────────────────────────
test("inlineCheck: PASS 词边界文法与主线一致（装饰形式计分）", () => {
  const root = tmp()
  mkdirSync(join(root, "tests"), { recursive: true })
  writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n")
  writeFileSync(join(root, "tests", "verification_log.md"), "## Task\n- iter 1 PASS [C]: 判据 1 — x\n")
  const fails = inlineCheck(root)
  assert.ok(!fails.some((m) => m.includes("verification_log")), `- iter 1 PASS [C]: 必须计为迭代证据，got ${JSON.stringify(fails)}`)
  rmSync(root, { recursive: true, force: true })
})

test("runAssert 运行器: VIBEWEAVER_PYTHON / VIBEWEAVER_ASSERT_TIMEOUT_MS 覆盖生效", () => {
  const before = process.env.VIBEWEAVER_PYTHON
  process.env.VIBEWEAVER_PYTHON = "/usr/bin/python3.99"
  assert.equal(pythonBin(), "/usr/bin/python3.99")
  delete process.env.VIBEWEAVER_PYTHON
  assert.equal(pythonBin(), "python3")
  if (before) process.env.VIBEWEAVER_PYTHON = before
  process.env.VIBEWEAVER_ASSERT_TIMEOUT_MS = "12345"
  assert.equal(assertTimeoutMs(), 12345)
  delete process.env.VIBEWEAVER_ASSERT_TIMEOUT_MS
  assert.equal(assertTimeoutMs(), 8000)
})

// ───────────────────────── pre-execute 决策入口 + warn 档 ─────────────────────────
test("preExecuteDecision: block 档 deny 风险写入与破坏性命令；allow 透传普通调用", () => {
  const root = project()
  const d1 = preExecuteDecision({ toolName: "write", args: { file_path: join(root, "src/auth/login.js") }, cwd: root, cfg: {} })
  assert.equal(d1.deny && /risk-path gate/.test(d1.deny), true, JSON.stringify(d1))
  const d2 = preExecuteDecision({ toolName: "bash", args: { command: "git add -A" }, cwd: root, cfg: {} })
  assert.match(d2.deny, /destructive guard/)
  const d3 = preExecuteDecision({ toolName: "write", args: { file_path: join(root, "src/lib.js") }, cwd: root, cfg: {} })
  assert.equal(d3.deny, null)
  const d4 = preExecuteDecision({ toolName: "read", args: { file_path: join(root, "src/auth/login.js") }, cwd: root, cfg: {} })
  assert.equal(d4.deny, null, "read 不在风险写入面内")
  rmSync(root, { recursive: true, force: true })
})

test("preExecuteDecision: gateMode=warn 只提示不 deny；off 完全放行", () => {
  const root = project()
  const warn = preExecuteDecision({ toolName: "bash", args: { command: "git reset --hard" }, cwd: root, cfg: { gateMode: "warn" } })
  assert.equal(warn.deny, null)
  assert.match(warn.warn.join("\n"), /destructive guard/)
  const off = preExecuteDecision({ toolName: "bash", args: { command: "git reset --hard" }, cwd: root, cfg: { gateMode: "off" } })
  assert.equal(off.deny, null)
  assert.deepEqual(off.warn, [])
  rmSync(root, { recursive: true, force: true })
})

test("preExecuteDecision: VIBEWEAVER_GATE=off 急停优先于一切守卫", () => {
  const root = project()
  process.env.VIBEWEAVER_GATE = "off"
  assert.equal(preExecuteDecision({ toolName: "bash", args: { command: "git add -A" }, cwd: root, cfg: {} }).deny, null)
  delete process.env.VIBEWEAVER_GATE
  rmSync(root, { recursive: true, force: true })
})

// ───────────────────────── 契约卡：COV-0 + §A7.7.1 + 组计数 ─────────────────────────
// ─────────── 接线级（apply 真实装配，不是纯函数单测） ───────────
test("N4 接线：warn 档会话渲染出的契约卡确实改口（曾是死代码）", async () => {
  const { apply } = await import("../../src/index.js")
  const ctx = makeCtx()
  apply(ctx, { skillSourceDir: tmp(), gateMode: "warn" })
  const section = ctx.systemPrompt.sections.find((x) => x.name === "vibeweaver-covenant")
  assert.ok(section, "契约段必须注册")
  const text = typeof section.text === "function" ? section.text() : section.text
  assert.match(text, /gateMode=warn：门禁仅提示不阻断/)
  const ctx2 = makeCtx()
  apply(ctx2, { skillSourceDir: tmp() })
  const t2 = ctx2.systemPrompt.sections.find((x) => x.name === "vibeweaver-covenant").text()
  assert.doesNotMatch(t2, /gateMode=warn：门禁仅提示不阻断/, "block 档不得出现 warn 说明")
  assert.match(t2, /急停: VIBEWEAVER_GATE=off/)
})

test("I2 接线：非白名单写工具（str_replace_editor）也走后置证据门禁", async () => {
  const { apply } = await import("../../src/index.js")
  const root = project({ log: "", assertScript: null })
  writeFileSync(join(root, "tests", "acceptance.md"), "")
  const ctx = makeCtx()
  apply(ctx, { skillSourceDir: tmp() })
  const res = await ctx.fire("tools/post-execute",
    { name: "str_replace_editor", arguments: { path: join(root, "src", "x.js") }, agent: agentOf("s9", root), callId: "c9" },
    { content: [{ type: "text", text: "ok" }], isError: false },
    async () => ({ kind: "accept", content: [{ type: "text", text: "ok" }] }))
  assert.equal(res.kind, "block", "空日志 + 无检查器 = 证据不足，写工具必须被门禁回拦")
  assert.match((res.feedback[0].text || ""), /verification_log|assertion script|GATE-BLOCKED/)
  // 只读工具不得进后置门禁（否则读一个文件就被要求补证据）
  const r2 = await ctx.fire("tools/post-execute",
    { name: "read", arguments: { file_path: join(root, "src", "x.js") }, agent: agentOf("s9", root), callId: "c10" },
    { content: [{ type: "text", text: "file" }], isError: false },
    async () => ({ kind: "accept", content: [{ type: "text", text: "file" }] }))
  assert.equal(r2.kind, "accept")
  rmSync(root, { recursive: true, force: true })
})

// ───────────── R2/R3 评审修复的回归钉（迭代 5） ─────────────
test("N3 无 pin 不得接管执行：正源桩不能把门禁洗绿（曾为重言式）", () => {
  const root = project({ log: "## Task\n- iter 1 PASS: x (evidence: tests/missing.png)\n" })
  writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n")
  rmSync(join(root, "tests", "assert_artifacts.py"))
  const home = tmp()
  mkdirSync(join(home, "scripts"), { recursive: true })
  // 无 assert_artifacts.sha256 = 无从验证 → 绝不执行这个"正源"，退回内联底线
  writeFileSync(join(home, "scripts", "assert_artifacts.py"),
    "# verification_log acceptance.md cap=5\nprint('assert_artifacts.py: all 99 checks pass (exit 0)')\n")
  const gate = checkGate(root, { skillSourceDir: home })
  assert.ok(gate && gate.blocking.length > 0, "无 pin 的桩正源必须不被采信；内联底线要拦住缺失截图")
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

test("I3 正源不认 --root 时自动退回（版本偏差不把门禁永久判红）", () => {
  const root = fullProject()
  rmSync(join(root, "tests", "assert_artifacts.py"))
  const home = tmp()
  mkdirSync(join(home, "scripts"), { recursive: true })
  const fake = [
    "#!/usr/bin/env python3",
    "import sys",
    "if '--root' in sys.argv: sys.exit('error: unrecognized arguments: --root')",
    "if '--help' in sys.argv: print('usage: assert_artifacts.py [-h] [--existing]'); sys.exit(0)",
    "print('assert_artifacts.py: all 40 checks pass (exit 0)')",
    "",
  ].join("\n")
  writeFileSync(join(home, "scripts", "assert_artifacts.py"), fake)
  const digest = execFileSync("shasum", ["-a", "256", join(home, "scripts", "assert_artifacts.py")], { encoding: "utf8" }).trim().split(/\s+/)[0]
  writeFileSync(join(home, "scripts", "assert_artifacts.sha256"), digest + "  assert_artifacts.py\n")
  const r = runAssert(root, { skillSourceDir: home })
  assert.equal(r.ok, true, "正源不认 --root 时应改走不带 --root 的调用而不是判红：" + JSON.stringify(r.attempts || ""))
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

test("N1/N2 受保护删除面：前导空白与复合段不得绕过；一条批准不外溢", () => {
  const root = project()
  const d = (cmd) => preExecuteDecision({ toolName: "bash", args: { command: cmd }, cwd: root, cfg: {} }).deny
  assert.match(d("   rm tests/assert_artifacts.py"), /evidence lock/, "前导空格曾让 ^ 锚点整体失效")
  assert.match(d("mv scratch.txt out.txt && rm tests/assert_artifacts.py"), /evidence lock/, "曾只查第一段")
  assert.match(d("dd if=/dev/zero of=tests/acceptance.md bs=1 count=1"), /evidence lock/, "dd of= 形态")
  assert.match(d("rm tests/acceptance.md tests/.evidence.lock"), /evidence lock/, "批准一个不得解锁另一个")
  assert.equal(d("rm scratch.txt"), null, "非受保护目标不误拦")
  assert.equal(d("git status tests/acceptance.md"), null, "无删除动词的只读命令不误拦")
  const approved = withApprovals(project(), "- risk-approved: tests/acceptance.md — 只批准改判据\n")
  const d2 = (cmd) => preExecuteDecision({ toolName: "bash", args: { command: cmd }, cwd: approved, cfg: {} }).deny
  assert.equal(d2("rm tests/acceptance.md"), null)
  assert.match(d2("rm tests/acceptance.md tests/assert_artifacts.py"), /evidence lock/, "同行未批准的受保护路径仍要拦")
  rmSync(root, { recursive: true, force: true })
  rmSync(approved, { recursive: true, force: true })
})

test("N5 文件级批准不得上溢解锁父目录；命令里的 ./ 归一", () => {
  const root = withApprovals(project(), "- risk-approved: src/auth/r.py — 用户只批准这一个文件\n")
  assert.equal(riskApproved(root, "src/auth/r.py"), true)
  assert.equal(riskApproved(root, "src/auth"), false, "文件批准解锁整个目录 = 上溢")
  assert.equal(riskApproved(root, "src/auth/login.js"), false)
  assert.match(riskCommandBlock(root, "rm -rf ./src/auth"), /risk-path gate/, "./ 前缀不得绕过")
  rmSync(root, { recursive: true, force: true })
})

test("M2 仓库自身的 *.lock（Cargo.lock 等）不是受保护证据", () => {
  const root = project()
  assert.equal(preExecuteDecision({ toolName: "write", args: { file_path: join(root, "Cargo.lock") }, cwd: root, cfg: {} }).deny, null)
  assert.notEqual(preExecuteDecision({ toolName: "write", args: { file_path: join(root, "tests", ".evidence.lock") }, cwd: root, cfg: {} }).deny, null)
  rmSync(root, { recursive: true, force: true })
})

test("M3 同一文件的相对/绝对两种写法不算参数冲突", () => {
  const root = project()
  const same = preExecuteDecision({ toolName: "write", args: { file_path: "src/a.js", path: join(root, "src", "a.js") }, cwd: root, cfg: {} })
  assert.equal(same.deny, null)
  const diff = preExecuteDecision({ toolName: "write", args: { file_path: "src/a.js", path: join(root, "src", "b.js") }, cwd: root, cfg: {} })
  assert.match(diff.deny, /arg guard/)
  rmSync(root, { recursive: true, force: true })
})

test("C1 dsh 真实只读工具（read_image/present/glob/grep）不进写面；pwsh 进命令面", () => {
  const root = project()
  for (const name of ["read", "read_image", "present", "glob", "grep", "web_fetch", "todo_write"]) {
    assert.equal(isReadOnlyTool(name), true, name + " 必须是只读面")
    assert.equal(preExecuteDecision({ toolName: name, args: { file_path: join(root, "src", "auth", "shot.png") }, cwd: root, cfg: {} }).deny, null,
      name + " 读风险命名文件不得被拦（COV-5 截图取证面）")
  }
  for (const name of ["write", "edit", "str_replace_editor", "multiedit", "apply_patch"]) {
    assert.equal(isGuardedTool(name) && !isReadOnlyTool(name), true, name + " 必须是写面")
  }
  assert.match(preExecuteDecision({ toolName: "pwsh", args: { command: "git " + "clean -fdx" }, cwd: root, cfg: {} }).deny, /destructive guard/, "Windows 命令面不得裸奔")
  // 通配免检牌不得存在：session_*/agent_* 这类前缀不能白名单化未来的写工具
  assert.equal(isReadOnlyTool("session_write_file"), false)
  assert.equal(isReadOnlyTool("agent_edit"), false)
  rmSync(root, { recursive: true, force: true })
})

test("I4 校验跑不了（python 缺失/超时）→ 提示而非判篡改", () => {
  const root = project()
  writeFileSync(join(root, "tests", ".evidence.lock"), "{}\n")
  const home = tmp()
  mkdirSync(join(home, "scripts"), { recursive: true })
  writeFileSync(join(home, "scripts", "evidence_lock.py"), "#!/usr/bin/env python3\nraise SystemExit(0)\n")
  process.env.VIBEWEAVER_PYTHON = "/nonexistent/python3.99"
  const r = protectedEvidenceCheck(root, join(root, "tests", "acceptance.md"), { skillSourceDir: home })
  delete process.env.VIBEWEAVER_PYTHON
  assert.equal(r.deny, null, "基础设施故障不得判成篡改：" + r.deny)
  assert.ok(r.warn.length > 0, "必须留下未校验的可见提示")
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

test("R2-M2 pin 缺失提示每会话一次（判据 #4 的一次性 WARN 字面承诺）", () => {
  const root = project()
  const home = tmp()
  const g1 = checkGate(root, { skillSourceDir: home })
  assert.ok(g1 && g1.warnings.some((w) => /checker pin unavailable/.test(w)), "首跑必须提示 pin 缺失")
  invalidateGateCache(root)
  const g2 = checkGate(root, { skillSourceDir: home })
  assert.ok(!g2 || !g2.warnings.some((w) => /checker pin unavailable/.test(w)), "同一 root+摘要 不得每写一次刷一遍")
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

test("R2-M4 卡面回补：COV-13 反降类句 / [Decisions] 字面 / §V11.9 格式覆盖面", () => {
  const card = covenantCard({})
  assert.match(card, /Class 决定哪些门跑，不决定证据存无/)
  assert.match(card, /\[Decisions\] N auto-decisions → tests\/decisions\.md/)
  assert.match(card, /ods\/odp\/odg/)
  assert.match(card, /无人时不阻塞/)
})

// ───────────────── R1 评审修复的回归钉（F1-F7） ─────────────────
test("F7 空壳检测: 单个 marker 注释不再冒充合法检查器（三标记 AND）", () => {
  const root = project()
  writeFileSync(join(root, "tests", "assert_artifacts.py"), "# acceptance.md\nimport sys\nsys.exit(0)\n")
  assert.equal(isPlausibleAssertScript(root), false, "OR 语义会让一行注释过关")
  writeFileSync(join(root, "tests", "assert_artifacts.py"), REPO_ASSERT)
  assert.equal(isPlausibleAssertScript(root), true)
  rmSync(root, { recursive: true, force: true })
})

test("F2 检查器被删不再降级成两行文本底线（正源检查器接管）", () => {
  const root = project({ log: "## Task\n- iter 1 PASS: pretend\n" })
  writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n")
  rmSync(join(root, "tests", "assert_artifacts.py"))
  const home = tmp()
  mkdirSync(join(home, "scripts"), { recursive: true })
  writeFileSync(join(home, "scripts", "assert_artifacts.py"), REPO_ASSERT)
  const digest = execFileSync("shasum", ["-a", "256", join(home, "scripts", "assert_artifacts.py")], { encoding: "utf8" }).trim().split(/\s+/)[0]
  writeFileSync(join(home, "scripts", "assert_artifacts.sha256"), digest + "  assert_artifacts.py\n")
  const gate = checkGate(root, { skillSourceDir: home })
  assert.ok(gate && gate.blocking.length > 0, "缺检查器时正源必须接管并判证据不足，而不是静默放行")
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

test("F3 工具名绕过: Bash 大写 / multiedit / apply_patch 仍在守卫面内；显式只读工具不误拦", () => {
  const root = project()
  const bashish = preExecuteDecision({ toolName: "Bash", args: { command: "rm -rf src" }, cwd: root, cfg: {} })
  assert.match(bashish.deny, /destructive guard/)
  const multi = preExecuteDecision({ toolName: "multiedit", args: { file_path: join(root, "src", "auth", "r.py") }, cwd: root, cfg: {} })
  assert.match(multi.deny, /risk-path gate/)
  const patch = preExecuteDecision({ toolName: "apply_patch", args: { path: join(root, "db", "migrations", "1.sql") }, cwd: root, cfg: {} })
  assert.match(patch.deny, /risk-path gate/)
  const reader = preExecuteDecision({ toolName: "read", args: { file_path: join(root, "src", "auth", "login.js") }, cwd: root, cfg: {} })
  assert.equal(reader.deny, null, "读工具不是写面，不得误拦")
  rmSync(root, { recursive: true, force: true })
})

test("F4 参数形态冲突（file_path≠path）→ deny，不静默跳过守卫", () => {
  const root = project()
  const d = preExecuteDecision({ toolName: "write", args: { file_path: join(root, "src", "a.js"), path: join(root, "src", "auth", "r.py"), filePath: join(root, "src", "b.js") }, cwd: root, cfg: {} })
  assert.match(d.deny, /arg guard/)
  const same = preExecuteDecision({ toolName: "write", args: { file_path: join(root, "src", "a.js"), path: join(root, "src", "a.js") }, cwd: root, cfg: {} })
  assert.equal(same.deny, null, "同值多拼写不是冲突")
  rmSync(root, { recursive: true, force: true })
})

test("F5 $HOME/$PWD 不是白名单目标（变量根 ≠ 临时目录）", () => {
  const root = project()
  assert.match(destructiveBlock(root, "rm -rf $HOME/.config"), /destructive guard/)
  assert.match(destructiveBlock(root, "rm -rf $PWD/src"), /destructive guard/)
  assert.equal(destructiveBlock(root, "rm -rf $TMPDIR/vw-run/x"), null)
  rmSync(root, { recursive: true, force: true })
})

test("F6 批准行按整路径/目录前缀命中，basename 不再万能钥匙", () => {
  const root = withApprovals(project(), "- risk-approved: r.py — 想解锁任意路径下的 r.py\n")
  assert.ok(riskPathBlock(root, join(root, "src", "auth", "r.py")), "basename 批准必须不成立")
  const dirRoot = withApprovals(project(), "- risk-approved: src/auth — 用户批准整目录\n")
  assert.equal(riskPathBlock(dirRoot, join(dirRoot, "src", "auth", "login.js")), null)
  assert.ok(riskPathBlock(dirRoot, join(dirRoot, "src", "billing", "x.js")))
  rmSync(root, { recursive: true, force: true })
  rmSync(dirRoot, { recursive: true, force: true })
})

test("F1 受保护证据: 直接写 .evidence.lock 拒绝；acceptance 写入跑锁校验", () => {
  const root = project()
  const lock = preExecuteDecision({ toolName: "write", args: { file_path: join(root, "tests", ".evidence.lock") }, cwd: root, cfg: {} })
  assert.match(lock.deny, /evidence lock/)
  // 锁缺失 + 任务证据已在 = 篡改信号（脚本可 --init，但那必须是显式 Class-E 动作）
  const noLock = preExecuteDecision({ toolName: "write", args: { file_path: join(root, "tests", "acceptance.md") }, cwd: root, cfg: {} })
  assert.match(noLock.deny, /evidence lock/)
  rmSync(root, { recursive: true, force: true })
})

test("F1 删除/搬移受保护证据需批准（普通 rm 不带 r 旗标也拦）", () => {
  const root = project()
  assert.match(preExecuteDecision({ toolName: "bash", args: { command: "rm tests/assert_artifacts.py" }, cwd: root, cfg: {} }).deny, /evidence lock/)
  assert.match(preExecuteDecision({ toolName: "bash", args: { command: "git rm tests/acceptance.md" }, cwd: root, cfg: {} }).deny, /risk-approved|evidence lock/)
  assert.equal(preExecuteDecision({ toolName: "bash", args: { command: "rm scratch.txt" }, cwd: root, cfg: {} }).deny, null)
  const approved = withApprovals(project(), "- risk-approved: tests/assert_artifacts.py — 用户批准重装 canonical\n")
  assert.equal(preExecuteDecision({ toolName: "bash", args: { command: "rm tests/assert_artifacts.py" }, cwd: approved, cfg: {} }).deny, null)
  rmSync(root, { recursive: true, force: true })
  rmSync(approved, { recursive: true, force: true })
})

// ─────────────── dsh 钩子层：tools/pre-execute 的真实决策形状 ───────────────
// fake 按 dsh-tools rc.6 类型建模（PreToolDecision = allow | deny{reason} | ask），
// 事件签名 'tools/pre-execute'(exec, next)；next() 默认放行（types/index.d.ts L38/L419-425）。
function makeCtx(cfg) {
  const handlers = {}
  return {
    handlers,
    logger: { warn() {} },
    on(evt, fn) { (handlers[evt] ||= []).push(fn) },
    tools: { register() {} },
    systemPrompt: { sections: [], section(x) { this.sections.push(x) } },
    skills: { registerProvider() {} },
    commands: { register() {} },
    agents: { get() { return undefined } },
    async fire(evt, ...args) {
      const list = handlers[evt] || []
      let def = null
      if (typeof args[args.length - 1] === "function") def = args.pop()
      let i = 0
      const next = async () => (i >= list.length ? (def ? def() : undefined) : list[i++](...args, next))
      return next()
    },
  }
}
function agentOf(sessionId, cwd) {
  return { session: { id: sessionId, header: { cwd } }, inject() {}, steer() {} }
}
async function firePreEx(root, toolName, args, cfg = {}) {
  const { apply } = await import("../../src/index.js")
  const ctx = makeCtx()
  apply(ctx, { skillSourceDir: tmp(), ...cfg })
  return ctx.fire("tools/pre-execute",
    { name: toolName, arguments: args, agent: agentOf("s1", root), callId: "c" + Math.random() },
    async () => ({ kind: "allow" }))
}

test("tools/pre-execute: 风险路径写入 → deny{reason}；普通写入 → 透传 allow", async () => {
  const root = project()
  const d1 = await firePreEx(root, "write", { file_path: join(root, "src", "auth", "login.js") })
  assert.equal(d1.kind, "deny", "risk-tier write must be denied before dispatch")
  assert.match(d1.reason, /risk-path gate/)
  const d2 = await firePreEx(root, "write", { file_path: join(root, "src", "lib.js") })
  assert.equal(d2.kind, "allow")
  rmSync(root, { recursive: true, force: true })
})

test("tools/pre-execute: bash 破坏性命令 deny；白名单目标与 git add -u 放行", async () => {
  const root = project()
  const bad = await firePreEx(root, "bash", { command: "rm -rf src" })
  assert.equal(bad.kind, "deny")
  assert.match(bad.reason, /destructive guard/)
  assert.equal((await firePreEx(root, "bash", { command: "rm -rf node_modules" })).kind, "allow")
  assert.equal((await firePreEx(root, "bash", { command: "git add -u" })).kind, "allow")
  const reset = await firePreEx(root, "bash", { command: "git reset --" + "hard" })
  assert.equal(reset.kind, "deny", "reset --hard 亦在六条规则内")
  rmSync(root, { recursive: true, force: true })
})

test("tools/pre-execute: DOC 类降级写入被 deny（当前块声明 DOC 且目标是源码）", async () => {
  const root = project({ log: "## Task\n- class: DOC — basis: 只改文档\n- iter 1 PASS: x\n" })
  const d = await firePreEx(root, "write", { file_path: join(root, "src", "app.py") })
  assert.equal(d.kind, "deny")
  assert.match(d.reason, /class guard/)
  rmSync(root, { recursive: true, force: true })
})

test("tools/pre-execute: warn 档放行不 deny；VIBEWEAVER_GATE=off 一律不拦", async () => {
  const root = project()
  const w = await firePreEx(root, "bash", { command: "git clean -fdx" }, { gateMode: "warn" })
  assert.equal(w.kind, "allow", "warn tier must never deny")
  process.env.VIBEWEAVER_GATE = "off"
  assert.equal((await firePreEx(root, "bash", { command: "git clean -fdx" })).kind, "allow")
  delete process.env.VIBEWEAVER_GATE
  rmSync(root, { recursive: true, force: true })
})

test("契约卡: 含 COV-0 交付契约与 A7.7.1 无人值守降级，组计数升到 1-22", () => {
  const card = covenantCard({})
  assert.match(card, /COV-0 交付契约/)
  assert.match(card, /final_gate_line/)
  assert.match(card, /A7\.7\.1 无人值守/)
  assert.match(card, /awaiting decision/)
  assert.match(card, /组1-22/)
  assert.match(card, /受保护证据|evidence_lock/,)
  rmSync(tmp(), { recursive: true, force: true })
})

test("契约卡: 四配置字节全部 <8000（主线新增两行不得破预算）", () => {
  const cfgs = [{}, { skillSourceDir: "/tmp/skills" }, { skillSourceDir: "/tmp/skills", steerBudget: 5 },
    { skillSourceDir: join(tmpdir(), "a-longer-than-production-skills-path-0123456789", "skills", "vibeweaver"), probeScript: "/opt/vw/scripts/mm_probe.py" }]
  for (const cfg of cfgs) {
    for (const gateMode of [undefined, "warn", "off"]) {
      const bytes = Buffer.byteLength(covenantCard({ ...cfg, gateMode }), "utf8")
      assert.ok(bytes < 8000, `card must stay <8000B, got ${bytes} for ${JSON.stringify({ ...cfg, gateMode })}`)
    }
  }
  // warn 档卡面必须说实话（不得继续写"强制执行"却什么都不拦）
  assert.match(covenantCard({ gateMode: "warn" }), /gateMode=warn：门禁仅提示不阻断/)
  assert.doesNotMatch(covenantCard({}), /gateMode=warn：门禁仅提示不阻断/)
})
