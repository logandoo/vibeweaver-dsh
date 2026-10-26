# AUDIT — dsh 最新版本 API 兼容性 & 上下文管理移植状态

日期：2026-10-26 · 类型：C4 只读审计（零源码改动）· 对象：`vibeweaver-dsh` 插件 vs `@deepseek-ai/dsh` 三版本
证据基线：本机三份已解包的类型定义/运行时源码 + `npm view` 注册表元数据；两条 BLOCKER 由本会话**自行复现**（不采信未复现的子代理结论）。

## 0. 版本事实

| 角色 | 版本 | 来源 |
| --- | --- | --- |
| 插件钉住 | **0.1.0-rc.6** | `script/linux/smoke.sh:10`、`package.json` 描述、`memory/project_dsh_env.md` |
| 本机实跑 | **0.1.5-rc.3** | `~/.npm/_npx/1e7f6d9597241db0/.../dsh/package.json` |
| 注册表最新 | **0.2.1-rc.3** | `npm view @deepseek-ai/dsh versions` |

> 记忆纠错：`memory/MEMORY.md` 记「类型真源 = `_npx/1e7f6d9597241db0`（0.1.0-rc.6 钉死）」——该缓存实测是 **0.1.5-rc.3**。本波 w19.0 的 API 实读实际对着 rc.3 完成（结论不受影响，但记录必须改，否则下一次对账会拿错真源）。

**结论速览**：`0.1.0-rc.6 → 0.1.5-rc.3` **无破坏**（本波新增的 `tools/pre-execute` 在 rc.6 里也已存在，不是新版本才有的面）。`→ 0.2.1-rc.3` 有 **2 条 BLOCKER + 1 条 IMPORTANT 覆盖面缺口 + 3 条 MINOR**，其中 BLOCKER-1 属于「写的时候不报错、下次打开会话才炸」的最坏失效形态。

## 1. BLOCKER-1 — `source.kind: "plugin"` 被 v4 会话格式判为废弃语法（致命）

**现状**：插件三处持久消息写入使用 `source: { kind: "plugin", plugin: "dsh-vibeweaver" }`
- `src/index.js:188`（pre-step 激活卡）
- `src/index.js:298`（turn-stopping 守卫 steer）
- `src/index.js:380`（compaction 重建卡 inject）

**证据链**（0.2.1-rc.3）：
1. 类型层：`dsh-llm/lib/types/message.d.ts:101-108` 的 `MessageSourceMap` 只剩 `user | model | tool | system-prompt`；同文件 :95-97 注释写明「each producer declares its own `kind` … **there is no shared catch-all `plugin` kind**」。rc.6 / rc.3 的同一文件 :98-101 仍有 `plugin: { kind: 'plugin'; plugin: string }`。
2. 写侧：**不拦**。`dsh-session/lib/index.js:1205` 只要求 `source.kind` 是非空字符串 → 消息成功入会话、模型照常读到。
3. 读侧：**致命**。`dsh-session-persistence-jsonl/lib/worker.cjs:11641`
   ```js
   if (... || value["kind"] === "plugin") throw new SessionFormatError("format v4 message requires a producer-owned source kind");
   ```
   区域注释 :11634「Native source admission preserves unknown attribution and **refuses retired plugin wrappers**」。调用点两处且都不在可降级路径上：`assertV4RowAdmission`（:12863，catch 后 :12866 **rethrow**）与 `finish()`（:12842，**无 try**）。

**影响**：插件注入的三条消息会让**会话日志再也读不回来**（resume / replay / fork / 会话列表加载全炸），而失败发生在持久层，症状是「这个会话打不开」，与插件毫无表面关联。V3 还把 bundle 装载失败收进 `skippedBundles`（`dsh-app-boot`），进一步降低可诊断性。

**为什么现在没炸**：本机 0.1.5-rc.3 用 v3 格式；且 V2 的 `session-format-v2-to-v3` codec 反过来**要求** system 消息用 `kind:'plugin'`（:263）。也就是说插件是被旧版反向钉在一个新版已禁的写法上。

**修复**（向后兼容，一行 × 3）：改为 producer-owned kind —— `source: { kind: "dsh-vibeweaver" }`。V3 官方示例即 `kind: 'my-plugin'`；V1/V2 对未知 kind 按普通 user 源处理。V3 另有迁移映射表把 `"@deepseek-ai/dsh-system-prompt" → "runtime-context"` 等收编（`worker.cjs:11631` 附近的 `Object.freeze({...})`），说明「自带名字」正是预期写法。

## 2. BLOCKER-2 — `session.header.cwd` 不再是有效工作目录（静默 fail-open）

**现状**：5 处把 header.cwd 当「会话当前目录」用：`src/index.js:201, 261, 271, 334, 359` → 喂给 `findProjectRoot()` 与相对路径解析。

