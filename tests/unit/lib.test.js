import test from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, resolve } from "node:path"
import { tmpdir, homedir } from "node:os"

const CANON_ASSERT_PATH = resolve(
  process.env.VIBEWEAVER_SKILL_DIR || join(homedir(), ".config/opencode/skills/vibeweaver"),
  "scripts/assert_artifacts.py"
)
import {
  findProjectRoot,
  runAssert,
  classifyMessages,
  blockMessage,
  stallObservation,
  countPasses,
  isCodingIntent,
  covenantCard,
  inlineCheck,
  checkGate,
  runnerCrashed,
  isPlausibleAssertScript,
} from "../../src/lib.js"

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "vwtest-"))
  mkdirSync(join(root, "tests"), { recursive: true })
  writeFileSync(join(root, "tests", "verification_log.md"), "## Task\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n")
  writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n")
  return root
}

function makeFullProject() {
  // 满足 assert_artifacts.py 全部 13 组的完整证据集（plain [] 模式）
  const root = mkdtempSync(join(tmpdir(), "vwfull-"))
  mkdirSync(join(root, "tests"), { recursive: true })
  mkdirSync(join(root, "memory"), { recursive: true })
  mkdirSync(join(root, "script", "linux"), { recursive: true })
  writeFileSync(join(root, "tests", "verification_log.md"), "## Task\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n")
  writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n")
  writeFileSync(join(root, "tests", "assert_artifacts.py"),
    readFileSync(CANON_ASSERT_PATH, "utf8"))
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
  writeFileSync(join(root, "extra.txt"), "x\n")
  execFileSync("git", ["add", "-A"], { cwd: root })
  execFileSync("git", ["commit", "-q", "-m", "final"], { cwd: root })
  return root
}

test("findProjectRoot: 从深层路径向上定位项目根", () => {
  const root = makeProject()
  const deep = join(root, "src", "deep", "file.js")
  assert.equal(findProjectRoot(deep), root)
  assert.equal(findProjectRoot(join(root, "tests")), root)
  assert.equal(findProjectRoot(null), null)
  assert.equal(findProjectRoot("/nonexistent-path-xyz/file.js"), null)
  rmSync(root, { recursive: true, force: true })
})

test("findProjectRoot: 非 vibeweaver-active 目录返回 null", () => {
  const root = mkdtempSync(join(tmpdir(), "vwplain-"))
  assert.equal(findProjectRoot(join(root, "x.js")), null)
  rmSync(root, { recursive: true, force: true })
})

test("runAssert: 证据齐的项目返回 ok=true", () => {
  const root = makeFullProject()
  const r = runAssert(root)
  assert.equal(r.ok, true)
  rmSync(root, { recursive: true, force: true })
})

test("runAssert: 证据缺失的项目返回 ok=false 且含 attempts", () => {
  const root = mkdtempSync(join(tmpdir(), "vwbad-"))
  mkdirSync(join(root, "tests"), { recursive: true })
  const r = runAssert(root)
  assert.equal(r.ok, false)
  assert.ok(Array.isArray(r.attempts) && r.attempts.length === 4)
  rmSync(root, { recursive: true, force: true })
})

test("classifyMessages: BLOCKING_HINTS 分类", () => {
  const lines = [
    "- tests/verification_log.md has no `- iter N PASS/FAIL:` entries (COV-1)",
    "- memory/MEMORY.md missing (A7.10)",
    "- new-project git repo needs >=2 commits (C1)",
  ]
  const { blocking, warnings } = classifyMessages(lines)
  assert.ok(blocking.some((m) => m.includes("verification_log")))
  assert.ok(warnings.some((m) => m.includes("MEMORY.md")))
  assert.ok(warnings.some((m) => m.includes("git repo")))
})

