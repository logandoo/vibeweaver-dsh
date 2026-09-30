"""G-DED artifact assertions — byte-level check of verification claims.
Canonical copy: vibeweaver skill `scripts/assert_artifacts.py`.
Mirrors COMPLETION_GATE.md §A4.4.1 minimum-check table (all 18 groups).
Group 12 enforces the A4.1 diagnosis clause; group 13 is a
claim-without-scope lint (approach modeled on J-Space Cognition Suite's
`ship` check at idea level; implementation here is original —
see repo README → Attribution). Groups 14-16 are change-wave content
gates: 14 secret scan (`vw-approved` marker ⇄ `- secret-approved:` log
pairing), 15 test-change guard, 16 risk-tier review. Project profiles
(tests/project_profile.json or --profile) declaratively skip groups that
are structurally N/A for the project kind (service/UI/new-project) —
a profile never weakens an applicable group. `--class DOC|CONFIG|CODE`
(COV-13 / §V11, or the log's `- class:` basis line) N/A's the memory (4)
and service-lifecycle (5) groups for the classes whose path card has no
such risk."""
import argparse, json, os, pathlib, re, subprocess, sys

FAILS = []
PASSES = 0
GIT_TIMEOUT = False

# Group 13 word sets, chosen for what vibeweaver logs actually overclaim with.
# CLAIM  — verbs that assert a verification result happened.
# COVER  — scope/evidence indicators: quantifiers, counts, artifact refs.
# A bare object name is not scope: "the endpoint is verified" names WHAT,
# not HOW MUCH was checked, so object nouns (endpoint/file/…) are excluded.
CLAIM = re.compile(
    r"\b(?:verified|confirmed|validated|proven|tested)\b|"
    r"\ball\s+(?:checks?|tests?)\s+pass(?:es|ed)?\b|\bchecks?\s+pass\b|"
    r"已验证|验证通过|已确认|确认无误|已测试|测试通过|已证明",
    re.I,
)
COVER = re.compile(
    r"\b(?:all|each|every|both)\b|"                     # quantifiers
    r"\b\d+\s*/\s*\d+\b|"                               # 3/3 fractions
    r"\bcriterion\s*#?\d+\b|\bcriteria\b|"              # criterion scope
    r"\bn\s*[<≤=]\s*\d+\b|"                             # bounded sweeps
    r"tests/[\w./-]+|\S+\.(?:png|mp4|webm|wav)\b|\S+\.trace\.log\b|"  # artifact refs
    r"\bcoverage\b|\bcovered\b|\bsweep\b|\bswept\b|"
    r"全部|所有|每个|每条|逐一|逐条|覆盖|边界|用例|场景|"
    r"包括|包含|至少|至多|最多|最少|随机",
    re.I,
)
STRUCT_LINE = re.compile(r"^(?:#{1,6}\s|>|\|{1,2}\s*-+|\s*$)")
EXEMPT_LINE = re.compile(r"(?:^- iter \d+ (?:PASS|FAIL):|^- Baseline verified GREEN|^- COV-\d+ skipped)")
FENCE = re.compile(r"^\s{0,3}(?:```|~~~)")

# --- groups 14-16: change-wave content gates (canonical spec:
# COMPLETION_GATE.md §A4.4.1 rows 14-16) -------------------------------
CODE_EXT = {".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".go", ".rs",
            ".java", ".sql", ".sh"}
SECRET_RES = [
    re.compile(r"AKIA[0-9A-Z]{16}"),                       # AWS access key id
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|"
               r"xox[baprs]-[A-Za-z0-9-]{16,}|"
               r"sk-(?:proj-|ant-)?[A-Za-z0-9_\-]{16,}"),  # GitHub/Slack/OpenAI/Anthropic tokens
]
# generic k = v: quoted literal values are candidates; UNQUOTED values
# containing `.`/`(`/`)` are references or calls (os.environ.get(…),
# process.env.X, config.password, self.x) — the SAFE handling pattern,
# never flagged. Values outside the base charset (spaces, !#%…) may
# escape — documented tradeoff, biased against false-blocking.
GENERIC_KV = re.compile(
    r"(?i)\b(?:api[_-]?key|apikey|secret|password|passwd|pwd|token|"
    r"private[_-]?key|access[_-]?key)\b[\"']?\s*[:=]\s*"
    r"(?P<q>[\"']?)(?P<v>[A-Za-z0-9_/+.\-]{12,})")
