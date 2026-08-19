#!/usr/bin/env python3
"""run_bench.py — A/B 评测主驱动
流程: 准备 fixture → 逐任务×臂×重复运行 headless dsh → 收集会话 JSONL 与工作区产物 → 评分 → report.md"""
import csv
import json
import os
import shutil
import subprocess
import sys
import time
try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import score

DSH_CMD = ["npm", "exec", "--yes", "--package=@deepseek-ai/dsh@0.1.0-rc.6", "--", "dsh"]
FIXTURE_SRC = Path(__file__).parent / "fixtures"

def setup_fixture(task):
    """为 modify-existing 任务准备初始工作区; new-project 任务给空目录"""
    ws = Path(f"/tmp/vwbench/{task['id']}")
    if ws.exists():
        shutil.rmtree(ws)
    ws.mkdir(parents=True)
    fixture = FIXTURE_SRC / task["id"]
    if fixture.exists():
        shutil.copytree(fixture, ws, dirs_exist_ok=True)
    return ws

def run_headless(profile, prompt, cwd, timeout=900):
    """在任务工作区 cwd 内运行 headless（会话目录归属工作区）"""
    t0 = time.time()
    try:
        r = subprocess.run(
            DSH_CMD + ["--profile", profile, prompt],
            capture_output=True, text=True, timeout=timeout, cwd=str(cwd),
        )
        ok = r.returncode == 0
        out = (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        ok = False
        out = "TIMEOUT"
    return ok, out, time.time() - t0

def main():
    cfg_path = Path(__file__).parent.parent.parent / "config.toml"
    with open(cfg_path, "rb") as f:
        cfg = tomllib.load(f)
    bench_cfg = cfg["bench"]
    task_root = Path(bench_cfg["task_dir"])
    session_root = Path(bench_cfg["session_root"])
    repeats = int(bench_cfg["repeats"])
    arms = bench_cfg["headless_profiles"]
    timeout = int(bench_cfg.get("model_timeout_seconds", 900))
    out_dir = Path(__file__).parent
    rows = []
    errors = []

    for task_dir in sorted(task_root.iterdir()):
        if not task_dir.is_dir() or not (task_dir / "task.json").exists():
            continue
        task = json.loads((task_dir / "task.json").read_text(encoding="utf-8"))
        for arm in arms:
            for rep in range(1, repeats + 1):
                ws = setup_fixture(task)
                ok, out, wall = run_headless(arm, task["prompt"], ws, timeout=timeout)
                session_dir = score.find_session_dir(session_root, ws)
                events = score.session_events(session_dir)
                metrics = score.extract_metrics(events)
                gate = score.check_gate_tokens(metrics["final_text"])
                ws_check = score.check_workspace(ws)
                row = {
                    "task": task["id"],
                    "type": task.get("type", ""),
                    "arm": arm,
                    "rep": rep,
                    "wall_s": round(wall, 1),
                    "headless_ok": ok,
                    "turns": metrics["turns"],
                    "prompt_tokens": metrics["prompt_tokens"],
                    "completion_tokens": metrics["completion_tokens"],
                    "total_tokens": metrics["prompt_tokens"] + metrics["completion_tokens"],
                    **gate,
                    "active": ws_check.get("vibeweaver_active", False),
                    "iter_count": ws_check.get("iter_count", 0),
                    "has_fail_diagnosis": ws_check.get("has_fail_diagnosis", False),
                    "has_cap_line": ws_check.get("has_cap_line", False),
                    "assert_exit": ws_check.get("assert_exit"),
                }
                rows.append(row)
                print(f"[BENCH] {task['id']} {arm} rep{rep}: wall={row['wall_s']}s tokens={row['total_tokens']} gate1={row['hard_gate1']}", flush=True)
                if not ok:
                    errors.append((task["id"], arm, rep, out[:300]))

    # CSV
    csv_path = out_dir / "bench_results.csv"
    fieldnames = list(rows[0].keys()) if rows else []
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)

    write_report(out_dir, rows, errors)
    print(f"[BENCH] done: {len(rows)} runs → {csv_path.name}, report.md", flush=True)

def write_report(out_dir, rows, errors):
    from statistics import mean
    rep = {}
    for r in rows:
        key = (r["arm"],)
        d = rep.setdefault(key, {"rows": []})
        d["rows"].append(r)
    lines = ["# A/B Bench Report", "", f"- runs: {len(rows)}", f"- date: {time.strftime('%Y-%m-%d %H:%M')}", ""]
    lines.append("| arm | n | compliance% (gate1+gate2+VL+cap) | avg total tokens | avg wall s | tasks pass |")
    lines.append("|---|---|---|---|---|---|")
    for key, d in sorted(rep.items()):
        rs = d["rows"]
        # 合规分: 0-4 分: gate1+gate2+iter+cap（M9: 移除首行死赋值）
        def comp_score(r):
            s = 0
            s += 1 if r["hard_gate1"] else 0
            s += 1 if r["hard_gate2"] else 0
            s += 1 if r["iter_count"] > 0 else 0
            s += 1 if r["has_cap_line"] else 0
            return s
        comp = mean(comp_score(r) for r in rs) / 4 * 100
        tokens = mean(r["total_tokens"] for r in rs)
        wall = mean(r["wall_s"] for r in rs)
        lines.append(f"| {key[0]} | {len(rs)} | {comp:.0f}% | {tokens:.0f} | {wall:.0f} | — |")
    lines.append("")
    lines.append("## 逐任务")
    lines.append("")
    lines.append("| task | arm | rep | gate1 | gate2 | iter | cap | assert | tokens | wall |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(rows, key=lambda r: (r["task"], r["arm"], r["rep"])):
        lines.append(f"| {r['task']} | {r['arm']} | {r['rep']} | {r['hard_gate1']} | {r['hard_gate2']} | {r['iter_count']} | {r['has_cap_line']} | {r['assert_exit']} | {r['total_tokens']} | {r['wall_s']} |")
    if errors:
        lines.append("")
        lines.append("## 运行错误")
        lines.append("")
        for tid, arm, rep, msg in errors:
            lines.append(f"- {tid} {arm} rep{rep}: {msg[:150]}")
    (out_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")

if __name__ == "__main__":
    main()
