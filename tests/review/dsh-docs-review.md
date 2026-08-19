# dsh 官网文档对照审核 — vibeweaver 插件

**日期:** 2026-08-19
**审核对象:** `src/index.js` / `src/lib.js` / `src/baseline.js` / `cordis.patch.yml` / `package.json`
**依据:** dsh 官网 reference（https://deepseek-harness.github.io/deepseek-harness/reference/）+ 本机 rc.6 真源交叉核对
**方法:** 每个 API 用法 → 对照官网对应页面 → 对照本机 `lib/types/*.d.ts` → 结论（合规 / 需修复 / 记录差异）

## 1. 插件形态（bundle + cordis.patch.yml）— 合规

| 官网条款 | 核对结果 |
|---|---|
| 架构页：「profile 列出组合包；**bundle** 是 Cordis 配置项及挂载代码的分发格式；package.json 通过 `dsh.bundle` 声明 patch 文件」 | 合规：`package.json: dsh.bundle.patch = ./cordis.patch.yml`；`cordis.patch.yml` 用 `- insert: [{id, name}]` 与 maid 先例一致；`dsh --profile vibe-arm-b --dump-config` 实测显示 `# == dsh-vibeweaver` + `- id: vibeweaver, name: dsh-vibeweaver` 挂载成功 |
| app-boot：「bundle 的 name 两锚点解析（dsh 安装处 → profile 目录）」 | 合规：bench profile 经 `~/.dsh/profiles/node_modules` 扁平 symlink（healProfilesModuleFallback 模式）解析，dump-config 验证通过 |

## 2. ctx.skills.registerProvider — 合规（含 1 项修复记录）

| 官网条款 | 核对结果 |
|---|---|
| skills 页：「SkillProvider {name, list(options), get(candidate, options)}；list 返回候选；get 加载完整正文；provider 拥有 resourceBase」 | 合规：provider 名称 `vibeweaver-filesystem`；list() 产出候选（name/description/rank/source/invocation/locator/path/resourceBase）；get() 重读 SKILL.md 正文 + `resourceBase: {kind:'directory', path}` |
| skills 页：「本地发现优先级 rank」与「模型目录仅使用 name+description」 | 合规：rank 100（覆盖 user-dsh 层旧副本删除后的空位）；catalog 由 dsh-tool-skill 注入，插件不干预 |
| skills 页 SkillDefinition：「extends SkillSummary，`source: SkillSource` 必填」 | **曾违例→已修复**：get() 初版漏 `source` 字段，真实 dsh 报 `loaded skill "vibeweaver" source must be a string`；已补 `source:"runtime"` 并经真实 headless 会话验证 skill 加载成功 |

## 3. ctx.systemPrompt.section — 合规

| 官网条款 | 核对结果 |
|---|---|
| system-prompt 页：「PromptSection {name, order, text: string \| (context)=>string}；order 100 为工具指引带；complete 段会独占」 | 合规：`vibeweaver-covenant` order 100，动态 text 生成契约卡；未设 complete（不与 dsh 内置 section 冲突） |
| system-prompt 页：「前缀稳定（prefix-stable）不失效 KV 缓存」 | 合规：契约卡文本静态派生（仅依赖 config），不随轮次变化 |

## 4. agent/pre-step — 合规

| 官网条款 | 核对结果 |
|---|---|
| agent-lifecycle：「agent/pre-step 是 waterfall；返回 decision {kind:'enter', messages} 可改写进入步骤的消息；监听器包装 next() 保留下游消息」 | 合规：插件 `await next()` 后追加激活消息，与 dsh-tool-skill 官方 consumer 同模式（其 lib/index.js:146-179 先 next() 再 `{kind:'enter', messages:[...decision.messages, ...injections]}`） |
| agent-lifecycle：「inject() 排队到下一次获准请求；不唤醒；void」 | 合规：pre-step 激活直接改写 decision.messages（不用 inject 返回值——真实签名 void，单测 fake 已按此修正） |

## 5. tools/post-execute 门禁 — 合规

