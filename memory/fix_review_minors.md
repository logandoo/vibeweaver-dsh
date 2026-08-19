---
name: COV-8 评审 Minor 记录（延后项）
description: M1 并发锁 / M7 可移植 / M10 语义注释 等延后 Minor 的裁定
type: fix
date: 2026-08-19
status: ⏳
commit: 5c2a7d9
---

# COV-8 评审 Minor 裁定记录

**M1 — stall observer 并发：** 同项目多 agent 并行时 `.tmp` 固定名 + 无锁 RMW 可能丢 op。裁定：PARKED——当前场景（单会话项目）无并发；记录待多 agent 场景。`.vibeweaver/` 已在 .gitignore。

**M7 — bench 可移植性：** FIXTURE_SRC/任务 prompt 硬编码 `/tmp/vwbench`。裁定：PARKED——本机专用 bench，README 已注明；跨机使用需参数化（deferred）。

**M10 — turn-stopping budget 键依赖"steer 后仍同 turn"语义：** 与 rc.6 文档一致（fresh steering 仍在 open turn 内）。裁定：注释保留，若 dsh 语义变更需复查。

**已修复 Minor：** M2（iter 复位）、M3（gate 缓存）、M4（死代码）、M5（状态清扫）、M6（/vibe 宽容）、M9（死赋值）。

**Status:** ⏳ Pending — awaiting user confirmation
