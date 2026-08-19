# Verification Log — vibeweaver-dsh

## Task: 脚手架与设计文档 | 2026-08-19

- iter 1 PASS: 脚手架完成（evidence: git 仓库、script/linux 6 脚本可执行、FLOW_DESIGN/BACKEND_DESIGN/DATABASE_DESIGN.html、config.toml、memory/ 5 文件、README/requirements/package.json、tests/assert_artifacts.py 13/13 标记自验、acceptance.md 23 条）| 23/23 计划判据对应任务已建
- COV-9 skipped — new project (C1), no pre-existing code to baseline-test

## Task: Task 1 — src/lib.js 纯函数核心（TDD）| 2026-08-19

- iter 1 FAIL: 全部 11 测因 src/lib.js 缺失 ERR_MODULE_NOT_FOUND 失败 | diagnosis: TDD RED 阶段, 测试先于实现 | changed: (none — 预期失败)
- iter 2 FAIL: covenantCard 缺字面 `HARD-GATE-1: NO-TEST-NO-DONE` token；runAssert fixture 缺 assert_artifacts.py | diagnosis: 契约卡漏排完成行 token 行；fixture 未复制规范断言脚本 | changed: src/lib.js, tests/unit/lib.test.js
- iter 3 PASS: 11/11 全绿（evidence: `node --test tests/unit/lib.test.js` → pass 11/fail 0；runAssert 用 makeFullProject 完整证据集 fixture 验证 exit 0）| 11/11

## Task: Task 2 — src/index.js 插件接线（TDD）| 2026-08-19

- iter 1 FAIL: src/index.js 缺失，模块加载失败（RED 预期） | diagnosis: TDD RED 阶段 | changed: (none — 预期失败)
- iter 2 FAIL: 7 测失败 | diagnosis: ①fake ctx registerProvider 存了工厂而非 create() 产物（真实签名 create(control)=>SkillProvider）②agent.inject/steer 未接侧通道 ③active fixture 证据"齐全"致 inlineCheck 不报错 ④ctx 作用域 ⑤fire 未透传事件签名（post-execute 三参） | changed: tests/unit/index.test.js
- iter 3 FAIL: 假阳性——fake inject 返回消息而真实 dsh inject() 为 void | diagnosis: 应改用 dsh-tool-skill 官方模式（pre-step waterfall 直接改 decision.messages） | changed: src/index.js, tests/unit/index.test.js
- iter 4 PASS: 23/23 全绿（evidence: `node --test tests/unit/*.test.js` → pass 23/fail 0）| 23/23

## Task: Task 3-6 — baseline 插件 + bench 框架 + 集成冒烟 | 2026-08-19

