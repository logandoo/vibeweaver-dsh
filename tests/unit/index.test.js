import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply, name, inject } from "../../src/index.js"
import { invalidateGateCache } from "../../src/lib.js"

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
    logger: { warn: (m) => ctx.log.push(`warn: ${m}`), info: (m) => ctx.log.push(`info: ${m}`) },
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

test("turn-stopping: gate GREEN + 无 final-run + 本轮写入 → positive-incomplete steer", async () => {
  const root = makeActiveProject(false)
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("s1", root)
  ctx.agents._register("s1", agent)
  const signal = new AbortController().signal
  const msg = (text) => ({ content: [{ type: "text", text }], source: { kind: "user" } })
  await ctx.fire("agent/pre-step", { agent, messages: [msg("实现登录功能")], turn: 1, step: 0, signal }, () => ({ kind: "enter", messages: [] }))
  await new Promise((r) => setTimeout(r, 5))
  const exec = { name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent }
  const result = { isError: false, content: [], value: {} }
  await ctx.fire("tools/post-execute", exec, result, () => ({ kind: "accept", content: [] }))
  await ctx.fire("agent/turn-stopping", { agent, turn: 1, signal }, () => {})
  assert.equal(ctx.steered.length, 1, "no final-run after a write must steer")
  assert.ok(ctx.steered[0].msg.content[0].text.includes("final-run"), "steer names the final-run gap")
  // A completed final-run suppresses the positive leg.
  writeFileSync(join(root, "tests", "verification_log.md"),
    "## Task\n- iter 1 PASS: x\n- final-run: --final — pass=1/fail=0\n")
  await ctx.fire("agent/turn-stopping", { agent, turn: 2, signal }, () => {})
  assert.equal(ctx.steered.length, 1, "final-run must suppress positive steer")
  rmSync(root, { recursive: true, force: true })
})

