import test from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, resolve } from "node:path"
import { tmpdir, homedir } from "node:os"

// 本仓 tests/assert_artifacts.py（unit under test：canonical + 2026-09-30 wave-2 五缺陷补丁 + 评审加固）
const REPO_ASSERT_URL = new URL("../../tests/assert_artifacts.py", import.meta.url)
const repoAssert = () => readFileSync(REPO_ASSERT_URL, "utf8")
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
  cueNotes,
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
  writeFileSync(join(root, "tests", "assert_artifacts.py"), repoAssert())
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

test("classifyMessages: 主线 18 组新增失败消息一律 blocking（2026-09-30 移植）", () => {
  // 字面串取自主线 canonical assert（tests/assert_artifacts.py）check() 文本，防措辞漂移
  const lines = [
    "- §V11.9 DOC-asset render gate: report.docx delivered without bound render evidence — add `render: <asset> — <existing page images>` or `render: <asset> — N/A (soffice missing)` (name the CONCRETE missing tool — soffice|libreoffice|pymupdf|pdftoppm|poppler|imagemagick — never a placeholder) to the log (NO RENDER, NO DONE)",
    "- §V11.9 exec-check: report.docx delivered without a recorded executable-behavior check — add `exec-check: <asset> — clean` or `exec-check: <asset> — escalated → Class CODE` (vbaProject.bin / PDF JS / macro sheet)",
    "--class DOC contradicts the log's `- class: CODE` in the current task block — one class per task (§V11.7)",
  ]
  const { blocking, warnings } = classifyMessages(lines)
  assert.ok(blocking.some((m) => m.includes("DOC-asset render gate")), "render gate must block")
  assert.ok(blocking.some((m) => m.includes("exec-check")), "exec-check must block")
  assert.ok(blocking.some((m) => m.includes("contradicts the log")), "class misreport must block")
  assert.equal(warnings.length, 0)
  // 字面串必须仍存在于 canonical 脚本中（措辞变了 = 分类器与 assert 脱钩）
  const canon = readFileSync(new URL("../../tests/assert_artifacts.py", import.meta.url), "utf8")
  assert.ok(canon.includes("DOC-asset render gate"), "canonical assert must carry the render-gate message")
  assert.ok(canon.includes("exec-check"), "canonical assert must carry the exec-check message")
  assert.ok(canon.includes("contradicts the log"), "canonical assert must carry the class-contradiction message")
  assert.ok(canon.includes("media evidence claimed"), "canonical assert must carry the media-evidence message")
})

test("classifyMessages: media evidence 声明缺失与 screenshot 同级 blocking（claim-class 补齐）", () => {
  const { blocking, warnings } = classifyMessages([
    "- media evidence claimed but missing/empty: tests/demo.webm (A4.1)",
  ])
  assert.ok(blocking.some((m) => m.includes("media evidence")), "media evidence must block")
  assert.equal(warnings.length, 0)
})

test("covenantCard: 含 COV-13 Class 声明与 §V11.9 渲染门 token（2026-09-30 移植）", () => {
  const card = covenantCard({ skillSourceDir: "/tmp/skills" })
  assert.ok(card.includes("COV-13"))
  assert.ok(/Class:\s*CODE\|CONFIG\|DOC/.test(card))
  assert.ok(card.includes("Class: DOC|CONFIG|CODE") || /gate 行含 Class 字段/.test(card))
  assert.ok(card.includes("NO RENDER"))
  assert.ok(card.includes("Doc-skill"))
  assert.ok(card.includes("docs-drift"))
  assert.ok(card.includes("render:"))
  assert.ok(card.includes("exec-check"), "§V11.9 line must carry the exec-check obligation")
  assert.ok(Buffer.byteLength(card) < 8000, `card exceeds 8KB bytes: ${Buffer.byteLength(card)}`)
})