- iter 1 PASS: baseline 3/3 绿；bench 8 任务 fixture 就绪（evidence: node --test 26/26、tests/bench/tasks/*.json、fixtures/*）
- iter 2 FAIL: 真实 dsh 冒烟报 UNSUPPORTED_SCHEMA（output schema properties 内 required:true 非规范位置） | diagnosis: dsh JsonSchemaNode 校验器要求顶层 required 数组 | changed: src/index.js（output/parameters schema 重构）
- iter 3 FAIL: skill 工具报 `loaded skill "vibeweaver" source must be a string` | diagnosis: SkillDefinition extends SkillSummary, source 必填; get() 返回对象漏 source 字段 | changed: src/index.js（get() 补 source:"runtime"）
- iter 4 PASS: 真实 dsh 双冒烟通过（evidence: tests/smoke_run.txt 见 skill catalog 含 vibeweaver；skill 加载返回 "# Skill: vibeweaver — Binding Contract + Companion Router"；node --test 26/26）| 26/26

## Task: P3 — dsh 官网文档对照审核 + 集成修复 | 2026-08-19

- iter 1 PASS: 官网 9 页核对完成（evidence: tests/review/dsh-docs-review.md §1-§12；两处真实违例已修复并经真实 dsh 验证）| 12/12 审核节
- iter 2 FAIL: Minor 偏差——注入消息 source 用 user 而非官网约定的 plugin | diagnosis: adding-a-tool 页规定插件注入 source={kind:'plugin', plugin:name} | changed: src/index.js 三处 source kind
- iter 3 PASS: 26/26 单测绿（evidence: node --test 全绿）| 26/26

## Task: P3 — COV-8 独立评审 + 评审修复 | 2026-08-19

- iter 1 PASS: 评审包生成（evidence: tests/review/review_log.md + review_diffstat.txt 31 文件 + review_package.md 2216 行）+ 独立评审派遣完成，verdict: not ready（C1 关键）
- iter 2 FAIL: C1——4/5 会话级功能死代码（agent.session.sessionId/metadata.cwd 不存在, 真值为 session.id/session.header.cwd）| diagnosis: fake ctx 按实现而非 API 建模 → 26/26 假绿 | changed: src/index.js 6 处属性名 + tests/unit/index.test.js fake + 形状回归测试
- iter 3 PASS: C1 实证修复（evidence: 真实 headless 会话 JSONL 含【vibeweaver 激活】注入 + 工作区完整 vibeweaver 产物 + vibeweaver_gate 被调用）| 1/1
- iter 4 PASS: I1（config 经 cordis.patch.yml 注入,dump-config 显示 5 键）+ I4（fail-closed: 空壳脚本/检查器崩溃 → blocking）+ I5（意图词表收紧）+ M2（iter 复位）+ M3（缓存）+ M6（/vibe 宽容）修复, 29/29 绿 | 29/29
- iter 5 PASS: I3 bench 评分健壮性（精确会话目录匹配 + newest-only + zstd + timeout 配置）+ M4 死代码清理, 29/29 仍绿 | 29/29
- 待办: I2（bench 完成度）+ Minor 记录（M1 并发锁 / M5 状态清扫 / M7 可移植 / M9 死赋值 / M10 注释）

## Task: P3 — bench 半程数据 + 评分链修复 | 2026-08-19

- iter 1 FAIL: 评分链拿不到数据 | diagnosis: ①会话目录编码为 --<strip 首/>替换>-（/private/tmp realpath）②主会话在 session-* 前缀目录（uuid 目录为子代理）③usage 键为 inputTokens/outputTokens ④文本在 text-chunks 事件 | changed: tests/bench/score.py
- iter 2 PASS: 评分链打通（evidence: t01/t02 双臂 token+gate 指标全部提取；t01-A 149.6K / t01-B 137.6K；t02-A 151.5K / t02-B 146.1K）| 8/8 指标
- iter 3 PASS: 半程 report 落盘（evidence: tests/bench/report.md——B 臂两任务 tokens 均 ≤ A，t02 turns 45 vs 69；合规 B 2/2 全过、A 1/2 缺 cap 行）| 2/2 任务对比
- 待办: bench 全量完成（t03-t08 运行中）→ 全量 report 覆盖；M9 已修

## Task: P3 — bench 全量完成 + 最终报告 | 2026-08-19

- iter 1 PASS: 16 次 headless 运行完成（8 任务 × 2 臂）（evidence: tests/bench/bench_run.log——t01 418s/492s, t02 725s/469s, t03 900s×2, t04 900s×2, t05 606s/131s, t06 142s/87s, t07 207s/167s, t08 292s/323s）| 16/16 运行
- iter 2 FAIL: 运行时评分 tokens=0/gate=False | diagnosis: run_bench.py 内联评分用了修复前的 score 逻辑（会话编码/事件结构 bug） | changed: 用修复后 score.py 重新评分 → tests/bench/final_scores.json
- iter 3 FAIL: t05/t06 双臂 + t04-B 收尾被外部 API TRANSPORT 故障破坏 | diagnosis: api.deepseek.com 网络故障（会话 JSONL finish reason=TRANSPORT）——非插件/模型行为 | changed: 数据排除/标记，不计入对比（诚实记录）
- iter 4 PASS: 最终报告产出（evidence: tests/bench/report.md——B 臂 4/6 任务 token 更低且合规持平或更优；t03-A 失控 vs t03-B 全合规；t07 负控 A 胜；t08 持平）| 6/6 有效任务

## Task: P3 — COV-8 scoped re-review + N1 修复 | 2026-08-19

- iter 1 PASS: re-review 派遣（修复范围 a835216..HEAD 21 文件）——10/10 原发现 ADDRESSED | evidence: re-review verdict（逐项表）
- iter 2 FAIL: N1 (Critical)——post-execute 读 exec.args 但真实 ToolExecution 字段为 exec.arguments，写门禁仍死代码 | diagnosis: 与 C1 同根因（fake 建模 args 而非 arguments，自证循环）| changed: src/index.js + tests/unit/index.test.js（fake 4 处）+ 回归测试钉死 arguments 形状
- iter 3 FAIL: M5 测试用 injected 侧通道断言，但激活走 pre-step 消息改写（真实 dsh 语义）不经过 agent.inject() | diagnosis: 测试断言路径错误 | changed: M5 测试改断言 decision.messages + disposed 后门禁恢复
- iter 4 PASS: 31/31 单测绿 + 真实 dsh 门禁实证（evidence: n1_verify 会话 JSONL——write 后 tool/result 含 `[GATE-WARNING (vibeweaver)] non-blocking: memory/...`，证明 exec.arguments 路径真实生效）| 31/31 + 1/1 真实验证
- 基线说明：新项目（C1），无既有代码可 baseline-test；git init + 设计文档先行

## Task: P3 部署 — web profile 挂载 + 删除旧 skill | 2026-08-19

- iter 1 PASS: web profile package.json bundles += dsh-vibeweaver（evidence: dump-config 输出 `# == dsh-vibeweaver` / `- id: vibeweaver`；maid bundle 未动）
- iter 2 PASS: ~/.dsh/skills/vibeweaver 已删除（evidence: ls ~/.dsh/skills/ 仅剩 agent-reach/global-skill-authoring/mm-sensor）
- iter 3 PASS: 删除后 catalog 回归验证——headless vibe-arm-b 会话列出 vibeweaver 仍可用（evidence: 会话输出含 4 个 skill 名）| 1/1 回归

## Task: P3 部署收尾 — web 重启 + 插件生效 | 2026-08-19

- iter 1 PASS: 旧 web 进程（58218/58204）PID 精确停止；npm exec rc.6 后台重启（用户授权）| evidence: ps 无残留 + nohup 日志
- iter 2 FAIL: 首次重启误拉 rc.7 | diagnosis: npm exec 无 --package pin 时取最新版 | changed: 重启命令显式 --package=@deepseek-ai/dsh@0.1.0-rc.6
- iter 3 PASS: web 以 rc.6 重启成功（evidence: ~/.dsh/web.log "dsh web: http://127.0.0.1:3080"；curl 200；进程 2396 健康；日志 0 error；bundles 含 dsh-vibeweaver）| 3/3
