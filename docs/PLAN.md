# vibeweaver-dsh 实施计划（C3）

**Goal:** 把 vibeweaver 技能封装为 dsh rc.6 插件 bundle（渐进披露 + 机械门禁），经 A/B bench 证明效果 ≥ 强制注入。
**Architecture:** Cordis 插件（bundle patch 挂载）；纯函数核心（src/lib.js）与事件接线（src/index.js）分离，核心单测可覆盖；bench 用双 headless profile。
**Tech Stack:** Node ESM（零运行时依赖）+ dsh 0.1.0-rc.6（npx 缓存真源）+ node:test + bash + python3（assert/评分）。

## Global Constraints
- 事件/类型签名一律以 npx 缓存 `node_modules/@deepseek-ai/*/lib/types/*.d.ts` 钉死为准（0.1.0-rc.6）
- 工具参数：write/edit 均用 `file_path`；结果 block 用 `{kind:'block', feedback:[ContentBlock]}`，accept 追加用 `{kind:'accept', content:[...]}`（content 字段，非 value）
- 构建/生命周期一律走 `script/linux/*.sh`（COV-2）；本机无 raw npm build
- 插件零 npm 运行时依赖（只 peer 引用 cordis 类型注释）；bench 需 pnpm（已有）

## Consistency Hub
| Entity | Canonical value/type | Source of truth |
|---|---|---|
| `file_path` | string（write/edit args 键） | dsh-tool-fs lib/index.js:608,750 |
| `{kind:'block',feedback}` / `{kind:'accept',content}` | PostToolDecision | dsh-tools types/index.d.ts:431-445 |
| `pre-step` decision | PreStepDecision = `{kind:'enter',messages}` / reject | dsh-agent runtime-types.d.ts:235-241 |
| `agent.inject/steer(msg)` | UserMessage{content:ContentBlock[],source:{kind:'user'}} | dsh-agent runtime-types.d.ts:109-132 |
| `skillSourceDir` 默认值 | `~/.config/opencode/skills/vibeweaver` | config.toml |
| `STEER_TEXT`/`ACTIVATION_TEXT`/`GATE_BLOCKED_MSG` 前缀 | 固定文案常量 | src/lib.js |
| skill provider name | `vibeweaver-filesystem` | BACKEND_DESIGN §3 |
| 契约段 name/order | `vibeweaver-covenant` / 100 | BACKEND_DESIGN §3 |

## Task 1: src/lib.js 纯函数核心（TDD，§A4.8）
**Files:** Create `src/lib.js` · Test `tests/unit/lib.test.js`
**Interfaces:**
- Consumes: 无（纯函数）
- Produces: `findProjectRoot(start: string|null): string|null` · `runAssert(root): {ok, attempts}` · `classifyMessages(lines): {blocking, warnings}` · `blockMessage(root, result): string` · `stallObservation(root, file): string|null` · `countPasses(root): number` · `isCodingIntent(text): boolean` · `covenantCard(cfg): string` · `inlineCheck(root): string[]`
- [x] Step 1-5: 每行为一个 RED→GREEN 循环（见 tests/verification_log.md）

## Task 2: src/index.js 插件接线
**Files:** Create `src/index.js` · Test `tests/unit/index.test.js`（fake ctx：on/emit/inject/steer/register/section 桩）
**Interfaces:**
- Consumes: Task 1 全部导出（signatures 见上）
- Produces: `name="vibeweaver"`、`inject=[tools,systemPrompt,skills,commands,agents]`、`apply(ctx, config)`
- [x] provider 注册、契约段、pre-step 注入、post-execute 门禁、turn-stopping、vibeweaver_gate、/vibe、compaction/end

## Task 3: src/baseline.js（Arm-A 基线插件）
**Files:** Create `src/baseline.js` · Test `tests/unit/baseline.test.js`
**Interfaces:** Consumes: 无 · Produces: `name="vibeweaver-baseline"`, `apply` 注册静态全文 section（读 skillSourceDir/SKILL.md）
- [x] 验证契约段含 SKILL.md 全文（长度 > 30KB 即 pass）

## Task 4: 脚本 + 构建 + 冒烟
**Files:** Create `script/linux/{project_build.sh,start.sh,stop.sh,restart.sh,bench.sh}` · `package.json` · `cordis.patch.yml` · `config.toml` · Test `tests/unit/build.test.sh`（或 lib 完整性检查）
**Interfaces:** Consumes: Task 2/3 · Produces: lib/{index,baseline}.js
- [x] build → node --check + cp；start → 冒烟 headless profile 加载插件不崩；stop → pid 安全 kill

## Task 5: headless 集成冒烟（A4.7b workflow 等价）
**Files:** Create `tests/workflows/smoke.trace.log`（产出）· 脚本 `script/linux/smoke.sh`（或并入 bench）
**Interfaces:** Consumes: Task 4 · Produces: 真 dsh 进程输出 trace
- [x] 用 vibe-arm-b profile 运行一句任务，验证：插件注入、skill 工具可用、契约段存在（dump-config）

## Task 6: A/B bench
**Files:** Create `tests/bench/{run_bench.sh,score.py,tasks/*}` · `bench/baseline-bundle/*`（Arm-A bundle 包）· 产出 `tests/bench/report.md`
**Interfaces:** Consumes: Task 4/5 · Produces: 评分 CSV + report.md
- [x] 8 任务 × 2 臂 × 3 次；指标：assert 退出码、gate token 计数、token 用量（session JSONL usage）、墙钟

## Task 7: 部署 + 审核
**Files:** 删除 `~/.dsh/skills/vibeweaver` · `dsh plugin --profile web add file:...` · dump-config 验证 · 官网文档对照审核（tests/review/dsh-docs-review.md）
**Interfaces:** Consumes: Task 6 · Produces: 生产挂载 + 审核报告
- [x] 用户要求：完成后按 dsh 官网 reference 逐项核对插件 API 用法

## Task 8: COV-8 独立评审 + 收尾
- [x] review_package.md → 独立评审子代理 → 修复/裁定 → assert_artifacts 全绿 → 完成表

**Self-review:** 覆盖（8 任务映射全部要求）· 无占位符 · 类型一致（file_path/PostToolDecision 全仓唯一拼写，见 Hub）。
