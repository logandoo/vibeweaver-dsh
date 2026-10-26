# Coverage matrix — 主线 w19.0 同步波（Lane L，§V7）

判据正源：`tests/acceptance.md`（12 条）。证据一次性重放脚本：`tests/w19_verify.sh`（输出留档 `tests/w19-verify.log`）。

| # | Criterion | Check (test/command) | Evidence file | Status |
| --- | --- | --- | --- | --- |
| 1 | assert 与主线逐字节 + 组22/--root/--self-check + fixed-local 语义在盘 | `shasum -a 256` 成对相等（`40090938…4ddaa` ×2）；8 个语义标记 mainline/dsh 计数一致；`python3 tests/assert_artifacts.py --existing` | tests/w19-verify.log §C1 · tests/w19-assert.log | covered |
| 2 | 三个捆绑脚本与主线 sha256 相同（+ 新增 evidence_lock.py） | `shasum -a 256` 四对全 OK（c06939a5 / 8b9feb25 / 53f653a7 / c5a549a8） | tests/w19-verify.log §C2 | covered |
| 3 | 契约卡 COV-0 + §A7.7.1 + COV-9 措辞 + `组1-22`；8 配置 <8000B | 7 个锚词全 OK；字节 min/max 7848/7949；单测 `契约卡: 含 COV-0…` + `四配置字节全部 <8000`（4 路径 × block/warn/off） | tests/w19-verify.log §C3 · tests/unit/w19_guards.test.js | covered |
| 4 | checker pin：不符 blocking / 缺失 WARN / CI 下豁免失效 | 单测 6 项（含 `ALLOW_CUSTOM_CHECKER` + CI）；真仓实测篡改→`ok=false reason=digest 7382de8c1541 != pinned 40090938cdb5`，还原→`ok=true` | tests/w19-verify.log §C4 · w19_guards.test.js | covered |
| 5 | 风险路径 pre-write 拦 + `risk-approved:` 放行 + env 关闸 | 单测 3 项（写面/命令面/批准）+ 钩子层 1 项；真仓 `write src/auth/x.js → DENY`、`write src/lib.js → allow` | tests/w19-verify.log §C5-C10 · w19_guards.test.js | covered |
| 6 | 破坏性命令六条规则 + 白名单 + `destructive-approved:` | 单测镜像主线 gate_trust 11 例（blocked 9 / allowed 8）+ `$HOME`/`$PWD` 排除钉 + 钩子层 2 项；真仓 `rm -rf $HOME/.config → DENY`、`rm -rf node_modules → allow` | tests/w19-verify.log §C5-C10 · w19_guards.test.js | covered |
| 7 | `.vibeweaver/project.json` 第二激活标记 + 一次性 GATE-INACTIVE（不阻断） | 单测 2 项（标记命中根 / 有标记无日志仅 warning 且第二次不重复） | w19_guards.test.js | covered |
| 8 | DOC 类降级守卫 | 单测 3 项（纯函数矩阵）+ 钩子层 `deny{reason}` 1 项 | w19_guards.test.js | covered |
| 9 | 符号链接安全路径（自身链接/悬空链接/祖先链 realpath） | 单测 `resolveWritePath…` 四例（含 `tests -> real_tests` 归一为 `real_tests/a.md`） | w19_guards.test.js | covered |
| 10 | `gateMode: warn` 真实生效 + `VIBEWEAVER_PYTHON`/超时覆盖 | 单测 3 项（warn 不 deny 且回传 warn / off 全放行 / env 覆盖）+ 钩子层 warn 档 1 项 + 卡面 warn 改口断言；真仓 warn 档破坏性命令 → allow | tests/w19-verify.log §C5-C10 · w19_guards.test.js | covered |
| 11 | 每项机制有单测钉（RED 先行）+ 全量绿 + 构建镜像一致 | `tests/w19-red-unit.log`（首跑 SyntaxError：新导出不存在 = RED）→ 全量 **121/121**（含迭代 5 的 12 项回归钉 + 2 项 apply() 接线级测试）；`bash script/linux/project_build.sh` exit 0 且 `lib/{index,lib,baseline}.js` 与 src 逐字节 cmp OK | tests/w19-red-unit.log · tests/w19-unit.log · tests/w19-verify.log §C11 | covered |
| 12 | README zh/en port note + memory 主题/索引 + `--existing --final` exit 0 | README.md/README_en.md 各含 2026-10-26 段与机制表两行；memory 新主题 + known_gaps 改记 + MEMORY.md 索引；`--final` 在 working_note 蒸馏删除后复跑 | tests/w19-verify.log §C12 · 收官 final-run 行 | covered（final-run 见 verification_log 收官行） |

**补充（超出判据但本波实际闭合的面，R1/R2/R3 三轮评审落点）**：受保护证据门（`protectedEvidenceCheck`/`protectedDeleteBlock`：直写锁拒绝、锁缺失+证据已在=篡改拒绝、复合段与前导空白不可绕过、dd/cp/重定向同面、单条批准不外溢）· 正源检查器接管且**无 pin 绝不接管**（重言式已消除）· `--root` 能力探测（正源版本偏差不把门禁判红）· 工具/命令面按 dsh 真实注册名（write/edit/str_replace_editor/… 与 bash/pwsh），只读面逐名列出、无通配免检牌 · 后置门禁与前置守卫同源判定 · 基础设施故障（python 缺失/超时）与证据伪造分离 · `pin 缺失` 提示一次性 · 契约卡 warn 档改口经 apply() 渲染验证 · `tests/project_profile.json` 声明 · package.json `files` 补齐 + 捆绑 evidence_seal.py。
**未覆盖/未做（不洗地）**：宽松旗标前置条件与 `gate_result.json`（ADR D-5 排除）· 内容指纹缓存 · 压缩期工作笔记投递 · cue 加固 · audit Tier-0/1/2 · 与主线同构的绕过天花板（详见 memory/known_gaps_upstream.md 残留表）。