**证据**：
- rc.6：`dsh-tool-fs/lib/index.js:242` `const cwd = exec.agent?.session.header.cwd`（:226 注释同义）
- 0.2.1-rc.3：同一位置 `const cwd = exec.agent === void 0 ? void 0 : await ctx.workingDirectory.ensure(exec.agent, exec.signal)`，并在 :1192 声明依赖 `"workingDirectory"`
- 契约：`wdcore/lib/types/index.d.ts:27`「immutable Session header retains the **original** project」，有效目录改由 `get`/`ensure`/`set`（:64/:70/:80）承载
- 可达性：`working_directory` 工具（参数 `cd`）**在 base bundle 默认挂载**（`dsh-base/cordis.patch.yml`，实测 `name: "working_directory"` / 参数 `cd`）

**影响**：会话只要 `cd` 过一次（worktree / 多包仓库工作流的常规动作），`findProjectRoot` 沿旧目录上溯就找不到 `tests/verification_log.md` 或 `.vibeweaver/project.json` → 插件判定「非 vibeweaver-active」→ **门禁整体消失且不报错**。失效点恰好在模型开始往新目录写代码的时刻。

**修复**：`inject` 增加 `"workingDirectory"`；解析顺序 `await ctx.workingDirectory.ensure(agent)` → 服务不存在时回退 `agent.session.header.cwd`（保住 rc.6 兼容）；把解析后的目录贯穿 `preExecuteDecision` / `findProjectRoot` / `vibeweaver_gate` / `/vibe`。

## 3. IMPORTANT-3 — 新版工具的参数形态落在守卫覆盖面之外

| 工具 | 参数 | 现状 | 后果 |
| --- | --- | --- | --- |
| `working_directory`（默认挂载） | `cd` | 既不在 `COMMAND_TOOL_RE` 也不在 `READONLY_TOOL_RE` → 归写面，但 `writePathFromArgs` 只认 `file_path|path|filePath` → `abs=null && command=""` → `src/lib.js` 提前 return allow | **移动会话目录的工具对门禁完全不可见**（与 BLOCKER-2 叠加成静默失效） |
| `run_code`（PTC；`RUN_CODE_NAME` 见 `dsh-tools/lib/index.js:955`，开关 `DSH_TOOLS_MODE`，`dsh-headless/cordis.patch.yml:17`） | `code`/`description` | 不识别 | 代码执行工具绕过六条破坏性规则与风险路径；且 PTC 嵌套子派发**会**走 `tools/pre-execute`（`dsh-tools/lib/index.js:1431 → :3321`）→ 钩子被调用并返回 allow = **假阴性**（比不调用更糟） |
| `terminal_*` / `schedule_*` / `lsp` / `create_worktree` / `mcp__<server>__<tool>` | 各异 | 未分类（`mcp__*` 恰好带 `file_path` 时才侥幸被拦） | 同上，按宿主装了什么而定 |

**修复**：`COMMAND_TOOL_RE` 扩到显式列出 `run_code|working_directory|create_worktree|lsp|schedule_create|schedule_update|terminal_open|terminal_send|terminal_signal`；`preExecuteDecision` 增加 `code`/`cd`/`text` 参数形态分支。**注意**：不要用 `^terminal_` / `^mcp__` 这类前缀通配图省事——本波刚以同样理由拆掉 `session_*`/`agent_*` 通配（见 `memory/project_mainline_w19_port_20261026.md` 硬教训 1）；前缀通配等于给未来工具发免检牌。

## 4. MINOR

| # | 项 | 证据 | 建议 |
| --- | --- | --- | --- |
| 4.1 | compaction **失败**也投「上下文已压缩，重读契约」重建卡 | `compaction/end` 载荷自 rc.6 起就有 `error?: string`（`dsh-compaction/lib/types/types.d.ts:76`），`src/index.js:375` 只判事件名 | 加 `if (event.data?.error) return`；V3 另有 `compaction/summary-error` waterfall（`lib/types/index.d.ts:83-85`）可正确区分 |
| 4.2 | 契约段的安全性靠巧合 | V3 `interpolate` 默认 true（`dsh-system-prompt/lib/types/index.d.ts:58-62`）；实测卡面 7870B 含 `{{`/`}}` 各 0 个 → 目前安全，但无结构性保证 | `ctx.systemPrompt.section({ ..., interpolate: false })`；顺带把卡从 `${probe}` 路径长度陷阱里解放出来（见 w19 波 ADR D-8） |
| 4.3 | 版本不匹配不在启动期暴露 | V3 `dsh-app-boot` 按 `engines.dsh` / `@deepseek-ai/dsh*` peerDependencies 做兼容闸；插件 `package.json` 两者皆无（实测） | 加 `engines.dsh`（或 peer），让不兼容在 boot 期报清楚，而不是推迟到持久层炸；同时把 `smoke.sh` 的版本钉与之一致 |
| 4.4 | 版本真源记忆过期 | 见 §0 | 改 `memory/MEMORY.md` + `project_dsh_env.md`；把「每次对齐前先 `npm view` + 实测缓存版本」写进流程 |

## 5. 上下文管理：移植状态 = **基本未移植**

### 5.1 机制层（主线 gate.js → dsh）

实测命中数（`grep -c` 于 `src/index.js` + `src/lib.js`，主线侧为 `vibeweaver-gate.js`）：