test("index.js 激活/重建文本覆盖 COV-1..13（2026-09-30 移植）", () => {
  const src = readFileSync(new URL("../../src/index.js", import.meta.url), "utf8")
  assert.ok(!src.includes("COV-1..11"), "stale COV-1..11 range must be gone")
  assert.ok(src.includes("COV-1..13"), "activation/recover texts must span COV-1..13")
  assert.ok(src.includes("Class: CODE|CONFIG|DOC"), "activation text must prompt the Class declaration")
  // 发货件是 lib/index.js（package.json main）——lib 须与 src 同步
  const libSrc = readFileSync(new URL("../../lib/index.js", import.meta.url), "utf8")
  assert.equal(libSrc, src, "lib/index.js must mirror src/index.js (run bash script/linux/project_build.sh)")
})

test("runnerCrashed: Python SyntaxError/IndentationError/超时崩溃识别（I4 fail-closed）", () => {
  assert.equal(runnerCrashed([{ flags: "", output: '  File "tests/assert_artifacts.py", line 3\nSyntaxError: invalid syntax' }]), true)
  assert.equal(runnerCrashed([{ flags: "", output: "IndentationError: unexpected indent" }]), true)
  assert.equal(runnerCrashed([{ flags: "", output: "exit ETIMEDOUT" }]), true)
  assert.equal(runnerCrashed([{ flags: "", output: "- tests/verification_log.md missing (COV-1)" }]), false)
})

test("checkGate: assert 脚本语法崩溃 → fail-closed blocking（I4）", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "tests", "assert_artifacts.py"),
    repoAssert() + "\nthis is not python syntax (((\n")
  const gate = checkGate(root)
  assert.ok(gate, "gate must produce a result")
  assert.ok(gate.blocking.length > 0, `checker crash must block, got blocking=[] warnings=${JSON.stringify(gate.warnings)}`)
  rmSync(root, { recursive: true, force: true })
})

test("checkGate: 检查器非零退出但无结构化 - 行 → fail-closed blocking（I4）", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "tests", "assert_artifacts.py"),
    "# verification_log acceptance cap=5 marker\nprint('checker exploded')\nraise SystemExit(1)\n")
  const gate = checkGate(root)
  assert.ok(gate, "gate must produce a result")
  assert.ok(gate.blocking.length > 0, `unstructured checker failure must block, got blocking=[] warnings=${JSON.stringify(gate.warnings)}`)
  rmSync(root, { recursive: true, force: true })
})

test("checkGate: office 资产无 render: 证据行 → blocking 含 render gate（§V11.9 集成）", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "report.docx"), "innocuous placeholder content\n")
  execFileSync("git", ["add", "report.docx"], { cwd: root })
  const gate = checkGate(root)
  assert.ok(gate, "gate must produce a result")
  assert.ok(gate.blocking.some((m) => m.includes("DOC-asset render gate")),
    `expected render-gate blocking, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

// ── wave-2: canonical 五缺陷补丁 pin（2026-09-30，用户指令本地修复）──

test("assert 类解析: 后写异类 - class: = 机器失败且类取首条（§V11.4#3 去降类）", () => {
  const root = makeFullProject()
  rmSync(join(root, "memory"), { recursive: true, force: true })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — src/lib.js\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n- class: DOC — downgraded\n")
  const gate = checkGate(root)
  assert.ok(gate, "de-escalation attempt must fail (was gate=null: DOC last-entry N/A'd memory)")
  assert.ok(gate.blocking.some((m) => /de-escalat|one class per task/i.test(m)),
    `expected class de-escalation failure, got ${JSON.stringify(gate)}`)
  assert.ok((gate.warnings || []).some((m) => m.includes("MEMORY.md")),
    `first-entry CODE must keep memory required, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 渲染绑定: 逐资产精确命名，stem 子串不覆盖（§V11.9）", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "report.docx"), "placeholder\n")
  writeFileSync(join(root, "annual-report.docx"), "placeholder\n")
  writeFileSync(join(root, "tests", "p1.png"), "png-bytes\n")
  execFileSync("git", ["add", "report.docx", "annual-report.docx"], { cwd: root })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — x\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" +
    "- render: annual-report.docx — tests/p1.png | pages: 1\n- exec-check: annual-report.docx — clean\n")
  const gate = checkGate(root)
  assert.ok(gate, "stem-substring coverage must fail (was gate=null: 'report' stem covered both)")
  assert.ok(gate.blocking.some((m) => m.includes("DOC-asset render gate: report.docx")),
    `expected report.docx named uncovered, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert COV-9: 空 class 不享 DOC 免跑（§V11.2 不确定取高）", () => {
  const root = makeProject()
  writeFileSync(join(root, "tests", "assert_artifacts.py"), repoAssert())
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n- COV-9 skipped — documentation-only change\n")
  const gate = checkGate(root)
  assert.ok(gate, "unclassified + no baseline must fail (was gate=null: empty class got DOC skip license)")
  assert.ok(gate.blocking.some((m) => m.includes("Baseline verified GREEN")),
    `expected COV-9 baseline failure, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 组 17 remediation: 模板给被 _line_ok 接受的形态（具名工具无尖括号）", () => {
  const canon = repoAssert()
  assert.ok(!canon.includes("N/A (<missing tool>)"), "rejected placeholder form must be gone from the message")
  assert.ok(/N\/A \(soffice missing\)/.test(canon), "message must show the accepted concrete-tool form")
})