test("classifyMessages: 组 14-16 内容门禁消息一律 blocking（2026-08-28 移植）", () => {
  const lines = [
    '- secret scan: app/config.py:1: credential-looking string on an added line — \'token = "x"\' (A4.4 content gate)',
    "- test-change guard: tests/test_math.py: 1 assertion line(s) removed without a `- test-change:` justification in verification_log.md (A4.8 test integrity)",
    "- risk-tier: change-wave touches risk-tier path(s) (auth/login.py) but tests/review_package.md missing/empty — A4.9 review non-skippable (A4.9)",
  ]
  const { blocking, warnings } = classifyMessages(lines)
  assert.ok(blocking.some((m) => m.includes("secret scan")), "secret scan must block")
  assert.ok(blocking.some((m) => m.includes("test-change")), "test-change must block")
  assert.ok(blocking.some((m) => m.includes("risk-tier")), "risk-tier must block")
  assert.equal(warnings.length, 0)
})

test("covenantCard: 含 14-16 内容门禁 token（2026-08-28 移植）", () => {
  const card = covenantCard({ skillSourceDir: "/tmp/skills" })
  assert.ok(card.includes("secret scan"))
  assert.ok(card.includes("test-change"))
  assert.ok(card.includes("risk-tier"))
})

test("checkGate: 波次 diff 新增凭据 → blocking 含 secret scan（16 组 canonical）", () => {
  const root = makeFullProject()
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "backup: before changes"], { cwd: root })
  writeFileSync(join(root, "app-config.js"),
    'const token = "' + "ghp_" + "a1B2c3D4" + "e5F6g7H8" + '"\n')
  execFileSync("git", ["add", "-A"], { cwd: root })
  execFileSync("git", ["commit", "-q", "-m", "add config"], { cwd: root })
  const result = checkGate(root)
  assert.ok(result, "gate must not pass a committed secret in the wave diff")
  assert.ok(result.blocking.some((m) => m.includes("secret scan")),
    `expected secret scan in blocking, got: ${JSON.stringify(result)}`)
  rmSync(root, { recursive: true, force: true })
})

test("blockMessage: 包含 GATE-BLOCKED 前缀与 blocking 明细", () => {
  const msg = blockMessage("/tmp/root", { blocking: ["- x"], warnings: [] })
  assert.ok(msg.includes("GATE-BLOCKED"))
  assert.ok(msg.includes("- x"))
})

test("stallObservation: 同文件3次无新iter → 返回 stall 警告；新 FAIL 迭代也复位", () => {
  const root = makeProject()
  const stateDir = join(root, ".vibeweaver")
  const f = join(root, "src", "a.js")
  assert.equal(stallObservation(root, f), null)
  assert.equal(stallObservation(root, f), null)
  const warn = stallObservation(root, f)
  assert.ok(warn !== null && warn.includes("STALL"))
  const state = JSON.parse(readFileSync(join(stateDir, "state.json"), "utf8"))
  assert.equal(state.ops.length, 3)
  // 新 FAIL 迭代（带 diagnosis）同样复位（M2）
  writeFileSync(join(root, "tests", "verification_log.md"), "## Task\n- iter 1 PASS: x | 1/1\n- iter 2 FAIL: y | diagnosis: z | changed: a\n")
  assert.equal(stallObservation(root, f), null)
  rmSync(root, { recursive: true, force: true })
})

test("countPasses: 统计 PASS 条目数", () => {
  const root = makeProject()
  assert.equal(countPasses(root), 1)
  writeFileSync(join(root, "tests", "verification_log.md"), "- iter 1 PASS: a\n- iter 2 PASS: b\n- iter 3 FAIL: c | diagnosis: d\n")
  assert.equal(countPasses(root), 2)
  rmSync(root, { recursive: true, force: true })
})