test("turn-stopping: host error / abort fences positive-incomplete; user Q&A is turn-scoped", async () => {
  const root = makeActiveProject(false)
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("s1", root)
  ctx.agents._register("s1", agent)
  const signal = new AbortController().signal
  const msg = (text) => ({ content: [{ type: "text", text }], source: { kind: "user" } })
  await ctx.fire("agent/pre-step", { agent, messages: [msg("实现功能")], turn: 1, step: 0, signal }, () => ({ kind: "enter", messages: [] }))
  await new Promise((r) => setTimeout(r, 5))
  const exec = { name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent }
  await ctx.fire("tools/post-execute", exec, { isError: false, content: [], value: {} }, () => ({ kind: "accept", content: [] }))
  // Host error after write fences all triggers.
  ctx.emit("agent/error", { agent, turn: 1, step: 1, error: new Error("aborted") })
  await ctx.fire("agent/turn-stopping", { agent, turn: 1, signal }, () => {})
  assert.equal(ctx.steered.length, 0, "error fence must suppress")
  // Aborted turn signal suppresses too (fresh context/agent).
  const root2 = makeActiveProject(false)
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent2 = makeAgent("s2", root2)
  ctx.agents._register("s2", agent2)
  await ctx.fire("agent/pre-step", { agent: agent2, messages: [msg("实现功能")], turn: 1, step: 0, signal }, () => ({ kind: "enter", messages: [] }))
  await new Promise((r) => setTimeout(r, 5))
  await ctx.fire("tools/post-execute", { name: "write", arguments: { file_path: join(root2, "src", "a.js") }, agent: agent2 }, { isError: false, content: [], value: {} }, () => ({ kind: "accept", content: [] }))
  const aborted = new AbortController(); aborted.abort()
  await ctx.fire("agent/turn-stopping", { agent: agent2, turn: 1, signal: aborted.signal }, () => {})
  assert.equal(ctx.steered.length, 0, "aborted signal must suppress")
  // User Q&A after the write is not auto-resumed.
  const root3 = makeActiveProject(false)
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent3 = makeAgent("s3", root3)
  ctx.agents._register("s3", agent3)
  await ctx.fire("agent/pre-step", { agent: agent3, messages: [msg("实现功能")], turn: 1, step: 0, signal }, () => ({ kind: "enter", messages: [] }))
  await new Promise((r) => setTimeout(r, 5))
  await ctx.fire("tools/post-execute", { name: "write", arguments: { file_path: join(root3, "src", "a.js") }, agent: agent3 }, { isError: false, content: [], value: {} }, () => ({ kind: "accept", content: [] }))
  await ctx.fire("agent/pre-step", { agent: agent3, messages: [msg("What changed?")], turn: 2, step: 0, signal }, () => ({ kind: "enter", messages: [] }))
  await ctx.fire("agent/turn-stopping", { agent: agent3, turn: 2, signal }, () => {})
  assert.equal(ctx.steered.length, 0, "user Q&A after write must not auto-resume")
  rmSync(root, { recursive: true, force: true })
  rmSync(root2, { recursive: true, force: true })
  rmSync(root3, { recursive: true, force: true })
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

// ── 波次 B：压缩投笔记原文 / 首次 touch / 子会话排除 ──────────────────────
test("B1/B2: compaction 投工作笔记原文；笔记被删后投快照", async () => {
  const root = makeActiveProject(false)
  writeFileSync(join(root, "tests", "working_note.md"), "# 账本\n- 关键: 压缩后要看见这行\n")
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("sComp", root)
  ctx.agents._register("sComp", agent)
  await ctx.emit("session/event", { id: "sComp" }, { type: "compaction/end", data: {} })
  assert.match(ctx.injected[0].msg.content[0].text, /压缩后要看见这行/, "压缩边界必须投笔记原文")
  rmSync(join(root, "tests", "working_note.md"))
  await ctx.emit("session/event", { id: "sComp" }, { type: "compaction/end", data: {} })
  const t2 = ctx.injected[1].msg.content[0].text
  assert.match(t2, /压缩后要看见这行/, "笔记被删（蒸馏属正常动作）后仍要投快照")
  assert.match(t2, /快照/)
  rmSync(root, { recursive: true, force: true })
})

test("B4: 子代理会话的压缩边界也不投上下文 bundle", async () => {
  const root = makeActiveProject(false)
  writeFileSync(join(root, "tests", "working_note.md"), "# 账本\n- 子代理不该看见这行\n")
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const child = makeAgent("sChildComp", root)
  child.session.header.origin = "subagent"
  ctx.agents._register("sChildComp", child)
  await ctx.emit("session/event", { id: "sChildComp" }, { type: "compaction/end", data: {} })
  assert.equal(ctx.injected.length, 0, "子代理会话不得收到压缩 bundle")
  rmSync(root, { recursive: true, force: true })
})

test("B3: warn 档 + 证据红也要投首次指针（原来被门禁降级分支吞掉）", async () => {
  const root = makeActiveProject(true)
  writeFileSync(join(root, "tests", "working_note.md"), "# 账本\n- x\n")
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2, gateMode: "warn" })
  const agent = makeAgent("sWarn", root)
  ctx.agents._register("sWarn", agent)
  const result = { isError: false, content: [{ type: "text", text: "ok" }], value: {} }
  const d = await ctx.fire("tools/post-execute",
    { name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent, callId: "w1" },
    result, () => ({ kind: "accept", content: result.content }))
  const text = (d.content || []).map((c) => c.text || "").join("\n")
  assert.match(text, /working_note\.md 在场/, "warn 档同样要投首次指针")
  rmSync(root, { recursive: true, force: true })
})

test("A3: package.json 的 engines.dsh 有上限（无上限 = 对未知大版本免检）", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
  const range = pkg.engines?.dsh || ""
  assert.match(range, />=\S+/, "要有下限")
  assert.match(range, /<\S+/, "要有上限（0.3 之前必须重新评估）")
})

