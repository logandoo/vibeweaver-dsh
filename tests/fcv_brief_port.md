# FCV Brief — dsh 主线 uif 移植（vibeweaver-dsh）

You are a fresh-context verification agent. Re-run every command below yourself; report observed output only. Do NOT edit repo files (write only under /tmp).

**Acceptance criteria (tests/acceptance.md):**
1. Covenant card: contains the §A4.1.2 clause (measure-then-judge; geometry by instruments; ui_fidelity/refboxes/comparative references; VLM never certifies geometry); byte caps hold.
2. Scripts: `scripts/mm_probe.py` and `scripts/ui_fidelity.py` byte-identical to the mainline tree; both `--selftest` pass; package.json files lists ui_fidelity.py.
3. Unit suite green (expected 69) after `project_build.sh` (lib==src).
4. Process: assert `--existing` and `--final --existing` exit 0; RED evidence + baseline logs on disk.
5. Docs/memory: README zh/en port notes + memory topic + ADR D-4 present; push state reported.

**Commands (run from `/Users/logan/Documents/DEV/SKILLS/vibeweaver-dsh`):**
```bash
bash script/linux/project_build.sh; echo "build=$?"
node --test tests/unit/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"
python3 tests/assert_artifacts.py --existing | tail -1; echo "existing=$?"
python3 tests/assert_artifacts.py --final --existing | tail -1; echo "final=$?"
node - <<'JS'
import('/Users/logan/Documents/DEV/SKILLS/vibeweaver-dsh/lib/lib.js').then(m => {
  const f = c => Buffer.byteLength(m.covenantCard(c));
  console.log('synthetic', f({ skillSourceDir: '/tmp/skills' }),
              '| no-cfg', f({}),
              '| expanded', f({ skillSourceDir: '/Users/logan/.config/opencode/skills/vibeweaver' }));
})
JS
diff -q scripts/mm_probe.py /Users/logan/Documents/DEV/SKILLS/vibeweaver/scripts/mm_probe.py; echo "mmdiff=$?"
diff -q scripts/ui_fidelity.py /Users/logan/Documents/DEV/SKILLS/vibeweaver/scripts/ui_fidelity.py; echo "uidiff=$?"
grep -c "A4.1.2" src/lib.js lib/lib.js
grep -n "final-run: --final" tests/verification_log.md | tail -1
grep -n "docs-drift:" tests/verification_log.md | tail -1
grep -n "7895/7945/7967" README.md README_en.md | head -2
grep -n "66→69" README.md README_en.md | head -2
python3 -c "import json;print('ui_fidelity in files:', 'scripts/ui_fidelity.py' in json.load(open('package.json'))['files'])"
git status -sb | head -1
```
Expected baselines: build 0; unit `tests 69 / pass 69 / fail 0`; existing `all 32 checks pass`; final `all 33 checks pass`; card numbers 7895/7945/7967 (all <8000); both diff exits 0 (silent); A4.1.2 present in both lib copies; final-run line says `--final — pass=33/fail=0`; docs contain the numbers; package files include ui_fidelity; branch ahead of origin (push may be pending — report, not a defect).

**Output contract:** `criterion #N: PASS|FAIL — observed: <exit codes / key lines>` for N=1..5, then `mismatches: <none|list>`. Return as your final message.