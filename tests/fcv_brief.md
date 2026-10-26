# FCV brief — vibeweaver-dsh 主线 w19.0 同步波

项目根：/Users/logan/Documents/DEV/SKILLS/vibeweaver-dsh
（配套阅读：`tests/acceptance.md` 是本简报判据的原文；`src/lib.js` 含 NUL/SOH 哨兵字节，
 用 `tr -d '\000\001' < src/lib.js | sed -n 'X,Yp'` 或 python 读取。）

## 待验证判据（原文照抄自 tests/acceptance.md）

Task: 把主线 `51608ea^..dca13ef`（w0/w1 信任底座 + w19.0）的契约与机械执行增量移植到 dsh 派生副本：assert canonical 快进、捆绑脚本字节同步、契约卡补 COV-0/§A7.7.1、门禁补 checker pin / 风险路径 / 破坏性命令 / 激活标记 / DOC 类守卫 / 符号链接安全路径 / warn 档。
范围裁定见 tests/decisions.md D-5（evidence-lock 写保护、内容指纹缓存、工作笔记投递、cue 加固、audit 插件不入本波）；捆绑 evidence_lock.py 见 D-6，checker pin 正源解析见 D-7。

1. `tests/assert_artifacts.py` 与主线 `scripts/assert_artifacts.py`（HEAD dca13ef）**逐字节一致**（含组 22 evidence-lock、`--root`、`--self-check`），且 dsh 五项 fixed-local 语义在盘可指认；`python3 tests/assert_artifacts.py --existing` exit 0。
2. `scripts/mm_probe.py`、`scripts/ui_fidelity.py`、`scripts/backlog_check.py` 与主线同名文件 **sha256 相同**（C3d 抗暴力哈希 + C3e 执行证明判据落地）。
3. 契约卡含 `COV-0`（交付契约：工件落盘 tests/，最终回答只给结果+证据摘要）与 `A7.7.1`（无人值守降级：awaiting decision，不以提问收尾）两条新行，COV-9 行含「基线三行默认写 verification_log」措辞，检查器组计数为 `组1-22`；四配置（默认/合成/probeScript 展开）字节全部 <8000。
4. checker pin：`checkGate` 比对项目 `tests/assert_artifacts.py` 的 sha256 与正源 `scripts/assert_artifacts.sha256`——不符 → blocking（`VIBEWEAVER_ALLOW_CUSTOM_CHECKER=1` 可豁免，CI 下豁免失效）；pin 缺失 → 一次性 WARN 不阻断。
5. 风险路径 pre-write 拦：write/edit 或 `rm`/`git rm` 命中 `auth|security|payment|billing|crypto|migration|permission|acl` 且 `tests/decisions.md` 无配对 `risk-approved:` 行 → `tools/pre-execute` 返回 deny；`VIBEWEAVER_RISK_GATE=off` 或批准行在场 → 放行。
6. 破坏性命令守卫：bash 命中 `git add -A`/`--all`、`git reset --hard`、`git clean -[a-z]*[fd]`、`git checkout|restore -- .`、`truncate`、`rm -<r> <非白名单>` 六条规则 → deny；`node_modules`/`dist`/`$VAR`/`/tmp` 白名单目标与 `rm -f`（无 r 旗标）放行；`- destructive-approved:` ADR 行放行。
7. 门禁激活：`findProjectRoot` 认 `.vibeweaver/project.json` 为第二激活标记；有标记但无 `tests/verification_log.md` → 返回一次性 `GATE-INACTIVE` 警告（blocking 为空，绝不静默拦截）。
8. DOC 类降级守卫：当前任务块声明 `- class: DOC` 且写入命中源码扩展名 → deny（提示先升类）；`- class: CODE` 或无声明 → 放行。
9. 符号链接安全路径：`resolveWritePath` 解析目标自身符号链接、悬空链接（lstat+readlink 递归 ≤8）与最近存在祖先 realpath；`tests/evil -> ../src/app.py` 形态不再被当作 `tests/` 内写入（单测实证）。
10. `gateMode: "warn"` 真实生效：证据门禁与风险/破坏性守卫在 warn 档一律不阻断，改为写后 `GATE-WARNING` 提示；`block` 档维持 deny。`VIBEWEAVER_PYTHON` / `VIBEWEAVER_ASSERT_TIMEOUT_MS` 可覆盖解释器与超时。
11. 上述每项机制有单测钉（先 RED 后 GREEN），`node --test tests/unit/*.test.js` 全绿；`bash script/linux/project_build.sh` exit 0 且 `lib/*.js` 与 `src/*.js` 逐字节一致。
12. `README.md` + `README_en.md` 有本波 port note（含未移植项清单），`memory/` 主题文件 + 索引更新，`python3 tests/assert_artifacts.py --existing --final` exit 0。

