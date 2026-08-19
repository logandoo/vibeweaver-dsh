---
name: 删除 ~/.dsh/skills/vibeweaver
description: 用户明确要求删除陈旧副本，由插件 skill provider 从正源供给
type: feedback
date: 2026-08-19
---

# 删除 ~/.dsh/skills/vibeweaver（用户指令）

**Why:** 该副本为旧版（8 契约、缺 scripts/assert_artifacts.py 与 TESTING_PROTOCOLS.md，与当前 11 契约正源不一致），继续驻留会造成 catalog 双源混乱。用户明确指示"删去"。

**How to apply:** 部署阶段删除整个目录；插件 provider 的 list()/get() 指向 `~/.config/opencode/skills/vibeweaver`（正源），保证模型经 skill 工具拿到的永远是最新全文。