test("isCodingIntent: 编码关键词/文件后缀命中，闲聊不命中", () => {
  assert.equal(isCodingIntent("帮我修复登录页面的 bug"), true)
  assert.equal(isCodingIntent("写一个 python 脚本"), true)
  assert.equal(isCodingIntent("把 API 接口加上鉴权"), true)
  assert.equal(isCodingIntent("实现 add.js 文件"), true)
  assert.equal(isCodingIntent("今天天气怎么样"), false)
  assert.equal(isCodingIntent("帮我想个名字"), false)
  assert.equal(isCodingIntent(""), false)
  // I5 收紧: 口语泛词不触发（评审要求）
  assert.equal(isCodingIntent("帮我修改这段话的措辞"), false)
  assert.equal(isCodingIntent("创建一个文档"), false)
  assert.equal(isCodingIntent("把 port 改为 5678"), false)
  assert.equal(isCodingIntent("写一个描述文件"), false)
})

test("covenantCard: 含核心 gate token 且长度 < 8KB", () => {
  const card = covenantCard({ skillSourceDir: "/tmp/skills", steerBudget: 3 })
  assert.ok(card.includes("HARD-GATE-1: NO-TEST-NO-DONE"))
  assert.ok(card.includes("HARD-GATE-2: SCRIPT-ONLY"))
  assert.ok(card.includes("cap=5  stall=3"))
  assert.ok(card.includes("tests/acceptance.md"))
  assert.ok(card.includes("vibeweaver_gate"))
  assert.ok(card.length < 8000, `card too large: ${card.length}`)
})

test("covenantCard: COV-5 引用视觉探针（probeScript 优先，默认回退正源目录）", () => {
  const bundled = covenantCard({ skillSourceDir: "/tmp/skills", probeScript: "/opt/dsh-vibeweaver/scripts/mm_probe.py" })
  assert.ok(bundled.includes("/opt/dsh-vibeweaver/scripts/mm_probe.py --generate"))
  assert.ok(!bundled.includes("/tmp/skills/scripts/mm_probe.py"))
  const fallback = covenantCard({ skillSourceDir: "/tmp/skills" })
  assert.ok(fallback.includes("/tmp/skills/scripts/mm_probe.py --generate"))
})

test("inlineCheck: assert 脚本缺失时做内联证据检查", () => {
  const root = makeProject()
  const failures = inlineCheck(root)
  assert.equal(failures.length, 0)
  const empty = mkdtempSync(join(tmpdir(), "vwempty-"))
  mkdirSync(join(empty, "tests"), { recursive: true })
  writeFileSync(join(empty, "tests", "verification_log.md"), "")
  writeFileSync(join(empty, "tests", "acceptance.md"), "")
  const bad = inlineCheck(empty)
  assert.ok(bad.some((m) => m.includes("verification_log")))
  assert.ok(bad.some((m) => m.includes("cap=5")))
  rmSync(root, { recursive: true, force: true })
  rmSync(empty, { recursive: true, force: true })
})

test("I4 fail-closed: 空壳 assert 脚本 → checkGate 返回 blocking", () => {
  const root = makeProject()
  writeFileSync(join(root, "tests", "assert_artifacts.py"), "#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n")
  const gate = checkGate(root)
  assert.ok(gate && gate.blocking.length > 0, "空壳脚本应 blocking")
  assert.ok(gate.blocking[0].includes("not a plausible canonical assertion script"))
  assert.equal(isPlausibleAssertScript(root), false)
  rmSync(root, { recursive: true, force: true })
})

test("I4 fail-closed: 合法 assert 脚本 + 崩溃 → runnerCrashed 识别", () => {
  const root = makeProject()
  const canon = readFileSync(CANON_ASSERT_PATH, "utf8")
  writeFileSync(join(root, "tests", "assert_artifacts.py"), canon)
  assert.equal(isPlausibleAssertScript(root), true)
  const crashed = [
    { flags: "", output: "Traceback (most recent call last):\n  File \"assert_artifacts.py\", line 3\nSyntaxError" },
    { flags: "--existing", output: "python3: can't open file: No such file or directory" },
  ]
  assert.equal(runnerCrashed(crashed), true)
  assert.equal(runnerCrashed([{ flags: "", output: "- tests/verification_log.md missing (COV-1)" }]), false)
  rmSync(root, { recursive: true, force: true })
})