test("B3: 首次写入投重入指针，第二次不再投（遥测记 1 次）", async () => {
  const root = makeActiveProject(false)
  writeFileSync(join(root, "tests", "working_note.md"), "# 账本\n- x\n")
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("sCue", root)
  ctx.agents._register("sCue", agent)
  const result = { isError: false, content: [{ type: "text", text: "ok" }], value: {} }
  const exec = (id) => ({ name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent, callId: id })
  const d1 = await ctx.fire("tools/post-execute", exec("c1"), result, () => ({ kind: "accept", content: result.content }))
  assert.match((d1.content || []).map((c) => c.text || "").join("\n"), /working_note\.md 在场/, "首次写入要投指针")
  const d2 = await ctx.fire("tools/post-execute", exec("c2"), result, () => ({ kind: "accept", content: result.content }))
  assert.ok(!/working_note\.md 在场/.test((d2.content || []).map((c) => c.text || "").join("\n")), "第二次不再投")
  const st = JSON.parse(readFileSync(join(root, ".vibeweaver", "state.json"), "utf8"))
  assert.equal(st.memoryDeliveries.sessionCue, 1, "遥测应记 1 次")
  rmSync(root, { recursive: true, force: true })
})

test("B3: 被门禁拦下的首写不消费指针，下一次被接受的写入才投", async () => {
  const root = makeActiveProject(true) // 证据红 → 首写会被 block
  writeFileSync(join(root, "tests", "working_note.md"), "# 账本\n- x\n")
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("sRed", root)
  ctx.agents._register("sRed", agent)
  const result = { isError: false, content: [{ type: "text", text: "ok" }], value: {} }
  const exec = (id) => ({ name: "write", arguments: { file_path: join(root, "src", "a.js") }, agent, callId: id })
  const d1 = await ctx.fire("tools/post-execute", exec("r1"), result, () => ({ kind: "accept", content: result.content }))
  assert.equal(d1.kind, "block", "证据红时首写被拦")
  // 修好证据后（直接改盘 + 失效缓存），下一次写入必须拿到那条指针
  writeFileSync(join(root, "tests", "verification_log.md"), "## Task\n- iter 1 PASS: x (evidence: tests/acceptance.md, 1/1)\n")
  writeFileSync(join(root, "tests", "acceptance.md"), "> cap=5  stall=3×\n") // 证据要真的变绿，两件都得在
  invalidateGateCache(root)
  const d2 = await ctx.fire("tools/post-execute", exec("r2"), result, () => ({ kind: "accept", content: result.content }))
  const text = (d2.content || []).map((c) => c.text || "").join("\n")
  assert.match(text, /working_note\.md 在场/, "被拦那次不得消费指针")
  rmSync(root, { recursive: true, force: true })
})

