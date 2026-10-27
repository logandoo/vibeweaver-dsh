# FIXES — dsh 0.2.x 兼容性修复 + 上下文管理移植（可接手清单）

日期：2026-10-26 · 来源：`docs/AUDIT_20261026_dsh_api_context.md`（两条 BLOCKER 已自行复现）
用法：每个任务块自包含（文件 / 接缝 / 步骤 / 验证命令 / 回滚），零上下文执行者可直接接手。
**开工前置**：`Mode: AUTO`、`Lane` 按块标注、每块自带 COV-9 基线；本仓 `verification_log.md` 只追加（见 §F 纪律）。

> **状态（2026-10-27 晚）**：波次 A（A1-A6）+ 波次 B（B1-B5）**均已完成**；本机运行时已升级到 0.2.1-rc.4 并跑过真会话 E2E（注入→落盘→重载 + 两个负对照）。
> **状态（2026-10-27）**：波次 A（A1-A6）**已完成**，区间 `4107240..f8432fc`，判据与证据见
> `tests/acceptance.md`「波次 A」块 / `tests/coverage_matrix_wave_a.md`。三处按原文执行会出事，
> 已改为安全写法并各记 ADR：**A2 的 `inject` 加名**（会让插件在 0.1.x 上静默不加载，D-11）、
> **A4 把 `lsp` 归命令面**（实测是只读导航，D-12）、**A4 把 `cd` 并进 `writePathFromArgs`**
> （会让门禁 block 掉切目录，D-13）。波次 B/C 未动。API 事实见 `memory/reference_dsh_plugin_apis.md`。


## Consistency Hub（改前先对齐这些字面值）

| 实体 | 正源 | 现值 |
| --- | --- | --- |
| 插件消息源 kind | `src/index.js` 三处 `source.kind` | 现 `plugin` → 改 `dsh-vibeweaver` |
| 有效工作目录 | V3 `ctx.workingDirectory.ensure(agent)`；rc.6 `session.header.cwd` | 解析顺序 `ensure → header.cwd` 回退 |
| 命令面工具名 | dsh 各 `dsh-tool-*/lib/index.js` 的 `name:` | `bash` `pwsh`（+V3 `run_code` `terminal_*` `schedule_*` `working_directory` `lsp` `create_worktree`） |
| 只读面工具名 | 同上，逐名列出，**禁前缀通配** | `read` `read_image` `present` `glob` `grep` `web_fetch` `web_search` `todo_write` `skill` `ask_user_question` |
| 契约卡预算 | `covenantCard()` 12 组合（4 路径 × block/warn/off） | 现 max 7971B / 上限 8000B（**余量 29B**） |
| 版本真源 | 0.1.0-rc.6 = `_npx/6c7f445d1bf61956`；0.1.5-rc.3（本机）= `_npx/1e7f6d9597241db0/…/dsh/node_modules/…`；最新 = 注册表 `0.2.1-rc.3` | 每次开工先 `npm view @deepseek-ai/dsh versions` |

---

## 波次 A — 0.2.1-rc.3 兼容性（A1/A2/A3 为必修；A4-A6 建议同波）

### A1 · 消息源 kind 去 `plugin`（BLOCKER-1，**现在就该改，与升不升级无关**）· Lane M

- **证据**：V3 `dsh-llm/lib/types/message.d.ts:101-108` 无 `plugin`（rc.6/rc.3 `:98-101` 有）；写侧 `dsh-session/lib/index.js:1205` 放行，读侧 `dsh-session-persistence-jsonl/lib/worker.cjs:11641` 抛 `SessionFormatError`（调用点 :12863 rethrow、:12842 `finish()` 无 try）→ 注入过消息的会话再也读不回来。
- **改**：`src/index.js:188`、`:298`、`:380` → `source: { kind: "dsh-vibeweaver" }`（去掉 `plugin` 字段）。
- **接缝**：`tests/unit/index.test.js` 现有 fake 断言消息形状处；新增一条：三处注入的 `source.kind` 恒为 `dsh-vibeweaver` 且**全文件不再出现** `kind: "plugin"`。
- **步骤**：① 先加钉（RED：现网三处为 plugin）② 改三处 ③ `node --test tests/unit/*.test.js` ④ `grep -c 'kind: "plugin"' src/index.js` == 0。
- **回滚**：单提交 revert；旧版对未知 kind 按 user 源处理，故在 rc.6/rc.3 上同样安全。

