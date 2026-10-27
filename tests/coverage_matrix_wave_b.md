# Coverage matrix — 波次 A 收尾（真机 E2E + 遗留项）与波次 B | 2026-10-27

判据正源：`tests/acceptance.md`「波次 A 收尾…与波次 B」块（13 条）。

| # | Criterion | Check (test / command) | Evidence file | Status |
| --- | --- | --- | --- | --- |
| 1 | 本机 dsh = 0.2.1-rc.4；四个 profile 均 compose，vibe-arm-b 含本插件 | 农场重指向脚本（356 条改指向 + 261 条补齐）+ 逐 profile `--dump-config` | tests/dsh-profiles-check.log · tests/dsh-farm-repoint-manifest.log | covered |
| 2 | 真实会话注入 1 条消息，带 id/role/自有 kind | 真 dsh 0.2.1-rc.4 跑编码任务 → 解压会话 → 断言（`tests/e2e_session_check.mjs`） | tests/dsh-e2e.log · tests/dsh-smoke-real.log | covered |
| 3 | `--session-id` 重载无 corrupt，失败只允许在鉴权层 | 真二进制重载 + 分类（无 corruption 词且有 AUTH 行 → 装载成功） | tests/dsh-smoke-real.log (3/5) | covered |
| 4 | 真机负对照两条 | 改写会话副本：旧 kind → `producer-owned source kind`；去 id/role → `lacks an identified message` | tests/dsh-e2e.log | covered |
| 5 | 冒烟 (3) 两条断言 PASS；无凭据如实 SKIP | `DSH_SMOKE_FAKE_KEY=1` 显式开关 + `DSH_BIN_OVERRIDE` | tests/dsh-smoke-real.log | covered（无凭据路径同样是 SKIP，未洗成 PASS） |
| 6 | engines 上限 + 真机 skip + 冒烟下限解析 | 临时 `<0.2.0` → `skipping profile bundle … incompatible with dsh 0.2.1-rc.4`；恢复后加载；`${FLOOR%% *}` | tests/dsh-b-engines-ceiling.log · tests/dsh-profiles-check.log | covered |
| 7 | 四类守卫盲区收口且各有 RED 钉 | 新钉在改动前源码（b4e3073）上 4/4 失败，改动后全绿 | tests/dsh-b-unit-1.log · red_carryover 运行记录（见 verification_log iter 5） | covered |
| 8 | B1 压缩投笔记原文（≤4KB），无笔记回退指令 | 单测 3 条（含 9000B 截断）+ 钩子层 1 条 | tests/unit/context.test.js · tests/unit/index.test.js | covered |
| 9 | B2 笔记被删仍投快照 | 单测（写→快照→删源→bundle 仍含正文）+ 钩子层（compaction 两次投递） | 同上 | covered |
| 10 | B3 首次写入投指针、第二次不投、遥测可查 | 钩子层钉（两次写入 + 读 `.vibeweaver/state.json`）+ 遥测累加钉（不覆盖 ops） | tests/unit/index.test.js · tests/unit/context.test.js | covered |
| 11 | B4 子代理会话不投激活卡 | 单测（origin=subagent 不投；parentSession-only 仍投；无 header 不投）+ 钩子层 | 同上 | covered |
| 12 | B5 卡面补 §V9/§V12 且 12 组合 <8000B | 词面钉 + 四配置 × 三档实测 7789-7940B | tests/unit/context.test.js · tests/unit/w19_guards.test.js | covered |
| 13 | 全套绿 | unit 165/165 · poc 26 例 · 两探针（rc.4）· build 0 且 lib==src · `assert --existing --final` | tests/dsh-b-*.log · tests/dsh-final-*.log | 收官跑（见 verification_log） |

## 诚实口径

- 判据 #2/#3 的"注入"发生在模型调用**之前**，所以用占位 key 即可验证持久化；**没有**真实模型回合参与，因此"模型读到注入内容后行为是否改变"不在本波证据内（属 A/B 评测范围）。
- `web` profile 只验证了 compose（未跑真实 web 会话）；live2d/maid 依赖未动。
- 农场重指向保留了 238 条"新运行时里不存在"的旧链接（如 `dsh-code-runtime`、`dsh-client-web`），它们仍指向旧缓存；这些包已不在 0.2.1-rc.4 的依赖图里，四个 profile 实测 compose 正常。
