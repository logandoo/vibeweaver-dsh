// vibeweaver-dsh 插件主入口 — dsh 0.1.0-rc.6 (Cordis)
// 组件: skill provider / 契约段 / pre-step 激活 / post-execute 门禁 /
//       turn-stopping 守卫 / vibeweaver_gate 工具 / /vibe 命令 / compaction 重建
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import {
  checkGate,
  blockMessage,
  stallObservation,
  isCodingIntent,
  covenantCard,
  findProjectRoot,
  invalidateGateCache,
  GATED_TOOLS,
} from "./lib.js"

export const name = "vibeweaver"
export const inject = ["tools", "systemPrompt", "skills", "commands", "agents"]

const ACTIVATION_TEXT = [
  "【vibeweaver 激活】本任务疑似编码任务（文件路径/编程关键词命中）。",
  "写或改任何代码之前，必须先调用 skill({name:\"vibeweaver\"}) 加载全量规则（渐进披露），然后：",
  "1. 按 SKILL.md §2 做 ZERO 分解与 web 研究（≥2 方案评估）；",
  "2. 产出 tests/acceptance.md（首行 `> cap=5  stall=3×`）作为验收判据；",
  "3. 遵守 COV-1..11（NO TEST NO DONE / SCRIPT-ONLY / 验证循环 / cap=5 stall=3× 边界）；",
  "4. 完成时输出 [Verification Gate] 行（含字面 HARD-GATE-1/2 token）与 8 列完成表。",
  "证据检查: 需要时调用 vibeweaver_gate 工具自检。",
].join("\n")

const STEER_TEXT = [
  "[vibeweaver 守卫] 验证证据未齐：tests/assert_artifacts.py 未退出 0（见上一工具结果）。",
  "本回合不得结束——先修复证据（verification_log/acceptance/截图等落盘），再调用 vibeweaver_gate 确认，或明确向用户说明为何无法满足。",
].join("\n")

const RECOVER_TEXT = [
  "【vibeweaver 重建卡】上下文已压缩。恢复纪律工作流状态：",
  "1. 重读 tests/acceptance.md 逐条核对当前进度；",
  "2. 重读 tests/verification_log.md 全部迭代行；",
  "3. 按 COV-1..11 继续（证据 + 循环边界 + 完成行格式）。",
].join("\n")