### A2 · 有效工作目录改走 `workingDirectory`（BLOCKER-2）· Lane M

- **证据**：V3 `dsh-tool-fs/lib/index.js:172` 用 `await ctx.workingDirectory.ensure(exec.agent, exec.signal)`（rc.6 同行 `:242` 是 `header.cwd`）；`working_directory{cd}` 在 dsh-base 默认挂载 → 会话 cd 后 `findProjectRoot` 找不到日志，**门禁静默消失**。
- **改**：`src/index.js:27` 的 `inject` 增加 `"workingDirectory"`；新增 `resolveCwd(exec)`：`ctx.workingDirectory?.ensure?.(agent) ?? agent?.session?.header?.cwd`；替换 `:201 :261 :271 :334 :359` 五处取值。
- **接缝**：`tests/unit/index.test.js` / `w19_guards.test.js` 的 fake ctx 需能注入一个 `workingDirectory` 桩（两种形态都测：有服务 / 无服务）。
- **步骤**：① RED：构造"header.cwd 在 A、workingDirectory 报 B、B 下才有 tests/verification_log.md"的夹具，断言门禁应命中 B（当前命中 A → 判非项目 → 失败）② 实现 ③ 全绿 ④ 真仓 `node tests/w19_poc.mjs` 不回归。
- **风险**：`ensure()` 是异步且有副作用（可能触发目录确认）；用 `get()` 优先、`ensure()` 兜底，并加 try/catch 回退 header.cwd。

### A3 · 版本兼容闸 + 冒烟断言 · Lane S

- **改**：`package.json` 加 `"engines": { "dsh": ">=0.1.0-rc.6" }`（或 `@deepseek-ai/dsh*` peerDependencies）；`script/linux/smoke.sh:10` 的版本钉与之一致；冒烟新增一步：**注入后重启加载该会话**（这条断言本来就能抓到 A1 的问题）。
- **证据**：V3 `dsh-app-boot` 按 `engines.dsh`/peer 做兼容闸；插件两者皆无 → 静默通过，故障推迟到持久层；V3 还把 bundle 装载失败收进 `skippedBundles`（不再抛），"插件没生效"更难发现。
- **验证**：`npm pack --dry-run` 件数与 `files` 一致；`bash script/linux/smoke.sh` 全绿。

### A4 · 守卫覆盖面补 V3 工具（IMPORTANT-3）· Lane M

- **改**：`src/lib.js` 的 `COMMAND_TOOL_RE` 显式补 `run_code|working_directory|create_worktree|lsp|schedule_create|schedule_update|terminal_open|terminal_send|terminal_signal`；`preExecuteDecision` 增加参数形态分支：`code`（run_code）/ `cd`（working_directory）/ `text`（terminal_send）→ 走 `destructiveBlock` / `riskCommandBlock` / `riskPathBlock`；`writePathFromArgs` 增补 `cd` 作为路径键。
- **纪律**：**禁止** `^terminal_` / `^mcp__` 前缀通配（本波刚以同样理由拆掉 `session_*`/`agent_*`，理由不变：通配=给未来工具发免检牌）。`mcp__<server>__<tool>` 只能按"未知名字归写面"处理，并在报告里承认其参数名不可枚举。
- **验证**：`tests/w19_poc.mjs` 增例——`run_code{code:"shutil.rmtree('src')"}` → DENY；`working_directory{cd:"../../.."} ` → 至少提示；`terminal_send{text:"git reset --hard"}` → DENY。

### A5 · compaction 失败不投重建卡（MINOR）· Lane S

- **改**：`src/index.js:375` 加 `if (event.data?.error) return`（`error?: string` 自 rc.6 起就在载荷里，`dsh-compaction/lib/types/types.d.ts:76`）；若目标版本 ≥0.2，另接 `compaction/summary-error` waterfall。

### A6 · 契约段显式 `interpolate: false`（MINOR）· Lane S

- **改**：`ctx.systemPrompt.section({ name, order, text, interpolate: false })`。V3 默认 true（`dsh-system-prompt/lib/types/index.d.ts:58-62`）；现卡 7870B 实测 `{{`/`}}` 各 0 个，属**隐性不变量**，显式化后才结构安全，并顺带解除 §F 里"卡面路径长度顶预算"的耦合。旧版忽略未知字段，安全。

---

