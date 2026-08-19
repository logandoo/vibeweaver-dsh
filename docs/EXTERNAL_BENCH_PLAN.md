# 外部 Benchmark 评测方案（对标 DeepSeek-V4 × J-Space 报告 §4.2）

> 版本: v0.1 · 状态: 草案（M0 启动前冻结） · 目标机: Ubuntu 24.04 服务器（用户提供）
> 上游参照: https://github.com/Tiger3807861189/DeepSeek-V4-J-Space-Capability-Realization-Report §4.2 分数记录

## 0. 目标与范围

复刻 J-Space 报告 §4.2 的 8 个 Benchmark 评测协议，产出 **2 个评分列**：

| 列 | 被测系统 |
|---|---|
| V4-Flash + vibeweaver-dsh | dsh 极简模式 + vibeweaver-dsh 插件 + `deepseek-v4-flash` |
| V4-Pro + vibeweaver-dsh | dsh 极简模式 + vibeweaver-dsh 插件 + `deepseek-v4-pro` |

不跑对照组（裸模型列取官方模型卡公开值作参照，不做重测）。

**注入方案（已确认）**：方案 A —— dsh 全程在线。8 个 benchmark 全部以 dsh Python SDK
（`jsonrpc-agent` + `minimal.cordis.yml` 极简组合）为 agent，vibeweaver-dsh 插件完整生效
（契约段、skill 工具、机械门禁 assert_artifacts、回合守卫、stall observer）。

## 1. 协议锁定（Protocol Lock）

对齐 J-Space 报告 §4.1 评测协议（其自述口径；差异见 §8 诚实声明）：

| 项 | 值 |
|---|---|
| Harness | dsh 极简组合（`minimal.cordis.yml`）+ vibeweaver-dsh 插件 |
| dsh 版本 | 0.1.0-rc.6（本项目已验证版本，钉死） |
| 模型 | `deepseek-v4-flash` / `deepseek-v4-pro`（记录服务端实际版本号 0731/0813 或等价） |
| 采样参数 | `reasoning_effort=max`、`temperature=1.0`、`top_p=0.95`（API 思考模式可能忽略后两者，记录日志实际行为） |
| 重复 | 单次运行（与 J-Space 同；不加置信区间） |
| 隔离 | 每任务独立 workspace + 独立 session id；同一 dsh 运行时复用但 session 不跨任务 |
| 变量控制 | 同模型、同任务、同工具条件、同评分规则；唯一变量 = 是否加载 vibeweaver-dsh（本方案只跑加载侧） |
| 技能来源 | vibeweaver SKILL.md 正源（插件 skill provider 供给，非手工粘贴） |

### 1.1 数据集钉版（M0 时逐项核实并记录 commit/版本）

| Benchmark | 数据集源 | 默认规模 | 钉版方式 |
|---|---|---|---|
| HLE 无工具 | `cais/hle`（text-only 子集） | 2500 题 | HF dataset 版本 |
| HLE 有工具 | activeloopai/hle_with_tools 同源 | 2500 题 | repo commit |
| Terminal Bench 2.1 | harbor 注册表 `terminal-bench/terminal-bench-2-1` | ~89 任务 | Harbor dataset 版本 |
| NL2Repo | multimodal-art-projection/NL2RepoBench | 104 任务 | repo commit |
| CyberGym | sunblaze-ucb/cybergym（OSS-Fuzz 语料） | 1507 实例（建议子集，§7） | repo commit + 子集 ID 列表 |
| DeepSWE | datacurve-ai/deep-swe（HF gated） | 113 任务 | repo commit + HF 版本 |
| Toolathlon-Verified | hkust-nlp/Toolathlon | 108 任务 | repo commit |
| Agents' Last Exam | rdi-berkeley/agents-last-exam | ~150 公开任务 | repo commit + 任务清单 |
| AutomationBench (Public) | zapier/AutomationBench | 600 公开任务 | repo commit |

