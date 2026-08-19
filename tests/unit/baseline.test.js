import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply, name, inject } from "../../src/baseline.js"

function makeCtx() {
  const sections = []
  return {
    sections,
    systemPrompt: { section(s) { sections.push(s) } },
  }
}

test("baseline 元数据", () => {
  assert.equal(name, "vibeweaver-baseline")
  assert.ok(inject.includes("systemPrompt"))
})

test("契约段含 SKILL.md 全文（>30KB）", () => {
  const src = mkdtempSync(join(tmpdir(), "vwb-"))
  const body = "# Skill: vibeweaver\n\n" + "rule line\n".repeat(4000)
  writeFileSync(join(src, "SKILL.md"), body)
  const ctx = makeCtx()
  apply(ctx, { skillSourceDir: src })
  assert.equal(ctx.sections.length, 1)
  assert.equal(ctx.sections[0].order, 100)
  const text = ctx.sections[0].text({})
  assert.ok(text.length > 30000, `SKILL.md 全文应 >30KB, got ${text.length}`)
  rmSync(src, { recursive: true, force: true })
})

test("正源缺失时降级为提示文本", () => {
  const ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/nonexistent-dir-xyz" })
  const text = ctx.sections[0].text({})
  assert.ok(text.includes("全文不可用"))
})
