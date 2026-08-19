import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply, name, inject } from "../../src/index.js"

let ctx = null

function makeCtx() {
  const handlers = {}
  const registered = { tools: {}, sections: [], commands: [], providers: [] }
  const agents = new Map()
  const ctx = {
    injected: [],
    steered: [],
    log: [],
    registered,
    agents,
    logger: { warn: (m) => ctx.log.push(`warn: ${m}`) },
    on(evt, fn) { (handlers[evt] ||= []).push(fn) },
    // Cordis waterfall 模拟: 与真实 dsh 事件签名一致 ——
    // 事件签名各异（agent/pre-step 两参; tools/post-execute 三参），
    // next 恒为最后一个参数（见 dsh rc.6 types: 'tools/post-execute'(exec, result, next)）
    async fire(evt, ...args) {
      const list = handlers[evt] || []
      let defaultFn = null
      if (typeof args[args.length - 1] === "function") defaultFn = args.pop()
      let i = 0
      const next = async () => {
        if (i >= list.length) return defaultFn ? defaultFn() : undefined
        const fn = list[i++]
        return fn(...args, next)
      }
      if (list.length === 0) return defaultFn ? defaultFn() : undefined
      return next()
    },
    async emit(evt, ...args) { for (const fn of handlers[evt] || []) fn(...args) },
  }
  ctx.tools = {
    register(t) { registered.tools[t.name] = t },
  }
  ctx.systemPrompt = {
    section(s) { registered.sections.push(s) },
    context() {},
  }
  ctx.skills = {
    // 真实签名: registerProvider(create: (control) => SkillProvider) → disposer
    registerProvider(create) { registered.providers.push(create({ signal: new AbortController().signal, invalidate: () => {} })) },
  }
  ctx.commands = {
    register(c) { registered.commands.push(c) },
  }
  ctx.agents = { get: (id) => agents.get(id), _register: (id, a) => agents.set(id, a) }
  return ctx
}

function makeAgent(sessionId, cwd) {
  return {
    id: sessionId,
    session: {
      id: sessionId,
      header: cwd ? { cwd } : {},
    },
    inject(msg) {
      // 真实 dsh: inject() 返回 void（fire-and-forget），仅记录侧通道
      ctx.injected.push({ agent: sessionId, msg })
    },
    steer(msg) {
      ctx.steered.push({ agent: sessionId, msg })
    },
  }
}

function makeActiveProject(evidenceBroken = false) {
  const root = mkdtempSync(join(tmpdir(), "vwidx-"))
  mkdirSync(join(root, "tests"), { recursive: true })
  if (evidenceBroken) {
    writeFileSync(join(root, "tests", "verification_log.md"), "")
    writeFileSync(join(root, "tests", "acceptance.md"), "")
  } else {
    writeFileSync(join(root, "tests", "verification_log.md"), "## Task\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n")
    writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n")
  }
  return root
}

test("插件元数据: name/inject 符合设计", () => {
  assert.equal(name, "vibeweaver")
  for (const k of ["tools", "systemPrompt", "skills", "commands", "agents"]) {
    assert.ok(inject.includes(k), `inject missing ${k}`)
  }
})

test("回归: 会话属性形状与真实 dsh API 一致（agent.session.id / agent.session.header.cwd）", () => {
  // dsh rc.6 真源: dsh-tool-skill 用 exec.agent.session.header.cwd; Session 类 get id()
  // 本测试钉死该形状 — 防止 fake 按错误属性建模导致假绿（COV-8 评审 C1）
  const session = { id: "s-shape", header: { cwd: "/tmp" } }
  assert.equal(typeof session.id, "string")
  assert.equal(typeof session.header.cwd, "string")
  assert.ok(session.sessionId === undefined, "真实 Session 无 sessionId 属性")
  assert.ok(session.metadata === undefined, "真实 Session 无 metadata 属性")
  // 插件从该形状取 id/cwd 的路径存在（编译期语义钉死）
  const agent = makeAgent("s-shape", "/tmp")
  assert.equal(agent.session.id, "s-shape")
  assert.equal(agent.session.header.cwd, "/tmp")
})

test("apply: 注册 provider + 契约段 + gate 工具 + /vibe 命令", () => {
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  assert.equal(ctx.registered.providers.length, 1)
  assert.equal(ctx.registered.providers[0].name, "vibeweaver-filesystem")
  assert.equal(ctx.registered.sections.length, 1)
  assert.equal(ctx.registered.sections[0].name, "vibeweaver-covenant")
  assert.equal(ctx.registered.sections[0].order, 100)
  assert.ok(ctx.registered.tools["vibeweaver_gate"])
  assert.ok(ctx.registered.commands.some((c) => c.name === "vibe"))
})

