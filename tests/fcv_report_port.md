# FCV Report — dsh 主线 uif 移植（vibeweaver-dsh）

- Fresh agent: `ses_ec6570b1effeoEdt7jj001MXv9`（fresh context；仅读 `tests/fcv_brief_port.md`）
- Date: 2026-10-14 · Result: **全过 — mismatches: none**（简报内全部命令执行）

| # | Criterion | Verdict | Observed（fresh 复跑节选） |
|---|---|---|---|
| 1 | 契约卡 §A4.1.2 + 字节帽 | PASS | synthetic 7895 / no-cfg 7945 / expanded 7967（全 <8000）；`A4.1.2` 在 src/lib 各 1；条款文本完整（「先测量后判定——几何/尺寸/遮挡只由仪器认证（ui_fidelity.py diff/boxes；图像参考 refboxes；比较能力 mm_probe --compare-*），VLM 永不认证几何」） |
| 2 | 脚本逐字节 + selftest + package | PASS | `mmdiff=0` · `uidiff=0`（静默）；两脚本 `--selftest` exit 0（28 字库 / 26 checks）；`ui_fidelity in files: True` |
| 3 | build + 单测 | PASS | `build=0`；`tests 69 / pass 69 / fail 0`；`diff -q src/lib.js lib/lib.js` 静默 |
| 4 | assert --existing/--final + RED/基线在盘 | PASS | `--existing` 32/32 exit 0；`--final --existing` 33/33 exit 0；`tests/port-red-unit.log`（66/68 预期红）；`tests/port-baseline-*.log`（基线 assert 2 失败留档） |
| 5 | 文档/记忆/ADR/推送态 | PASS | README zh/en port notes（7895/7945/7967B、66→69）；memory 主题 + MEMORY.md:13 索引；ADR D-4（decisions.md:8）；`main...origin/main [ahead 2]`——推送于本报告后收尾（按简报为预期态） |

观察（非缺陷）：卡内无字面 "comparative"——中文以「比较能力 mm_probe --compare-*」表述，属措辞选择。
