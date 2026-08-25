# vibeweaver-dsh

**vibeweaver 技能的 DeepSeek Harness (dsh) 专属版本** — 将 [vibeweaver](https://github.com/logandoo/vibeweaver) 工程纪律封装为 DeepSeek Harness 0.1.0-rc.6 插件 bundle，使 vibeweaver 工作流可以在 dsh 生态中完整运行。

> 本仓库是 vibeweaver 的 dsh harness 专属发行版：原技能面向 opencode，本版本面向 DeepSeek Harness（jsonrpc-agent / headless CLI），非通用替代品。

## 特性

- **渐进披露契约段**：紧凑契约卡常驻上下文，skill 全文按需加载（替代全量强制注入，A/B 评测验证 token 用量显著下降）
- **机械门禁**：`assert_artifacts.py` 证据检查，`gate_mode: block|warn|off` 三档
- **编码任务自动激活**：pre-step 意图启发式，仅对编码任务注入
- **回合守卫**：stall observer + steer 预算，防止死循环（防失控，见 bench t03-A 对照）
- **压缩恢复**：compaction 后自动重建契约卡
- **零 npm 运行时依赖**：Node ESM 纯函数核心 + cordis 事件接线

## 架构

| 组件 | 文件 | 机制 |
|---|---|---|
| 插件主入口 | `src/index.js` → `lib/index.js` | `apply(ctx, config)` 事件接线 |
| Arm-A 基线插件 | `src/baseline.js` → `lib/baseline.js` | 全量 SKILL.md 静态注入（bench 对照臂） |
| 纯函数核心 | `src/lib.js` | 项目根发现 / assert 执行 / gate 分类 / stall observer / 意图启发式 / 契约卡 |
| bundle 挂载 | `package.json` + `cordis.patch.yml` | `dsh.bundle.patch` → `insert: [{id, name}]` |

## 安装

```bash
# 1. 克隆本仓库，确保 vibeweaver 技能正源目录存在（默认 ~/.config/opencode/skills/vibeweaver）
#    可从 opencode 仓库获取 vibeweaver SKILL.md 到该目录

# 2. 挂载到 dsh profile（将 <path/to/vibeweaver-dsh> 替换为你本机路径）
dsh plugin --profile web add file:<path/to/vibeweaver-dsh>

# 3. 生效验证
dsh --profile web --dump-config | grep -A3 dsh-vibeweaver
```

> 路径说明：`config.toml` / `cordis.patch.yml` 中的 `skill_source_dir`、`session_root` 为示例路径（`~` 占位），部署时请改为本机实际路径，或通过环境变量 `VIBEWEAVER_SKILL_DIR` 覆盖。

## 配置

`config.toml`（插件运行时与 bench 配置；部署时由 profile 的 plugin config 覆盖）：

```toml
[plugin]
skill_source_dir = "~/.config/opencode/skills/vibeweaver"  # skill 正源目录
steer_budget = 3        # 回合守卫每回合最大 steer 次数
gate_mode = "block"     # block | warn | off
pre_step_activation = true
recover_after_compaction = true

[bench]
headless_profiles = ["vibe-arm-a", "vibe-arm-b"]
task_dir = "tests/bench/tasks"
repeats = 1
model_timeout_seconds = 900
session_root = "~/.dsh/sessions"
```

环境变量 `VIBEWEAVER_GATE=off` 可急停门禁。

## 开发与评测

```bash
bash script/linux/project_build.sh   # src → lib（node --check + copy）
node --test tests/unit/              # 单测（node:test）
bash script/linux/bench_profiles.sh  # 创建 vibe-arm-a / vibe-arm-b headless profile
bash script/linux/bench.sh           # A/B 评测 → tests/bench/report.md
bash script/linux/smoke.sh           # headless 冒烟
```

## 依赖

- Node.js ≥ 20（零 npm 运行时依赖）
- dsh 0.1.0-rc.6
- Python 3.11+（评分脚本 / assert_artifacts.py，`tomllib` 需 3.11+）
- pnpm（bench profile 安装）

## 许可证

MIT
