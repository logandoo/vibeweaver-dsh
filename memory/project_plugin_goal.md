---
name: 插件目标与验收
description: 效果 ≥ 强制注入；交付后按 dsh 官网审核插件；bench 判据预注册
type: project
date: 2026-08-19
---

# 插件目标与验收

**Why:** 用户要求"确保效果与强制注入 skill 相比效果更好，或者持平"，并"完成后根据 dsh 官网信息审核插件"。

**How to apply:**
- 验收 = A/B bench：合规率（assert_artifacts 退出码 + gate token 正则）+ 效率（token 用量）双指标
- 审核 = 完成开发后对照 dsh 官网 reference 各页逐项核对插件 API 用法 → tests/review/dsh-docs-review.md
- 部署 = 删 `~/.dsh/skills/vibeweaver` + `dsh plugin --profile web add` + dump-config 验证
