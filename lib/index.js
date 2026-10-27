// vibeweaver-dsh 插件主入口 — dsh >=0.1.0-rc.6 (Cordis)，实测覆盖 0.1.0-rc.6 / 0.1.5-rc.3 / 0.2.1-rc.3
// 组件: skill provider / 契约段 / pre-step 激活 / post-execute 门禁 /
//       turn-stopping 守卫 / vibeweaver_gate 工具 / /vibe 命令 / compaction 重建
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import {
  writePathFromArgs,
  checkGate,
  preExecuteDecision,
  isGuardedTool,
  isCommandTool,
  surfacesGuardWarn,
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
  compactStateBundle,
  recordMemoryDelivery,
  resumeCueNote,
  snapshotWorkingNote,
  isChildSession,
  capBoundedCollection,
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
  "4. 遵守 COV-0..13（NO TEST NO DONE / SCRIPT-ONLY / 验证循环 / cap=5 stall=3× 边界 / Class 比例化路径）；",
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
  "3. 按 COV-0..13 继续（证据 + 循环边界 + Class 比例化路径 + 完成行格式）。",
].join("\n")

// 注入消息的自有源 kind（A1 / BLOCKER-1）。
// 0.2.x 的 MessageSourceMap 不再提供 catch-all `plugin` kind（dsh-llm/lib/types/message.d.ts:101-108），写侧 dsh-session 只要求 kind 非空，而读侧 v4 admission 对
// kind === "plugin" 抛 SessionFormatError（dsh-session-persistence-jsonl/lib/worker.cjs:11641，
// 经 :12863 rethrow、:12842 finish() 无 try）——注入过消息的会话再也读不回来。
// 声明自有 kind 是 merge-extensible 的正路；旧读侧对未知 kind 放行，向后兼容。
export const messageSource = () => ({ kind: "dsh-vibeweaver" })

// 注入消息的**完整身份**（评审 R2 Critical-1：只改 kind 仍然读不回来）。
// dsh-agent-loop 把 pre-step 的 decision.messages 原样 `session.append("user/message", message)`
// （dsh-agent-loop/lib/index.js:1069-1073），steer/inject 走的也是同一个 send()（:801-815，
// 不补身份）；而读侧 assertMessageEventShape 要求 `id` 非空字符串且 `role === "user"`
// （dsh-session/lib/index.js，adoptSessionEvent 调用）。官方消费者一律经 createUserMessage
// 构造（dsh-tool-skill:917、dsh-plan-mode:216、dsh-user-approval:102），其实现就是
// `{...input, role:"user", id: brandString(randomUUID())}`（dsh-llm/lib/index.js:40）。
// 这里同构自建：不 import dsh-llm，避免依赖它在 npx 嵌套布局里的解析路径。
export const injectedUserMessage = (text) => ({
  id: randomUUID(),
  role: "user",
  content: [{ type: "text", text }],
  source: messageSource(),
})