test("assert 渲染门: 接受形态 render: <asset> — N/A (soffice missing) 通过", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "report.docx"), "placeholder\n")
  execFileSync("git", ["add", "report.docx"], { cwd: root })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — x\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" +
    "- render: report.docx — N/A (soffice missing) · layout risk flagged\n- exec-check: report.docx — clean\n")
  const gate = checkGate(root)
  assert.equal(gate, null, `accepted N/A form must pass the render/exec gates, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 渲染门: 纯 untracked office 资产被识别（ls-files 单列解析）", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "report.docx"), "placeholder\n")
  const gate = checkGate(root)
  assert.ok(gate, "untracked asset must be detected (was gate=null: single-column ls-files line dropped)")
  assert.ok(gate.blocking.some((m) => m.includes("DOC-asset render gate: report.docx")),
    `expected untracked report.docx named uncovered, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
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
  assert.ok(Buffer.byteLength(card) < 8000, `card exceeds 8KB bytes: ${Buffer.byteLength(card)}`)
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
  writeFileSync(join(root, "tests", "assert_artifacts.py"), repoAssert())
  assert.equal(isPlausibleAssertScript(root), true)
  const crashed = [
    { flags: "", output: "Traceback (most recent call last):\n  File \"assert_artifacts.py\", line 3\nSyntaxError" },
    { flags: "--existing", output: "python3: can't open file: No such file or directory" },
  ]
  assert.equal(runnerCrashed(crashed), true)
  assert.equal(runnerCrashed([{ flags: "", output: "- tests/verification_log.md missing (COV-1)" }]), false)
  rmSync(root, { recursive: true, force: true })
})

// ── wave-2 评审加固 pin（fix-round 1，双评审 Critical/Important PoC 回归网）──

