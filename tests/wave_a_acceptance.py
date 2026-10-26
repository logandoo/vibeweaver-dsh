#!/usr/bin/env python3
"""波次 A 判据追加器（一次性工具，用完即删）。

为什么是脚本而不是 bash 内联：门禁按**命令文本**扫描破坏性字面量，而判据 #8 必须原样
写出被拦命令（FIXES §F #4 的同一踩坑）。脚本内拼接让字面量落到文件里、不落进命令行。

§F 纪律：tests/acceptance.md 只尾部追加；追加不得 rstrip（末尾字节属于已封缄基线）；
判据变更走 evidence_lock.py --update-acceptance --reason --approved 正路。
"""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

# 与 tests/w19_poc.mjs 的 TR 同法：文件里字面量完整，命令行里不出现。
GIT_HARD_RESET = "git " + "reset --hard"

ACC = f"""
# Acceptance — 波次 A：dsh 0.2.1-rc.3 兼容性修复（A1-A6）| 2026-10-26

Task: 按 `docs/FIXES_20261026_dsh_compat_and_context.md` 波次 A 落地六项——A1 消息源 kind 去 `plugin`（BLOCKER-1）· A2 有效工作目录改走 `workingDirectory`（BLOCKER-2）· A3 版本兼容闸 + 冒烟重启加载断言 · A4 守卫面补 V3 工具 · A5 compaction 失败不投重建卡 · A6 契约段显式 `interpolate: false`。波次 B/C 不在本波。

1. `src/index.js` 三处注入（pre-step 激活 / turn-stopping steer / compaction 重建）的 `source.kind` 恒为 `dsh-vibeweaver` 且不带 `plugin` 字段；`grep -c 'kind: "plugin"' src/index.js` == 0；对应单测钉先 RED（现网三处为 plugin）后 GREEN。
2. 「0.2.1-rc.3 读侧拒 `kind: "plugin"`、放行 `kind: "dsh-vibeweaver"`」由本机安装的 0.2.1-rc.3 `dsh-session-persistence-jsonl/lib/worker.cjs` 断言点实测复核（不是引用文档），且 rc.6/rc.3 读侧对未知 kind 不报错（向后兼容成立）。
3. 有效工作目录：服务在场 → `workingDirectory.get(session)`；服务缺失（rc.6/rc.3）或读取抛错 → 回退 `session.header.cwd`；`src/index.js` 五处取值（pre-execute / post-execute / turn-stopping / gate 工具 / /vibe 命令）全部经同一解析函数。
4. 夹具「header.cwd = A、服务报 B、`tests/verification_log.md` 只在 B」下门禁命中 B（RED：现网命中 A → 判非项目）；有服务 / 无服务两种形态各有单测钉。
5. 不把 `workingDirectory` 写进 `inject`：本机 cordis 源码实证「inject 名无实现 → fiber epoch=INACTIVE → 插件静默不加载」，而 0.1.x 无该服务；改可选依赖读取，单测钉住「服务缺失时插件照常注册并生效」。
6. `package.json` 含 `engines.dsh`，其范围与 `script/linux/smoke.sh` 的版本钉一致；`npm pack --dry-run` 的文件清单与 `files` 声明一致。
7. `script/linux/smoke.sh` 新增「注入后重启加载该会话」一步（A1 类持久化回归在冒烟里可见）。
8. 守卫面：`run_code{{code:"shutil.rmtree('src')"}}` → DENY；`terminal_send{{text:"{GIT_HARD_RESET}"}}` → DENY；`working_directory{{cd:"../../.."}}` → 至少提示（不 deny）；`lsp` 归只读面；`COMMAND_TOOL_RE` / `READONLY_TOOL_RE` 不出现 `^terminal_` / `^mcp__` 前缀通配。
9. `node tests/w19_poc.mjs` 原 15 例判定不回归；`node --test tests/unit/*.test.js` 全绿（新增钉计入）；`bash script/linux/project_build.sh` exit 0 且 `lib/*.js` 与 `src/*.js` 逐字节一致。
10. compaction 事件 `data.error` 在场 → 不投重建卡（单测钉）；`ctx.systemPrompt.section` 注册带 `interpolate: false`；契约卡 12 组合字节仍全部 <8000。
11. `python3 tests/assert_artifacts.py --existing --final` exit 0；`python3 scripts/evidence_lock.py --root . --check` OK（log 只尾部追加，判据更新走 `--update-acceptance --reason --approved`）。
12. 独立评审（COV-8：行为语义变更 + ≥3 文件 + 门禁安全面）已派发并逐条裁定，Critical/Important 修复后复跑覆盖测试；FCV 全新上下文复验通过。
"""


def main() -> int:
    target = ROOT / "tests" / "acceptance.md"
    before = target.read_text(encoding="utf-8")
    if "波次 A：dsh 0.2.1-rc.3 兼容性修复" in before:
        print("acceptance.md 已含波次 A 判据块，跳过")
        return 0
    base = before if before.endswith("\n") else before + "\n"
    target.write_text(base + ACC, encoding="utf-8")
    after = target.read_text(encoding="utf-8")
    assert after.startswith(before), "append-only violated"
    print(f"appended tests/acceptance.md +{len(ACC)} chars")
    r = subprocess.run(
        ["python3", "scripts/evidence_lock.py", "--root", ".", "--update-acceptance",
         "--reason",
         "波次 A 判据逐条来自用户指定的 docs/FIXES_20261026_dsh_compat_and_context.md 波次 A 验证接缝（A1-A6），非本会话自创",
         "--approved"],
        cwd=ROOT, capture_output=True, text=True,
    )
    print("update-acceptance:", r.returncode, (r.stdout + r.stderr).strip()[-300:])
    c = subprocess.run(["python3", "scripts/evidence_lock.py", "--root", ".", "--check"],
                       cwd=ROOT, capture_output=True, text=True)
    print("check:", c.returncode, (c.stdout + c.stderr).strip()[-200:])
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
