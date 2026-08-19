---
name: 门禁 fail-closed 与缓存设计
description: 证据检查器自身故障/空壳脚本必须 fail-closed；1s 缓存降阻塞
type: fix
date: 2026-08-19
status: ⏳
commit: 17ec049
---

# Fix: 门禁 fail-closed（评审 I4/M3）

**Problem:** 原 checkGate 在 assert_artifacts.py 崩溃或模型写空壳脚本时 fail-open（放行），违背门禁目的。

**Correct Fix:** ①`isPlausibleAssertScript` 校验脚本含核心标记（verification_log/acceptance/cap=5）→ 空壳即 blocking；②`runnerCrashed` 识别 traceback/ENOENT → blocking；③`invalidateGateCache` + 1s TTL 缓存降每次 write 的 4×8s python 阻塞。

**Files:** src/lib.js（checkGate/isPlausibleAssertScript/runnerCrashed/gateCache）, src/index.js（post-execute 前 invalidate）

**Status:** ⏳ Pending — awaiting user confirmation