export function apply(ctx, config = {}) {
  const skillSourceDir = config.skillSourceDir || process.env.VIBEWEAVER_SKILL_DIR || join(homedir(), ".config/opencode/skills/vibeweaver")
  const steerBudget = config.steerBudget ?? 3
  const gateMode = config.gateMode || "block"
  const preStepActivation = config.preStepActivation !== false
  const recoverAfterCompaction = config.recoverAfterCompaction !== false

  // 会话级状态（瞬态；持久状态在项目 .vibeweaver/state.json 由 stallObservation 管理）
  const injectedAgents = new Set()
  const steered = new Map() // key: `${sessionId}:${turn}` -> count
  const disabledSessions = new Set()

  // M5: 会话结束/销毁时清扫状态
  ctx.on("agent/disposed", (payload) => {
    const sessionId = payload.agent?.session?.id
    if (!sessionId) return
    injectedAgents.delete(sessionId)
    disabledSessions.delete(sessionId)
    for (const key of steered.keys()) {
      if (key.startsWith(sessionId + ":")) steered.delete(key)
    }
  })

  const gateEnabled = () => gateMode !== "off"

  // ── 1. skill provider：从正源目录提供 vibeweaver skill ──
  ctx.skills.registerProvider(() => ({
    name: "vibeweaver-filesystem",
    async list(options) {
      if (!existsSync(join(skillSourceDir, "SKILL.md"))) return []
      return [{
        name: "vibeweaver",
        description: "Enforce disciplined engineering workflows for all coding projects. TRIGGER when: user asks to build, modify, debug, or deploy any software project.",
        rank: 100,
        source: "runtime",
        invocation: { modelInvocable: true, userInvocable: true },
        provider: "vibeweaver-filesystem",
        locator: { dir: skillSourceDir },
        path: join(skillSourceDir, "SKILL.md"),
        resourceBase: { kind: "directory", path: skillSourceDir },
      }]
    },
    async get(candidate) {
      const dir = candidate?.locator?.dir || skillSourceDir
      const p = join(dir, "SKILL.md")
      if (!existsSync(p)) return undefined
      return {
        name: "vibeweaver",
        description: "Enforce disciplined engineering workflows for all coding projects. TRIGGER when: user asks to build, modify, debug, or deploy any software project.",
        content: readFileSync(p, "utf8"),
        path: p,
        source: "runtime",
        invocation: { modelInvocable: true, userInvocable: true },
        provider: "vibeweaver-filesystem",
        resourceBase: { kind: "directory", path: dir },
      }
    },
  }))

  // ── 2. 契约段（order 100，prefix-stable）──
  ctx.systemPrompt.section({
    name: "vibeweaver-covenant",
    order: 100,
    text: () => covenantCard({ skillSourceDir, steerBudget }),
  })

  // ── 3. pre-step 激活 ──
  // 与 dsh-tool-skill 同模式（官方 consumer）：在 waterfall 里改 decision.messages
  // 立即生效；agent.inject() 是 void（fire-and-forget，仅排队下一批）—— 用于 compaction 重建
  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next()
    if (!preStepActivation) return decision
    if (decision?.kind !== "enter") return decision
    const agent = payload.agent
    const sessionId = agent?.session?.id
    if (!sessionId || injectedAgents.has(sessionId)) return decision
    const userTexts = (payload.messages || [])
      .filter((m) => m.source?.kind === "user")
      .map((m) => (m.content || []).map((c) => c.text || "").join("\n"))
      .join("\n")
    if (!isCodingIntent(userTexts)) return decision
    injectedAgents.add(sessionId)
    return {
      ...decision,
      messages: [
        ...(decision.messages || []),
        { content: [{ type: "text", text: ACTIVATION_TEXT }], source: { kind: "plugin", plugin: "dsh-vibeweaver" } },
      ],
    }
  })

  // ── 4. post-execute 门禁（write/edit）──
  const postExecute = async (exec, result, next) => {
    if (!gateEnabled()) return next()
    if (!GATED_TOOLS.has(exec.name)) return next()
    if (process.env.VIBEWEAVER_GATE === "off") return next()
    const sessionId = exec.agent?.session?.id
    if (sessionId && disabledSessions.has(sessionId)) return next()
    const filePath = exec.arguments && typeof exec.arguments.file_path === "string" ? exec.arguments.file_path : null
    const root = findProjectRoot(filePath)
    if (!root) return next()
    invalidateGateCache(root) // 写操作已落盘 → 缓存失效, 本次检查重跑
    const gate = checkGate(root)
    const base = () => ({ kind: "accept", content: result.content })
    if (gate && gate.blocking.length) {
      const msg = blockMessage(root, gate)
      return { kind: "block", feedback: [{ type: "text", text: msg }] }
    }
    const warns = []
    if (gate && gate.warnings.length) {
      warns.push("[GATE-WARNING (vibeweaver)] non-blocking: " + gate.warnings.join("; ") + " — fix before the final [Verification Gate] line.")
    }
    const stall = stallObservation(root, filePath || "(unknown file)")
    if (stall) warns.push("[GATE-WARNING (vibeweaver-stall)] " + stall)
    if (warns.length) {
      const existing = (result.content || []).map((c) => c.text || "").join("\n")
      return {
        kind: "accept",
        content: [...(result.content || []), { type: "text", text: warns.join("\n") }],
      }
    }
    return base()
  }
  ctx.on("tools/post-execute", postExecute)

  // ── 5. turn-stopping 守卫 ──
  ctx.on("agent/turn-stopping", (payload) => {
    if (!gateEnabled()) return
    if (process.env.VIBEWEAVER_GATE === "off") return
    const agent = payload.agent
    const sessionId = agent?.session?.id
    if (sessionId && disabledSessions.has(sessionId)) return
    const agentCwd = agent?.session?.header?.cwd
    const root = findProjectRoot(agentCwd)
    if (!root) return
    const gate = checkGate(root)
    if (!gate || !gate.blocking.length) return
    const key = `${sessionId}:${payload.turn}`
    const count = steered.get(key) || 0
    if (count < steerBudget) {
      steered.set(key, count + 1)
      agent.steer({ content: [{ type: "text", text: STEER_TEXT }], source: { kind: "plugin", plugin: "dsh-vibeweaver" } })
    } else {
      ctx.logger.warn(`vibeweaver: gate RED but steer budget exhausted for ${key}, turn closing`)
    }
  })

  // ── 6. vibeweaver_gate 工具 ──
  ctx.tools.register({
    name: "vibeweaver_gate",
    description: "Run the vibeweaver evidence gate (tests/assert_artifacts.py) for the given workspace and return structured pass/blocking/warnings. Use it to self-check verification evidence before declaring a task complete.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string", description: "Workspace directory to check; defaults to the calling session's cwd." },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          pass: { type: "boolean" },
          blocking: { type: "array", items: { type: "string" } },
          warnings: { type: "array", items: { type: "string" } },
        },
        required: ["pass", "blocking", "warnings"],
      },
      render: (_args, value) => {
        const lines = [`vibeweaver gate: ${value.pass ? "PASS" : "FAIL"}`]
        if (value.blocking.length) lines.push("blocking:", ...value.blocking.map((m) => "- " + m))
        if (value.warnings.length) lines.push("warnings:", ...value.warnings.map((m) => "- " + m))
        return [{ type: "text", text: lines.join("\n") }]
      },
    },
    async execute(args, exec) {
      const cwd = args?.cwd || exec.agent?.session?.header?.cwd
      const root = findProjectRoot(cwd)
      if (!root) return { pass: true, blocking: [], warnings: [] }
      const gate = checkGate(root)
      if (!gate) return { pass: true, blocking: [], warnings: [] }
      return { pass: gate.blocking.length === 0, blocking: gate.blocking, warnings: gate.warnings }
    },
  })

  // ── 7. /vibe 命令 ──
  ctx.commands.register({
    name: "vibe",
    description: "vibeweaver gate 状态查询（/vibe）或会话级禁用（/vibe off）",
    handler: (invocation) => {
      const sessionId = invocation.agent?.session?.id
  const raw = (invocation.rawInput || "").trim()
  const firstWord = raw.split(/\s+/)[0] || ""
  if (firstWord === "off") {
        if (sessionId) disabledSessions.add(sessionId)
        return { kind: "success", text: "vibeweaver gate disabled for this session (/vibe on 重新启用)。" }
      }
      if (firstWord === "on") {
        if (sessionId) disabledSessions.delete(sessionId)
        return { kind: "success", text: "vibeweaver gate enabled for this session。" }
      }
      const agentCwd = invocation.agent?.session?.header?.cwd
      const root = findProjectRoot(agentCwd)
      if (!root) return { kind: "success", text: "vibeweaver: 当前工作区非 vibeweaver-active（无 tests/verification_log.md），gate 不生效。" }
      const gate = checkGate(root)
      if (!gate) return { kind: "success", text: "vibeweaver gate: PASS（证据齐）。" }
      return {
        kind: "success",
        text: `vibeweaver gate: ${gate.blocking.length ? "FAIL" : "PASS"} (blocking=${gate.blocking.length}, warnings=${gate.warnings.length})` +
          (gate.blocking.length ? "\n" + gate.blocking.map((m) => "- " + m).join("\n") : ""),
      }
    },
  })

  // ── 8. compaction 重建注入 ──
  ctx.on("session/event", (session, event) => {
    if (!recoverAfterCompaction) return
    if (event?.type !== "compaction/end") return
    const sessionId = session?.id
    if (!sessionId) return
    const agent = ctx.agents.get(sessionId)
    if (!agent) return
    agent.inject({ content: [{ type: "text", text: RECOVER_TEXT }], source: { kind: "plugin", plugin: "dsh-vibeweaver" } })
  })
}
