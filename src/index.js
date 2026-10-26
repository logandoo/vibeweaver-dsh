// vibeweaver-dsh 插件主入口 — dsh 0.1.0-rc.6 (Cordis)
// 组件: skill provider / 契约段 / pre-step 激活 / post-execute 门禁 /
//       turn-stopping 守卫 / vibeweaver_gate 工具 / /vibe 命令 / compaction 重建
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import {
  writePathFromArgs,
  checkGate,
  preExecuteDecision,
  blockMessage,
  stallObservation,
  isCodingIntent,
  covenantCard,
  currentLogBlock,
  hasFinalRun,
  isStopDirective,
  findProjectRoot,
  invalidateGateCache,
  cueNotes,
  GATED_TOOLS,
} from "./lib.js"

export const name = "vibeweaver"
export const inject = ["tools", "systemPrompt", "skills", "commands", "agents"]

const ACTIVATION_TEXT = [
  "【vibeweaver 激活】本任务疑似编码任务（文件路径/编程关键词命中）。",
  "写或改任何代码之前，必须先调用 skill({name:\"vibeweaver\"}) 加载全量规则（渐进披露），然后：",
  "1. 按 SKILL.md §2 做 ZERO 分解与 web 研究（≥2 方案评估）；",
  "2. 产出 tests/acceptance.md（首行 `> cap=5  stall=3×`）作为验收判据；",
  "3. 声明 `Mode:` / `Lane:` / `Class: CODE|CONFIG|DOC`（COV-12/13，按 git diff --stat 文件种类，不确定取高）；",
  "4. 遵守 COV-1..13（NO TEST NO DONE / SCRIPT-ONLY / 验证循环 / cap=5 stall=3× 边界 / Class 比例化路径）；",
  "5. 完成时输出 [Verification Gate] 行（含字面 HARD-GATE-1/2 token 与 Class 字段）与完成表（CODE=8 列；DOC/CONFIG=lite 3 列），交付 office 资产先过 NO RENDER, NO DONE 渲染门。",
  "证据检查: 需要时调用 vibeweaver_gate 工具自检。",
].join("\n")

const STEER_TEXT = [
  "[vibeweaver 守卫] 验证证据未齐：tests/assert_artifacts.py 未退出 0（见上一工具结果）。",
  "本回合不得结束——先修复证据（verification_log/acceptance/截图等落盘），再调用 vibeweaver_gate 确认，或明确向用户说明为何无法满足。",
].join("\n")

const INCOMPLETE_STEER_TEXT = [
  "[vibeweaver 守卫] 本回合停在任务未完成状态：tests/acceptance.md 仍存在，但当前任务块没有 `- final-run: --final … pass=N/fail=0`。",
  "本回合不得结束——运行 vibeweaver_gate 确认证据；继续修复，或写 tests/paused_state.md 并给出 [PAUSED] 包（合法停止）。不要只总结已完成的部分。",
].join("\n")

const RECOVER_TEXT = [
  "【vibeweaver 重建卡】上下文已压缩。恢复纪律工作流状态：",
  "1. 重读 tests/acceptance.md 逐条核对当前进度；",
  "2. 重读 tests/verification_log.md 全部迭代行（含任务块首条 `- class:` 声明）；",
  "3. 按 COV-1..13 继续（证据 + 循环边界 + Class 比例化路径 + 完成行格式）。",
].join("\n")

