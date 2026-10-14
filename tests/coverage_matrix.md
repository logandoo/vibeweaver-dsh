# Coverage Matrix — dsh 主线 uif 移植（Lane L，§V7）

| # | Criterion | Check (test/command) | Evidence file | Status |
|---|---|---|---|---|
| 1 | 契约卡 §A4.1.2 条款 + 字节帽（四配置 <8000） | node 量四配置 7895/7945/7967 · 单测双配置帽 pin | tests/port-fix-unit.log · tests/port-closure-unit.log · node 实测（本波 log） | covered |
| 2 | 脚本逐字节 = 主线 + selftest + package files | `diff -q` 双静默 · 两 `--selftest` · package.json 断言 | tests/port-fix-unit.log · tests/fcv_report_port.md | covered |
| 3 | build/单测（lib==src · 69/69） | `project_build.sh` · `node --test` · 镜像 pin | tests/port-closure-unit.log · tests/port-fix2-unit.log | covered |
| 4 | assert --existing/--final + RED/基线在盘 | 32/32 · 33/33 exit 0 | tests/port-fix2-assert.log · port-closure-final.log · port-red-unit.log · port-baseline-*.log | covered |
| 5 | 评审（dual+scoped）+ FCV + 文档/记忆/ADR + push | verdict 在盘 · fcv_report_port · `git ls-remote` == HEAD | tests/review/review_package_uif*.md · tests/fcv_report_port.md · README.md/README_en.md · memory/project_mainline_uif_port_20261014.md · tests/decisions.md | covered |
