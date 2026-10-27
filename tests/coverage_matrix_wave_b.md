# Coverage matrix — 波次 A 收尾（真机 E2E + 遗留项）与波次 B | 2026-10-27

判据正源：`tests/acceptance.md`「波次 A 收尾…与波次 B」块（13 条）。

| # | Criterion | Check (test / command) | Evidence file | Status |
| --- | --- | --- | --- | --- |
| 1 | 本机 dsh = 0.2.1-rc.4；四个 profile 均 compose，vibe-arm-b 含本插件 | 农场重指向脚本（356 条改指向 + 261 条补齐）+ 逐 profile `--dump-config` | tests/dsh-profiles-check.log · tests/dsh-farm-repoint-manifest.log | covered |
| 2 | 真实会话注入 1 条消息，带 id/role/自有 kind | 真 dsh 0.2.1-rc.4 跑编码任务 → 解压会话 → 断言（`tests/e2e_session_check.mjs`） | tests/dsh-e2e.log · tests/dsh-smoke-real.log | covered |
| 3 | `--session-id` 重载无 corrupt，失败只允许在鉴权层 | 真二进制重载 + 分类（无 corruption 词且有 AUTH 行 → 装载成功） | tests/dsh-smoke-real.log (3/5) | covered |
| 4 | 真机负对照两条 | 改写会话副本：旧 kind → `producer-owned source kind`；去 id/role → `lacks an identified message` | tests/dsh-e2e.log | covered |
| 5 | 冒烟 (3) 两条断言 PASS；无凭据如实 SKIP | `DSH_SMOKE_FAKE_KEY=1` 显式开关 + `DSH_BIN_OVERRIDE`；SKIP 分支原被 `set -e` 吞掉（评审实证），已改 `|| E2E_RC=$?` 并单跑空会话根验证 | tests/dsh-smoke-real.log · tests/dsh-smoke-skip.log | covered（两条路径都实测过） |
| 6 | engines 上限 + 真机 skip + 冒烟下限解析 | 临时 `<0.2.0` → `skipping profile bundle … incompatible with dsh 0.2.1-rc.4`；恢复后加载；`${FLOOR%% *}` | tests/dsh-b-engines-ceiling.log · tests/dsh-profiles-check.log | covered |
| 7 | 四类守卫盲区收口且各有 RED 钉 | 新钉在改动前源码（b4e3073）上 4/4 失败，改动后全绿 | tests/dsh-b-unit-1.log · red_carryover 运行记录（见 verification_log iter 5） | covered |
| 8 | B1 压缩投笔记原文（**≤4KB 字节**，非字符），无笔记回退指令 | 单测 5 条（ASCII/中文/emoji 三组按 `Buffer.byteLength` 断言 + 30MB 只读头部）+ 钩子层 1 条 | tests/unit/context.test.js · tests/unit/index.test.js | covered |
| 9 | B2 笔记被删仍投快照；**换任务后旧快照失效**；`.vibeweaver` 符号链接不写不读 | 单测（写→快照→删源→bundle 仍含正文；验收判据变更→快照作废；.vibeweaver 指向项目外→不写不读）+ 钩子层（compaction 两次投递） | 同上 | covered |
| 10 | B3 首次写入投指针、第二次不投、遥测可查 | 钩子层钉（两次写入 + 读 `.vibeweaver/state.json`）+ 遥测累加钉（不覆盖 ops） | tests/unit/index.test.js · tests/unit/context.test.js | covered |
| 11 | B4 子代理会话不投激活卡 | 单测（origin=subagent 不投；parentSession-only 仍投；无 header 不投）+ 钩子层 | 同上 | covered |
| 12 | B5 卡面补 §V9/§V12 且 12 组合 <8000B | 词面钉 + 四配置 × 三档实测 7789-7940B | tests/unit/context.test.js · tests/unit/w19_guards.test.js | covered |
| 13 | 全套绿 | unit 176/176 · poc 26 例 · 两探针（rc.4）· build 0 且 lib==src · `assert --existing --final` | tests/dsh-b-*.log · tests/dsh-final-*.log | 收官跑（见 verification_log） |

## 独立评审修复（3 Important + 5 Minor）

| 评审发现 | 修复 |
| --- | --- |
| B1 的 4KB 是**字符**切片：中文笔记 8769B、快照 12.3KB（判据 #8 对中文不成立） | 新增 `capUtf8()`（二分到 UTF-8 字节上限）；快照同样按字节；读取加 1MB 上限 |
| B2 快照没有任务身份：上一任务的"下一动作"会被当作"权威"投给新任务 | 快照记录 `acceptance.md` 指纹；验收判据变了即作废 |
| 冒烟 (3) 的 SKIP/FAIL 分支是死代码（`set -e` + 命令替换透传退出码） | `E2E_RC=0; E2E_OUT="$(...)" || E2E_RC=$?`；空会话根单跑验证 |
| `.vibeweaver` 符号链接可把快照写到/读到项目外 | 读写两侧都过 `relativeUnderRoot(resolveWritePath(...))` |
| 续行按"换空格"处理，而 shell 是**删除**（`rm -<NL>rf` 仍可执行） | 归一化为空串；补钉 |
| `os.posix_spawn` / `os.spawnv(mode,prog,argv)` 漏网 | 数组前允许任意前缀参数；补钉 |
| 并发会话共用同名 `.tmp` → `rename` ENOENT 丢遥测（8 进程 800 次只剩 12） | 临时文件加 `process.pid` |
| §V12 丢了"cap-stall 须带 ❌ 记忆"、§V9 丢了"关键仪式不延后" | 卡面恢复两条子条件（仍 7817-7968B），补词面钉 |

## FCV（全新上下文，判 fail → 修复后复验）

| FCV 发现 | 修复 |
| --- | --- |
| `--final` 因工作笔记未删而 exit 1（收尾顺序问题，非代码缺陷） | 蒸馏入 memory 后删除，再跑 `--final` |
| 无凭据时 dsh 仍会建会话并注入 → "如实 SKIP"的说法不成立 | 结论按实测改写：占位 key 路径与空会话根 SKIP 路径**分别**实测；默认路径取决于本机是否配了 provider 凭据 |
| 注入检查器可被"旧会话合规"满足（假 PASS） | 只验**本轮最新**会话；改坏的副本必须 FAIL（已反向验证） |
| B3 在 warn 档 + 红门禁下不投指针 | `takeCue()` 在每条投递路径上调用（含 warn 降级分支） |
| 手搓/无指纹快照被信任 | 快照指纹 **fail-closed** |
| 无笔记分支仍是字符切片（中文 12KB） | 同用 `capUtf8` |
| `engines` 上限无测试钉（删除后 171/171 仍绿） | 新增 package.json 断言；变异复测已红 |
| 子代理的压缩边界仍投 bundle | compaction 加 `isChildSession` 早退 + 钉 |

## 诚实口径

- 判据 #2/#3 的"注入"发生在模型调用**之前**，所以用占位 key 即可验证持久化；**没有**真实模型回合参与，因此"模型读到注入内容后行为是否改变"不在本波证据内（属 A/B 评测范围）。
- `web` profile 只验证了 compose（未跑真实 web 会话）；live2d/maid 依赖未动。
- 农场重指向保留了 238 条"新运行时里不存在"的旧链接（如 `dsh-code-runtime`、`dsh-client-web`），它们仍指向旧缓存；这些包已不在 0.2.1-rc.4 的依赖图里，四个 profile 实测 compose 正常。
