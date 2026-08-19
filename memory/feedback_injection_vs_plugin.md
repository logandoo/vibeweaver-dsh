---
name: 强制注入 vs 插件封装
description: 用户接受插件方案；A/B 基线定为全量 SKILL.md 静态 system-prompt 段；B 臂 = 渐进披露+机械门禁
type: feedback
date: 2026-08-19
---

# 强制注入 vs 插件封装（方案确认）

**Why:** 用户在 Gate A 后授权"按你认为最合适的方案进行开发"，即方案 B（dsh 插件 bundle）。四个待拍板默认项也一并授权默认：Arm-A 基线 = 全量 SKILL.md 静态段（最严格强制注入）；任务集 = 拟 8 任务；A/B 模型 = deepseek-v4-flash(high)（沿用用户默认）；`~/.dsh/skills/vibeweaver` = 删除。

**How to apply:** 评测判据预注册：Arm-B 合规率 ≥ Arm-A 且（tokens ≤ Arm-A 或合规率 +10%）。任何偏离需回到用户确认。
