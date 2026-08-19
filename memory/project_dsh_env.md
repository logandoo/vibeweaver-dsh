---
name: dsh 0.1.0-rc.6 环境
description: npx 缓存真源位置、web profile 结构、bundle 挂载先例、全局 skills 目录
type: project
date: 2026-08-19
---

# dsh 0.1.0-rc.6 环境（本机事实）

**Why:** 插件开发必须绑定真实安装版本的行为，不是文档理想形态。

**How to apply:**
- 运行方式：`npm exec @deepseek-ai/dsh web`（ps 见 pid 58218）
- 类型真源：`~/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/*/lib/types/*.d.ts` + `lib/*.js`（已钉死：write/edit 参数键 file_path；PostToolDecision block/accept；agent/pre-step waterfall；agent/turn-stopping serial）
- profile：`~/.dsh/profiles/web/`（bundles: dsh-base, dsh-web-app, @dsh-whale/maid）；`dsh plugin --profile web add <pkg>` 官方安装路径
- 全局 skills：`~/.dsh/skills/`（rank 400 user-dsh）；设置 skills.globalSkillDirs 指向它
- headless 一次性：`dsh --profile headless "task"`（CLI 已确认）
- 会话落盘：`~/.dsh/sessions/<workspace-encoded>/`（bench 评分数据源）
