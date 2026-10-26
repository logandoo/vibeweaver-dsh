// real_cordis_probe.mjs — 在**真 cordis 容器**里跑真插件，认证可选依赖的语义与时序。
//
// 为什么需要它（评审 R2 Critical-2 + FCV M7）：本仓单测的 ctx 是手搓的桩。桩一旦比
// 真系统宽松（同步回调 / 直接返回服务），150/150 也能与"运行时恒 undefined"共存——
// `ctx.reflect.get` 那版 A2 就是这么空转过去的。这里用真 `Context`、真 `ctx.inject`
// 纤维调度，跑 `src/index.js` 本体：
//   1) 服务在场 → 门禁必须按**服务目录**归属项目（而不是 header.cwd）
//   2) 服务缺席 → 插件照常加载生效，回退 header.cwd（0.1.x 形状）
//   3) 服务抛错 → 回退，且不得把异常抛进写钩子
//   4) cordis 语义本身：依赖缺席时回调**永不触发**，提供后**异步**触发
//      → 这条同时钉住"回调在 apply() 之后才来"，任何"apply 时快照服务"的改法都会让
//        检查 1 变红（FCV M7 的守卫）
//
// 用法: node tests/real_cordis_probe.mjs <装有 @deepseek-ai/cordis 的 node_modules 路径>
// 退出码: 0 = 全过; 1 = 有失败; 2 = 上游不可得（调用方判 na，不判过）
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

const ROOT_MODS = process.argv[2]
const CORDIS = join(ROOT_MODS || "", "@deepseek-ai", "cordis", "lib", "index.js")
if (!ROOT_MODS || !existsSync(CORDIS)) {
  console.log("SKIP: 真 cordis 不可得（传一个装好 @deepseek-ai/dsh@0.2.x 的 node_modules 路径）")
  process.exit(2)
}
const { Context } = await import(pathToFileURL(CORDIS).href)
const PLUGIN = new URL("../src/index.js", import.meta.url).href

function projectDir(active) {
  const root = mkdtempSync(join(tmpdir(), "vwrc-"))
  if (active) {
    mkdirSync(join(root, "tests"), { recursive: true })
    writeFileSync(join(root, "tests", "verification_log.md"), "")
    writeFileSync(join(root, "tests", "acceptance.md"), "")
  }
  return root
}

const tick = () => new Promise((r) => setTimeout(r, 50))

async function scenario({ withWd, wdThrows = false }) {
  const dirProject = projectDir(true)   // 服务报的目录：活跃 vibeweaver 项目（证据红）
  const dirOther = projectDir(false)    // header.cwd：非项目
  const root = new Context()
  const reg = { tools: {}, sections: [], commands: [] }
  const WD = {
    get(session) {
      if (!session || typeof session !== "object" || !("header" in session)) throw new Error("get 需要 Session")
      if (wdThrows) throw new Error("projection unavailable")
      return dirProject
    },
  }
  function host(ctx) {
    ctx.provide("tools", { register: (t) => { reg.tools[t.name] = t } })
    ctx.provide("systemPrompt", { section: (s) => { reg.sections.push(s) }, context: () => {} })
    ctx.provide("skills", { registerProvider: () => () => {} })
    ctx.provide("commands", { register: (c) => { reg.commands.push(c) } })
    ctx.provide("agents", { get: () => undefined })
    ctx.provide("logger", { info() {}, warn() {}, error() {} })
    if (withWd) ctx.provide("workingDirectory", WD)
  }
  await root.plugin(host)
  const mod = await import(PLUGIN + "?" + Math.random())
  await root.plugin(mod)
  await tick()

  const agent = { id: "s1", session: { id: "s1", header: { cwd: dirOther } }, inject() {}, steer() {} }
  const alive = !!reg.tools["vibeweaver_gate"] && reg.sections.length > 0
  const gate = await reg.tools["vibeweaver_gate"].execute({}, { agent })
  return { alive, gate, dirProject, dirOther }
}

let failed = 0
const check = (label, ok, detail) => {
  if (!ok) failed += 1
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
}

// 1) 服务在场：门禁必须跟着服务走（header.cwd 是非项目，若代码退回 header 就会 pass:true）
const a = await scenario({ withWd: true })
check("服务在场 → 插件在真 cordis 里加载并注册", a.alive)
check("服务在场 → 门禁按服务目录归属项目（不是 header.cwd）", a.gate.pass === false, `gate.pass=${a.gate.pass}`)

// 2) 服务缺席（0.1.x 形状）：插件必须活着且按 header.cwd 判定
const b = await scenario({ withWd: false })
check("服务缺席 → 插件照常加载（可选依赖不拖垮父 fiber）", b.alive)
check("服务缺席 → 回退 header.cwd（非项目 → 门禁不生效）", b.gate.pass === true, `gate.pass=${b.gate.pass}`)

// 3) 服务抛错：回退且不炸
const c = await scenario({ withWd: true, wdThrows: true })
check("服务抛错 → 回退 header.cwd 且不抛进钩子", c.gate.pass === true, `gate.pass=${c.gate.pass}`)

// 4) cordis 语义 + 时序：缺席不触发、提供后异步触发（这条钉住"回调晚于 apply()"）
const root2 = new Context()
let firedCount = 0
function subscriber(ctx) {
  ctx.inject(["laterService"], () => { firedCount += 1 })
}
await root2.plugin(subscriber)
await tick()
check("依赖缺席时回调不触发（可选依赖不是立即求值）", firedCount === 0, `fired=${firedCount}`)
function later(c) { c.provide("laterService", { x: 1 }) }
await root2.plugin(later)
await tick()
check("依赖提供后回调触发（且只触发一次）", firedCount === 1, `fired=${firedCount}`)

// 5) 时序守卫（FCV M7）：回调相对 apply() 的先后决定"能不能在 apply 时快照服务"
const root3 = new Context()
let order = []
function probeTiming(ctx) {
  ctx.inject(["late2"], () => order.push("cb"))
  order.push("apply-end")
}
root3.plugin(probeTiming)
await tick()
function late2(c) { c.provide("late2", {}) }
await root3.plugin(late2)
await tick()
check("回调晚于 apply() 返回 → 服务读取必须是惰性闭包读，apply 时快照会空转",
  order[0] === "apply-end" && order[1] === "cb", `顺序=${JSON.stringify(order)}`)

console.log(failed ? `PROBE FAIL (${failed})` : "PROBE PASS")
process.exit(failed ? 1 : 0)