test("skill provider: list/get 从正源读取", async () => {
  const src = mkdtempSync(join(tmpdir(), "vwskill-"))
  const body = "# Skill: vibeweaver — Core Executable Rules\n\n" + "rule text\n".repeat(3000)
  writeFileSync(join(src, "SKILL.md"), body)
  writeFileSync(join(src, "TESTING_PROTOCOLS.md"), "# TP\n")
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: src, steerBudget: 2 })
  const p = ctx.registered.providers[0]
  const candidates = await p.list({})
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].name, "vibeweaver")
  const def = await p.get(candidates[0], {})
  assert.ok(def.content.includes("# Skill: vibeweaver"))
  assert.equal(def.resourceBase.kind, "directory")
  assert.equal(def.resourceBase.path, src)
  rmSync(src, { recursive: true, force: true })
})

test("契约段 text(): 动态生成含 gate token", () => {
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const text = ctx.registered.sections[0].text({})
  assert.ok(text.includes("HARD-GATE-1"))
  assert.ok(text.includes("cap=5  stall=3"))
})

test("pre-step 激活: 编码消息→inject 一次; 非编码不注入; 每 agent 去重", async () => {
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("s1")
  const signal = new AbortController().signal
  const msg = (text) => ({ content: [{ type: "text", text }], source: { kind: "user" } })
  // 编码意图
  const d1 = await ctx.fire("agent/pre-step", {
    agent, messages: [msg("帮我修复登录 bug")], turn: 1, step: 0, signal,
  }, () => ({ kind: "enter", messages: [msg("x")] }))
  assert.ok(d1.messages.some((m) => m.content.some((c) => c.text.includes("vibeweaver"))), "inject 应进入 messages")
  // 同 agent 第二次编码消息：不重复注入
  const d2 = await ctx.fire("agent/pre-step", {
    agent, messages: [msg("再修一个 bug")], turn: 1, step: 1, signal,
  }, () => ({ kind: "enter", messages: [msg("x")] }))
  assert.ok(!d2.messages.some((m) => m.content.some((c) => c.text.includes("vibeweaver"))), "不重复注入")
  // 新 agent 闲聊：不注入
  const agent2 = makeAgent("s2")
  const d3 = await ctx.fire("agent/pre-step", {
    agent: agent2, messages: [msg("今天天气如何")], turn: 1, step: 0, signal,
  }, () => ({ kind: "enter", messages: [msg("y")] }))
  assert.ok(!d3.messages.some((m) => m.content.some((c) => c.text.includes("vibeweaver"))), "闲聊不注入")
})

test("post-execute 门禁: write 到 active 项目且证据缺失→block 带 GATE-BLOCKED", async () => {
  const root = makeActiveProject(true) // 证据缺失（verification_log 空 + 无 assert_artifacts.py）
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const exec = { name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent: makeAgent("s1") }
  const result = { isError: false, content: [{ type: "text", text: "ok" }], value: {} }
  const decision = await ctx.fire("tools/post-execute", exec, result, () => ({ kind: "accept", content: result.content }))
  assert.equal(decision.kind, "block")
  const text = decision.feedback.map((c) => c.text).join(" ")
  assert.ok(text.includes("GATE-BLOCKED"))
  rmSync(root, { recursive: true, force: true })
})

test("post-execute 门禁: 证据齐的 active 项目→放行", async () => {
  const root = makeActiveProject(false)
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const exec = { name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent: makeAgent("s1") }
  const result = { isError: false, content: [{ type: "text", text: "ok" }], value: {} }
  const decision = await ctx.fire("tools/post-execute", exec, result, () => ({ kind: "accept", content: result.content }))
  assert.equal(decision.kind, "accept")
  rmSync(root, { recursive: true, force: true })
})

test("post-execute 门禁: 非 active 项目→next() 放行", async () => {
  const root = mkdtempSync(join(tmpdir(), "vwplain-"))
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const exec = { name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent: makeAgent("s1") }
  const result = { isError: false, content: [{ type: "text", text: "ok" }], value: {} }
  const decision = await ctx.fire("tools/post-execute", exec, result, () => ({ kind: "accept", content: result.content }))
  assert.equal(decision.kind, "accept")
  rmSync(root, { recursive: true, force: true })
})

test("turn-stopping: gate RED → steer 拦截（budget 内）; 超预算放行", async () => {
  const root = makeActiveProject(true)
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("s1", root)
  ctx.agents._register("s1", agent)
  // 直接调用 serial handler（无 next 语义）
  await ctx.fire("agent/turn-stopping", { agent, turn: 1, signal: new AbortController().signal }, () => {})
  await ctx.fire("agent/turn-stopping", { agent, turn: 1, signal: new AbortController().signal }, () => {})
  await ctx.fire("agent/turn-stopping", { agent, turn: 1, signal: new AbortController().signal }, () => {})
  assert.equal(ctx.steered.length, 2, "budget=2 → 2 次 steer")
  assert.ok(ctx.log.some((l) => l.includes("budget exhausted")), "第 3 次应 warn")
  rmSync(root, { recursive: true, force: true })
})

