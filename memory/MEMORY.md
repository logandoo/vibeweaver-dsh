# Project Memory Index

## User Context
- [User Role & Preferences](user_role_prefs.md) — 本机 macOS + opencode + dsh 双环境；偏好严谨工程化、可机器验证的证据文化；中文交流

## Feedback — Validated Approaches
- [强制注入 vs 插件封装](feedback_injection_vs_plugin.md) — 用户接受"插件渐进披露 + 机械门禁"方案；认定强制注入基线 = 全量 SKILL.md 静态 system-prompt 段

## Feedback — Corrections
- [删旧 skill 副本](feedback_delete_stale_skill.md) — 用户明确要求删除 `~/.dsh/skills/vibeweaver`（陈旧 8 契约副本），由插件 provider 供给最新内容

## Project Context
- [dsh 0.1.0-rc.6 环境](project_dsh_env.md) — npx 缓存真源；web profile 常驻；skills 全局目录；bundle 挂载先例 @dsh-whale/maid
- [插件目标与验收](project_plugin_goal.md) — 效果 ≥ 强制注入；完成后按 dsh 官网审核插件
- [主线 opencode 审计插件 08-21 修复](project_opencode_twin_20260821.md) — 会话级 RED 锁存 + 留痕释放；本仓库是其死锁受害者；dsh 无状态门架构不受影响

## External References
- [dsh 官方参考](reference_dsh_docs.md) — reference/ 各子系统页 URL；本机 lib/types 真源路径

## Fix Tracking
- ⏳ [Fix: dsh 会话属性形状](fix_dsh_session_shape.md) — session.id / session.header.cwd；fake 按 API 建模
- ⏳ [Fix: 门禁 fail-closed](fix_gate_fail_closed.md) — 空壳脚本/检查器崩溃 → blocking；缓存降阻塞
- ⏳ [Fix: 评审 Minor 记录](fix_review_minors.md) — M1/M7/M10 裁定 park；M2-M6/M9 已修复
- ⏳ [Fix: 会话收尾交付](fix_session_delivery.md) — 插件交付 + bench 结论 + 部署记录

## Key Dependencies & Conventions
- dsh 类型真源 = `~/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/*/lib/types/`（0.1.0-rc.6 钉死）
- write/edit 工具参数键 = `file_path`；PostToolDecision = `{kind:'block',feedback}` / `{kind:'accept',content}`
- bundle 挂载 = package.json `dsh.bundle.patch` + cordis.patch.yml `- insert: [{id, name}]`
