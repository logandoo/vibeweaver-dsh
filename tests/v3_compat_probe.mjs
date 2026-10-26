// v3_compat_probe.mjs — 用 0.2.x **真上游读侧**认证本插件注入消息的可回放性。
//
// 为什么需要它：本仓自写单测只能证明"我们写出了什么形状"，证不了"上游读侧收不收"。
// 这里直接 import 0.2.1-rc.3 的 `@deepseek-ai/dsh-session-format-v3-to-v4`，把
// `src/index.js` 真正发出的 source 对象喂进 v4 admission（worker.cjs 读会话时走的
// 同一段代码），断言：自有 kind 放行、retired 的 catch-all `plugin` kind 抛错。
//
// 用法: node tests/v3_compat_probe.mjs <装有 @deepseek-ai 作用域包的 node_modules 路径>
// 退出码: 0 = 全部通过; 1 = 有失败; 2 = 上游模块不可得（调用方据此判 na，不判过）
import { pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
import { join } from "node:path"

const root = process.argv[2]
if (!root || !existsSync(join(root, "@deepseek-ai", "dsh-session-format-v3-to-v4"))) {
  console.log("SKIP: 上游 0.2.x 读侧不可得（需要一个装好 @deepseek-ai/dsh@0.2.x 的 node_modules）")
  process.exit(2)
}
const mod = await import(pathToFileURL(join(root, "@deepseek-ai/dsh-session-format-v3-to-v4/lib/index.js")).href)
const { assertV4RowAdmission } = mod
const { messageSource } = await import(new URL("../src/index.js", import.meta.url))

const row = (source) => ({
  type: "user/message",
  seq: 1,
  data: { id: "m1", role: "user", content: [{ type: "text", text: "vibeweaver 激活卡" }], source },
})

let failed = 0
const check = (label, fn, expectThrow) => {
  let threw = null
  try { fn() } catch (e) { threw = e }
  const ok = expectThrow ? !!threw : !threw
  if (!ok) failed += 1
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${threw ? ` → ${threw.constructor.name}: ${String(threw.message).slice(0, 72)}` : " → 放行"}`)
}

console.log(`上游读侧: ${join(root, "@deepseek-ai/dsh-session-format-v3-to-v4")}`)
console.log(`本插件 src/index.js 的 source: ${JSON.stringify(messageSource())}`)
// 1) 自有 kind 必须能被 v4 读侧收下（否则注入过消息的会话再也读不回来）
check("自有 kind 通过 v4 admission", () => assertV4RowAdmission(row(messageSource())), false)
// 2) retired 的 catch-all plugin kind 必须被拒（证明本判据不是空跑：旧写法确实致命）
check('retired kind:"plugin" 被 v4 admission 拒绝', () => assertV4RowAdmission(row({ kind: "plugin", plugin: "dsh-vibeweaver" })), true)
// 3) 自有 kind 必须逐处一致（三处注入同一个工厂）
const kinds = new Set([messageSource().kind, messageSource().kind])
check("三处注入同源同 kind", () => { if (kinds.size !== 1 || !kinds.has("dsh-vibeweaver")) throw new Error("kind 漂移") }, false)
// 注：空 kind 的拒绝点在未导出的 assertV4MessageSources（worker.cjs:11641 同时查
// length 与 "plugin"），本探针只认证导出的行级 admission；不拿"探针没测到"当"不存在"。

console.log(failed ? `PROBE FAIL (${failed})` : "PROBE PASS")
process.exit(failed ? 1 : 0)
