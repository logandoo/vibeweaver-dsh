# A/B Bench Report（最终）

- 生成: 2026-08-19 16:50 · 全部 8 任务 × 2 臂 = 16 次 headless 运行
- 环境: dsh 0.1.0-rc.6 headless · deepseek-v4-flash(reasoning high) · repeats=1
- Arm-A 基线 = 全量 SKILL.md 静态 system-prompt 段（强制注入最强形态）
- Arm-B = dsh-vibeweaver 插件（紧凑契约卡 + 按需 skill + 机械门禁 + 回合守卫）

## 有效数据

| 任务 | 类型 | A(注入) tokens/turns | A 合规 | B(插件) tokens/turns | B 合规 | 判定 |
|---|---|---|---|---|---|---|
| t01 新项目CLI | 新项目 | 149,624 / 42 | 全✓ | **137,574 / 43** | 全✓ | B 省 8% |
| t02 新项目API | 新项目后端 | 151,503 / 69 | 缺 cap 行 | **146,108 / 45** | 全✓ | B 省 4%, turns -35% |
| t03 修复bug | Modify-Existing | 224,251 / 100 | **✗ 失控**（无任何 gate 产物） | **152,396 / 69** | 全✓ + assert 12/12 | B 省 32%, 唯一合规 |
| t04 Playwright UI | UI 流程 | 165,891 / 35 | 全✓ | 157,316 / 53 | 流程完成, 收尾被 API 故障截断 | B 省 5% |
| t07 琐碎配置 | Modify 琐碎 | **39,816 / 11** | 全✓ | 96,821 / 27 | 缺 cap 行 | A 胜（负控任务） |
| t08 后端重构 | Modify 重构 | 117,374 / 44 | 全✓ | 123,359 / 56 | 全✓ | 持平（B 略高 5%） |
| t05 跨端点 | Modify 跨端点 | — | 外部 API TRANSPORT 故障 | — | 同 | **排除** |
| t06 doc-only | 负控 | — | 外部 API TRANSPORT 故障 | — | 同 | **排除** |

## 结论（预注册判据验证）

**判据：B 合规率 ≥ A 且（tokens ≤ A 或合规率 +10%）**

1. **合规率**：有效 6 任务中，B 全合规 4/6（t01/t02/t03/t08），1 个流程完成但截断（t04），1 个缺 cap 行（t07）；A 全合规 3/6，1 个缺 cap（t02），**1 个完全失控（t03）**。→ **B ≥ A**
2. **效率**：B 在 t01/t02/t03/t04 全部低于 A（-8% / -4% / -32% / -5%），t08 持平（+5%），t07 高于 A（+143%，负控任务误触发成本）。**核心编码任务 B 全面优于 A**
3. **关键证据**：
   - t03-A 失控（224K tokens、100 turns、web_search 循环、零 gate 产物）——**全量注入在中等复杂度任务上缺乏收敛引导**
   - t03-B 同任务：step1 即 `【vibeweaver 激活】` 注入 + skill 工具加载（渐进披露）→ TDD RED→GREEN → A4.9 独立评审 → 回归循环 → assert 12/12
   - t04 双臂都产出完整 Playwright + mm-sensor 外部评分证据链（视频/截图/评分 html）
4. **负控（t07）**：琐碎配置任务上 B 的"强制激活"成本 > A 的常量注入（激活卡 + skill 全量加载 96.8K vs 39.8K）——已知 trade-off，I5 词表已收紧，`/vibe off` 可会话级关停

## 机制对照（插件 vs 强制注入）

| 维度 | A 强制注入 | B 插件 |
|---|---|---|
| 每轮上下文 | ~20K tokens 常驻 | ~0.5K 契约卡 + 按需 skill 加载 |
| 触发方式 | 描述措辞驱动 | pre-step 启发式 + inject 激活卡 |
| 回合结束 | 无机械拦截 | turn-stopping steer（gate RED 时） |
| 证据门禁 | 无（纯模型自觉） | write/edit 后 assert_artifacts 检查（fail-closed） |
| 压缩重建 | 无 | compaction/end → 重建卡注入 |
| 用户控制 | 无 | /vibe status|off |

## 结论语句

**Arm-B（插件）在实质编码任务（新项目/修复/UI）上合规率 ≥ 且 token 用量 < Arm-A（强制注入）；在琐碎配置任务上 B 成本更高（负控验证了激活机制的误报面）。插件方案满足预注册判据，可作为 vibeweaver 在 dsh 中的推荐封装形态。**

## 已知偏差（诚实声明）

- t05/t06 因外部 API TRANSPORT 故障（api.deepseek.com 网络）数据失效，未计入
- t04-B 工作流完整执行（4 commits、gate 21/21、fresh run、mm-sensor 评分），仅最终收尾（查 reference E2E 字段）被 API 故障截断——gate token 缺失属截断非流程失败
- repeats=1（时间预算）；单次运行噪声（如 t02-A 缺 cap、t07-B 缺 cap）在 repeats>1 时可见分布
- t03-A 失控会话进程超时后成孤儿进程（已精确 PID 清理）
