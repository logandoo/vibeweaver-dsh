> cap=5  stall=3×

# Acceptance Criteria — vibeweaver-dsh 插件交付

## A. 插件功能（src/index.js + lib.js）
1. skill provider `vibeweaver-filesystem` 注册成功；`skill({name:"vibeweaver"})` 返回正源 SKILL.md 全文（>30KB）与 resourceBase
2. 契约段 `vibeweaver-covenant`（order 100）含 HARD-GATE-1/2、cap=5 stall=3×、tests/ 产物清单
3. pre-step 激活：编码意图消息（含 "修复" 或 ".py"）触发一次 inject，非编码消息不触发
4. tools/post-execute：write/edit 到 vibeweaver-active 项目且证据缺失 → `{kind:'block', feedback}` 含 GATE-BLOCKED；证据齐 → 原样放行
5. stall observer：同文件 3× 编辑无新 PASS → state.json 记录 + GATE-WARNING 追加
6. agent/turn-stopping：gate RED 且 steer 计数 < budget → steer 拦截；达到 budget → 放行并 warn
7. `vibeweaver_gate` 工具注册，返回 {pass, blocking, warnings}
8. `/vibe` 命令注册；`/vibe off` 置位会话级禁用
9. compaction/end 事件触发 agent.inject() 重建卡
10. 契约段文本从 config.toml skill_source_dir 派生（无硬编码路径）

## B. 工程纪律（本项目自身）
11. tests/acceptance.md 首行 `> cap=5  stall=3×`（本文件）
12. tests/verification_log.md 有 ≥1 iter 条目，FAIL 带 diagnosis
13. script/linux/{start,stop,restart,project_build}.sh 存在且可执行，构建/生命周期全程走脚本
14. memory/MEMORY.md + ≥1 topic 文件 + 指针
15. FLOW_DESIGN.html + BACKEND_DESIGN.html + DATABASE_DESIGN.html 存在（PAGE_DESIGN 跳过——backend-only）
16. git ≥2 提交；README + requirements.txt + package.json 存在

## C. 集成与评测
17. headless vibe-arm-b profile 加载插件不崩（smoke 冒烟）
18. A/B bench：8 任务 × 2 臂 × 3 次运行完成，report.md 产出
19. 判据：Arm-B 合规率 ≥ Arm-A 且（tokens ≤ Arm-A 或合规率 +10%）
20. dsh 官网文档对照审核报告（tests/review/dsh-docs-review.md）产出
21. 部署：~/.dsh/skills/vibeweaver 已删除；web profile 安装插件；dump-config 验证插件行

## D. 收尾
22. python3 tests/assert_artifacts.py 退出 0（最终树）
23. 完成表 8 列齐全；[Verification Gate]/[Memory Gate]/[Convergence] 行齐备