## 2. 服务器配置要求（Ubuntu 24.04）

### 2.1 硬件（依据：并发容器内存占用、镜像/数据集体积、轨迹日志量）

| 资源 | 最低 | 推荐 | 依据 |
|---|---|---|---|
| CPU | 16 核 | 32 核 | 并发 8-16 任务容器 + dsh Node runtime + 镜像解压；无 GPU 需求（推理在 DeepSeek 云端 API） |
| 内存 | 64 GB | 128 GB | 每任务容器 1-4 GB + dsh runtime ~0.5-1 GB/会话；Toolathlon 单任务起多个 MCP 容器（可至 8+ GB/任务）；并发 8 时峰值 ~60 GB |
| 磁盘 | 500 GB NVMe | 1 TB NVMe | 镜像 ~150-300 GB + 数据集 ~80-150 GB + 会话 JSONL/轨迹 ~100 GB + 余量 |
| GPU | 无 | 无 | 全部推理走 API |

磁盘明细估算：

| 项 | 估算 |
|---|---|
| terminal-bench 2.1 任务镜像（Harbor 缓存） | 15-30 GB |
| DeepSWE 113 任务镜像（5 语言 base 共享后） | 40-80 GB |
| NL2Repo 104 环境 + pip 依赖 | 20-60 GB |
| CyberGym OSS-Fuzz 数据 + build 镜像（子集 300 实例） | 30-60 GB |
| Toolathlon MCP 应用栈镜像（32 应用） | 20-50 GB |
| ALE 沙箱镜像（VM/容器基底） | 10-30 GB |
| HLE / AutomationBench | < 2 GB |
| 会话 JSONL + 轨迹 + 报告（全 8 套 × 2 模型） | 50-150 GB |

### 2.2 软件依赖

| 软件 | 版本要求 | 用途 |
|---|---|---|
| Docker Engine + compose | ≥ 24（非 Docker Desktop，纯 Linux daemon） | 全部沙箱 |
| Python | 3.10-3.12（推荐 3.11/3.12） | deepseek-harness-sdk、各 harness 驱动、评分 |
| Node.js | ≥ 20 | dsh runtime |
| uv | 最新 | harbor / pier / auto-bench / ALE 安装 |
| git | 任意 | 数据集钉版 |
| pnpm（可选） | 任意 | dsh profile 安装（如走 npm exec 则不需要） |

### 2.3 网络（出站，无入站开放需求——所有任务由服务器主动发起）

| 目标 | 用途 |
|---|---|
| `api.deepseek.com`（或用户自定义 base_url） | 模型推理 |
| `registry.docker.io` / `ghcr.io` | 任务镜像 |
| `huggingface.co` | 数据集（国内环境建议 `HF_ENDPOINT=https://hf-mirror.com`） |
| `hub.harborframework.com` | Terminal-Bench / DeepSWE 数据集 |
| `github.com` / `pypi.org` | 安装与钉版 |
| `tbench.ai` / `lastexam.ai`（如需） | 数据集元数据 |

带宽：≥ 100 Mbps（推荐 300+）；首次拉取 ~300 GB 镜像/数据集，1 Gbps 下约 40 分钟。

### 2.4 隔离与安全（重要）

- **专用服务器**：多个 harness 使用 `danger-full-access` 组合 + agent 可修改容器内任意路径，**不得与生产/业务环境共存**。
- 独立非 root 评测用户（如 `bench`），容器以该用户权限运行。
- CyberGym 自带 Squid 域白名单代理（agent 容器出网受限）——按官方默认 allowlist 使用，不关防火墙。
- 会话日志含完整工具调用与代码，落盘目录建议 `0700`。

### 2.5 待核实项（M0 首日，阻塞项）