| 主线机制 | 作用 | 主线 | dsh | 影响 |
| --- | --- | --- | --- | --- |
| `compactStateBundle` | 压缩边界投递工作笔记原文（≤4KB，`capBounded` 截断） | 3 | **0** | 压缩后 §A7.15 假设账本只能靠模型自觉去读，不保证在场 |
| `snapshotWorkingNote` / `snapshotTextOf` | 笔记文件被删仍能投出快照 | 3 | **0** | 「蒸馏后删除」的正常动作反而让重建时无内容可投 |
| `firstTouchCue` | 每根/每会话首次写入投一行重入提示 | 3 | **0** | 新会话第一笔写入拿不到「先读日志」指针 |
| `resumeCueNote` | 压缩恢复时的续读指针 | 2 | **0** | 同上 |
| `recordMemoryDelivery` | 投递遥测（`capBounded` 配套） | 4 | **0** | 无法回答「提示到底送到没有」 |
| `injectBootstrap` / `bootstrapText` / `BOOTSTRAP_VERSION` / `isChildSession` / `bootstrapped` | 1KB 指针注入 + `model_class` 选档 + **绝不注入子会话** + 压缩后重装 | 21 | **0** | dsh 以「常驻契约卡」替代指针（设计选择，见 §5.3），但**「不注入子代理」这一条没有对应实现**——dsh 的 pre-step 激活卡对 subagent 会话同样会投 |

dsh 现有的是：`RECOVER_TEXT` 三行静态重建卡（`src/index.js:48-53`）+ cue 投递（`cueNotes`，已移植）+ stall observer + turn-stopping stop-guard。

### 5.2 契约文本层（卡面）

实测：`§3.3 重入`、`§A7.15 working_note`、`cap=5 stall=3×`、`docs-drift`、`awaiting decision` **在卡里**；`§V9 预算/收官顺序`、`§V10 动作分诊`、`§V12 合法停止`、`FCV 新鲜复验` **不在卡里**。

后四条不是遗漏而是取舍：它们约束的是「预算紧张时如何降级仪式」「计划动作先分诊 C/E/N」「什么才算合法停止」「自写测试需新鲜上下文复验」——dsh 消费者同样会犯这些错，属于**该补而未补**，但每条都要在 8000B 卡预算里付字节（当前 12 组合最大 7971B，余量 29B）。

### 5.3 不算未移植的部分

- **bootstrap 指针**：主线用它是因为 opencode 会话默认不加载 skill 全文；dsh 走 `systemPrompt.section` 常驻卡 + skill provider 按需加载，指针机制被架构替代（`memory/feedback_injection_vs_plugin.md`）。真正缺的只是其中的 `isChildSession` 排除。
- **压缩提示改写**：主线靠 `experimental.session.compacting` 把笔记塞进压缩提示；dsh **三个版本都没有**对应钩子（V3 新增的 `compaction/summary-error` 是 waterfall 错误处理，`start/summary/end/prune` 均为事件），这条属**不可移植**，只能用「压缩后 inject 笔记原文」近似。

### 5.4 建议的下一波（上下文管理移植，按性价比排序）

1. `compaction/end` → 投 `tests/working_note.md` 原文（≤4KB 截断 + 文件已删时用会话内快照），替代现在的三行静态卡；顺带修 §4.1 的 error 判断。
2. `firstTouchCue`（每根/每会话一次）+ 投递遥测。
3. 子代理会话排除（对应主线 `isChildSession`）。
4. 卡面补 §V9 收官顺序 + §V12 合法停止（各约 120B，需先腾字节）；§V10/FCV 视消费者实际错误再定。
5. 若确定要跑 0.2.x：改用 `systemPrompt.context({required:true})` + `refreshContext` 承载门禁状态快照（比一次性 inject 更耐压缩），`interpolate:false`，`deny.info` 结构化反馈。

## 6. 修复顺序（若决定跟进）

1. BLOCKER-1（3 行，零风险，向后兼容）——**任何版本都该先改**，因为它在 rc.6 上同样合法。
2. BLOCKER-2（服务探测 + 回退，中等）——不升级也会因 `str_replace_editor` 等场景误判，但只有 0.2.x 的 `working_directory` 才让它真正常态触发。
3. `package.json` `engines.dsh` + `smoke.sh` 版本钉上调 + 冒烟加一条「注入后能重新加载会话」断言（这条断言本来就能抓到 BLOCKER-1）。
4. IMPORTANT-3 守卫覆盖面（含 §3 的反通配纪律）。
5. MINOR 4.1 / 4.2。
6. 上下文管理波（§5.4），独立于兼容性修复。

## 7. 审计边界

- 未执行真实 dsh 会话（0.2.1-rc.3 未安装到本机；`script/linux/smoke.sh` 仍钉 rc.6）。BLOCKER-1/2 的判定基于类型定义 + 运行时校验代码路径的直接阅读，均为可复现的静态证据；动态复现需要 `npm i @deepseek-ai/dsh@0.2.1-rc.3` 后跑一次「注入 → 重启会话加载」。
- 未审 `dsh-web-frontend` / 官方插件清单遥测（`plugin-package-inventory-deepseek`）对隐私面的影响。
- 本审计不改代码；所有修复以建议形式给出。