PLACEHOLDER = re.compile(r"(?i)example|sample|dummy|placeholder|changeme|"
                         r"redacted|fake|<[^>]+>")
ASSERT_LINE = re.compile(r"^\s*(?:assert\b|self\.assert|expect\s*\(|"
                         r"pytest\.raises|require\s*\(|def test_|it\s*\(|"
                         r"test\s*\(|func Test|@Test)")
TEST_DIR = re.compile(r"(^|/)(?:tests?|__tests__|spec)/")
RISK_PATH = re.compile(r"(?i)(^|/)(?:auth|security|payments?|billing|crypto|"
                       r"migrations?|permissions?|acl)(?:/|\.|_|$)")


def _git(root, *args):
    global GIT_TIMEOUT
    try:
        r = subprocess.run(["git", "-C", str(root), *args],
                           capture_output=True, text=True, timeout=20)
        return r.returncode, r.stdout
    except FileNotFoundError:
        return -1, ""
    except subprocess.TimeoutExpired:
        GIT_TIMEOUT = True
        return -2, ""


def _unquote_git(p: str) -> str:
    """Decode git's C-quoted path (\"a\\tb\" / \"\\346\\212\\245\\345\\221\\221.docx\")
    to the real filename — octal escapes are raw UTF-8 bytes (2026-09-30 review)."""
    if len(p) < 2 or p[0] != '"' or p[-1] != '"':
        return p
    body = p[1:-1]
    simple = {"t": 9, "n": 10, "a": 7, "b": 8, "f": 12, "v": 11, "\\": 0x5C, '"': 0x22}
    out = bytearray()
    i, n = 0, len(body)
    while i < n:
        ch = body[i]
        if ch == "\\" and i + 1 < n:
            nxt = body[i + 1]
            if nxt in simple:
                out.append(simple[nxt])
                i += 2
                continue
            if nxt in "01234567" and i + 3 < n and all(c in "01234567" for c in body[i + 2:i + 4]):
                out.append(int(body[i + 1:i + 4], 8))
                i += 4
                continue
            out.append(ord(nxt))
            i += 2
            continue
        out.extend(ch.encode("utf-8"))
        i += 1
    return out.decode("utf-8", "replace")


def wave_diff_text(root):
    """Change-wave diff: PER-COMMIT patches of newest `backup: before changes`
    commit..HEAD (a net range diff would hide intra-wave add-then-remove),
    else `git show HEAD`; plus uncommitted `git diff HEAD`. "" = no git repo."""
    rc, _ = _git(root, "rev-parse", "--git-dir")
    if rc != 0:
        return ""
    rc, sha = _git(root, "log", "--format=%H", "-1", "--fixed-strings",
                   "--grep=backup: before changes")
    parts = []
    if rc == 0 and sha.strip():
        _, d = _git(root, "log", "-p", "--format=", f"{sha.strip()}..HEAD")
        parts.append(d)
    else:
        _, d = _git(root, "show", "--format=", "HEAD")
        parts.append(d)
    _, d = _git(root, "diff", "HEAD")
    parts.append(d)
    return "\n".join(parts)


def untracked_files(root):
    """Untracked, non-gitignored files (never visible in git diff)."""
    rc, out = _git(root, "ls-files", "--others", "--exclude-standard")
    return [_unquote_git(l) for l in out.splitlines() if l.strip()] if rc == 0 else []


HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def parse_diff(text):
    """{path: [added, removed]} — added = [(new-file lineno, text)] via @@
    hunks; removed = [text]. Deleted files keep their `--- a/` path so
    removed lines and the path are retained (whole-file deletion must NOT
    fail-open the guards)."""
    files, cur, nline = {}, None, 0
    for line in text.splitlines():
        h = HUNK.match(line)
        if h:
            nline = int(h.group(1))
        elif line.startswith("--- a/"):
            cur = line[6:]
            files.setdefault(cur, [[], []])
        elif line.startswith("+++ b/"):
            cur = line[6:]
            files.setdefault(cur, [[], []])
        elif line.startswith("--- /dev/null"):
            cur = None
        elif line.startswith("+++ /dev/null"):
            pass                                # deleted file: keep a/ path
        elif cur and line.startswith("+"):
            files[cur][0].append((nline, line[1:]))
            nline += 1
        elif cur and line.startswith("-"):
            files[cur][1].append(line[1:])
        elif line.startswith(" "):
            nline += 1
    return files


