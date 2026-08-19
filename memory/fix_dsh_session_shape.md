---
name: COV-8 评审发现与修复（dsh 插件会话属性）
description: agent.session.id / session.header.cwd 是真实 API 形状；fake ctx 必须按 API 建模否则假绿
type: fix
date: 2026-08-19
status: ⏳
commit: 17ec049
---

# Fix: dsh 会话属性名（评审 C1）

**Problem:** 插件 4/5 会话级功能（pre-step 激活/turn-stopping/vibe off/compaction 重建）在真实 dsh 上全为死代码——代码用 `agent.session.sessionId` 与 `agent.session.metadata.cwd`，真实 dsh rc.6 Session 暴露 `session.id` 与 `session.header.cwd`。

**Root Cause:** 单测 fake ctx 的 makeAgent() 按实现习惯建模（sessionId/metadata），而非按真实 dsh API 形状（dsh-session Session 类: get id()、header 含 id/cwd）建模 → 26/26 假绿掩盖真实死代码。

**Correct Fix:** 6 处属性改名（sessionId→session.id, metadata.cwd→header.cwd）；fake 对齐真实形状；新增"会话属性形状"回归测试钉死 API（断言 sessionId===undefined 防再犯）。

**Failed Approaches (DO NOT retry):**
- 依赖 fake 形状自洽性（自证循环）——fake 必须引用真实 API 文档/类型

**Rejected Alternatives:**
- 不改 fake、只在真实环境多冒烟——成本高且晚发现

**Files:** src/index.js, tests/unit/index.test.js

**Status:** ⏳ Pending — awaiting user confirmation