test("vibeweaver_gate 工具: 注册且 execute 返回结构化结果", async () => {
  const root = makeActiveProject()
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const tool = ctx.registered.tools["vibeweaver_gate"]
  assert.ok(tool)
  const exec = { agent: makeAgent("s1") }
  const value = await tool.execute({ cwd: root }, exec)
  assert.equal(typeof value.pass, "boolean")
  assert.ok(Array.isArray(value.blocking))
  assert.ok(Array.isArray(value.warnings))
  rmSync(root, { recursive: true, force: true })
})

test("vibe 命令: handler 输出状态; off 置位禁用", async () => {
  const root = makeActiveProject(true)
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const cmd = ctx.registered.commands.find((c) => c.name === "vibe")
  const agent = makeAgent("s1", root)
  ctx.agents._register("s1", agent)
  const r1 = await cmd.handler({ agent, rawInput: "", commandId: "c1", signal: new AbortController().signal })
  assert.equal(r1.kind, "success")
  assert.ok(r1.text.includes("FAIL"), "证据缺失 → FAIL 状态")
  const r2 = await cmd.handler({ agent, rawInput: "off", commandId: "c2", signal: new AbortController().signal })
  assert.equal(r2.kind, "success")
  // off 后 gate 应放行
  const exec = { name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent }
  const result = { isError: false, content: [{ type: "text", text: "ok" }], value: {} }
  const decision = await ctx.fire("tools/post-execute", exec, result, () => ({ kind: "accept", content: result.content }))
  assert.equal(decision.kind, "accept")
  rmSync(root, { recursive: true, force: true })
})

test("compaction/end: 触发重建注入", async () => {
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("s1")
  ctx.agents._register("s1", agent)
  await ctx.emit("session/event", { id: "s1" }, { type: "compaction/end" })
  assert.equal(ctx.injected.length, 1)
  assert.ok(ctx.injected[0].msg.content[0].text.includes("vibeweaver"))
})

test("回归: ToolExecution 参数字段为 arguments 而非 args（re-review N1）", () => {
  // rc.6 真源: ToolExecutionInput.arguments（dsh-tools types/index.d.ts:205）
  // 官方 consumer agent-instructions 读 exec.arguments.file_path
  const exec = { name: "write", arguments: { file_path: "/tmp/x.js" } }
  assert.equal(typeof exec.arguments.file_path, "string")
  assert.ok(exec.args === undefined, "真实 ToolExecution 无 args 字段")
})

test("M5: agent/disposed 清扫会话状态", async () => {
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("s1")
  ctx.agents._register("s1", agent)
  const signal = new AbortController().signal
  const msg = (text) => ({ content: [{ type: "text", text }], source: { kind: "user" } })
  // 激活注入（pre-step 消息改写路径）
  const d1 = await ctx.fire("agent/pre-step", { agent, messages: [msg("帮我修复 bug")], turn: 1, step: 0, signal },
    () => ({ kind: "enter", messages: [msg("x")] }))
  assert.ok(d1.messages.some((m) => m.content.some((c) => c.text.includes("vibeweaver"))), "激活卡进入 messages")
  // /vibe off 置位禁用
  const cmd = ctx.registered.commands.find((c) => c.name === "vibe")
  await cmd.handler({ agent, rawInput: "off", commandId: "c", signal })
  const exec = { name: "write", arguments: { file_path: "/tmp/x.js" }, agent }
  const result = { isError: false, content: [{ type: "text", text: "ok" }], value: {} }
  const before = await ctx.fire("tools/post-execute", exec, result, () => ({ kind: "accept", content: result.content }))
  assert.equal(before.kind, "accept", "off 后门禁放行")
  // agent 销毁 → 清扫 disabledSessions
  await ctx.emit("agent/disposed", { agent })
  const agent2 = makeAgent("s1")
  ctx.agents._register("s1", agent2)
  // 同 id 新 agent: off 已清 → 门禁重新生效（active 项目）
  const root = makeActiveProject(true)
  const exec2 = { name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent: agent2 }
  const after = await ctx.fire("tools/post-execute", exec2, result, () => ({ kind: "accept", content: result.content }))
  assert.equal(after.kind, "block", "disposed 后禁用被清除, 门禁恢复")
  rmSync(root, { recursive: true, force: true })
})
