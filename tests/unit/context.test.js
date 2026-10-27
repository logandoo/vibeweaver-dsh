// 波次 B（上下文管理移植）单测钉：压缩边界投工作笔记原文 / 快照兜底 / 卡面新增义务。
import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  compactStateBundle,
  snapshotWorkingNote,
  snapshotTextOf,
  workingNoteOf,
  resumeCueNote,
  recordMemoryDelivery,
  isChildSession,
  covenantCard,
} from "../../src/lib.js"

function project({ note = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vwctx-"))
  mkdirSync(join(root, "tests"), { recursive: true })
  writeFileSync(join(root, "tests", "verification_log.md"), "## Task\n- iter 1 PASS: x\n")
  writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n")
  if (note !== null) writeFileSync(join(root, "tests", "working_note.md"), note)
  return root
}

test("B1: 有工作笔记 → 压缩边界投**原文**（不是三行静态文案）", () => {
  const root = project({ note: "# 账本\n- 已确认: A\n- 下一动作: B\n" })
  const bundle = compactStateBundle(root)
  assert.ok(bundle.includes("已确认: A"), "必须包含笔记正文")
  assert.ok(bundle.includes("下一动作: B"))
  assert.ok(bundle.includes("工作状态"), "要标明这是机器投递的任务状态")
  assert.ok(Buffer.byteLength(bundle, "utf8") <= 4096, "≤4KB 预算")
  rmSync(root, { recursive: true, force: true })
})

test("B1: 超长笔记被截断到 4KB 以内（不是无限投递）", () => {
  const root = project({ note: "x".repeat(9000) })
  const bundle = compactStateBundle(root)
  assert.ok(Buffer.byteLength(bundle, "utf8") <= 4096, `got ${Buffer.byteLength(bundle, "utf8")}`)
  rmSync(root, { recursive: true, force: true })
})

test("B1: 没有任何笔记/快照 → 投『去建笔记』的指令，而不是空字符串", () => {
  const root = project()
  const bundle = compactStateBundle(root)
  assert.match(bundle, /working_note/)
  assert.match(bundle, /cap=5/, "把验收首行带上，恢复时不用再找")
  rmSync(root, { recursive: true, force: true })
})

test("B2: 笔记被删（蒸馏是正常动作）→ 仍能投出快照", () => {
  const root = project({ note: "# 账本\n- 关键: 快照这条要留住\n" })
  snapshotWorkingNote(root)
  assert.ok(snapshotTextOf(root).includes("快照这条要留住"), "快照应落盘")
  rmSync(join(root, "tests", "working_note.md"))
  assert.equal(workingNoteOf(root).trim(), "", "源文件确实没了")
  const bundle = compactStateBundle(root)
  assert.ok(bundle.includes("快照这条要留住"), "压缩边界仍要投出快照内容")
  assert.match(bundle, /快照/, "并说明这是 harness 快照")
  rmSync(root, { recursive: true, force: true })
})

test("B3: 首次写入的重入指针按项目根判定（有笔记/有验收两种文案）", () => {
  const withNote = project({ note: "# 账本\n" })
  assert.match(resumeCueNote(withNote), /working_note\.md 在场/)
  const noNote = project()
  assert.match(resumeCueNote(noNote), /建一个/)
  const bare = mkdtempSync(join(tmpdir(), "vwbare-"))
  assert.equal(resumeCueNote(bare), null, "非受管项目不投")
  for (const d of [withNote, noNote, bare]) rmSync(d, { recursive: true, force: true })
})

test("B3: 投递遥测累加且不覆盖已有 state.json 字段", () => {
  const root = project()
  mkdirSync(join(root, ".vibeweaver"), { recursive: true })
  writeFileSync(join(root, ".vibeweaver", "state.json"), JSON.stringify({ ops: [{ f: "x", p: 0, t: 1 }] }))
  recordMemoryDelivery(root, "sessionCue")
  recordMemoryDelivery(root, "sessionCue")
  recordMemoryDelivery(root, "compactBundle")
  const st = JSON.parse(readFileSync(join(root, ".vibeweaver", "state.json"), "utf8"))
  assert.equal(st.memoryDeliveries.sessionCue, 2)
  assert.equal(st.memoryDeliveries.compactBundle, 1)
  assert.ok(Array.isArray(st.ops) && st.ops.length === 1, "不得踩掉 stall observer 的字段")
  rmSync(root, { recursive: true, force: true })
})

test("B4: 子代理会话的判定只看 header.origin（fork 血缘不算）", () => {
  assert.equal(isChildSession({ session: { header: { origin: "subagent" } } }), true)
  assert.equal(isChildSession({ session: { header: { parentSession: "s0" } } }), false, "用户 fork 仍要投激活卡")
  assert.equal(isChildSession({ session: { header: {} } }), false)
  assert.equal(isChildSession(null), false)
  assert.equal(isChildSession(undefined), false)
})

test("B5: 契约卡含 §V9 收官顺序与 §V12 合法停止", () => {
  const card = covenantCard({})
  assert.match(card, /§V9 收官顺序/)
  assert.match(card, /§V12 合法停止/)
  assert.match(card, /上下文用尽/, "§V12 要写明它不是停止理由")
})