test("assert 资产收集: 大写 D 开头 untracked 路径不再被删除过滤误杀", () => {
  const root = makeFullProject()
  mkdirSync(join(root, "Docs"), { recursive: true })
  writeFileSync(join(root, "Docs", "Document.docx"), "placeholder\n")
  const gate = checkGate(root)
  assert.ok(gate, "capital-D untracked asset must be detected (was: startswith('D') dropped it)")
  assert.ok(gate.blocking.some((m) => m.includes("Document.docx")),
    `expected Document.docx named uncovered, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert exec-check 判决: unclean/NOT clean 不再洗白行为门", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "report.docx"), "placeholder\n")
  execFileSync("git", ["add", "report.docx"], { cwd: root })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — x\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" +
    "- render: report.docx — N/A (soffice missing)\n- exec-check: report.docx — unclean: macros active, NOT clean\n")
  const gate = checkGate(root)
  assert.ok(gate, "negated verdict must not certify (was: substring 'clean' matched 'unclean')")
  assert.ok(gate.blocking.some((m) => m.includes("exec-check")),
    `expected exec-check blocking, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 类解析: 缩进/列表符/空格冒号形态的首条声明不可躲避", () => {
  const root = makeFullProject()
  rmSync(join(root, "memory"), { recursive: true, force: true })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n  * class : CODE — src/lib.js\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n- class: DOC — downgraded\n")
  const gate = checkGate(root)
  assert.ok(gate, "dodged first-entry form must still be detected")
  assert.ok(gate.blocking.some((m) => /contradiction\/append|one class per task/i.test(m)),
    `expected class contradiction failure, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 渲染绑定: 同名不同目录资产须逐路径绑定", () => {
  const root = makeFullProject()
  mkdirSync(join(root, "a"), { recursive: true })
  mkdirSync(join(root, "b"), { recursive: true })
  writeFileSync(join(root, "a", "report.docx"), "placeholder\n")
  writeFileSync(join(root, "b", "report.docx"), "placeholder\n")
  writeFileSync(join(root, "tests", "p1.png"), "png-bytes\n")
  execFileSync("git", ["add", "a/report.docx", "b/report.docx"], { cwd: root })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — x\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" +
    "- render: a/report.docx — tests/p1.png | pages: 1\n- exec-check: a/report.docx — clean\n")
  const gate = checkGate(root)
  assert.ok(gate, "basename-only row must not cover a same-basename sibling dir")
  assert.ok(gate.blocking.some((m) => m.includes("report.docx")),
    `expected sibling named uncovered, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 渲染绑定: 连字符分隔行（' - '）仍可绑定", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "report.docx"), "placeholder\n")
  writeFileSync(join(root, "tests", "p1.png"), "png-bytes\n")
  execFileSync("git", ["add", "report.docx"], { cwd: root })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — x\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" +
    "- render: report.docx - tests/p1.png | pages: 1\n- exec-check: report.docx - clean\n")
  const gate = checkGate(root)
  assert.equal(gate, null, `hyphen-separated rows must bind, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 渲染证据: N/A 行附伪造页图引用不放行（N/A 仅覆盖零引用行）", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "report.docx"), "placeholder\n")
  execFileSync("git", ["add", "report.docx"], { cwd: root })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — x\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" +
    "- render: report.docx — N/A (soffice missing) tests/p999.png\n- exec-check: report.docx — clean\n")
  const gate = checkGate(root)
  assert.ok(gate, "fabricated co-citation must fail (was: N/A short-circuit laundered it)")
  assert.ok(gate.blocking.some((m) => m.includes("DOC-asset render gate")),
    `expected render-gate blocking, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 资产收集: git C 引号路径解码（CJK 文件名不出八进制幻影资产）", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "报告.docx"), "placeholder\n")
  const gate = checkGate(root)
  assert.ok(gate, "CJK untracked asset must be detected")
  assert.ok(!gate.blocking.some((m) => m.includes("\\346")),
    `octal garbage must not appear in messages, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert COV-9: 旧任务块的 skipped 行不许可当前块（skip 按块作用域）", () => {
  const root = makeProject()
  writeFileSync(join(root, "tests", "assert_artifacts.py"), repoAssert())
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: DOC — old wave\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n- COV-9 skipped — documentation-only change\n" +
    "## Task2\n- iter 2 PASS: x (evidence: tests/acceptance.md, 2/2)\n")
  const gate = checkGate(root)
  assert.ok(gate, "older block's skip must not license the current block (was: whole-vl search licensed it)")
  assert.ok(gate.blocking.some((m) => m.includes("Baseline verified GREEN")),
    `expected COV-9 baseline failure, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

// ── fix-round 2 pin（scoped re-review 新回归三处）──

test("assert 资产收集: rename 行取新路径，不出 old\\tnew 幻影资产", () => {
  const root = makeFullProject()
  writeFileSync(join(root, "old.docx"), "placeholder\n")
  execFileSync("git", ["add", "old.docx"], { cwd: root })
  execFileSync("git", ["commit", "-q", "-m", "add old"], { cwd: root })
  execFileSync("git", ["mv", "old.docx", "new.docx"], { cwd: root })
  writeFileSync(join(root, "tests", "p1.png"), "png-bytes\n")
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — x\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" +
    "- render: new.docx — tests/p1.png | pages: 1\n- exec-check: new.docx — clean\n")
  const gate = checkGate(root)
  assert.equal(gate, null, `renamed asset must bind to its new name, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 渲染绑定: 根级同名资产可用裸名覆盖（与子目录同名并存）", () => {
  const root = makeFullProject()
  mkdirSync(join(root, "a"), { recursive: true })
  writeFileSync(join(root, "report.docx"), "placeholder\n")
  writeFileSync(join(root, "a", "report.docx"), "placeholder\n")
  writeFileSync(join(root, "tests", "p1.png"), "png-bytes\n")
  writeFileSync(join(root, "tests", "p2.png"), "png-bytes\n")
  execFileSync("git", ["add", "report.docx", "a/report.docx"], { cwd: root })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — x\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" +
    "- render: report.docx — tests/p1.png | pages: 1\n- exec-check: report.docx — clean\n" +
    "- render: a/report.docx — tests/p2.png | pages: 1\n- exec-check: a/report.docx — clean\n")
  const gate = checkGate(root)
  assert.equal(gate, null, `root bare-name row must cover the root asset, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

test("assert 渲染绑定: 带目录行不以路径后缀误盖嵌套同名兄弟", () => {
  const root = makeFullProject()
  mkdirSync(join(root, "a"), { recursive: true })
  mkdirSync(join(root, "docs", "a"), { recursive: true })
  writeFileSync(join(root, "a", "report.docx"), "placeholder\n")
  writeFileSync(join(root, "docs", "a", "report.docx"), "placeholder\n")
  writeFileSync(join(root, "tests", "p1.png"), "png-bytes\n")
  execFileSync("git", ["add", "a/report.docx", "docs/a/report.docx"], { cwd: root })
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- class: CODE — x\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n" +
    "- render: a/report.docx — tests/p1.png | pages: 1\n- exec-check: a/report.docx — clean\n")
  const gate = checkGate(root)
  assert.ok(gate, "nested same-suffix sibling must stay uncovered (was: endswith matched)")
  assert.ok(gate.blocking.some((m) => m.includes("report.docx")),
    `expected nested sibling named, got ${JSON.stringify(gate)}`)
  rmSync(root, { recursive: true, force: true })
})

// ── 主线 wave16/17 移植：stall latch + cue 触发 + 契约卡新义务 ──

test("stallObservation: latch——同一停滞签名只报一次，新 iter 重新武装（wave17 移植）", () => {
  const root = makeProject()
  mkdirSync(join(root, "src"), { recursive: true })
  const f = join(root, "src", "x.js")
  const msgs = []
  for (let i = 0; i < 5; i++) {
    writeFileSync(f, `// ${i}\n`)
    const m = stallObservation(root, f)
    if (m) msgs.push(m)
  }
  assert.equal(msgs.length, 1, `stall must fire once, got ${msgs.length}`)
  // 新 iter 条目 → 重新武装
  const log = join(root, "tests", "verification_log.md")
  writeFileSync(log, readFileSync(log, "utf8") + "- iter 2 PASS: re-arm (evidence: inline)\n")
  let fired = null
  for (let i = 0; i < 3; i++) {
    writeFileSync(f, `// b${i}\n`)
    const m = stallObservation(root, f)
    if (m) fired = m
  }
  assert.ok(fired, "new iter entry must re-arm the stall observer")
  rmSync(root, { recursive: true, force: true })
})

test("cueNotes: 命中/不命中/memory 自指/上限/无引号行内列表（wave16 移植）", () => {
  const root = makeProject()
  mkdirSync(join(root, "memory"), { recursive: true })
  mkdirSync(join(root, "src", "auth"), { recursive: true })
  writeFileSync(join(root, "memory", "fix_auth.md"), '---\ntype: fix\nstatus: ❌\ntriggers:\n  - "src/auth/**"\n---\n# Auth trap\n')
  writeFileSync(join(root, "memory", "reference_uq.md"), '---\ntype: reference\ntriggers: [src/uq/**, db/**]\n---\n# Unquoted\n')
  writeFileSync(join(root, "memory", "fix_evil.md"), '---\ntype: fix\ntriggers:\n  - "**/**/**/**/**/**/zz"\n---\n# ReDoS\n')
  const hit = cueNotes(root, join(root, "src", "auth", "a.ts"))
  assert.equal(hit.length, 1)
  assert.ok(hit[0].includes("fix_auth.md") && hit[0].includes("❌"))
  assert.deepEqual(cueNotes(root, join(root, "src", "other", "b.ts")), [])
  assert.deepEqual(cueNotes(root, join(root, "memory", "fix_auth.md")), [], "memory self-edit never cues")
  assert.ok(cueNotes(root, join(root, "src", "uq", "c.ts"))[0]?.includes("reference_uq.md"), "unquoted inline list must fire")
  assert.deepEqual(cueNotes(root, join(root, "a", "b", "c", "d", "e", "f", "zz")), [], ">2 ** groups rejected")
  rmSync(root, { recursive: true, force: true })
})

test("cueNotes: CRLF+BOM 主题文件仍投递（wave16 移植）", () => {
  const root = makeProject()
  mkdirSync(join(root, "memory"), { recursive: true })
  mkdirSync(join(root, "src", "win"), { recursive: true })
  writeFileSync(join(root, "memory", "fix_crlf.md"), "﻿---\r\ntype: fix\r\ntriggers:\r\n  - \"src/win/**\"\r\n---\r\n# CRLF\r\n")
  const hit = cueNotes(root, join(root, "src", "win", "w.ts"))
  assert.equal(hit.length, 1)
  rmSync(root, { recursive: true, force: true })
})

test("covenantCard: 含 wave15-17 主线义务 token（2026-10-07 移植）", () => {
  const card = covenantCard({ skillSourceDir: "/tmp/skills" })
  assert.ok(card.includes("tests/working_note.md"), "§A7.15 working note")
  assert.ok(card.includes("triggers:"), "§A7.16 cue triggers")
  assert.ok(card.includes("--final"), "final-run flag")
  assert.ok(card.includes("final-run:"), "final-run log line")
  assert.ok(card.includes("C8 外层循环"), "C8 route")
  assert.ok(card.includes("backlog_check.py"), "backlog mechanism")
  assert.ok(card.includes("12b"), "diagnosis substance lint")
  assert.ok(card.includes("组 1-20"), "20 groups")
  assert.ok(card.includes("4b"), "trigger prefix lint")
  assert.ok(Buffer.byteLength(card) < 8000, `card exceeds 8KB bytes: ${Buffer.byteLength(card)}`)
})

test("canonical assert: 12b/4b/19 组与 --final 旗标在位（wave16/17 同步）", () => {
  const canon = repoAssert()
  assert.ok(canon.includes("diagnosis is a placeholder"), "12b substance lint")
  assert.ok(canon.includes("literal prefix"), "4b trigger-prefix lint")
  assert.ok(canon.includes("working_note.md still present"), "group 19")
  assert.ok(canon.includes('"--final"'), "--final flag")
})

test("canonical assert: 组 20 working-note 创建侧在位（wave19 移植）", () => {
  const canon = repoAssert()
  assert.ok(canon.includes("working-note:"), "group 20 lifecycle-line check")
  assert.ok(canon.includes("creation side"), "group 20 present")
})