## 需要重放的命令（逐条跑，记录实际输出）

```bash
cd /Users/logan/Documents/DEV/SKILLS/vibeweaver-dsh
bash script/linux/project_build.sh; echo "exit=$?"
for f in index lib baseline; do cmp -s lib/$f.js src/$f.js && echo "mirror OK $f" || echo "MIRROR DIFF $f"; done
node --test tests/unit/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"
python3 tests/assert_artifacts.py --existing; echo "exit=$?"
python3 tests/assert_artifacts.py --existing --final; echo "exit=$?"
shasum -a 256 tests/assert_artifacts.py ../vibeweaver/scripts/assert_artifacts.py
for f in mm_probe.py ui_fidelity.py backlog_check.py evidence_lock.py evidence_seal.py; do shasum -a 256 scripts/$f ../vibeweaver/scripts/$f; done
bash tests/w19_verify.sh
node tests/w19_poc.mjs
git diff --stat f9c2c03..HEAD
grep -n "2026-10-26" README.md README_en.md | head
ls -1 docs/PLAN_w19_port_20261026.md memory/project_mainline_w19_port_20261026.md tests/coverage_matrix.md
test -f tests/working_note.md && echo "working_note 仍在" || echo "working_note 已删"
```

## 本波改动的文件清单（git diff --stat f9c2c03..HEAD）

```
 .gitignore                     |   4 +
 README.md                      |  19 +-
 README_en.md                   |  25 +-
 docs/PLAN_w19_port_20261026.md |  48 +++
 lib/index.js                   |  78 ++++-
 lib/lib.js                     | 533 ++++++++++++++++++++++++++++--
 package.json                   |   6 +-
 scripts/backlog_check.py       |  18 +-
 scripts/evidence_lock.py       | 399 +++++++++++++++++++++++
 scripts/evidence_seal.py       | 270 +++++++++++++++
 scripts/mm_probe.py            | 120 ++++---
 scripts/ui_fidelity.py         |   4 +-
 src/index.js                   |  78 ++++-
 src/lib.js                     | 533 ++++++++++++++++++++++++++++--
 tests/assert_artifacts.py      | 139 +++++++-
 tests/coverage_matrix.md       |  26 +-
 tests/project_profile.json     |   8 +
 tests/unit/lib.test.js         |   7 +-
 tests/unit/w19_guards.test.js  | 723 +++++++++++++++++++++++++++++++++++++++++
 tests/w19_poc.mjs              |  24 ++
 tests/w19_verify.sh            |  67 ++++
 21 files changed, 2958 insertions(+), 171 deletions(-)
```

## 给验证者的要求

1. 逐条重放上面的命令，**不要修改任何文件**（只读；临时文件请只写在 /private/var/folders/8z/h73xmj297g1995r1d9q6dc2r0000gn/T/opencode 下）。
2. 对 12 条判据逐条给出 pass / fail / uncertain，并附你**实际看到**的输出片段作为证据（不要转述预期）。
3. 任何"判据声称 X，实测看到 Y"的不一致都要单独列出，即使你认为它无关紧要。
4. 额外回答三个事实核对：(a) `lib/*.js` 与 `src/*.js` 是否逐字节一致；(b) 契约卡在 4 组配置 × 3 档（block/warn/off）下最大字节数是否 <8000；(c) `tests/assert_artifacts.py` 与主线 `../vibeweaver/scripts/assert_artifacts.py` 摘要是否相同。