export function apply(ctx, config = {}) {
  const skillSourceDir = config.skillSourceDir || process.env.VIBEWEAVER_SKILL_DIR || join(homedir(), ".config/opencode/skills/vibeweaver")
  const steerBudget = config.steerBudget ?? 3
  const gateMode = config.gateMode || "block"
  const preStepActivation = config.preStepActivation !== false
  const recoverAfterCompaction = config.recoverAfterCompaction !== false

  // 视觉探针优先用插件自带的 mm_probe.py（与 vibeweaver 主线字节一致），缺失时回退
  // skill 正源目录——旧版正源下契约卡的探针命令也不落空。
  // 正源副本优先（可随主线更新）；正源没有探针时才用插件自带的那份兜底。
  // 反直觉之处：捆绑路径几乎总是更长（npx 缓存目录），卡面插值 ${probe} 一旦变长就
  // 顶破 8000B 契约卡预算，所以"捆绑优先"从来不是可选项——历史 "../.." 指向包父目录
  // 是 off-by-one（评审 I5），修好的是兜底路径本身，而不是它的优先级。
  const pluginRoot = fileURLToPath(new URL("..", import.meta.url))
  const bundledProbe = join(pluginRoot, "scripts", "mm_probe.py")
  const skillProbe = join(skillSourceDir, "scripts", "mm_probe.py")
  const probeScript = existsSync(skillProbe) ? skillProbe : bundledProbe

  // 贯穿给 lib.js 纯函数的配置面（checker pin 的正源解析 + 守卫的档位判定）
  const gateCfg = { skillSourceDir, steerBudget, gateMode, probeScript }
  const blockMode = () => gateMode !== "warn"

  // 有效工作目录（A2 / BLOCKER-2）：0.2.x 起会话可以 cd（working_directory{cd}），
  // 不可变的 session.header.cwd 保留原项目，dsh 工具面改读 ctx.workingDirectory
  // （dsh-tool-fs/lib/index.js:172）。门禁必须跟工具面同源，否则会话 cd 之后
  // findProjectRoot 找不到日志 → 门禁静默消失。三层兜底，缺一即降级不缺失：
  //  1) 服务在场 → get(session)：同步读 projection（init 即 header.cwd），无 I/O 无副作用；
  //     不用 ensure(agent)——它异步、做 fs stat、目录消失时 append 事件 + 投 user 通知、
  //     可抛（dsh-working-directory/lib/index.js:78-101）。门禁只要词法根。
  //  2) 可选依赖读法（ctx.reflect.get）：把服务名写进 inject 会让缺少该服务的 0.1.x
  //     整个 fiber epoch=INACTIVE → _unload()（cordis/lib/index.js:1317-1345），
  //     插件在旧版上静默不加载——比门禁降级严重得多。
  //  3) 服务缺失或抛错 → header.cwd（rc.6/rc.3 旧语义原样保留）。注意服务在场时
  //     get() 恒返回字符串（projection ?? defaultDirectory），所以第 3 层只在
  //     "没有服务"或"服务抛错"时到达，不是每次都到的兜底链。
  // 可选依赖订阅（评审 R2 Critical-2 纠正）：`ctx.inject([name], cb)` 是 cordis 的官方
  // 形态（dsh-agent 对可选的 "typert" 就这么用，dsh-agent/lib/index.js:333）——服务缺席
  // 时嵌套 fiber 永不激活，回调不执行，父 fiber 不受影响。
  // 反例：本波曾用 `ctx.reflect.get(name)`，从**插件作用域**读恒为 undefined——provide
  // 把实现存在提供方的 isolate 键下，_getImpl 用读取方的 isolate 映射去查
  // （cordis/lib/index.js:767 + 800-816），实测三个服务全 undefined。写出来像兜底，
  // 实际让 A2 变成空转。
  let workingDirectoryService = null
  let wdResolved = false
  if (process.env.VIBEWEAVER_DEBUG) ctx.logger.info("vibeweaver: apply() 开始")
  try {
    ctx.inject?.(["workingDirectory"], function vibeweaverWorkingDirectory(depCtx) {
      workingDirectoryService = depCtx?.workingDirectory ?? null
      wdResolved = !!workingDirectoryService
      // 可选依赖是否真的解析到，只有运行时知道（评审 R2：源码读出来的"应该能行"错过一次）。
      if (process.env.VIBEWEAVER_DEBUG) {
        ctx.logger.info(`vibeweaver: workingDirectory ${wdResolved ? "resolved" : "absent"} (optional dependency)`)
      }
    })
  } catch {
    workingDirectoryService = null
  }

  const effectiveCwd = (agent) => {
    const session = agent?.session
    try {
      const dir = workingDirectoryService?.get?.(session)
      if (typeof dir === "string" && dir) return dir
    } catch {
      // 宿主子系统故障不能让门禁消失，也不能让写钩子抛栈
    }
    return session?.header?.cwd
  }
  const agentCwd = (exec) => effectiveCwd(exec?.agent)
  // 根锚候选：有效目录在前（cd 后归属新目录），原项目目录始终留在候选里。
  // 只认有效目录时，一次 working_directory/create_worktree 就能把门禁整体关掉
  // （评审 I-1）——不可变的 header.cwd 是这条退路的地板。
  const rootHints = (agent) => [effectiveCwd(agent), agent?.session?.header?.cwd]

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
    // A6: 0.2.x 起 interpolate 默认 true（dsh-system-prompt/lib/types/index.d.ts:58-62）。
    // 卡面今天恰好没有 `{{`/`}}`，但那是隐性不变量；显式关闭后宿主插值永不改写契约文本。
    interpolate: false,
    text: () => covenantCard(gateCfg), // gateMode 必须在场：warn 档卡面要说实话（评审 N4/I1）
  })

  // ── 3. pre-step 激活 ──
  // 与 dsh-tool-skill 同模式（官方 consumer）：在 waterfall 里改 decision.messages
  // 立即生效；agent.inject() 是 void（fire-and-forget，仅排队下一批）—— 用于 compaction 重建
  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next()
    if (!preStepActivation) return decision
    if (decision?.kind !== "enter") return decision
    // B4：子代理会话永不注入激活卡（主线 isChildSession；dsh 的标记是 header.origin）
    if (isChildSession(payload.agent)) return decision
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
        injectedUserMessage(ACTIVATION_TEXT),
      ],
    }
  })

  // ── 4a. pre-execute 守卫（主线 W1 移植：风险路径 pre-write 拦 + 破坏性命令守卫
  // + DOC 类降级守卫）。dsh 的 deny 在工具执行前生效，是本插件唯一的执行前拦截面。
  const deniedCalls = new Set() // 自己 deny 的 callId → post-execute 不再重复处理
  // pre-execute 的**提示级**结论按 callId 暂存，由 post-execute 原样投递。
  // 不在后置重算：cd 之后同一个相对路径参数的含义已经变了，重算会凭空造出警告（评审 R1）。
  const pendingNotes = new Map()
  // B3：每 (root, session) 首次写入只投一次重入指针（主线 firstTouchCue）
  const firstTouch = new Set()
  ctx.on("tools/pre-execute", async (exec, next) => {
    if (!gateEnabled()) return next()
    if (process.env.VIBEWEAVER_GATE === "off") return next()
    const sessionId = exec.agent?.session?.id
    if (sessionId && disabledSessions.has(sessionId)) return next()
    const cwd = agentCwd(exec)
    const d = preExecuteDecision({
      toolName: exec.name, args: exec.arguments, cwd,
      fallbackCwd: exec.agent?.session?.header?.cwd, cfg: gateCfg,
    })
    if (d.deny && blockMode()) {
      if (exec.callId) { if (deniedCalls.size > 2000) deniedCalls.clear(); deniedCalls.add(exec.callId) }
      return { kind: "deny", reason: d.deny }
    }
    if (exec.callId && d.warn.length) {
      if (pendingNotes.size > 2000) pendingNotes.clear()
      pendingNotes.set(exec.callId, d.warn)
    }
    return next()
  })

  // ── 4b. post-execute 门禁（write/edit + warn 档的守卫提示）──
  const postExecute = async (exec, result, next) => {
    if (exec.callId && deniedCalls.delete(exec.callId)) return next()
    if (!gateEnabled()) return next()
    // 后置面与前置守卫同源：只读工具不进；命令面只在 warn 档需要回传提示（评审 I2）
    if (!isGuardedTool(exec.name)) return next()
    if (process.env.VIBEWEAVER_GATE === "off") return next()
    const sessionId = exec.agent?.session?.id
    if (sessionId && disabledSessions.has(sessionId)) return next()
    // pre-execute 的提示以**动作前**的语义算好；后置只搬运，不带着新目录重算。
    const stashed = exec.callId ? pendingNotes.get(exec.callId) : null
    if (exec.callId) pendingNotes.delete(exec.callId)
    // 命令面只进前置：动作此时**已经执行完**，后置再判红只会把工具自己的输出换成门禁块
    // （评审 R1）。它仍要作废门禁缓存（run_code/terminal_send 会改文件），并投递
    // pre-execute 暂存的提示——换目录类工具只有后置这一个出口。
    // 放在 disabledSessions 之后：`/vibe off` 的会话必须彻底安静（评审 R1 复评）。
    if (isCommandTool(exec.name) && gateMode !== "warn") {
      const cmdRoot = findProjectRoot(rootHints(exec.agent))
      if (cmdRoot) invalidateGateCache(cmdRoot)
      if (!stashed || !stashed.length) return next()
      return { kind: "accept", content: [...(result.content || []), { type: "text", text: stashed.join("\n") }] }
    }
    const filePath = writePathFromArgs(exec.arguments) // W18: file_path/path/filePath 全拼写
    const root = findProjectRoot([filePath, ...rootHints(exec.agent)])
    if (!root) return next()
    if (sessionId && filePath && result?.isError !== true) lastWriteAt.set(sessionId, Date.now())
    invalidateGateCache(root) // 写操作已落盘 → 缓存失效, 本次检查重跑
    // cue 投递提升于门之上（主线 wave16）：门红时恰是「动手前先读」必须在场
    // 的时刻——block 反馈与 accept 提示两路都携带。
    const cues = cueNotes(root, filePath)
    // B2：写工作笔记时留快照（笔记随后被蒸馏删除属正常动作，压缩边界还要投它）
    if (/(^|\/)working_note\.md$/.test(filePath || "")) snapshotWorkingNote(root)
    const memoryWarns = []
    const gate = checkGate(root, gateCfg)
    const base = () => ({ kind: "accept", content: result.content })
    // warn 档：证据门禁与守卫一律不阻断，降级为写后可见提示（block 档才 deny/block）
    const guardWarn = gateMode === "warn" || surfacesGuardWarn(exec.name)
      ? (stashed || preExecuteDecision({
          toolName: exec.name, args: exec.arguments,
          cwd: sessionId ? agentCwd(exec) : undefined,
          fallbackCwd: exec.agent?.session?.header?.cwd,
          cfg: gateCfg,
        }).warn)
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
    // B3：每根/每会话首次写入投一行重入指针（第二次不再投），并记遥测。
    // 放在 gate 阻断之后：被拦下的那次不消费标记，否则提示会被"消费掉但没投出"（自查缺陷）。
    const touchKey = `${root}:${sessionId || "(session)"}`
    if (!firstTouch.has(touchKey)) {
      const cue = resumeCueNote(root)
      if (cue) {
        snapshotWorkingNote(root) // 删除窗口之前先留快照
        firstTouch.add(touchKey)
        capBoundedCollection(firstTouch)
        recordMemoryDelivery(root, "sessionCue")
        memoryWarns.push(cue)
      }
    }
    const warns = [...cues, ...memoryWarns, ...guardWarn.map((m) => "[GATE-WARNING (vibeweaver-guard, gateMode=warn)] " + m)]
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

  // ── 5. turn-stopping 守卫 ──
  ctx.on("agent/turn-stopping", (payload) => {
    if (!gateEnabled()) return
    if (process.env.VIBEWEAVER_GATE === "off") return
    if (payload.signal?.aborted) return
    const agent = payload.agent
    const sessionId = agent?.session?.id
    if (sessionId && disabledSessions.has(sessionId)) return
    const root = findProjectRoot(rootHints(agent))
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
      agent.steer(injectedUserMessage(text))
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
      const cwd = args?.cwd || effectiveCwd(exec.agent)
      const root = findProjectRoot([cwd, ...rootHints(exec.agent)])
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
      const root = findProjectRoot(rootHints(invocation.agent))
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

  if (process.env.VIBEWEAVER_DEBUG) ctx.logger.info(`vibeweaver: apply() 结束，workingDirectory 已解析=${wdResolved}`)

  // ── 8. compaction 重建注入 ──
  ctx.on("session/event", (session, event) => {
    if (!recoverAfterCompaction) return
    if (event?.type !== "compaction/end") return
    // A5: 失败的压缩同样以 end 收尾，载荷带 error?: string（dsh-compaction/lib/types/
    // types.d.ts:73-79，自 rc.6 起在场）。上下文没被压掉时投"已压缩"重建卡是假信号。
    if (event?.data?.error) return
    const sessionId = session?.id
    if (!sessionId) return
    const agent = ctx.agents.get(sessionId)
    if (!agent) return
    // B1/B2：压缩边界投**工作笔记原文**（≤4KB）；笔记已删则投快照；都没有才回退静态文案
    const root = findProjectRoot(rootHints(agent))
    if (!root) {
      agent.inject(injectedUserMessage(RECOVER_TEXT))
      return
    }
    agent.inject(injectedUserMessage(compactStateBundle(root)))
    recordMemoryDelivery(root, "compactBundle")
  })
}
