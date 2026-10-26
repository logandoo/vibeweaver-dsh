# FCV brief — 波次 A（dsh 0.2.1-rc.3 兼容性）| 最终树 `db66902`

## 要验什么（判据正源：`tests/acceptance.md`「波次 A」块，12 条）

被验对象是 vibeweaver-dsh 插件（dsh / DeepSeek Harness 的 Cordis 插件 bundle）的波次 A 改动，
区间 `4107240..db66902`，计划正源 `docs/FIXES_20261026_dsh_compat_and_context.md` 波次 A。

## 已声称的结论（逐条试图证伪，不要复述）

1. **A1**：三处注入的 `source.kind` 恒为 `dsh-vibeweaver`，且消息带 `id` + `role:"user"`，
   能被 0.2.x 的**加载期**校验接受（`adoptSessionEvent`）与 v4 种类闸（`assertV4RowAdmission`）。
2. **A2**：有效工作目录走 `ctx.inject(["workingDirectory"], cb)` 订阅到的服务 `get(session)`，
   服务缺席/抛错回退 `header.cwd`；根锚候选始终含不可变 `header.cwd`。
3. **A3**：`engines.dsh: ">=0.1.0-rc.6"` 真被 dsh 兼容闸读取（不满足 → bundle 被 skip）。
4. **A4**：`run_code{code}` / `terminal_send{text}` / `working_directory{cd}` 三类参数形态进入守卫；
   `lsp` 归只读；无前缀通配。
5. **A5/A6**：`compaction/end` 带 `error` 不投重建卡；契约段 `interpolate:false`；卡 12 组合 <8000B。
6. 全套测试绿：`node --test tests/unit/*.test.js` 150/150；`node tests/w19_poc.mjs` 26 例；
   `python3 tests/assert_artifacts.py --existing` exit 0；`bash script/linux/project_build.sh` exit 0 且 lib==src。

## 必须自己重跑的命令（不要引用日志文件代替执行）

```
cd /Users/logan/Documents/DEV/SKILLS/vibeweaver-dsh
node --test tests/unit/*.test.js
node tests/w19_poc.mjs
node tests/v3_compat_probe.mjs /private/var/folders/8z/h73xmj297g1995r1d9q6dc2r0000gn/T/opencode/dshv3/node_modules
node tests/v3_compat_probe.mjs /private/var/folders/8z/h73xmj297g1995r1d9q6dc2r0000gn/T/opencode/dshv4/node_modules
python3 tests/assert_artifacts.py --existing
bash script/linux/project_build.sh && for f in index.js lib.js baseline.js; do cmp -s src/$f lib/$f; echo "$f=$?"; done
```

## 本波踩过的坑 —— 请专门朝这些方向查（它们曾让"全绿"与"运行时必坏"共存）

- **认证工件自造输入**：`tests/v3_compat_probe.mjs` 上一版自己伪造了 `id/role` 的行信封，
  于是探针 PASS 而插件注入的消息在真内核上让会话损坏。请确认它喂的是 `src/index.js`
  真实发出的那个对象（`injectedUserMessage`），且负对照抛点确实在被验的那个检查上。
- **桩照想象建模**：`tests/unit/index.test.js` 的 `cwdProbeCtx` 现在实现 `ctx.inject(deps, cb)`。
  请对照真 cordis（`/private/var/folders/.../dshv3/node_modules/@deepseek-ai/cordis/lib/index.js`
  的 `inject(inject, callback)` → `this.plugin({inject, apply: callback})`）判断桩语义是否成立；
  若桩比真系统更宽松，测试就是自证。
- **变异复测**：在 `/private/var/folders/8z/h73xmj297g1995r1d9q6dc2r0000gn/T/opencode/` 下开副本
  （`rsync -a --exclude .git` 本仓），故意破坏每个修复，确认至少一条测试失败：
  ① `injectedUserMessage` 去掉 id/role ② `effectiveCwd` 退回 `header.cwd`
  ③ `codePathMutations` 的 DST2 组清空 ④ `stringMask` 停用 ⑤ `fallbackCwd` 从根锚里去掉
  ⑥ 命令面后置分支移回 `disabledSessions` 之前。**仓库本体不得改动。**
- **真内核验证**（可选但价值最高）：本机 profile `vibe-arm-b` 以 `file:` 直挂本仓，
  `VIBEWEAVER_DEBUG=1 DEEPSEEK_API_KEY=sk-x npm exec --yes --package=@deepseek-ai/dsh@0.2.1-rc.3 -- dsh --profile vibe-arm-b "hi"`
  应看到 `workingDirectory resolved=true`（rc.6 上应无此行且不报错）。

## 输出要求

写 `tests/fcv_report_wave_a.md`（只新建这一个文件），包含：
① 每条判据 verdict + 你实际跑的命令与关键输出行；② 变异复测表（破坏点 → 是否有测试失败）；
③ 与你预期不符之处；④ 结论：pass / pass-with-notes / fail（fail 要给出可复现命令）。
不要改 `tests/acceptance.md`、`tests/verification_log.md`、`src/`、`lib/`。
