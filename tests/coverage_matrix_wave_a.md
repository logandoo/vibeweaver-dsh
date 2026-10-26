# Coverage matrix — 波次 A（dsh 0.2.1-rc.3 兼容性，Lane L，§V7）

判据正源：`tests/acceptance.md`「波次 A」块（12 条）。计划正源：`docs/FIXES_20261026_dsh_compat_and_context.md` 波次 A。
状态口径：**covered** = 有执行过的检查 + 落盘证据；**partial** = 机制已实现但某条证据链未在本机执行（写明缺哪一段）；不写 na 除非判据本身不适用。

| # | Criterion | Check (test / command) | Evidence file | Status |
| --- | --- | --- | --- | --- |
| 1 | 三处注入 `source.kind` 恒为 `dsh-vibeweaver`，源码不再出现 `kind: "plugin"` | 单测 `A1: 三处注入…`（三条注入路径逐个断言 + 源码级 grep 断言）；RED 实测 `grep -c` = 3 | tests/dsh-a1-red.log · tests/dsh-a-red-on-baseline.log | covered |
| 2 | 「0.2.x 读侧拒 plugin / 放行自有 kind」由上游真代码复核（非引用文档） | `node tests/v3_compat_probe.mjs <0.2.x node_modules>` → 调 `@deepseek-ai/dsh-session-format-v3-to-v4` 的 `assertV4RowAdmission`，含**负对照**（旧写法必须抛）+ 注入点真扫源码 | tests/dsh-a1-oracle.log（PROBE PASS，3 检查） | covered |
| 3 | 有效工作目录 = 服务 `get(session)`，缺失/抛错回退 `header.cwd`；五处取值统一 | 单测 A2 四条（有服务 / 无服务 / 服务抛错 / 不进 inject）；`grep 'header\.cwd' src/index.js` 只剩注释 | tests/dsh-a-wave-unit-4.log | covered |
| 4 | 夹具「header.cwd=A、服务报 B、日志只在 B」门禁命中 B | 判别钉 `A2: header.cwd 与服务报不同目录时…`（RED：actual 0 steers；GREEN：命中 B，gate 工具同判）；同一夹具在波次基线 ca0133a 上复跑仍失败（反 tautology） | tests/dsh-a-red-on-baseline.log | covered |
| 5 | 不把 `workingDirectory` 写进 `inject`（0.1.x 上会让插件静默不加载） | 单测 `!inject.includes("workingDirectory")`；cordis 源码判定链 `_refresh → epoch=INACTIVE → _unload`（lib/index.js:1317-1345）+ `ctx.reflect.get` 的"无 inject 要求"契约（rc.6 同 API） | tests/verification_log.md iter 3 · memory/reference_dsh_plugin_apis.md §1 | covered（判定链为源码级实证，未做真实 0.1.x 加载实验） |
| 6 | `engines.dsh` 与冒烟版本钉一致；pack 清单与 `files` 一致 | 端到端：0.2.1-rc.3 上 `>=99.0.0` → dsh 报 `skipping profile bundle "dsh-vibeweaver" … incompatible`；`>=0.1.0-rc.6` → 正常加载；`npm pack --dry-run --json` 11 件 = files[] 9 + package.json + README.md，声明未打包 0 件 | tests/dsh-a3-engines.log | covered |
| 7 | 冒烟新增「注入后重启加载该会话」一步 | 已实现（`--session-id` 能力探测 + 按时间取本轮 session id + 命中 `SessionFormatError` 即 FAIL）；本机 vibe-arm-b **无模型配置**，实跑输出 `SKIP: 未取得 session id…不是通过` | tests/dsh-a-smoke.log (3/5) | **partial** — 脚本在位且失败会红，但"重载断言真跑过"未在本机成立（缺模型配置） |
| 8 | 守卫面：run_code 递归删 DENY / terminal_send 硬复位 DENY / cd 出根提示 / lsp 只读 / 无前缀通配 | `node tests/w19_poc.mjs` 新增 11 例（含白名单与只读程序不误拦）+ 单测 `tests/unit/v3_surface.test.js` 13 钉（含评审加固：省略接收者、程序落点交回路径守卫、多行补扫、注释豁免、create_worktree 提示） | tests/dsh-a-poc-after-r1.log | covered |
| 9 | 原 15 例判定不回归；unit 全绿；build exit 0 且 lib==src | `node tests/w19_poc.mjs`（15 原例判定不变，`+warn2→+warn1` 归因于本仓 log 类声明变化，已具名实测）；`node --test tests/unit/*.test.js` 143/143；`bash script/linux/project_build.sh` + `cmp -s` 三文件 | tests/dsh-a-poc-after-r1.log · tests/dsh-a-wave-unit-4.log · tests/dsh-a-wave-build-5.log | covered |
| 10 | compaction 带 error 不投重建卡；契约段 `interpolate:false`；12 组合 <8000 | 单测 `A5` / `A6`；`bash tests/w19_verify.sh` §C3 字节 min/max 7820/7934 | tests/dsh-a-w19verify.log | covered |
| 11 | `assert_artifacts.py --existing --final` exit 0；`evidence_lock --check` OK | 收官时跑（`--final` 要求 working_note 已蒸馏删除） | 待：tests/dsh-a-final-assert.log | pending（收官跑） |
| 12 | 独立评审派发 + 逐条裁定 + FCV 全新上下文复验 | R1（对抗/守卫面）已回：4 Important + 8 Minor，Important 全修并有钉，Minor 采纳 4 / 记录 2；R1 复评 + R2（判据保真/跨版本）在跑；FCV 待最终树 | tests/review/review_package_wave_a.md · tests/verification_log.md iter 7-8 | pending（复评 + FCV） |

## 已知未覆盖 / 有意不做

- **真实模型回合**：pre-step 注入与 `workingDirectory` 的实际读取需要 dsh 会话回合，本机 headless profile 无模型配置。冒烟脚本对此打 SKIP（不是 PASS）。
- **波次 B/C**：上下文管理移植（B1-B6）与 `engines.dsh` 上限裁定（ADR D-14）不在本波。
- **`/bin/rm` 绝对路径形式**：shell 面破坏性表以 `rm\b` 锚定，绝对路径 `/bin/rm -rf` 可绕（先于本波存在，记 follow-up；`run_code` 的 `os.spawn*` 已按 basename 归一）。
