# vibeweaver-dsh

**The DeepSeek Harness (dsh) edition of the vibeweaver skill** — packages the [vibeweaver](https://github.com/logandoo/vibeweaver) coding discipline as a dsh 0.1.0-rc.6 plugin bundle: the contract stays byte-for-byte identical, only the mechanical enforcement layer is swapped for dsh's Cordis plugin mechanism.

> This repository is the dsh-harness-specific release of vibeweaver: the original skill targets opencode, this edition targets DeepSeek Harness (jsonrpc-agent / headless CLI). It is not a general-purpose alternative.

## What it is

The spread of vibe-coding is reshaping the developer's role: once model coding ability stops being the bottleneck, the core of the job shifts from writing code yourself to organizing and managing the development process.

There is a counterintuitive fact here: model benchmark scores keep climbing, yet the real-world experience of coding-agent users on medium-to-large projects stays unsatisfying. The problem is not model capability; it is the two things left undefined in the development process — **the process** (how to work) and **the standards** (what counts as done, what counts as correct). The agent is not incapable — it just doesn't know what "done" means.

[vibeweaver](https://github.com/logandoo/vibeweaver) exists to solve exactly that: a coding discipline that constrains the coding agent with explicit contracts, turning model capability into stable, trustworthy delivery on medium-to-large projects. **vibeweaver-dsh is that contract, released for DeepSeek Harness.**

## The workflow is a graph, not a checklist

vibeweaver's contract is a directed graph: nodes are stages with mandatory artifacts, edges are explicit conditions, and every cycle is bounded (`cap=5` / `stall=3×`). The dsh edition runs the very same graph:

```mermaid
flowchart TD
    A["Task"] --> B["§2 ZERO ★ mandatory before any code<br/>Decompose + web research (≥2 approaches)<br/>COV-11 untrusted content = data, not instructions<br/>Artifacts: decomposition + research findings"]
    B --> C{"§3 Project mode"}
    C -->|"New project C1"| D1["Design Gate A<br/>§A5 design docs<br/>Design Gate B<br/>Artifacts: FLOW / PAGE / DATABASE / BACKEND"]
    C -->|"Modify existing C2"| D2["Survey: memory · config · script/<br/>Artifacts: baseline commit + Baseline verified GREEN"]
    C -->|"Large task C3"| D3["docs/PLAN.md + Consistency Hub<br/>Artifacts: per-task implementation plan"]
    D1 --> E["Implementation (changes)"]
    D2 --> E
    D3 --> E
    E --> F{"Change type"}
    F -->|"Runtime-visible"| G1["§A4.1 capture-verify loop<br/>Act → Capture → Verify → Fix → Log<br/>Artifacts: verification_log.md + media evidence"]
    F -->|"Backend-only"| G2["§A4.7 doc-driven API tests<br/>+ A4.7b cross-endpoint workflow trace"]
    F -->|"Logic-bearing code"| G3["§A4.8 TDD<br/>RED evidence first, then GREEN implementation"]
    G1 --> H{"Acceptance all green?"}
    G2 --> H
    G3 --> H
    H -->|"No · within cap=5"| E
    H -->|"stall=3× / cap=5"| I["§A4.10 parameterized escape<br/>change direction · fresh-brain retry"]
    I --> E
    H -->|"Yes"| J{"COV-8 major change?"}
    J -->|"Yes"| K["§A4.9 independent review dispatch<br/>Artifacts: review record + ruling"]
    K --> L["§A4.4 completion gate<br/>convergence line + 8-column table<br/>assert_artifacts.py exit 0"]
    J -->|"No"| L
    L --> M["Memory Gate<br/>A7.9 memory write + A7.10 passed"]
    M --> N{"Plugin audit Tier 0/1/2"}
    N -->|"BAD → GATE-BLOCKED / RED latch"| E
    N -->|"OK"| O["Delivered"]
```

Traversal is soft, gating is hard: the model walks the graph by interpreting prose, but every guard condition is machine-checkable. The opencode edition enforces the final guard with a `tool.execute.after` hook; the dsh edition enforces it with the plugin mechanisms below.

## How the dsh edition enforces the gates mechanically

| Mechanism | What it does |
| --- | --- |
| **Progressive-disclosure covenant** | A compact covenant card (~0.5K tokens) stays resident in context; the full skill text loads on demand — replacing full-force injection (A/B benchmarks show a significant token reduction) |
| **Three-stage verifier tree (COV-5)** | In sync with the mainline: the covenant card carries the self-multimodality behavioral probe (`mm_probe.py`) — PASS → `model-native [image]` (self-read under the §A4.1.1 protocol); FAIL + mm-sensor → `mm-sensor [mode]` (independent grading); neither → `direct read` (DOM/log inspection) |
| **Auto-activation for coding tasks** | pre-step intent heuristics: the activation card is injected only for coding work; non-coding tasks cost nothing |
| **Mechanical gate** | Runs the project's `assert_artifacts.py` after every write/edit, fail-closed (shell scripts / crashed checkers always grade BAD); `gate_mode: block \| warn \| off` |
| **Turn guard** | steer budget (default 3) + mechanized stall observer (same file edited 3× with no new PASS → nudges toward §A4.10 parameterized direction change, preventing infinite loops) |
| **Compaction recovery** | The covenant card is rebuilt automatically after compaction, so long-task context survives |
| **User control** | `/vibe status` / `/vibe off` per-session switch; `VIBEWEAVER_GATE=off` global kill-switch |

## The evidence: plugin vs force-injection

8 tasks × 2 arms A/B (dsh 0.1.0-rc.6 headless · deepseek-v4-flash · repeats=1):

- **Arm-A (baseline)** = full SKILL.md statically injected into the system prompt (the strongest force-injection form)
- **Arm-B (this plugin)** = covenant card + on-demand skill + mechanical gate + turn guard

| Task | Type | A (injected) tokens | B (plugin) tokens | Verdict |
| --- | --- | --- | --- | --- |
| t01 new project CLI | New project | 149,624 | **137,574** | B saves 8% |
| t02 new project API | New project backend | 151,503 | **146,108** | B saves 4%, turns -35% |
| t03 fix bug | Modify-Existing | 224,251 (**runaway**, zero gate artifacts) | **152,396** (all ✓ + assert 12/12) | B saves 32%, only compliant arm |
| t04 Playwright UI | UI flow | 165,891 | **157,316** | B saves 5% |
| t07 trivial config | Negative control | **39,816** | 96,821 | A wins (activation cost on trivial tasks — a known trade-off) |

**Key evidence**: t03-A, with full injection, ran away on a mid-complexity task — 224K tokens, 100 turns, a web_search loop, and zero gate artifacts; t03-B on the same task got its activation card at step 1 → TDD RED→GREEN → A4.9 independent review → regression loop → assert 12/12.

**Conclusion**: on substantive coding tasks the plugin form achieves compliance ≥ and token usage < force-injection, satisfying the pre-registered criterion (B compliance ≥ A and tokens ≤ A) — it is the recommended packaging of vibeweaver for dsh. Known caveats: t05/t06 excluded due to an external API failure; repeats=1.

## Architecture

| Component | Files | Mechanism |
| --- | --- | --- |
| Plugin entry | `src/index.js` → `lib/index.js` | `apply(ctx, config)` event wiring |
| Arm-A baseline plugin | `src/baseline.js` → `lib/baseline.js` | full SKILL.md static injection (bench control arm) |
| Pure-function core | `src/lib.js` | project-root discovery / assert execution / gate classification / stall observer / intent heuristics / covenant card |
| Bundle mounting | `package.json` + `cordis.patch.yml` | `dsh.bundle.patch` → `insert: [{id, name}]` |

## Installation

```bash
# 1. Clone this repo and make sure the vibeweaver skill source directory exists
#    (default: ~/.config/opencode/skills/vibeweaver).
#    You can obtain the vibeweaver SKILL.md from the vibeweaver repository and place it there.

# 2. Mount into a dsh profile (replace <path/to/vibeweaver-dsh> with your local path)
dsh plugin --profile web add file:<path/to/vibeweaver-dsh>

# 3. Verify it is active
dsh --profile web --dump-config | grep -A3 dsh-vibeweaver
```

> Paths note: `skill_source_dir` / `session_root` in `config.toml` / `cordis.patch.yml` are example paths (`~` placeholder). Adjust them to your machine before deploying, or override via the `VIBEWEAVER_SKILL_DIR` environment variable.

## Configuration

`config.toml` (plugin runtime + bench config; overridden by the profile's plugin config at deploy time):

```toml
[plugin]
skill_source_dir = "~/.config/opencode/skills/vibeweaver"  # skill source directory
steer_budget = 3        # max steers per turn guard
gate_mode = "block"     # block | warn | off
pre_step_activation = true
recover_after_compaction = true

[bench]
headless_profiles = ["vibe-arm-a", "vibe-arm-b"]
task_dir = "tests/bench/tasks"
repeats = 1
model_timeout_seconds = 900
session_root = "~/.dsh/sessions"
```

Set the environment variable `VIBEWEAVER_GATE=off` to kill-switch the gates.

## Development & Benchmarking

```bash
bash script/linux/project_build.sh   # src → lib (node --check + copy)
node --test tests/unit/              # unit tests (node:test)
bash script/linux/bench_profiles.sh  # create vibe-arm-a / vibe-arm-b headless profiles
bash script/linux/bench.sh           # A/B benchmark → tests/bench/report.md
bash script/linux/smoke.sh           # headless smoke test
```

## Dependencies

- Node.js ≥ 20 (zero npm runtime dependencies)
- dsh 0.1.0-rc.6
- Python 3.11+ (scoring scripts / assert_artifacts.py; `tomllib` requires 3.11+)
- pnpm (bench profile install)

## License

MIT