| 官网条款 | 核对结果 |
|---|---|
| tool-execution-pipeline：「tools/post-execute 可替换展示内容或返回值、**阻止结果**或附加上下文；PostToolDecision = {kind:'accept', content?} \| {kind:'accept', value} \| {kind:'block', feedback}」 | 合规：blocking 证据缺失 → `{kind:'block', feedback:[text]}`（错误化结果，GATE-BLOCKED）；warnings → `{kind:'accept', content:[...original, warning]}` |
| adding-a-tool：「用 tools/post-execute 替换展示内容或返回值、阻止结果；tools/result 仅观察不可变结果」 | 合规：选择 post-execute（需变换结果）而非 result（只读）；block 不改写 value（保留程序化访问）——符合「保密策略屏蔽或替换 value；替换内容不阻止程序化访问 value」语义 |

## 6. agent/turn-stopping 守卫 — 合规

| 官网条款 | 核对结果 |
|---|---|
| agent-lifecycle：「agent/turn-stopping 是 serial（无 next()）；监听器反对时 steer() 且机器重读 inbox：fresh steering 再跑一步，否则关回合」 | 合规：serial handler 内检查 gate RED → `agent.steer()`；steer 预算防死循环（超过则 warn 放行） |

## 7. ctx.tools.register（vibeweaver_gate）— 合规（含 1 项修复记录）

| 官网条款 | 核对结果 |
|---|---|
| adding-a-tool：「output.schema 用 ValueSchemaSpec；root 可为对象；required 数组在顶层」 | **曾违例→已修复**：初版把 `required:true` 写在 properties 内部（非标准位置），真实 dsh 报 `UNSUPPORTED_SCHEMA: schema.properties.pass.required is not supported`；已改为顶层 `required: ["pass","blocking","warnings"]` |
| adding-a-tool：「execute 只返回规范 JSON 值；注册表快照为无损 JSON 并校验」 | 合规：execute 返回 `{pass, blocking, warnings}` 字面对象；render 纯函数 |
| adding-a-tool：「register 借用只读定义；注册后不改 schema」 | 合规：定义一次性注册，无热改 |
| tool 参数校验（ParameterSchemaSpec） | 合规：`parameters` 声明 object+properties+type；真实 headless 会话中工具可被模型调用（冒烟验证通过） |

## 8. ctx.commands.register（/vibe）— 合规

| 官网条款 | 核对结果 |
|---|---|
| commands 页：「CommandDefinition {name（无斜杠小写）, description, handler(invocation)→CommandResult}；结果直接呈现给 UI，不产生模型消息」 | 合规：name="vibe"；handler 返回 {kind:'success', text}；off/on 会话级状态 |

## 9. compaction 重建 — 合规（记录差异）

| 官网条款 | 核对结果 |
|---|---|
| compaction 子系统：「compaction/end 是持久会话事件（session/event 流）」（本机 dsh-compaction types/types.d.ts:72 确认） | 合规：`ctx.on('session/event')` 过滤 `event.type === 'compaction/end'` → `agent.inject()` |
| 记录差异：官网文档（zh）未直接给出 compact 事件名；以本机 rc.6 类型真源（compaction/start|end|prune|summary）为准 | 已记录 |

## 10. 插件注入消息的 source 约定 — 已修复

| 官网条款 | 核对结果 |
|---|---|
| adding-a-tool：「`agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })` 追加持久化上下文」 | **已修复**：初版用 `{kind:'user'}`；已改为 `{kind:'plugin', plugin:'dsh-vibeweaver'}`（pre-step 激活 / steer / compaction 重建三处），单测 26/26 仍绿 |

## 11. 未使用的可选扩展点（不违反）— 记录

- `ctx.invariants`（invariants 页）：可选；插件门禁自带错误处理，无需额外运行时不变式注册——不注册不违例
- `ctx.approval` / sandbox / jobs：本插件无权限升级或长任务需求，不触碰
- `dsh-skill-badge`（BUNDLED_SKILL_RANK）：插件自建 provider，无需 badge

## 12. 结论

- **Critical:** 0 · **Important:** 0 · **Minor:** 1（source kind 约定，审核中已一并修复）
- 审核过程发现并已修复 2 处真实环境违例（SkillDefinition.source 缺失、output schema required 位置）——均由真实 dsh headless 运行暴露，单测无法覆盖（fake ctx 无 schema 校验器）；已在单测中补充对应契约断言防回归
- 总评：插件与 dsh 官网文档及本机 rc.6 类型真源一致，可部署