test("B4: 子代理会话不投激活卡，普通会话照投", async () => {
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const msg = (text) => ({ content: [{ type: "text", text }], source: { kind: "user" } })
  const child = makeAgent("sChild")
  child.session.header.origin = "subagent"
  const d1 = await ctx.fire("agent/pre-step", { agent: child, messages: [msg("修复登录 bug")], turn: 1, step: 0 },
    () => ({ kind: "enter", messages: [msg("x")] }))
  assert.ok(!d1.messages.some((m) => m.content.some((c) => (c.text || "").includes("vibeweaver"))), "子代理不得注入")
  const normal = makeAgent("sNormal")
  const d2 = await ctx.fire("agent/pre-step", { agent: normal, messages: [msg("修复登录 bug")], turn: 1, step: 0 },
    () => ({ kind: "enter", messages: [msg("x")] }))
  assert.ok(d2.messages.some((m) => m.content.some((c) => (c.text || "").includes("vibeweaver"))), "普通会话照投")
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

// ── A1（BLOCKER-1）：消息源 kind 去 catch-all `plugin` ──────────────────────
// 0.2.x 的 MessageSourceMap 只有 user/model/tool/system-prompt（dsh-llm/lib/types/
// message.d.ts:101-108，注释 :97 "there is no shared catch-all `plugin` kind"）；
// 写侧 dsh-session 只要求 kind 非空，读侧 dsh-session-persistence-jsonl/lib/worker.cjs:11641
// 对 kind === "plugin" 抛 SessionFormatError → 注入过消息的会话再也读不回来。
// 生产者的正确写法是声明自己的 kind（merge-extensible），这里 = dsh-vibeweaver。
test("A1: 三处注入的 source.kind 恒为 dsh-vibeweaver（激活卡 / steer / 重建卡）", async () => {
  const SOURCES = []
  const MESSAGES = []
  // 1) pre-step 激活卡（改 decision.messages）
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("s1")
  const msg = (text) => ({ content: [{ type: "text", text }], source: { kind: "user" } })
  const d1 = await ctx.fire("agent/pre-step", {
    agent, messages: [msg("帮我修复登录 bug")], turn: 1, step: 0,
  }, () => ({ kind: "enter", messages: [msg("x")] }))
  SOURCES.push(["activation", d1.messages[d1.messages.length - 1].source])
  MESSAGES.push(["activation", d1.messages[d1.messages.length - 1]])
  // 2) turn-stopping steer（证据红项目 → 必 steer）
  const root = makeActiveProject(true)
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent2 = makeAgent("s2", root)
  ctx.agents._register("s2", agent2)
  await ctx.fire("agent/turn-stopping", { agent: agent2, turn: 1, signal: new AbortController().signal }, () => {})
  SOURCES.push(["steer", ctx.steered[0].msg.source])
  MESSAGES.push(["steer", ctx.steered[0].msg])
  // 3) compaction 重建卡（agent.inject 侧通道）
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent3 = makeAgent("s3")
  ctx.agents._register("s3", agent3)
  await ctx.emit("session/event", { id: "s3" }, { type: "compaction/end", data: {} })
  SOURCES.push(["recover", ctx.injected[0].msg.source])
  MESSAGES.push(["recover", ctx.injected[0].msg])

  for (const [where, src] of SOURCES) {
    assert.ok(src, `${where}: 注入缺少 source`)
    assert.equal(src.kind, "dsh-vibeweaver", `${where}: source.kind 必须是生产者自有 kind`)
    assert.ok(!("plugin" in src), `${where}: 不得再带 plugin 字段（0.2.x 读侧按 retired syntax 拒绝）`)
  }
  // 评审 R2 Critical-1：光有 kind 仍然读不回来——读侧 assertMessageEventShape 要求
  // 每条 user/message 有非空 id 且 role === "user"，而 dsh-agent-loop 原样落盘不补身份。
  for (const [where, msg] of MESSAGES) {
    assert.equal(typeof msg.id, "string", `${where}: 缺 id → 会话重载报 "lacks an identified message"`)
    assert.ok(msg.id.length > 0, `${where}: id 不得为空`)
    assert.equal(msg.role, "user", `${where}: role 必须是 user`)
  }
  // 全文件级钉：源码里不再出现 catch-all 写法（判据 #1 的 grep 断言）
  const entry = readFileSync(new URL("../../src/index.js", import.meta.url), "utf8")
  assert.equal((entry.match(/kind:\s*"plugin"/g) || []).length, 0, 'src/index.js 仍出现 kind: "plugin"')
  assert.ok((entry.match(/injectedUserMessage\(/g) || []).length >= 3, "注入必须全走信封工厂（≥3 处：激活/steer/重建）")
  rmSync(root, { recursive: true, force: true })
})

// ── A5（MINOR）：compaction 失败不投"已压缩"重建卡 ─────────────────────────
// compaction/end 载荷自 rc.6 起带 `error?: string`（dsh-compaction/lib/types/
// types.d.ts:73-79）：失败的压缩同样以 end 收尾，此时上下文并未被压掉，投重建卡
// 是假信号（还会挤掉真正的恢复时机）。
test("A5: compaction/end 带 error → 不投重建卡；无 error → 照常投", async () => {
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("s5")
  ctx.agents._register("s5", agent)
  await ctx.emit("session/event", { id: "s5" }, { type: "compaction/end", data: { error: "summary request failed" } })
  assert.equal(ctx.injected.length, 0, "压缩失败（data.error 在场）不得投重建卡")
  await ctx.emit("session/event", { id: "s5" }, { type: "compaction/end", data: { compactionId: "c1" } })
  assert.equal(ctx.injected.length, 1, "成功压缩仍要投重建卡")
})

// ── A6（MINOR）：契约段显式 interpolate: false ─────────────────────────────
// 0.2.x 的 PromptSection.interpolate 默认 true（dsh-system-prompt/lib/types/index.d.ts:58-62），
// 卡面今天恰好没有 `{{`/`}}` 属隐性不变量；显式化后宿主插值不会改写契约文本，
// 且解除"卡面路径长度顶预算"的耦合。旧版忽略未知字段，安全。
test("A6: 契约段注册显式 interpolate: false", () => {
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const section = ctx.registered.sections[0]
  assert.equal(section.name, "vibeweaver-covenant")
  assert.equal(section.interpolate, false, "契约段必须显式关闭宿主插值")
})

// ── A2（BLOCKER-2）：有效工作目录跟工具面同源 ──────────────────────────────
// 0.2.x 起会话可以 cd（working_directory{cd}），不可变的 session.header.cwd 保留原项目，
// dsh-tool-fs 改读 ctx.workingDirectory.ensure(exec.agent)（lib/index.js:172）。门禁若仍
// 只读 header.cwd，会话 cd 之后 findProjectRoot 找不到日志 → 门禁静默消失。
// 夹具形态对齐真源：ctx.workingDirectory.get(session) 同步读 projection、无 I/O。
function projectDir({ active = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vwcwd-"))
  if (active) {
    mkdirSync(join(root, "tests"), { recursive: true })
    writeFileSync(join(root, "tests", "verification_log.md"), "")
    writeFileSync(join(root, "tests", "acceptance.md"), "")
  }
  return root
}

function cwdProbeCtx(effective, { throws = false } = {}) {
  const c = makeCtx()
  // 按真 cordis 的可选依赖语义建模（评审 R2 Critical-2 的教训：桩必须照上游机制写，
  // 不能照"我们希望代码怎么读"写）：ctx.inject([name], cb) 在依赖可用时以扩展 ctx 调用
  // cb；依赖缺席则回调永不触发。上游签名是 get(session)（dsh-working-directory/lib/
  // index.js:76），传错对象时真服务会抛——所以这里也校验入参形状（评审 I-4）。
  c.inject = (deps, cb) => {
    if (!Array.isArray(deps) || !deps.includes("workingDirectory")) return () => {}
    // 回调**异步**触发：真 cordis 的可选依赖回调晚于 apply() 返回（tests/real_cordis_probe.mjs
    // 在真容器里实测顺序 = ["apply-end","cb"]）。桩若同步触发，"apply 时快照服务"的错误
    // 实现在单测里照样全绿——FCV M7 就是这个盲区（评审 R2 的 reflect.get 空转同族）。
    const t = setTimeout(() => cb({
      ...c,
      workingDirectory: {
        get: (session) => {
          if (!session || typeof session !== "object" || !("header" in session)) {
            throw new Error("workingDirectory.get 需要 Session（不是 Agent）")
          }
          if (throws) throw new Error("projection unavailable")
          return effective
        },
      },
    }), 0)
    return () => clearTimeout(t)
  }
  return c
}
// 等可选依赖回调落地（与真 cordis 同序：晚于 apply()）
const settle = () => new Promise((r) => setTimeout(r, 0))

test("A2: header.cwd 与服务报不同目录时，门禁命中服务目录（turn-stopping + gate 工具）", async () => {
  const dirA = projectDir({ active: false }) // header.cwd：非 vibeweaver 项目
  const dirB = projectDir()                  // 服务报：会话 cd 后的真项目（证据红）
  ctx = cwdProbeCtx(dirB)
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  await settle()
  const agent = makeAgent("sA2", dirA)
  ctx.agents._register("sA2", agent)
  const signal = new AbortController().signal
  const msg = (text) => ({ content: [{ type: "text", text }], source: { kind: "user" } })
  await ctx.fire("agent/pre-step", { agent, messages: [msg("实现功能")], turn: 1, step: 0, signal }, () => ({ kind: "enter", messages: [] }))
  await ctx.fire("agent/turn-stopping", { agent, turn: 1, signal }, () => {})
  assert.equal(ctx.steered.length, 1, "服务目录是活跃项目 → 必须 steer（现网读 header.cwd 会判非项目）")

  const value = await ctx.registered.tools["vibeweaver_gate"].execute({}, { agent })
  assert.equal(value.pass, false, "gate 工具默认工作目录同样必须走服务")
  rmSync(dirA, { recursive: true, force: true })
  rmSync(dirB, { recursive: true, force: true })
})

test("A2: 服务缺失（rc.6/rc.3）→ 回退 header.cwd，门禁照常生效", async () => {
  const dirB = projectDir()
  ctx = makeCtx() // 无 ctx.reflect → 无 workingDirectory 服务（0.1.x 形状）
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("sA2b", dirB)
  ctx.agents._register("sA2b", agent)
  const signal = new AbortController().signal
  const msg = (text) => ({ content: [{ type: "text", text }], source: { kind: "user" } })
  await ctx.fire("agent/pre-step", { agent, messages: [msg("实现功能")], turn: 1, step: 0, signal }, () => ({ kind: "enter", messages: [] }))
  await ctx.fire("agent/turn-stopping", { agent, turn: 1, signal }, () => {})
  assert.equal(ctx.steered.length, 1, "旧版语义必须原样保留")
  const value = await ctx.registered.tools["vibeweaver_gate"].execute({}, { agent })
  assert.equal(value.pass, false)
  rmSync(dirB, { recursive: true, force: true })
})

test("A2: 服务抛错 → 回退 header.cwd（宿主子系统故障不得让门禁消失，也不得让写入抛栈）", async () => {
  const dirB = projectDir()
  ctx = cwdProbeCtx(dirB, { throws: true })
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  await settle()
  const agent = makeAgent("sA2c", dirB)
  ctx.agents._register("sA2c", agent)
  const signal = new AbortController().signal
  const msg = (text) => ({ content: [{ type: "text", text }], source: { kind: "user" } })
  await ctx.fire("agent/pre-step", { agent, messages: [msg("实现功能")], turn: 1, step: 0, signal }, () => ({ kind: "enter", messages: [] }))
  await ctx.fire("agent/turn-stopping", { agent, turn: 1, signal }, () => {})
  assert.equal(ctx.steered.length, 1, "服务抛错时 header.cwd 兜底")
  rmSync(dirB, { recursive: true, force: true })
})

test("A2: 服务不进 inject（0.1.x 上会让整个插件 INACTIVE）", () => {
  // cordis _refresh(): 任一 inject 名无实现 → epoch=INACTIVE → _unload()。
  // rc.6/rc.3 没有 workingDirectory 服务，声明它 = 插件在旧版上静默不加载。
  assert.ok(!inject.includes("workingDirectory"), "workingDirectory 必须走可选读，不能声明为必需服务")
  assert.ok(inject.includes("tools"), "inject 面其余项不动")
})

// 评审 R1（Important-1）：只认服务目录时，一次 cd 出去就把命令面三道守卫整体关掉，
// 连"绝对路径删项目内文件"都不再看。原项目目录（不可变 header.cwd）必须留在根锚候选里。
test("A2/R1 镜像夹具: 项目在**服务**一侧时，守卫仍必须认得它", async () => {
  // 判别对象：把 effectiveCwd 退回 header.cwd（评审复评 M-M 变异）时，本例会从 DENY 变 ALLOW。
  // 上一例的项目在 header.cwd 一侧，所以那个变异在它眼里"碰巧正确"——这就是盲区。
  const dirB = projectDir() // 服务报的目录：真项目
  const dirOut = mkdtempSync(join(tmpdir(), "vcout2-")) // header.cwd：非项目
  ctx = cwdProbeCtx(dirB)
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  await settle()
  const agent = makeAgent("sMirror", dirOut)
  ctx.agents._register("sMirror", agent)
  const exec = { name: "bash", arguments: { command: "rm -rf src" }, agent, callId: "c-mirror" }
  const d = await ctx.fire("tools/pre-execute", exec, () => ({ kind: "allow" }))
  assert.equal(d.kind, "deny", "相对路径的破坏性命令必须按服务目录归属项目")
  rmSync(dirB, { recursive: true, force: true })
  rmSync(dirOut, { recursive: true, force: true })
})

test("A4/R1: /vibe off 之后命令面提示也必须彻底安静", async () => {
  const root = makeActiveProject(false)
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("sOff", root)
  ctx.agents._register("sOff", agent)
  const result = { isError: false, content: [{ type: "text", text: "ok" }], value: {} }
  await ctx.fire("tools/pre-execute",
    { name: "working_directory", arguments: { cd: "../.." }, agent, callId: "k-off" }, () => ({ kind: "allow" }))
  const cmd = ctx.registered.commands.find((c) => c.name === "vibe")
  await cmd.handler({ agent, rawInput: "off", commandId: "c", signal: new AbortController().signal })
  const after = await ctx.fire("tools/post-execute",
    { name: "working_directory", arguments: { cd: "../.." }, agent, callId: "k-off" },
    result, () => ({ kind: "accept", content: result.content }))
  const text = (after.content || []).map((c) => c.text || "").join("")
  assert.ok(!/项目根|working_directory/.test(text), "禁用会话不得再投守卫提示（评审 R1 复评）")
  rmSync(root, { recursive: true, force: true })
})

test("A2/R1: 会话 cd 出项目后，命令面守卫仍以原项目为根", async () => {
  const dirB = projectDir() // 原项目（header.cwd）
  const dirOut = mkdtempSync(join(tmpdir(), "vcout-")) // 服务报的目录：非项目
  ctx = cwdProbeCtx(dirOut)
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  await settle()
  const agent = makeAgent("sAnchor", dirB)
  ctx.agents._register("sAnchor", agent)
  const exec = { name: "bash", arguments: { command: `rm -rf ${dirB}/src` }, agent, callId: "c-anchor" }
  const d = await ctx.fire("tools/pre-execute", exec, () => ({ kind: "allow" }))
  assert.equal(d.kind, "deny", "绝对路径指向项目内的递归删除必须仍被拦")
  assert.match(d.reason, /destructive|破坏性/)
  rmSync(dirB, { recursive: true, force: true })
  rmSync(dirOut, { recursive: true, force: true })
})

// 评审 R1（Minor）：命令面工具的动作在后置之前就已执行完，判红只能把工具自己的输出
// 换成门禁块。命令面因此不进证据门；只有换目录工具的提示需要投递。
test("A4/R1: 命令面块档不进后置证据门；换目录工具的提示仍可见", async () => {
  const root = makeActiveProject(true) // 证据红
  ctx = makeCtx()
  apply(ctx, { skillSourceDir: "/tmp/skills", steerBudget: 2 })
  const agent = makeAgent("sCmd", root)
  ctx.agents._register("sCmd", agent)
  const result = { isError: false, content: [{ type: "text", text: "ran" }], value: {} }
  const d1 = await ctx.fire("tools/post-execute",
    { name: "run_code", arguments: { code: "print(1)" }, agent, callId: "k1" },
    result, () => ({ kind: "accept", content: result.content }))
  assert.equal(d1.kind, "accept", "run_code 不被后置门禁替换输出")
  assert.ok(!((d1.content || []).map((c) => c.text).join("").includes("GATE-BLOCKED")))

  const d2 = await ctx.fire("tools/pre-execute",
    { name: "working_directory", arguments: { cd: "../.." }, agent, callId: "k2" }, () => ({ kind: "allow" }))
  assert.equal(d2.kind, "allow", "cd 出项目不 deny")
  const p2 = await ctx.fire("tools/post-execute",
    { name: "working_directory", arguments: { cd: "../.." }, agent, callId: "k2" },
    result, () => ({ kind: "accept", content: result.content }))
  const text2 = (p2.content || []).map((c) => c.text || "").join("\n")
  assert.equal(p2.kind, "accept")
  assert.match(text2, /项目根|working_directory/, "前置的提示必须由后置投出（pre→post 链路）")
  // 同一次调用的提示不得重复投递两次（stash 消费一次即清）
  const p2b = await ctx.fire("tools/post-execute",
    { name: "working_directory", arguments: { cd: "../.." }, agent, callId: "k2" },
    result, () => ({ kind: "accept", content: result.content }))
  assert.ok(!((p2b.content || []).map((c) => c.text || "").join("").includes("项目根")), "二次后置不得重投")
  rmSync(root, { recursive: true, force: true })
})
