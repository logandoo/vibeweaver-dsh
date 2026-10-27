// e2e_session_check.mjs — 用真 dsh 落盘的会话文件，验证"插件注入的消息能被读回"。
//
// 背景（判据 #7）：冒烟里"注入后重启加载会话"这一步长期只能 SKIP（无模型凭据）。
// 但注入发生在模型调用**之前**——用占位 key 跑一次编码任务，会话照样会落盘，且带着
// 插件注入的那条消息。于是无需真实模型额度也能端到端验证：
//   1) 注入真的发生了（会话里存在 source.kind === "dsh-vibeweaver" 的 user/message）
//   2) 那条消息带 id + role（否则真读取器会报 lacks an identified message）
//   3) 会话能被 `--session-id` 重载（由调用方跑 dsh 并检查输出）
//
// 用法: node tests/e2e_session_check.mjs <sessionRoot> <slug>
//   退出码 0 = 找到合规注入消息；1 = 缺注入或缺身份；2 = 没有会话（无凭据/未落盘）
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { zstdDecompressSync } from "node:zlib"

const [root, slug, sinceArg] = process.argv.slice(2)
const since = Number(sinceArg || 0)
if (!root || !slug) {
  console.log("usage: node tests/e2e_session_check.mjs <sessionRoot> <slug> [sinceEpochSeconds]")
  process.exit(2)
}
const dir = join(root, slug)
if (!existsSync(dir)) {
  console.log("SKIP: 没有会话目录（本机未落盘）")
  process.exit(2)
}
// 只看 since 之后落盘的会话（跑本轮之前的历史会话与本轮无关），新的优先
const sessions = readdirSync(dir)
  .filter((n) => n.startsWith("session-"))
  .map((n) => ({ n, p: join(dir, n) }))
  .filter(({ p }) => existsSync(join(p, "session.v4.jsonl.zstd")))
  .map((x) => ({ ...x, mtime: statSync(join(x.p, "session.v4.jsonl.zstd")).mtimeMs / 1000 }))
  .filter((x) => !since || x.mtime >= since)
  .sort((a, b) => b.mtime - a.mtime)
if (!sessions.length) {
  console.log("SKIP: 没有任何 v4 会话文件")
  process.exit(2)
}

const rowsOf = (p) => {
  const raw = zstdDecompressSync(readFileSync(p)).toString("utf8")
  return raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

// 只看**本轮最新**的那个会话：扫遍全部会让"旧会话合规"掩盖"本轮会话不合规"（FCV 实证的假 PASS）
const newest = sessions[0]
const rows = rowsOf(join(newest.p, "session.v4.jsonl.zstd"))
const mine = rows.filter((r) => r.type === "user/message" && r.data?.source?.kind === "dsh-vibeweaver")
if (!mine.length) {
  console.log(`FAIL: 本轮最新会话 ${newest.n} 里没有 source.kind === "dsh-vibeweaver" 的注入消息（共 ${rows.length} 行）`)
  process.exit(1)
}
const found = { session: newest.n, rows, mine }
const bad = found.mine.filter((r) => typeof r.data?.id !== "string" || !r.data.id || r.data.role !== "user")
if (bad.length) {
  console.log(`FAIL: ${found.session} 有 ${found.mine.length} 条注入，其中 ${bad.length} 条缺 id/role（读侧会报 lacks an identified message）`)
  process.exit(1)
}
console.log(`OK: ${found.session} 含 ${found.mine.length} 条注入，全部带 id + role:"user" + source.kind:"dsh-vibeweaver"（共 ${found.rows.length} 行）`)
console.log(`SESSION=${found.session}`)
process.exit(0)
