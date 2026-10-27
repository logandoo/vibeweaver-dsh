// v3_compat_probe.mjs — 用 0.2.x **真上游代码**认证本插件注入的消息可回放。
//
// 为什么需要它：本仓自写单测只能证明"我们写出了什么形状"，证不了"上游读侧收不收"。
// 评审 R2 的教训更狠：上一版探针**自己伪造了消息信封**（id:"m1", role:"user"）并只跑
// kind 维度的 assertV4RowAdmission，于是"PROBE PASS"与"真实注入的会话根本读不回来"
// 同时成立。这一版改为：喂 `src/index.js` 真正发出的那个对象，并且跑**两条**上游路径
//   · adoptSessionEvent —— 会话加载期的消息形状闸（id/role），BLOCKER-1 的真实死因之一
//   · assertV4RowAdmission —— v4 源种类闸（拒绝 retired 的 catch-all plugin kind）
// 每条正向检查都配一条负对照（旧写法必须抛），否则探针等于空跑。
//
// 用法: node tests/v3_compat_probe.mjs <装有 @deepseek-ai 作用域包的 node_modules 路径>
// 退出码: 0 = 全部通过; 1 = 有失败; 2 = 上游模块不可得（调用方据此判 na，不判过）
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const root = process.argv[2]
const FMT = join(root || "", "@deepseek-ai", "dsh-session-format-v3-to-v4")
const SES = join(root || "", "@deepseek-ai", "dsh-session")
if (!root || !existsSync(FMT) || !existsSync(SES)) {
  console.log("SKIP: 上游 0.2.x 读侧不可得（需要一个装好 @deepseek-ai/dsh@0.2.x 的 node_modules）")
  process.exit(2)
}
const { assertV4RowAdmission } = await import(pathToFileURL(join(FMT, "lib/index.js")).href)
const { adoptSessionEvent } = await import(pathToFileURL(join(SES, "lib/index.js")).href)
const { injectedUserMessage, messageSource } = await import(new URL("../src/index.js", import.meta.url))

const real = injectedUserMessage("【vibeweaver 激活】…")
const row = (source, extra = {}) => ({
  type: "user/message",
  seq: 10,
  data: { ...(extra.id ? { id: extra.id, role: "user" } : {}), content: [{ type: "text", text: "x" }], source },
})

let failed = 0
const check = (label, fn, expectThrow) => {
  let threw = null
  try { fn() } catch (e) { threw = e }
  const ok = expectThrow ? !!threw : !threw
  if (!ok) failed += 1
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${threw ? ` → ${threw.constructor.name}: ${String(threw.message).slice(0, 76)}` : " → 放行"}`)
}

console.log(`上游读侧: ${FMT}`)
console.log(`本插件实际发出的消息: ${JSON.stringify({ ...real, content: [{ type: "text", text: "…" }] })}`)

// ── 加载期消息形状闸（adoptSessionEvent）────────────────────────────────────
const evt = (data) => ({ type: "user/message", seq: 10, surfaceOp: "append", data })
check("实际发出的消息通过 adoptSessionEvent（id + role + source）", () => adoptSessionEvent(evt(structuredClone(real))), false)
const oldShape = { content: [{ type: "text", text: "x" }], source: { kind: "dsh-vibeweaver" } }
check("负对照：缺 id/role 的旧注入形状被 adoptSessionEvent 拒绝", () => adoptSessionEvent(evt(oldShape)), true)
check("负对照的定位校验：旧形状先抛在身份上而不是 surface 标记上", () => {
  const e = evt(structuredClone(oldShape))
  try { adoptSessionEvent(e) } catch (err) { if (!/identified message/.test(String(err.message))) throw new Error(`抛点不对: ${err.message}`) }
}, false)

// ── v4 源种类闸（assertV4RowAdmission）──────────────────────────────────────
check("实际 source 的 kind 通过 v4 admission", () => assertV4RowAdmission(row(messageSource(), { id: real.id })), false)
check("负对照：retired kind:\"plugin\" 被 v4 admission 拒绝", () => assertV4RowAdmission(row({ kind: "plugin", plugin: "dsh-vibeweaver" }, { id: "m1" })), true)

// ── 源码级：三处注入必须同源于信封工厂 ──────────────────────────────────────
const entrySrc = readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
const sites = (entrySrc.match(/injectedUserMessage\(/g) || []).length
const inline = (entrySrc.match(/\bsource:\s*\{/g) || []).length
const retired = (entrySrc.match(/kind:\s*"plugin"/g) || []).length
check(`注入点全部走 injectedUserMessage 信封工厂（实测 ${sites} 处，内联 source ${inline}，retired ${retired}）`,
  () => { if (sites < 3 || inline !== 0 || retired !== 0) throw new Error(`sites=${sites} inline=${inline} retired=${retired}`) }, false)

console.log(failed ? `PROBE FAIL (${failed})` : "PROBE PASS")
process.exit(failed ? 1 : 0)
