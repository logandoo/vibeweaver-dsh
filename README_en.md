# vibeweaver-dsh

**The DeepSeek Harness (dsh) edition of the vibeweaver skill** — packages the [vibeweaver](https://github.com/anomalyco/opencode) engineering discipline as a DeepSeek Harness 0.1.0-rc.6 plugin bundle, so the vibeweaver workflow runs fully inside the dsh ecosystem.

> This repository is the dsh-harness-specific release of vibeweaver: the original skill targets opencode, this edition targets DeepSeek Harness (jsonrpc-agent / headless CLI). It is not a general-purpose alternative.

## Features

- **Progressive disclosure covenant**: a compact covenant card stays resident in context; the full skill text is loaded on demand (replaces full-force injection; A/B benchmarks show a significant token reduction)
- **Mechanical gates**: `assert_artifacts.py` evidence checks with `gate_mode: block|warn|off`
- **Auto activation for coding tasks**: pre-step intent heuristics, injects only for coding work
- **Turn guards**: stall observer + steer budget to prevent infinite loops (see the t03-A runaway contrast in the bench)
- **Compaction recovery**: covenant card is rebuilt automatically after compaction
- **Zero npm runtime dependencies**: Node ESM pure-function core + cordis event wiring

## Architecture

| Component | Files | Mechanism |
|---|---|---|
| Plugin entry | `src/index.js` → `lib/index.js` | `apply(ctx, config)` event wiring |
| Arm-A baseline plugin | `src/baseline.js` → `lib/baseline.js` | full SKILL.md static injection (bench control arm) |
| Pure-function core | `src/lib.js` | project-root discovery / assert execution / gate classification / stall observer / intent heuristics / covenant card |
| Bundle mounting | `package.json` + `cordis.patch.yml` | `dsh.bundle.patch` → `insert: [{id, name}]` |

## Installation

```bash
# 1. Clone this repo and make sure the vibeweaver skill source directory exists
#    (default: ~/.config/opencode/skills/vibeweaver).
#    You can obtain the vibeweaver SKILL.md from the opencode repository and place it there.

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
