# Coverage matrix — 波次 A（dsh 0.2.1-rc.3 兼容性，Lane L，§V7）

判据正源：`tests/acceptance.md`「波次 A」块（12 条）。计划正源：`docs/FIXES_20261026_dsh_compat_and_context.md` 波次 A。
状态口径：**covered** = 有执行过的检查 + 落盘证据；**partial** = 机制已实现但某条证据链未在本机执行（写明缺哪一段）；不写 na 除非判据本身不适用。

| # | Criterion | Check (test / command) | Evidence file | Status |
| --- | --- | --- | --- | --- |
| 1 | 三处注入 `source.kind` 恒为 `dsh-vibeweaver`，源码不再出现 `kind: "plugin"` | 单测 `A1: 三处注入…`（三条注入路径逐个断言 + 源码级 grep 断言）；RED 实测 `grep -c` = 3 | tests/dsh-a1-red.log · tests/dsh-a-red-on-baseline.log | covered |
| 2 | 注入的消息能被 0.2.x **加载期**收下（kind + id/role 两个维度） | 探针喂 `injectedUserMessage()` 真对象，跑 `adoptSessionEvent`（加载期形状闸）+ `assertV4RowAdmission`（v4 种类闸）两条上游路径，各配负对照 + 定位校验；对 rc.3 与 rc.4 双版本复跑 | tests/dsh-a1-oracle.log · tests/dsh-a1-oracle-rc4.log（均 PROBE PASS） | covered（评审 R2 判 Critical 后重做：旧探针自造信封，只证了 kind 维度） |
| 3 | 有效工作目录 = 服务 `get(session)`，缺失/抛错回退 `header.cwd`；五处取值统一 | 单测 A2 五条（有服务 / 无服务 / 服务抛错 / 不进 inject / 镜像夹具）+ **真内核运行时实证**：0.2.1-rc.3 上 `workingDirectory resolved=true`，rc.6 上回调不触发（按设计回退）；同一次实测也证明旧写法 `reflect.get` 恒 undefined | tests/dsh-a-runtime-probe.log · tests/dsh-a-real-cordis.log · tests/dsh-a-wave-unit-10.log | covered（评审 R2 判 Critical 后改法：`reflect.get` → `ctx.inject`） |
| 4 | 夹具「header.cwd=A、服务报 B、日志只在 B」门禁命中 B | 判别钉 `A2: header.cwd 与服务报不同目录时…`（RED：actual 0 steers；GREEN：命中 B，gate 工具同判）；同一夹具在波次基线 ca0133a 上复跑仍失败（反 tautology） | tests/dsh-a-red-on-baseline.log | covered |
| 5 | 不把 `workingDirectory` 写进 `inject`（0.1.x 上会让插件静默不加载） | 单测 `!inject.includes("workingDirectory")`；cordis 源码判定链 `_refresh → epoch=INACTIVE → _unload`（lib/index.js:1317-1345）+ `ctx.reflect.get` 的"无 inject 要求"契约（rc.6 同 API） | tests/verification_log.md iter 3 · memory/reference_dsh_plugin_apis.md §1 | covered（判定链为源码级实证，未做真实 0.1.x 加载实验） |
| 6 | `engines.dsh` 与冒烟版本钉一致；pack 清单与 `files` 一致 | 端到端：0.2.1-rc.3 上 `>=99.0.0` → dsh 报 `skipping profile bundle "dsh-vibeweaver" … incompatible`；`>=0.1.0-rc.6` → 正常加载；`npm pack --dry-run --json` 11 件 = files[] 9 + package.json + README.md，声明未打包 0 件 | tests/dsh-a3-engines.log | covered |
| 7 | 冒烟新增「注入后重启加载该会话」一步 | 已实现并修两处死因（评审 R2）：默认跑**下限 + next 两端**（旧版只跑 rc.6 → 永远 SKIP）；能力探测改版本号为主（help 层级探错，永远落空）；FAIL 匹配词补 `is corrupt` / `lacks an identified message`（旧词与真实报错不相交 → 真回归会报 WARN） | tests/dsh-a-smoke-2.log (3/5) | **partial** — 脚本在位且失败会红，但"重载断言真跑过"仍未成立：本机 profile 无模型凭据（headless 直接 MISSING_CREDENTIAL / 401） |
| 8 | 守卫面：run_code 递归删 DENY / terminal_send 硬复位 DENY / cd 出根提示 / lsp 只读 / 无前缀通配 | `node tests/w19_poc.mjs` 新增 11 例（含白名单与只读程序不误拦）+ 单测 `tests/unit/v3_surface.test.js` 13 钉（含评审加固：省略接收者、程序落点交回路径守卫、多行补扫、注释豁免、create_worktree 提示） | tests/dsh-a-poc-after-r1.log | covered |
| 9 | 原 15 例判定不回归；unit 全绿（150/150）；build exit 0 且 lib==src | `node tests/w19_poc.mjs`（15 原例判定不变，`+warn2→+warn1` 归因于本仓 log 类声明变化，已具名实测）；`node --test tests/unit/*.test.js` 143/143；`bash script/linux/project_build.sh` + `cmp -s` 三文件 | tests/dsh-a-poc-after-r1.log · tests/dsh-a-wave-unit-4.log · tests/dsh-a-wave-build-5.log | covered |
| 10 | compaction 带 error 不投重建卡；契约段 `interpolate:false`；12 组合 <8000 | 单测 `A5` / `A6`；`bash tests/w19_verify.sh` §C3 字节 min/max 7820/7934 | tests/dsh-a-w19verify.log | covered |
| 11 | `assert_artifacts.py --existing --final` exit 0；`evidence_lock --check` OK | 收官时跑（`--final` 要求 working_note 已蒸馏删除） | 待：tests/dsh-a-final-assert.log | pending（收官跑） |
| 12 | 独立评审派发 + 逐条裁定 + FCV 全新上下文复验 | R1（对抗/守卫面）已回：4 Important + 8 Minor，Important 全修并有钉，Minor 采纳 4 / 记录 2；R1 复评 + R2（判据保真/跨版本）在跑；FCV 待最终树 | tests/review/review_package_wave_a.md · tests/verification_log.md iter 7-8 | pending（复评 + FCV） |

