#!/usr/bin/env python3
"""bench 评分脚本 — 解析 headless 会话 JSONL 与工作区产物, 输出评分 CSV + report.md
指标: ① assert 证据组 ② gate token ③ token 用量 ④ 墙钟 ⑤ 任务 checker"""
import json
import os
import re
import sys
try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib
from pathlib import Path

CLAIM_RE = re.compile(r"HARD-GATE-1: NO-TEST-NO-DONE|HARD-GATE-2: SCRIPT-ONLY|\[Verification Gate\]|\[Convergence\]|cap=5\s+stall=3")
TABLE_RE = re.compile(r"\| # \| Problem \| Research Sources")
ITER_RE = re.compile(r"- iter \d+ (PASS|FAIL):")

def load_config(path):
    with open(path, "rb") as f:
        return tomllib.load(f)

def find_session_dir(session_root, workspace_abs):
    """dsh 将工作区编码为会话目录名: 路径 / 替换为 -，两端包 --（如 --private-tmp-vwbench-t01--）
    精确匹配后缀避免跨 rep 污染（I3）；/tmp 在 macOS 是 /private/tmp 符号链接 → 两种编码都试"""
    variants = {str(Path(workspace_abs).resolve()), str(Path(workspace_abs))}
    root = Path(session_root)
    if not root.exists():
        return None
    best = None
    for v in variants:
        enc = "--" + v.lstrip("/").replace("/", "-") + "--"
        candidates = [d for d in root.iterdir() if d.is_dir() and d.name == enc]
        if candidates:
            best = max(candidates, key=lambda d: d.stat().st_mtime)
    return best

def session_events(session_dir, newest_only=True):
    """合并会话目录下事件。主会话目录以 session- 前缀命名（子代理会话为 uuid 目录, I3/M7）"""
    events = []
    if not session_dir:
        return events
    if newest_only:
        subs = [d for d in session_dir.iterdir() if d.is_dir()]
        main = [d for d in subs if d.name.startswith("session-")]
        if main:
            session_dir = max(main, key=lambda d: d.stat().st_mtime)
        elif subs:
            session_dir = max(subs, key=lambda d: d.stat().st_mtime)
    for f in sorted(session_dir.glob("*.jsonl")):
        if f.suffix != ".jsonl":
            continue
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    # zstd 压缩会话支持
    for f in sorted(session_dir.glob("*.jsonl.zstd")):
        import subprocess
        try:
            raw = subprocess.run(["zstd", "-d", "-c", str(f)], capture_output=True, timeout=30)
            for line in raw.stdout.decode("utf-8", errors="replace").splitlines():
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        except Exception:
            continue
    return events

def extract_metrics(events):
    """从会话事件提取: 全部助手文本、token 用量、回合数
    rc.6 事件: assistant/message.data.usage = {inputTokens, outputTokens, cacheReadTokens, reasoningTokens}
    text 分散在 assistant/chunk.text-delta 与 text-chunks.data.texts（含推理与最终文本）"""
    text_parts = []
    usage = {"prompt_tokens": 0, "completion_tokens": 0}
    turns = 0
    for ev in events:
        t = ev.get("type")
        data = ev.get("data", {})
        if t == "assistant/message":
            turns += 1
            if isinstance(data.get("usage"), dict):
                usage["prompt_tokens"] += data["usage"].get("inputTokens") or 0
                usage["completion_tokens"] += (data["usage"].get("outputTokens") or 0) + (data["usage"].get("reasoningTokens") or 0)
        elif t == "assistant/chunk":
            chunk = data.get("chunk", {})
            if chunk.get("type") == "text-delta":
                text_parts.append(chunk.get("text", ""))
        elif t == "text-chunks":
            for tx in ev.get("data", {}).get("texts") or []:
                if tx:
                    text_parts.append(tx)
    return {
        "final_text": "".join(text_parts),
        "prompt_tokens": usage["prompt_tokens"],
        "completion_tokens": usage["completion_tokens"],
        "turns": turns,
    }

def check_gate_tokens(text):
    return {
        "hard_gate1": bool(re.search(r"HARD-GATE-1: NO-TEST-NO-DONE", text)),
        "hard_gate2": bool(re.search(r"HARD-GATE-2: SCRIPT-ONLY", text)),
        "verification_gate_line": bool(re.search(r"\[Verification Gate\]", text)),
        "convergence_line": bool(re.search(r"\[Convergence\]", text)),
        "cap_stall": bool(re.search(r"cap=5\s+stall=3", text)),
        "table8": bool(TABLE_RE.search(text)),
        "iter_entries": len(ITER_RE.findall(text)),
    }

def check_workspace(workspace):
    """检查工作区是否 vibeweaver-active 且 assert 通过"""
    ws = Path(workspace)
    vl = ws / "tests" / "verification_log.md"
    acc = ws / "tests" / "acceptance.md"
    result = {"vibeweaver_active": vl.exists()}
    if vl.exists():
        log_text = vl.read_text(encoding="utf-8", errors="replace")
        result["iter_count"] = len(ITER_RE.findall(log_text))
        result["has_fail_diagnosis"] = bool(re.search(r"- iter \d+ FAIL:.*diagnosis:", log_text))
        # 运行 assert_artifacts 验证证据完备性
        ap = ws / "tests" / "assert_artifacts.py"
        if ap.exists():
            import subprocess
            r = subprocess.run(["python3", str(ap), "--existing", "--backend-only"],
                               capture_output=True, text=True, cwd=str(ws), timeout=30)
            result["assert_exit"] = r.returncode
            result["assert_out"] = r.stdout.strip()[:200]
        else:
            result["assert_exit"] = None
    if acc.exists():
        result["has_cap_line"] = bool(re.search(r"^>\s*cap=5\s+stall=3", acc.read_text(encoding="utf-8", errors="replace"), re.M))
    else:
        result["has_cap_line"] = False
    return result

def run_tasks(cfg, arm, report_rows):
    """执行单臂全部任务（run_bench.py 调用）"""
    tasks_dir = Path(cfg["bench"]["task_dir"])
    session_root = Path(cfg["bench"]["session_root"])
    repeats = cfg["bench"]["repeats"]
    for task_dir in sorted(tasks_dir.iterdir()):
        if not task_dir.is_dir():
            continue
        task = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
        workspace = f"/tmp/vwbench/{task['id']}"
        for rep in range(1, repeats + 1):
            # 由 run_bench.py 执行 headless 并传入 events/workspace 结果
            yield task, rep, workspace

def main():
    cfg = load_config("config.toml")
    rows = []
    for task, rep, workspace in run_tasks(cfg, None, rows):
        pass  # 实际运行在 run_bench.py; 本脚本提供纯评分函数
    print("score.py: 纯函数库, 由 run_bench.py 调用")

if __name__ == "__main__":
    main()