def _is_test_code(path):
    p = pathlib.PurePosixPath(path)
    if p.suffix not in CODE_EXT or "assert_artifacts.py" in path:
        return False
    if TEST_DIR.search(path):
        return True
    n = p.name
    return (n.startswith("test_") or "_test." in n
            or ".test." in n or ".spec." in n)


def secret_scan(root, vl=""):
    """Group 14 — secret scan. Returns (fails, warns). Only ADDED diff lines
    and untracked files; placeholder-marked lines exempt; .md warn-only;
    any assert_artifacts.py never scanned. A `vw-approved` inline marker
    exempts a credential line ONLY when verification_log.md carries the
    path-scoped pairing `- secret-approved: <path> — <reason>` (marker count
    per path must be ≤ approvals for that path — same binding shape as group
    15's `- test-change: <path>`). A bare mention of the marker on a line
    that matches no credential pattern is a no-op (prose mentions never
    trip the gate). Pairing failures FAIL regardless of file type (the
    .md warn-only rule applies only to plain unmarked secrets)."""
    fails, warns, marker_paths = [], [], {}

    def hit(path, lineno, text):
        if "assert_artifacts.py" in path or PLACEHOLDER.search(text):
            return
        found = any(rx.search(text) for rx in SECRET_RES)
        if not found:
            m = GENERIC_KV.search(text)
            found = bool(m) and (bool(m.group("q")) or
                                 bool(not any(c in m.group("v") for c in ".()")))
        if not found:
            return
        if re.search(r"vw-approved", text, re.I):
            marker_paths[path] = marker_paths.get(path, 0) + 1
            return
        (warns if path.endswith(".md") else fails).append(
            f"secret scan: {path}:{lineno}: credential-looking string "
            f"on an added line — {text.strip()[:50]!r} (A4.4 content gate)")

    for path, (added, _r) in parse_diff(wave_diff_text(root)).items():
        for lineno, l in added:
            hit(path, lineno, l)
    for rel in untracked_files(root):
        p = root / rel
        try:
            if not p.is_file() or p.stat().st_size > 1_000_000:
                continue
            t = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for i, l in enumerate(t.splitlines(), 1):
            hit(rel, i, l)
    for mpath, cnt in sorted(marker_paths.items()):
        approvals = len(re.findall(
            r"^- secret-approved:\s*" + re.escape(mpath) + r"(?![\w.\-])", vl, re.M))
        if approvals < cnt:
            fails.append(
                f"secret scan: {mpath}: {cnt} `vw-approved` marker line(s) but "
                f"{approvals} matching `- secret-approved: {mpath}` line(s) in "
                f"verification_log.md — every approved secret needs its own "
                f"path-scoped approval (A4.4 content gate)")
    return fails, warns


def test_change_guard(root, vl):
    """Group 15 — test-change guard: REMOVED assertion lines in test code
    files require a `- test-change: <path> — <reason>` log line."""
    fails = []
    for path, (_a, removed) in parse_diff(wave_diff_text(root)).items():
        if not _is_test_code(path):
            continue
        n = sum(1 for l in removed if ASSERT_LINE.match(l))
        if n and not re.search(r"^- test-change:.*" + re.escape(path), vl, re.M):
            fails.append(
                f"test-change guard: {path}: {n} assertion line(s) removed "
                f"without a `- test-change:` justification in "
                f"verification_log.md (A4.8 test integrity)")
    return fails


def risk_tier(root):
    """Group 16 — risk-tier: diffs/untracked files touching risk-tier code
    paths require tests/review_package.md on disk."""
    paths = set(parse_diff(wave_diff_text(root))) | set(untracked_files(root))
    hits = sorted(p for p in paths
                  if pathlib.PurePosixPath(p).suffix in CODE_EXT
                  and RISK_PATH.search(p))
    rp = root / "tests" / "review_package.md"
    if hits and not (rp.exists() and rp.stat().st_size > 0):
        return [f"risk-tier: change-wave touches risk-tier path(s) "
                f"({', '.join(hits[:5])}) but tests/review_package.md "
                f"missing/empty — A4.9 review non-skippable (A4.9)"]
    return []


def check(ok: bool, msg: str):
    global PASSES
    PASSES += 1
    if not ok:
        FAILS.append(msg)


def read(p: pathlib.Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError):
        return ""


def claim_without_coverage(vl: str):
    """Return violating (line_number, line) pairs: a claim verb on a prose line
    whose own line states no coverage scope. Fenced blocks, headings, tables
    and structured entries are exempt — see EXEMPT_LINE."""
    hits = []
    in_fence = False
    for i, line in enumerate(vl.splitlines(), 1):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        stripped = line.strip()
        if not stripped or STRUCT_LINE.match(stripped) or EXEMPT_LINE.match(stripped):
            continue
        if CLAIM.search(stripped) and not COVER.search(stripped):
            hits.append((i, stripped[:80]))
    return hits