1. **ALE 沙箱机制**：rdi-berkeley/agents-last-exam 使用 VM 沙箱（ALE-Claw）→ 若需 KVM，云服务器需确认**嵌套虚拟化**支持；否则核实其 Docker/容器化路径或改期。
2. **DeepSWE 数据集 gated 访问**：HF 上需要申请（datacurve/deep-swe），提交后需审批；M0 即发起申请。
3. **CyberGym 全量 vs 子集**：1507 实例 × 2 模型成本过高（§7 建议 300 实例子集 + 记录抽样方式）；若对标 J-Space 分数需同口径，先与报告方/官方 leaderboard 口径核对。
4. **V4-Pro API 版本号**：确认 `deepseek-v4-pro` 对应 0813 快照（模型卡口径）。

## 3. 架构总览

### 3.1 服务器目录布局

```
/home/bench/external-bench/          # 评测工程根（git 仓库 = 本项目 vibeweaver-dsh 的部署形态）
├── adapters/                        # 8 个 benchmark 的 dsh 适配器（本方案最大工程项）
│   ├── hle/          ├── terminal_bench/   ├── nl2repo/
│   ├── cybergym/     ├── deepswe/          ├── toolathlon/
│   ├── ale/          └── automationbench/
├── profiles/                        # dsh bench profile（仿 vibe-arm-b 模板）
├── scripts/                         # 生命周期：env_setup / pull / run / stop / report
├── datasets/                        # 数据集钉版清单 + 下载脚本
├── results/                         # 每 benchmark × 模型 的原始结果 + 汇总
├── sessions/                        # dsh session JSONL（= 轨迹证据）
└── report/                          # 最终 8×2 评分表 + 证据索引
```

### 3.2 dsh 接入统一模式（适配器公共骨架）

每个 benchmark 适配器实现同一接口：

```
[benchmark task] → [sandbox/container 准备] → [dsh jsonrpc-agent 会话]
                    → 任务指令注入（instruction.md / task prompt）
                    → vibeweaver-dsh 插件自动激活（pre_step_activation）
                    → [官方评分器] → [result.json 回传]
```

- 复用 `deepseek-harness-sdk` 的 `DeepSeekHarness` 上下文管理器（生命周期、运行时缓存、session 持久化）；
- 每任务 `session_id = <benchmark>/<task-id>/<model>`，workspace 指向任务容器挂载目录；
- 插件配置经 profile 的 plugin config 注入（同 `cordis.patch.yml` 模式），`skill_source_dir` 指向服务器上 bakes 好的技能正源（打包进镜像或 volume 挂载，容器内路径要可达——与现有本机 bench 的关键差异）。

### 3.3 逐 benchmark 接入设计

| Benchmark | 官方 harness | dsh 接入形态 | 评分 | 预估 token 量级（×2 模型合计） |
|---|---|---|---|---|
| HLE 无工具 | cais/hle `run_model_predictions.py` + judge | 自写驱动：逐题 dsh 会话，解析最终答案 → 官方 judge 脚本 | 官方 judge（GPT-4o/o3-mini 系） | ~100 M |
| HLE 有工具 | activeloopai/hle_with_tools agent 循环 | 自写驱动 + dsh 工具面（检索工具） | 同官方 | ~150 M |
| Terminal Bench 2.1 | Harbor + 自定义 agent | 自写 Harbor agent 包装 dsh（先例：pier 的 opencode 适配器） | Harbor 官方 verifier（task 内 test.sh） | ~140 M |
| NL2Repo | NL2RepoBench 环境（bash+submit） | 环境与 agent 解耦：直接以 dsh 为循环，submit 工具回传评分 | 官方 pytest 通过率（0-1 连续分） | ~120 M |
| CyberGym | cybergym 服务器 + agent 容器 | 自写 agent 容器（官方 agents/ 目录模式）：容器内跑 dsh headless，PoC 提交官方服务器验证 | 官方 verify（pre/post-patch 崩溃对照） | ~200 M（300 实例子集） |
| DeepSWE | pier + mini-swe-agent | 自写 pier 适配器驱动 dsh（pier 已支持 opencode 同型）；或 Harbor dataset 直接跑自定义 agent | 官方手写 verifier（分离验证环境） | ~110 M |
| Toolathlon | 官方 eval 服务 / decoupled 模式 | decoupled 模式：环境留容器内，host 侧 scaffold 换成 dsh 驱动 | 官方 eval 脚本（环境终态断言） | ~120 M |
| Agents' Last Exam | ale_run | 将 dsh headless CLI 注册为 ALE harness（in-sandbox 形态） | 官方 `evaluate()` 灰度打分 | ~150 M |
| AutomationBench | auto-bench（自带循环） | **受限**：fork 其 agent 循环，工具（search/execute）路由到 dsh 会话；或按 §7 风险条款决策 | 官方断言（终态 rubrics） | ~330 M |