## 波次 B — 上下文管理移植（当前命中数 0，独立于波次 A）

| # | 任务 | 主线对照（`vibeweaver-gate.js`） | dsh 落点 | 验证接缝 |
| --- | --- | --- | --- | --- |
| B1 | 压缩后投**工作笔记原文**（≤4KB，`capBounded` 截断），替代三行静态 `RECOVER_TEXT` | `compactStateBundle` L1274-1307 | `src/index.js:373-381` + `src/lib.js` 新增纯函数 | 单测：夹具含 working_note → 投出内容含账本首行；无笔记 → 回退现文案 |
| B2 | 笔记被删仍可投**快照**（蒸馏删除是正常动作，现在反而无内容可投） | `snapshotWorkingNote`/`snapshotTextOf` L1245-1269 | `src/lib.js` 会话内快照 Map（写入时留存） | 单测：投出后 `rm working_note` → 仍能投出快照 |
| B3 | `firstTouchCue`（每根/每会话首次写入投一行重入指针）+ 投递遥测 | L1571-1587 / `recordMemoryDelivery` L1322-1344 | `src/index.js` post-execute + `src/lib.js` | 单测：第二次写入不再投 |
| B4 | **子代理会话排除**（主线 `isChildSession`：绝不向 subagent 注入激活卡） | L1200-1205 | `src/index.js:161` pre-step 前判定 | 单测：payload 标记为子会话 → 不投激活卡 |
| B5 | 卡面补 `§V9 收官顺序` + `§V12 合法停止`（各约 120B，**须先腾字节**） | `VERIFICATION_UPGRADES.md` §V9/§V12 | `src/lib.js` `covenantCard` | 现有 12 组合字节帽 pin 必须仍 <8000 |
| B6 | （≥0.2.x）门禁状态快照改 `systemPrompt.context({required:true})` + `refreshContext`；deny 走 `deny.info` 结构化 | — | `src/index.js` | 需 A1-A3 先落地 |

**明确不可移植**：主线 `experimental.session.compacting`（把笔记塞进压缩提示）在 dsh 三个版本都无对应钩子（V3 仅 `compaction/summary-error` waterfall + `compaction/prune` 事件）→ 只能用"压缩后 inject 原文"近似，别把它列成待办。

---

## 波次 C — 上一波显式未移植项（低优先，动前先做产品决策）

- 宽松旗标前置条件（`--existing` 需 `- profile:`）+ `tests/gate_result.json` 落盘 —— 会翻转全部 fixture 与消费者严格度（ADR D-5）。
- 内容指纹缓存替换 1s TTL（主线 `depFingerprint` + lossy-key 语义）。
- cue 投递加固：realpath 归一、50ms 匹配预算 + 可见跳过、`cue-stats.json` 遥测、`safeGlob` 收紧到 ≤64 字符/≤2 个 `*`。
- audit Tier-0/1/2 插件（主线 2669 行 + `vibeweaver-audit-core.js`，独立工程）。
- 开工第一件事：`python3 scripts/evidence_seal.py`（消掉长期 WARN，并激活 C3b 测试基线哈希校验；ADR D-10 的 revisit 条件）。

---

## F. 施工纪律（本波三次踩坑，写死在这里）

1. `tests/verification_log.md` **只能尾部追加**；块内声明（`- class:` / `- profile:` / `- wave-base:`）与块头同次写完。
2. 追加**不要** `s.rstrip("\n")`——文件末尾那个空行属于已封缄基线，吃掉它就会触发 `baseline prefix changed`；正确写法 `s + "- 新行\n"`。
3. `- wave-base: <sha>` 必须**行尾即 sha**（正则 `^- wave-base:\s*([0-9a-f]{7,40})\s*$`），且必须是 HEAD 的**严格祖先**（等于 HEAD 被拒），解释另起一行。
4. 门禁按命令文本扫描，测试夹具/日志里出现破坏性字面量会被拦；需要时"写文件再执行文件"，**不要**加批准行（加了就是真授权）。
5. 改守卫前跑 `node tests/w19_poc.mjs`（15 例绕过/误拦）；改判据类文件前跑 `bash tests/w19_verify.sh`。

## 建议排期

A1 + A5 + A6（三处小改、零风险、向后兼容）→ A3（版本闸）→ A2（工作目录）→ A4（守卫面）→ B1-B4（上下文管理）→ B5（卡面，含腾字节）→ B6 / 波次 C。