## FCV 之后新增的守卫（M7）

| 项 | 内容 | 证据 |
| --- | --- | --- |
| 真容器探针 | `tests/real_cordis_probe.mjs`：在真 `Context` 里跑真插件——服务在场按服务归属 / 缺席回退 header / 抛错回退；并实测 cordis 语义"缺席不触发、提供后异步触发、回调晚于 apply()" | tests/dsh-a-real-cordis.log（8 检查 PROBE PASS，rc.3 与 rc.4 双跑） |
| 桩的时序保真 | `cwdProbeCtx.inject` 改**异步**触发回调（与真 cordis 同序）；否则"apply 时快照服务"的错误实现能在单测里活下来 | 变异复测：快照式实现 → 2 条单测失败 + 真容器探针 FAIL |
| 冒烟接入 | `smoke.sh` (4b) 跑真容器探针，缺上游时 SKIP 不判过 | script/linux/smoke.sh |

## 评审后修正的过度声称

- #2 / #3 曾记 covered：评审 R2 证明当时**两条修复都是空转**（消息缺 id/role；`reflect.get` 在插件作用域读不到服务），且认证工件自造信封掩盖了它。现已按真实产物 + 真内核重做并改判。
- 教训：`PROBE PASS` + `150/150` 不等于修复成立——认证链的输入必须是被测代码真实产出的对象，桩必须照上游机制建模。

## 已知未覆盖 / 有意不做

- **真实模型回合**：pre-step 注入与 `workingDirectory` 的实际读取需要 dsh 会话回合，本机 headless profile 无模型配置。冒烟脚本对此打 SKIP（不是 PASS）。
- **波次 B/C**：上下文管理移植（B1-B6）与 `engines.dsh` 上限裁定（ADR D-14）不在本波。
- **`/bin/rm` 绝对路径形式**：shell 面破坏性表以 `rm\b` 锚定，绝对路径 `/bin/rm -rf` 可绕（先于本波存在，记 follow-up；`run_code` 的 `os.spawn*` 已按 basename 归一）。