### 3.4 评分输出

每 benchmark × 模型产出：

- 官方原生分（越高越好，与 §4.2 同口径）；
- `results/<benchmark>/<model>/tasks.jsonl`（每任务 reward + 时长 + token）；
- 最终 8 行 × 2 列对照表（对齐 §4.2 表头），附运行日期、模型版本、数据集版本、失败任务清单。

## 4. 实施里程碑

| 里程碑 | 内容 | 验证命令/出口条件 |
|---|---|---|
| **M0 环境** | 服务器验收：硬件、Docker、Python/Node/uv、网络出站、HF 镜像；DeepSWE/HLE gated 数据集申请；ALE KVM 核实；模型双列冒烟（dsh headless 各 1 句） | `docker run hello-world`；`dsh --profile bench "echo ok"` 两模型各 1 次；申请确认 |
| **M1 pilot：Terminal Bench 2.1** | Harbor 安装 + oracle 冒烟（官方要求先跑 oracle 验证沙箱）；写 dsh Harbor agent；单任务 × 2 模型跑通 | `harbor run -d terminal-bench/terminal-bench-2-1 -a oracle` 通过；单任务真实评分产出 result.json |
| **M2 全量接入** | 其余 7 个适配器开发 + 各 benchmark 单任务冒烟（每适配器 1 任务 × 2 模型） | 8 适配器均产出官方格式 result；冒烟矩阵 8×2=16 全绿 |
| **M3 全量运行** | 8 benchmark × 2 模型全任务集（CyberGym 子集待定）；并发 4→8→16 阶梯；故障重试与日志 | 每单元完成计数 = 钉版任务数（除明确排除项）；无静默失败 |
| **M4 报告** | 汇总 8×2 评分表；与 §4.2 J-Space 列并排（注明不可比声明）；证据索引（session/轨迹/result 路径）；成本与时长记录 | 报告产出 + 内部一致性自检（任务数=评分样本数） |

预估：M0-M2 工程 1-2 周；M3 有效运行 ~5-7 天（并发 8-16），含重试与故障 → **全流程 2-4 周墙钟**。

## 5. 成本估算（token 口径，M1 实测校准）

| Benchmark | 单会话均值（估计） | 会话数 ×2 模型 | 总 token 量级 |
|---|---|---|---|
| HLE 无工具 | ~20 K | 5000 | ~100 M |
| HLE 有工具 | ~30 K | 5000 | ~150 M |
| Terminal Bench 2.1 | ~400 K | 178 | ~70 M |
| NL2Repo | ~600 K | 208 | ~125 M |
| CyberGym（300 子集） | ~350 K | 600 | ~210 M |
| DeepSWE | ~500 K | 226 | ~110 M |
| Toolathlon | ~550 K | 216 | ~120 M |
| ALE | ~500 K | 300 | ~150 M |
| AutomationBench | ~280 K | 1200 | ~335 M |

合计 ~1.4 B token（输入为主，DeepSeek 上下文缓存可显著折减；实际价格按 M1 pilot 实测 3-5 个任务的 token/元换算后，再批准 M3 全量预算）。**预算闸门：M1 结束后向用户汇报实测成本曲线，获批准才进入 M3。**

