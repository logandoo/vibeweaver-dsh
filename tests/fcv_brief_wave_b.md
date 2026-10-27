# FCV brief — 波次 A 收尾 + 波次 B | 最终树（commit 见下）

## 要验什么（判据正源：`tests/acceptance.md`「波次 A 收尾…与波次 B」块，13 条）

本轮四段：① 本机 dsh 升到 0.2.1-rc.4；② 真会话 E2E 闭合判据 #7；③ 遗留项（engines 上限 + 四类守卫盲区）；④ 波次 B（B1-B5 上下文管理）。

## 已声称的结论（逐条试图证伪）

1. 本机 dsh = 0.2.1-rc.4；headless / vibe-arm-a / vibe-arm-b / web 四个 profile 都能 compose。
2. 真会话：编码任务下插件注入 1 条 `{id, role:"user", source:{kind:"dsh-vibeweaver"}}`；`--session-id` 重载 0 处 corrupt。
3. 真机负对照两条：旧 `kind:"plugin"` → `producer-owned source kind`；去 id/role → `lacks an identified message`。
4. 冒烟 (3) 两条断言 PASS，且无凭据时如实 SKIP（`DSH_SMOKE_FAKE_KEY=1` 才用占位 key）。
5. `engines.dsh: ">=0.1.0-rc.6 <0.3.0"`；真机不满足时 bundle 被 skip。
6. 四类守卫盲区（/bin/rm、反斜杠续行、rimraf.sync、os.exec* argv）各有 RED 钉。
7. B1-B5 行为与单测一致；卡 12 组合 7789-7940B。

## 必须自己重跑

```
cd /Users/logan/Documents/DEV/SKILLS/vibeweaver-dsh
node --test tests/unit/*.test.js
node tests/w19_poc.mjs
node tests/v3_compat_probe.mjs /private/var/folders/8z/h73xmj297g1995r1d9q6dc2r0000gn/T/opencode/dshv4/node_modules
node tests/real_cordis_probe.mjs /private/var/folders/8z/h73xmj297g1995r1d9q6dc2r0000gn/T/opencode/dshv4/node_modules
python3 tests/assert_artifacts.py --existing --final
bash script/linux/project_build.sh && for f in index.js lib.js baseline.js; do cmp -s src/$f lib/$f || echo DIFF $f; done
DSH_SMOKE_FAKE_KEY=1 DSH_BIN_OVERRIDE=$HOME/.dsh/runtime/0.2.1-rc.4/node_modules/.bin/dsh DSH_SMOKE_VERSIONS=0.2.1-rc.4 bash script/linux/smoke.sh
```

## 专查方向（本波已出现过"看着绿其实坏"的三类）

- **占位 key 的 E2E 是否真的证明了"会话装载成功"**：`AUTH:` 行只能说明走到了模型调用；请构造反例——把真会话的注入行改成旧形状/去掉 id，走同一套判定逻辑，看会不会也被判 PASS（若是，则判定逻辑无效）。
- **B3 的"首次"语义**：被门禁拦下的首写不应消费标记（已修并有钉，自己再破坏一次确认能红）；会话 id 变化、cd 到别的 root、`/vibe off` 会不会重复投/漏投。
- **B2 快照**：把 `tests/working_note.md` 做成符号链接指向项目外的文件、或塞入超大/二进制内容，看 4KB 上限与快照落点是否仍成立，会不会把项目外内容带进模型上下文。
- **卡面字节**：用 `tests/unit/w19_guards.test.js` 里那条最坏配置（长路径 + probeScript）实测，别用短路径自欺。
- **变异复测**：至少破坏 ①B1 的截断 ②B2 的快照回退 ③B3 的 firstTouch 标记 ④B4 的 origin 判定 ⑤engines 上限，确认各有测试变红。

## 输出

写 `tests/fcv_report_wave_b.md`（只新建这一个文件），含：逐判据 verdict + 实际命令与关键输出；变异表；与预期不符处；结论 pass / pass-with-notes / fail。
不要改 `src/`、`lib/`、`tests/acceptance.md`、`tests/verification_log.md`。