def main():
    global PASSES
    ap = argparse.ArgumentParser()
    ap.add_argument("--existing", action="store_true", help="Modify-Existing task: skip new-project §A5 design-doc + git checks")
    ap.add_argument("--backend-only", action="store_true", help="no UI: skip PAGE_DESIGN.html and project_build.sh checks")
    ap.add_argument("--profile", default="", help="project profile: service|backend-api|web-static|cli|library — skips structurally-N/A groups (overrides tests/project_profile.json)")
    ap.add_argument("--class", dest="task_class", default="", choices=["DOC", "CONFIG", "CODE"],
                    help="COV-13 task class (§V11): DOC N/A's memory + service-lifecycle groups; CONFIG N/A's memory when the log carries `- memory: na (<why>)`. Default: auto-detect from the `- class: <X> — <basis>` first entry of the task block in tests/verification_log.md")
    args = ap.parse_args()

    root = pathlib.Path(__file__).resolve().parent.parent

    # --- project profile: declarative N/A for groups that are structurally
    # impossible for this project kind (a library has no service to start).
    # A profile SKIPS a group only; it never weakens an applicable group.
    # Explicit keys in tests/project_profile.json override the preset.
    prof_name = args.profile
    prof_cfg = {}
    pf = root / "tests" / "project_profile.json"
    if pf.exists():
        try:
            loaded = json.loads(pf.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                prof_cfg = loaded
                if not prof_name:
                    prof_name = str(prof_cfg.get("profile", "") or "")
            else:
                check(False, "tests/project_profile.json must contain a JSON "
                             "object with a 'profile' key (A4.4.1 profile)")
        except (OSError, ValueError) as e:
            check(False, f"tests/project_profile.json unparseable ({e}) — "
                         f"profile overrides ignored (A4.4.1 profile)")
    KNOWN_PROFILES = ("service", "backend-api", "web-static", "cli", "library")
    if prof_name and prof_name not in KNOWN_PROFILES:
        print(f"profile: {prof_name} — WARN unknown profile name, preset "
              f"skips not applied; only explicit keys below take effect")
    for k in ("no_service", "no_ui", "no_new_project"):
        if k in prof_cfg and not isinstance(prof_cfg[k], bool):
            check(False, f"tests/project_profile.json: '{k}' must be boolean, "
                         f"got {type(prof_cfg[k]).__name__} — override ignored "
                         f"(A4.4.1 profile)")
            prof_cfg[k] = None
    no_service = prof_cfg.get("no_service")
    no_ui = prof_cfg.get("no_ui")
    no_new_project = prof_cfg.get("no_new_project")
    if prof_name == "cli" or prof_name == "library" or prof_name == "web-static":
        no_service = True if no_service is None else no_service
    if prof_name in ("backend-api", "cli", "library"):
        no_ui = True if no_ui is None else no_ui
    if prof_name == "backend-api":
        no_service = False if no_service is None else no_service
    backend_only = args.backend_only or bool(no_ui)
    existing = args.existing or bool(no_new_project)
    skips = []
    if no_service:
        skips.append("service lifecycle N/A (group 5 skipped)")
    if backend_only and not args.backend_only:
        skips.append("UI N/A")
    if existing and not args.existing:
        skips.append("new-project gates N/A")
    if prof_name or skips or any(prof_cfg.get(k) is not None
                                 for k in ("no_service", "no_ui", "no_new_project")):
        print("profile: " + (prof_name or "custom")
              + (" — " + "; ".join(skips) if skips else " — full gates"))

    tests = root / "tests"
    vl = read(tests / "verification_log.md")
    acc = read(tests / "acceptance.md")

    # --- COV-13 task class (VERIFICATION_UPGRADES §V11): which groups are
    # structurally N/A for this change wave. --class wins; otherwise the
    # `- class: <X> — <basis>` first entry of the CURRENT task block in the log.
    # A class never weakens an applicable group — it only N/A's groups whose
    # risk is not in the class's path card.
    cls = (args.task_class or "").upper()
    cls_basis = "--class flag"
    # Multi-block logs: the CURRENT task is the LAST `## ` block — an older
    # block's `- class:` / `- memory: na` is history and licenses nothing here.
    cur_block = re.split(r"(?m)^(?=## )", vl)[-1] if vl else ""

    # Fence/quote-aware line filter: fenced examples and blockquoted echoes
    # never license anything (class · render · exec rows alike).
    def _live_lines(block: str):
        in_fence = False
        out = []
        for _l in block.splitlines():
            if FENCE.match(_l):
                in_fence = not in_fence
                continue
            if in_fence or _l.lstrip().startswith(">"):
                continue
            out.append(_l)
        return out

    # Widened class-line grammar (2026-09-30 review): indent · list bullets ·
    # spaced colon · all three dash variants · optional basis — an author must
    # not be able to hide the FIRST declaration and let a later flush-left line
    # become "first".
    _class_re = re.compile(
        r"^\s*(?:[-*]|\d+[.)])?\s*class\s*:\s*(DOC|CONFIG|CODE)\b\s*(?:[—–-]\s*(.+))?$", re.I)
    m_all = []
    for _l in _live_lines(cur_block):
        _m = _class_re.match(_l)
        if _m:
            m_all.append((_m.group(1).upper(), (_m.group(2) or "").strip()))
    if m_all:
        # One class per task (§V11.7): the FIRST entry is the basis line; a
        # later DIFFERENT `- class:` is a contradiction/append attempt —
        # escalate by EDITING the line, never appending (§V11.4#3 只升不降).
        _classes = [m[0] for m in m_all]
        _dups = [c for c in _classes[1:] if c != _classes[0]]
        if _dups:
            check(False, f"tests/verification_log.md: class contradiction/append — "
                         f"`- class: {_classes[0]}` then `- class: {_dups[-1]}` in one task block "
                         f"(one class per task §V11.7; 升类=改写该行非追加，只升不降 §V11.4#3)")
    if not cls and m_all:
        cls = _classes[0]
        cls_basis = "log: - class: " + m_all[0][0] + (" — " + m_all[0][1][:60] if m_all[0][1] else "")
    if cls and m_all and args.task_class:
        # flag-vs-log cross-check: a contradicting --class must not silently
        # disable the class's own gates (§V11.7 one class per task).
        if m_all[0][0] != cls:
            check(False, f"--class {cls} contradicts the log's `- class: {m_all[0][0]}` "
                         f"in the current task block — one class per task (§V11.7)")
    class_skip_memory = (cls == "DOC" and not re.search(
        r"^- iter \d+ FAIL|^- stall:|cap-hit", cur_block, re.M)) or (
        cls == "CONFIG" and bool(re.search(r"^-[ \t]*memory:[ \t]*na[ \t]*\(", cur_block, re.M | re.I)))
    class_skip_service = cls == "DOC"
    # §V11.9 DOC-asset render + exec gates — FILE-KIND triggered (every class:
    # a mixed CODE wave shipping a docx owes the same render). Assets come from
    # git --name-status + untracked (binary-safe; deletions are not deliveries).
    _asset_re = re.compile(r"\.(docx|doc|xlsx|xls|pptx|ppt|pdf|odt|ods|odp|rtf|odg|epub|mht|docm|xlsm|pptm)$", re.I)
    # Whole change wave, not just the working tree: assets COMMITTED mid-wave are
    # still deliveries (newest `backup: before changes`..HEAD + uncommitted +
    # untracked). --name-status is binary-safe; D = not a delivery.
    _paths = set()
    _rcb, _base = _git(root, "log", "--format=%H", "-1", "--fixed-strings", "--grep=backup: before changes")
    # No `backup:` marker → the wave is the working tree only (pre-wave history
    # must never count as deliveries).
    _ranges = (["log", "--name-status", "--format=", f"{_base.strip()}..HEAD"] if _rcb == 0 and _base.strip()
               else ["diff", "--name-status", "HEAD"])
    for _args in (_ranges, ["diff", "--name-status", "HEAD"], ["diff", "--cached", "--name-status"],
                  ["ls-files", "--others", "--exclude-standard"]):
        _rc, _out = _git(root, *_args)
        for _line in _out.splitlines():
            if not _line.strip():
                continue
            if "\t" in _line:
                # name-status row: status column carries deletions; only HERE
                # does `D` mean "not a delivery" (2026-09-30 review C-fix:
                # a bare path starting with `D` is a delivery, not a deletion).
                # Rename/copy rows (`R100\told\tnew`) deliver the LAST field.
                _status, _, _rest = _line.partition("\t")
                if _status.strip().startswith("D"):
                    continue
                if _rest:
                    _paths.add(_unquote_git(_rest.split("\t")[-1]))
            else:
                # `git ls-files --others` prints bare single-column paths — a
                # tab-less line IS the path (an untracked delivery), not a
                # malformed name-status row (2026-09-30 wave-2 fix).
                _paths.add(_unquote_git(_line))
    _wave_assets = sorted(p for p in _paths if _asset_re.search(p))
    _render_lines = [l for l in _live_lines(cur_block) if re.match(r"^\s*(?:[-*]\s+)?render\s*:", l, re.I)]
    _toolchain_re = re.compile(r"soffice|libreoffice|pymupdf|pdftoppm|poppler|imagemagick", re.I)

    def _line_ok(_l):
        # §V11.9 evidence binding: when page images are cited, EVERY cited
        # image must exist non-empty under tests/ (no escaping paths — one
        # real png may not launder a fabricated co-citation); the N/A form is
        # only a fallback for rows citing NO images at all.
        _pngs = []
        for f in re.findall(r"tests/([\w./-]*[\w-]+\.(?:png|webm))", _l):
            if os.path.basename(f).lower().startswith("probe_vision."):
                continue
            _norm = os.path.normpath(f)
            if _norm.startswith("..") or os.path.isabs(_norm):
                return False
            _pngs.append(_norm)
        _on_disk = bool(_pngs) and all((tests / f).exists() and (tests / f).stat().st_size > 0 for f in _pngs)
        _na = (not _pngs) and bool(re.search(r"N/A", _l, re.I)) and bool(_toolchain_re.search(_l)) and "<" not in _l
        return _on_disk or _na

    _split_re = re.compile(r"\s+[—–-]\s+")

    def _declared_of(_l):
        _m = re.match(r"^\s*(?:[-*]\s+)?(?:render|exec-check)\s*:\s*", _l, re.I)
        if not _m:
            return None
        _rest = _l[_m.end():]
        return _split_re.split(_rest, maxsplit=1)[0].strip().strip('`"\'') or None

    def _named(_p, _l):
        # §V11.9 per-asset binding: the row must DECLARE this asset — the token
        # before the first spaced dash separator, normpath-compared. A
        # slash-form row binds ONLY its exact path (no suffix matching); a bare
        # name binds the root-level asset exactly, or a UNIQUE basename.
        _d = _declared_of(_l)
        if not _d:
            return False
        _p_norm = os.path.normpath(_p.replace("\\", "/")).replace("\\", "/")
        _d_norm = os.path.normpath(_d.replace("\\", "/")).replace("\\", "/")
        if _p_norm == _d_norm:
            return True
        if "/" in _d_norm:
            return False
        if os.path.basename(_p_norm).lower() != _d_norm.lower():
            return False
        _same = [a for a in _wave_assets
                 if os.path.basename(a.replace("\\", "/")).lower() == _d_norm.lower()]
        return len(_same) <= 1

    _uncovered = [p for p in _wave_assets
                  if not any(_named(p, l) and _line_ok(l) for l in _render_lines)]
    if _uncovered:
        check(False, f"§V11.9 DOC-asset render gate: {_uncovered[0]} delivered without bound render "
                     "evidence — add `render: <asset> — <existing page images>` or "
                     "`render: <asset> — N/A (soffice missing)` (name the CONCRETE missing tool — "
                     "soffice|libreoffice|pymupdf|pdftoppm|poppler|imagemagick — never a placeholder) "
                     "to the log (NO RENDER, NO DONE)")
    # 17b) §V11.9 exec-check: delivered office assets need the named
    # executable-behavior check recorded (vbaProject/PDF JS/macro sheet).
    # The verdict is the token AFTER the separator — "unclean"/"not clean"
    # never certifies ("clean|escalat" substring search was laundersible).
    _exec_lines = [l for l in _live_lines(cur_block) if re.match(r"^\s*(?:[-*]\s+)?exec-check\s*:", l, re.I)]

    def _exec_ok(_l):
        _parts = _split_re.split(_l, maxsplit=1)
        if len(_parts) < 2:
            return False
        _verdict = _parts[1].strip().lower()
        return bool(re.match(r"clean\b", _verdict) or re.match(r"escalat", _verdict))

    _exec_uncovered = [p for p in _wave_assets
                       if not any(_named(p, l) and _exec_ok(l) for l in _exec_lines)]
    if _exec_uncovered:
        check(False, f"§V11.9 exec-check: {_exec_uncovered[0]} delivered without a recorded "
                     "executable-behavior check — add `exec-check: <asset> — clean` or "
                     "`exec-check: <asset> — escalated → Class CODE` (vbaProject.bin / PDF JS / macro sheet)")
    if cls:
        print(f"class: {cls} — {cls_basis}"
              + ("; group 4 N/A (no lesson / docs-only wave)" if class_skip_memory else "")
              + ("; group 5 N/A (no service lifecycle in a DOC wave)" if class_skip_service else ""))

    # 1) verification_log — exists, has >=1 standard iteration entry (COV-1)
    check(vl and len(vl.strip()) > 0, "tests/verification_log.md missing or empty (COV-1)")
    check(bool(re.search(r"^- iter \d+ (PASS|FAIL):", vl, re.M)),
          "verification_log.md has no `- iter N PASS/FAIL:` entries (A4.1 Step 4)")

    # 2) acceptance.md — exists, first line cap/stall stop-condition (COV-7)
    check(bool(re.search(r"^>\s*cap=5\s+stall=3", acc, re.M)),
          "tests/acceptance.md missing first line `> cap=5  stall=3×` (COV-7)")

    # 3) screenshots cited in the log files must exist >0 bytes (A4.4)
    for png in re.findall(r"tests/(\S+\.png)", vl + "\n" + acc):
        p = tests / png
        check(p.exists() and p.stat().st_size > 0,
              f"screenshot claimed but missing/empty: tests/{png} (A4.4)")

    # 4) memory — MEMORY.md + >=1 topic file + index pointers (A7.9/A7.10)
    #    Class DOC / lesson-less CONFIG: N/A (§V11.3 lesson-triggered) —
    #    printed above as `class: … group 4 N/A` gate evidence.
    if not class_skip_memory:
        mem = root / "memory"
        idx_text = read(mem / "MEMORY.md")
        check(bool(idx_text), "memory/MEMORY.md missing (A7.10)")
        if idx_text:
            topics = sorted(mem.glob("*.md"))
            check(len(topics) >= 2, "memory/: MEMORY.md + >=1 topic file required (A7.9)")
            check(bool(re.search(r"\]\([^)]+\.md\)", idx_text)),
                  "memory/MEMORY.md index has no topic-file pointers (A7.9)")
            check(any(p.name != "MEMORY.md" for p in topics),
                  "memory/: at least one topic file besides MEMORY.md (A7.9)")

    # 5) scripts — start/stop/restart (+ project_build unless no-UI) (A2/COV-2)
    #    exec-bit is only meaningful on POSIX; on Windows .sh files ride along
    #    and only their existence is enforceable.
    #    Profiles (cli/library/web-static) skip this group — structurally N/A
    #    (a library has no service lifecycle; skipping is declarative, and the
    #    skip line above names it in the output for the completion gate).
    #    Class DOC: N/A — a prose change wave carries no service lifecycle.
    if not no_service and not class_skip_service:
        posix = os.name != "nt"
        for s in ["start.sh", "stop.sh", "restart.sh"]:
            sp = root / "script" / "linux" / s
            if not sp.exists():
                check(False, f"script/linux/{s} missing or not executable (A2/COV-2)")
                continue
            is_exec = bool(sp.stat().st_mode & 0o111) if posix else True
            check(is_exec,
                  f"script/linux/{s} missing or not executable (A2/COV-2)")
        if not backend_only:
            bp = root / "script" / "linux" / "project_build.sh"
            check(bp.exists(), "script/linux/project_build.sh missing (A2; use --backend-only if no UI)")

    # 6) git — new projects: repo exists with >=2 commits (C1 step 1/15, A9)
    if not existing:
        try:
            r = subprocess.run(["git", "-C", str(root), "log", "--oneline"],
                               capture_output=True, text=True, timeout=20)
            rc, out = r.returncode, r.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            rc, out = -1, ""
        n_commits = len([l for l in out.splitlines() if l.strip()]) if rc == 0 else 0
        check(rc == 0 and n_commits >= 2,
              f"new-project git repo needs >=2 commits (init + final); found {n_commits} (C1 step 1/15)")

    # 7) §A5 design docs — new projects (skipped with --existing) (A5 / C1 step 2)
    if not existing:
        for doc in ["FLOW_DESIGN.html", "DATABASE_DESIGN.html", "BACKEND_DESIGN.html"]:
            check((root / doc).exists(), f"new-project design doc missing: {doc} (A5 / C1 step 2)")
        if not backend_only:
            check((root / "PAGE_DESIGN.html").exists(),
                  "new-project design doc missing: PAGE_DESIGN.html (A5; use --backend-only if no UI)")

    # 8) README + requirements — new projects (skipped with --existing) (C1 step 15)
    if not existing:
        check(any((root / n).exists() for n in ["README.md", "README.html"]),
              "new-project README.md/README.html missing (C1 step 15)")
        check(any((root / n).exists() for n in ["requirements.txt", "package.json"]),
              "new-project requirements.txt/package.json missing (C1 step 15)")

    # 9) COV-9 — Modify-Existing tasks: baseline verdict recorded on disk (COV-9)
    #    State-skip is a Class DOC license; CONFIG/CODE run the baseline (§V11.3) —
    #    their skip must name a mid-task escalation, never "documentation-only".
    if existing:
        baseline_line = bool(re.search(r"Baseline verified GREEN", vl, re.M))
        # The skip license is scoped to the CURRENT task block — an older
        # block's `COV-9 skipped` is history and licenses nothing here
        # (same scoping as `- class:`, 2026-09-30 review).
        escalation_skip = bool(re.search(r"COV-9 skipped[^\n]*escalat", cur_block, re.M | re.I))
        # The state-skip license is Class DOC ONLY — an empty/absent class is
        # never DOC (§V11.2 uncertain → HIGHER class): unclassified tasks must
        # run the baseline or name an escalation (2026-09-30 wave-2 fix).
        doc_skip = bool(re.search(r"COV-9 skipped", cur_block, re.M)) and cls == "DOC"
        check(baseline_line or escalation_skip or doc_skip,
              "tests/verification_log.md missing `- Baseline verified GREEN` (COV-9); "
              "`- COV-9 skipped —` licenses Class DOC only (with a `- class: DOC — <basis>` "
              "line or `--class DOC`) — unclassified/CONFIG/CODE run the baseline "
              "or name an escalation (§V11.2/§V11.3)")

    # 10) A4.7b — workflow traces cited in the log must exist >0 bytes (A4.7b)
    for wf in re.findall(r"tests/workflows/(\S+?\.trace\.log)", vl):
        p = tests / "workflows" / wf
        check(p.exists() and p.stat().st_size > 0,
              f"workflow trace claimed but missing/empty: tests/workflows/{wf} (A4.7b)")

    # 11) A4.1 — video/audio evidence cited in the log must exist >0 bytes (A4.1 Step 2/3)
    for m in re.findall(r"tests/(\S+\.(?:webm|wav|mp4|mp3))", vl):
        p = tests / m
        check(p.exists() and p.stat().st_size > 0,
              f"media evidence claimed but missing/empty: tests/{m} (A4.1)")

    # 12) FAIL diagnosis clause — every failed iteration must carry its diagnosis
    #     (A4.1 Step 4 — a retry without its diagnosis is the same attempt again)
    for i, line in enumerate(vl.splitlines(), 1):
        if re.match(r"^- iter \d+ FAIL:", line.strip()):
            check("diagnosis:" in line,
                  f"verification_log.md line {i}: FAIL entry lacks `diagnosis:` clause (A4.1 Step 4)")

    # 13) claim-without-coverage — a verification claim must state what it covered
    #     (A4.4 Gate Function — "verified" without a stated scope is not a result)
    for i, snippet in claim_without_coverage(vl):
        check(False,
              f"verification_log.md line {i}: claim without stated coverage — {snippet!r} (A4.4 claim rule)")

    # 14) secret scan — the change-wave diff / untracked files must not ADD
    #     credential-looking lines (.md warn-only; placeholder-marked exempt)
    s14_fails, s14_warns = secret_scan(root, vl)
    for w in s14_warns:
        print("WARN " + w)
    for f in s14_fails:
        check(False, f)

    # 15) test-change guard — removed test assertions need a logged reason
    for f in test_change_guard(root, vl):
        check(False, f)

    # 16) risk-tier — risk-tier code paths require the A4.9 review package
    for f in risk_tier(root):
        check(False, f)

    if GIT_TIMEOUT:
        print("WARN groups 14-16: a git call timed out — content gates ran "
              "on partial data (fail-open); re-run to confirm")

    if FAILS:
        print("ASSERT FAILURES (%d):" % len(FAILS))
        for f in FAILS:
            print("  - " + f)
        sys.exit(1)
    print(f"assert_artifacts.py: all {PASSES} checks pass (exit 0)")


if __name__ == "__main__":
    main()