## 6. 验收标准（acceptance 草案，M0 冻结）

1. 8 个 benchmark 全部产出官方原生评分，2 个模型列完整（16 个评分单元，明确排除项除外）。
2. 每评分单元附：运行日期、模型版本、数据集钉版 commit、单次运行、失败任务 ID 清单。
3. 每任务 session JSONL 与轨迹完整落盘，路径入证据索引。
4. 协议参数（reasoning_effort/temp/top_p）与 J-Space §4.1 一致并在日志中可查。
5. 报告含诚实声明：与 J-Space 列并排仅作参考位置，非严格对比（§8）。
6. 全部运行经 `script/` 生命周期管理（COV-2），无 raw 命令旁路。

## 7. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| ALE 需 KVM 而云服务器无嵌套虚拟化 | 高 | M0 核实；备选：ALE docker 化路径 / 改期 ALE |
| CyberGym 全量 1507×2 成本/时间超预算 | 高 | 默认 300 实例随机子集（记录 seed 与抽样）；先与官方 leaderboard 口径核对分数含义 |
| AutomationBench 循环不可托管 dsh | 中 | fork auto-bench 路由工具调用至 dsh；或降级为方案 B（系统提示注入）并在报告注明 |
| dsh 插件在容器内不可达 skill_source_dir | 中 | M1 前决定 bake vs volume 挂载；M1 冒烟覆盖 |
| API 限流/网络抖动（本项目 A/B 曾遇 TRANSPORT 故障） | 中 | 并发阶梯 + 每任务重试策略（≤3 次，记录）；断点续跑（按已完成 session 跳过） |
| 单次运行噪声（J-Space 同款问题） | 中 | 如实声明；关键异常值（如某 benchmark 波动大）补 1 次复跑 |
| token 成本超预算 | 中 | M1 成本闸门；HLE 可先跑官方文本子集；上下文缓存启用 |
| HF gated 数据集审批延迟 | 低 | M0 首日提交申请，不等审批先跑非 gated 项 |

## 8. 诚实声明（写入最终报告）

- J-Space 报告为**单次运行、无置信区间**，且未公开每 benchmark 的子集选择与技能加载细节；本方案的分数是**同方法学下新增的一列**，与 J-Space 列并排仅作参考位置，不构成严格对比。
- 裸模型参照列（V4-Flash-0731 / V4-Pro-0813）取官方模型卡公开值，不在本方案重测。
- vibeweaver-dsh 与 J-Space 是两套不同技能/插件；分数差异不代表两者优劣，仅记录各自系统在同协议下的表现。
- 部分 benchmark 官方榜数字（如 Toolathlon 70.7 vs 报告 70.3）接近，说明报告裸分列接近官方跑法——这是本方案与报告可比性的基础，但 CyberGym 分数口径差异（公开榜 ~30% vs 报告 76-86）需在 M0 核实。

## 9. 术语表（Consistency Hub）

| 项 | 规范值 | 说明 |
|---|---|---|
| dsh 版本 | 0.1.0-rc.6 | 钉死（本项目验证版本） |
| 模型 ID | `deepseek-v4-flash` / `deepseek-v4-pro` | API 实际 ID，记录服务端版本快照 |
| bench profile | `vibe-ext-bench` | 服务器 dsh profile 名 |
| skill_source_dir | `/home/bench/external-bench/skills/vibeweaver` | 容器内外路径一致的挂载/bake 位置 |
| 会话根 | `/home/bench/external-bench/sessions` | dsh session JSONL 落盘 |
| 结果根 | `/home/bench/external-bench/results` | 每 benchmark×模型 result.jsonl |
| 采样参数 | max / 1.0 / 0.95 | reasoning_effort / temperature / top_p |
| 评分脚本 | 各 benchmark 官方原生 | 一律不自行改写评分逻辑 |