export function apply(ctx, config = {}) {
  const skillSourceDir = config.skillSourceDir || process.env.VIBEWEAVER_SKILL_DIR || join(homedir(), ".config/opencode/skills/vibeweaver")
  const steerBudget = config.steerBudget ?? 3
  const gateMode = config.gateMode || "block"
  const preStepActivation = config.preStepActivation !== false
  const recoverAfterCompaction = config.recoverAfterCompaction !== false

  // 视觉探针优先用插件自带的 mm_probe.py（与 vibeweaver 主流程字节一致），
  // 缺失时回退到 skill 正源目录——保证旧版正源下契约卡的探针命令也不落空。
  const pluginRoot = fileURLToPath(new URL("../..", import.meta.url))
  const probeScript = existsSync(join(pluginRoot, "scripts", "mm_probe.py"))
    ? join(pluginRoot, "scripts", "mm_probe.py")
    : join(skillSourceDir, "scripts", "mm_probe.py")

  // 贯穿给 lib.js 纯函数的配置面（checker pin 的正源解析 + 守卫的档位判定）
  const gateCfg = { skillSourceDir, steerBudget, gateMode, probeScript }
  const blockMode = () => gateMode !== "warn"

  // 会话级状态（瞬态；持久状态在项目 .vibeweaver/state.json 由 stallObservation 管理）
  const injectedAgents = new Set()
  const steered = new Map() // key: `${sessionId}:${turn}` -> count
  const disabledSessions = new Set()
  // turn-stopping positive-incomplete state (mainline 2026-10-18 port)
  const lastUserAt = new Map()
  const lastWriteAt = new Map()
  const lastErrorAt = new Map()
  const lastUserText = new Map()
  const lastTurn = new Map()
  const sessionStart = new Map()

  // M5: 会话结束/销毁时清扫状态
  ctx.on("agent/disposed", (payload) => {
    const sessionId = payload.agent?.session?.id
    if (!sessionId) return
    injectedAgents.delete(sessionId)
    disabledSessions.delete(sessionId)
    for (const key of steered.keys()) {
      if (key.startsWith(sessionId + ":")) steered.delete(key)
    }
    lastUserAt.delete(sessionId)
    lastWriteAt.delete(sessionId)
    lastErrorAt.delete(sessionId)
    lastUserText.delete(sessionId)
    lastTurn.delete(sessionId)
    sessionStart.delete(sessionId)
  })

  // Host error/abort fence: never auto-resume a turn the user just cancelled
  // or a turn that ended on an error. A later successful write clears it.
  ctx.on("agent/error", (payload) => {
    const sessionId = payload?.agent?.session?.id
    if (sessionId) lastErrorAt.set(sessionId, Date.now())
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
    text: () => covenantCard({ skillSourceDir, steerBudget, probeScript }),
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
    const userTexts = (payload.messages || [])
      .filter((m) => m.source?.kind === "user")
      .map((m) => (m.content || []).map((c) => c.text || "").join("\n"))
      .join("\n")
    if (sessionId) {
      const now = Date.now()
      if (!sessionStart.has(sessionId)) sessionStart.set(sessionId, now)
      const turn = Number.isFinite(payload.turn) ? payload.turn : 0
      if (payload.step === 0 || lastTurn.get(sessionId) !== turn) {
        lastUserAt.set(sessionId, now)
        lastUserText.set(sessionId, userTexts)
      }
      lastTurn.set(sessionId, turn)
    }
    if (!sessionId || injectedAgents.has(sessionId)) return decision
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

  // ── 4a. pre-execute 守卫（主线 W1 移植：风险路径 pre-write 拦 + 破坏性命令守卫
  // + DOC 类降级守卫）。dsh 的 deny 在工具执行前生效，是本插件唯一的执行前拦截面。
  const deniedCalls = new Set() // 自己 deny 的 callId → post-execute 不再重复处理
  ctx.on("tools/pre-execute", async (exec, next) => {
    if (!gateEnabled()) return next()
    if (process.env.VIBEWEAVER_GATE === "off") return next()
    const sessionId = exec.agent?.session?.id
    if (sessionId && disabledSessions.has(sessionId)) return next()
    const cwd = exec.agent?.session?.header?.cwd
    const d = preExecuteDecision({ toolName: exec.name, args: exec.arguments, cwd, cfg: gateCfg })
    if (d.deny && blockMode()) {
      if (exec.callId) { if (deniedCalls.size > 2000) deniedCalls.clear(); deniedCalls.add(exec.callId) }
      return { kind: "deny", reason: d.deny }
    }
    return next()
  })

  // ── 4b. post-execute 门禁（write/edit + warn 档的守卫提示）──
  const postExecute = async (exec, result, next) => {
    if (exec.callId && deniedCalls.delete(exec.callId)) return next()
    if (!gateEnabled()) return next()
    if (!GATED_TOOLS.has(exec.name) && !(gateMode === "warn" && (exec.name === "bash" || exec.name === "shell"))) return next()
    if (process.env.VIBEWEAVER_GATE === "off") return next()
    const sessionId = exec.agent?.session?.id
    if (sessionId && disabledSessions.has(sessionId)) return next()
    const filePath = writePathFromArgs(exec.arguments) // W18: file_path/path/filePath 全拼写
    const root = findProjectRoot([filePath, agentCwd(exec)])
    if (!root) return next()
    if (sessionId && result?.isError !== true) lastWriteAt.set(sessionId, Date.now())
    invalidateGateCache(root) // 写操作已落盘 → 缓存失效, 本次检查重跑
    // cue 投递提升于门之上（主线 wave16）：门红时恰是「动手前先读」必须在场
    // 的时刻——block 反馈与 accept 提示两路都携带。
    const cues = cueNotes(root, filePath)
    const gate = checkGate(root, gateCfg)
    const base = () => ({ kind: "accept", content: result.content })
    // warn 档：证据门禁与守卫一律不阻断，降级为写后可见提示（block 档才 deny/block）
    const guardWarn = gateMode === "warn"
      ? preExecuteDecision({ toolName: exec.name, args: exec.arguments, cwd: sessionId ? agentCwd(exec) : undefined, cfg: gateCfg }).warn
      : []
    if (gate && gate.blocking.length) {
      if (!blockMode()) {
        return {
          kind: "accept",
          content: [...(result.content || []), { type: "text", text: "[GATE-WARNING (vibeweaver, gateMode=warn)] 证据门禁未过（不阻断）: " + gate.blocking.join("; ") }],
        }
      }
      const msg = blockMessage(root, gate)
      const text = cues.length ? msg + "\n" + cues.join("\n") : msg
      return { kind: "block", feedback: [{ type: "text", text }] }
    }
    const warns = [...cues, ...guardWarn.map((m) => "[GATE-WARNING (vibeweaver-guard, gateMode=warn)] " + m)]
    if (gate && gate.warnings.length) {
      warns.push("[GATE-WARNING (vibeweaver)] non-blocking: " + gate.warnings.join("; ") + " — fix before the final [Verification Gate] line.")
    }
    const stall = stallObservation(root, filePath || "(unknown file)")
    if (stall) warns.push("[GATE-WARNING (vibeweaver-stall)] " + stall)
    if (warns.length) {
      return {
        kind: "accept",
        content: [...(result.content || []), { type: "text", text: warns.join("\n") }],
      }
    }
    return base()
  }
  ctx.on("tools/post-execute", postExecute)

  const agentCwd = (exec) => exec?.agent?.session?.header?.cwd

  // ── 5. turn-stopping 守卫 ──
  ctx.on("agent/turn-stopping", (payload) => {
    if (!gateEnabled()) return
    if (process.env.VIBEWEAVER_GATE === "off") return
    if (payload.signal?.aborted) return
    const agent = payload.agent
    const sessionId = agent?.session?.id
    if (sessionId && disabledSessions.has(sessionId)) return
    const agentCwd = agent?.session?.header?.cwd
    const root = findProjectRoot(agentCwd)
    if (!root) return

    const testFile = (name) => join(root, "tests", name)
    const started = sessionStart.get(sessionId) || 0
    const mtimeAt = (p) => { try { return statSync(p).mtimeMs } catch { return 0 } }
    const paused = mtimeAt(testFile("paused_state.md")) >= started && started > 0
    const classE = mtimeAt(testFile("decisions.md")) >= started && started > 0
      && /Class-E/i.test(readFileSync(testFile("decisions.md"), "utf8"))
    const log = existsSync(testFile("verification_log.md")) ? readFileSync(testFile("verification_log.md"), "utf8") : ""
    const active = existsSync(testFile("acceptance.md")) && !hasFinalRun(log)
    const wroteAfterUser = lastWriteAt.has(sessionId)
      && (!lastUserAt.has(sessionId) || lastWriteAt.get(sessionId) > lastUserAt.get(sessionId))
    const errorFence = lastErrorAt.has(sessionId)
      && (!lastWriteAt.has(sessionId) || lastErrorAt.get(sessionId) >= lastWriteAt.get(sessionId))
    const userStop = isStopDirective(lastUserText.get(sessionId))
    const positiveIncomplete = !!active && wroteAfterUser && !errorFence && !paused && !classE && !userStop

    const gate = checkGate(root, gateCfg)
    const red = !!(gate && gate.blocking.length)
    if (!red && !positiveIncomplete) return
    const text = red ? STEER_TEXT : INCOMPLETE_STEER_TEXT
    const key = `${sessionId}:${payload.turn}`
    const count = steered.get(key) || 0
    if (count < steerBudget) {
      steered.set(key, count + 1)
      agent.steer({ content: [{ type: "text", text }], source: { kind: "plugin", plugin: "dsh-vibeweaver" } })
    } else {
      ctx.logger.warn(`vibeweaver: gate RED/incomplete but steer budget exhausted for ${key}, turn closing`)
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
      const gate = checkGate(root, gateCfg)
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
      const gate = checkGate(root, gateCfg)
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
