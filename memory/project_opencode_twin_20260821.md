---
name: 主线 opencode 审计插件 2026-08-21 修复（兄弟插件等价参照）
description: 主线 vibeweaver(opencode) 审计插件改为会话级 RED 锁存 + 留痕自动释放 + 嵌套 tests 豁免；本仓库是其死锁受害者，且 dsh 门架构上不受该类缺陷影响
type: project
date: 2026-08-21
---

# 主线 opencode 审计插件 2026-08-21 修复（兄弟插件等价参照）

**Why:** 主线仓库 `/Users/logan/Documents/DEV/SKILLS/vibeweaver`（remote `logandoo/vibeweaver`，08-21 推送 `c2103fe`）完成审计死锁修复并四副本同步：RED 锁存改会话级 `{sessionID, ts, bad}`，换会话 / TTL（**仅全局** `~/.config/opencode/vibeweaver/audit.json` 的 `redTtlHours`，项目本地配置被刻意忽略以防自改审计器）/ legacy 状态三条路自动释放，每次释放留痕（redReleases + 报告段落）；项目根下任意 `test`/`tests` 路径段 RED 期间保持可写；selftest 28→36 项（含 T20 legacy 自愈）。

**对本仓库的意义:** 本仓库的 `.vibeweaver/audit-state.json` 曾于 08-20 被旧主线插件 latch（BLOCKING=yes 现场 = 已入库的 tests/gate_audit.md），08-21 经主线 heal 路径迁移释放并留痕（by=manual-heal-20260821, reason=stale-session, from=unknown）。

**架构结论（无需移植）:** dsh 插件是**无状态即时门**——PostToolDecision 在每次 write/edit 后即时跑 `tests/assert_artifacts.py`，`{kind:'block'}` 只是把反馈替换进工具结果（写已落盘、不可逆亦不可拦）→ 结构上不存在跨会话锁存，主线 latch 缺陷类不适用，不引入锁存状态机。skill 内容等价由正源目录保证：provider 指向 `~/.config/opencode/skills/vibeweaver`（08-21 已 17/17 payload 字节同步），dsh 会话拉到的 vibeweaver 即最新版。

**How to apply:** 未来评审"为什么 dsh 门没有 RED 锁存"或以主线行为对照 dsh 行为时，以本条为准；若 dsh 门新增持久化状态，必须同步主线的会话级 + 留痕释放语义。
