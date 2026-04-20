# kimi-plugin-cc Phase 0 Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empirically resolve 5 runtime unknowns about the Kimi CLI, producing a machine-readable `doc/probe/probe-results.json` that the subsequent Phase 1 skeleton plan consumes as literal values — eliminating placeholder patterns in later code-writing plans.

**Architecture:** Each probe runs the kimi CLI in a controlled way, captures output, documents findings in `doc/probe/<NN>-<topic>.md`, and extracts key machine-readable values. A final consolidation task merges all findings into `probe-results.json` with a fixed schema that Phase 1 can validate against.

**Tech Stack:** kimi CLI ≥ 1.34 (**must be installed and logged in** before starting), POSIX shell, python3 (hashlib, json — both stdlib), node (for the final json consolidation).

**v0.1 total budget estimate:** ~85 tasks / ~300 steps across 5 phases. This plan covers **Phase 0 only (7 tasks, ~35 steps)**. Phase 1 skeleton (~12 tasks) will be written AFTER this plan's tag lands — its details depend on probe outcomes.

**Reference spec:** `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` §3 and Appendix A.

**Reference source:** `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/gemini.mjs` (the analogous logic in the sister plugin — read for context but do NOT copy code in this phase; no code is written in Phase 0).

**Cross-platform notes:**
- All shell commands must work on **macOS and Linux**. Do not use macOS-only `md5` (use `python3 -c "import hashlib, sys; ..."` instead). Do not use Linux-only `md5sum`. Do not hardcode absolute paths — use `"$PWD"` or paths relative to the plan file.
- Python3 ≥ 3.8 is assumed present.

**Exit criteria:**
- Git tag `phase-0-probes-done` applied
- `doc/probe/probe-results.json` committed, schema-valid (see Task P0.6)
- 6 probe docs committed under `doc/probe/`
- CHANGELOG.md entry appended with `status: done`, pointing to Phase 1 plan as `next`

**Explicit non-goals for this plan:**
- No source code in `plugins/kimi/` (Phase 1)
- No `/kimi:setup` command file (Phase 1)
- No skill content (`kimi-cli-runtime` SKILL.md draft is Phase 1 Task, seeded from probe-results.json)

---

## File Structure for this Plan

**Create:**
- `doc/probe/00-preflight.md` — environment preconditions and their check results
- `doc/probe/01-stream-json.md` — stream-json event taxonomy
- `doc/probe/02-work-dirs.md` — `~/.kimi/kimi.json` behavior + session directory hash
- `doc/probe/03-stdin.md` — large-prompt delivery mechanism
- `doc/probe/04-max-steps.md` — `--max-steps-per-turn` ping stability
- `doc/probe/05-failure-modes.md` — error exit codes and stderr shape
- `doc/probe/probe-results.json` — consolidated machine-readable summary

**Modify:**
- `CHANGELOG.md` (append phase-done entry)

---

## Task P0.0: Preflight — confirm kimi is installed and logged in

**Purpose:** Fail fast if the probe environment is broken. All subsequent probes **require** an authenticated kimi. Without this gate, probes return auth errors that look like real failure modes and pollute conclusions.

**Files:**
- Create: `doc/probe/00-preflight.md`

- [ ] **Step 1: Create probe directory**

```bash
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p doc/probe
```

- [ ] **Step 2: Check kimi binary on PATH**

```bash
command -v kimi || { echo "FAIL: kimi not on PATH"; exit 1; }
kimi -V
```

Expected: prints version (e.g., `kimi, version 1.34.0`). If it errors, stop and tell the user to install kimi first (see spec §4.2). Do not proceed to Step 3.

- [ ] **Step 3: Check credentials directory non-empty**

```bash
ls -A ~/.kimi/credentials/ | grep -v '^\.' | head -1 \
  || { echo "FAIL: ~/.kimi/credentials is empty — run 'kimi login' first"; exit 1; }
```

Expected: at least one non-dotfile listed. If empty, stop and tell the user `! kimi login`. Do not proceed.

- [ ] **Step 4: Validate login with a minimal live ping**

```bash
PING_OUT="$(mktemp)"
kimi -p "Reply with exactly: OK" --print --output-format stream-json --max-steps-per-turn 3 \
  > "$PING_OUT" 2>&1
ECODE=$?
echo "exit=$ECODE"
if [ $ECODE -ne 0 ]; then
  echo "FAIL: kimi ping returned non-zero. First 10 lines of output:"
  head -10 "$PING_OUT"
  rm -f "$PING_OUT"
  exit 1
fi

# Check for at least one assistant-role event in the JSONL stream
grep -c '"role":\s*"assistant"' "$PING_OUT" || {
  echo "FAIL: ping succeeded but no assistant-role event observed."
  echo "This likely means auth state is inconsistent. Try 'kimi logout' then 'kimi login'."
  rm -f "$PING_OUT"
  exit 1
}
rm -f "$PING_OUT"
```

Expected: exit 0 with at least one assistant event observed.

- [ ] **Step 5: Write doc/probe/00-preflight.md**

```markdown
# Probe 00: Preflight

## Environment
- OS: <macos|linux> (recorded at probe time)
- kimi version: <output of `kimi -V`>
- `~/.kimi/credentials/` entries: <count>
- Auth check ping: PASS

## Notes
<any noteworthy system details, e.g., kimi installed via uv/pipx/brew/shell>
```

- [ ] **Step 6: Commit**

```bash
git add doc/probe/00-preflight.md
git commit -m "probe: preflight — kimi installed and authenticated"
```

---

## Task P0.1: Probe stream-json event taxonomy

**Purpose:** Confirm the exact JSONL event shape. Codex source-read of `kimi_cli/ui/print/visualize.py` and `kosong/message.py` indicates events are **flat** with `role` and `content` keys (no `{message:{...}}` nesting). This probe empirically confirms and captures the session-id carrier.

**Files:**
- Create: `doc/probe/01-stream-json.md`

- [ ] **Step 1: Run a minimal stream-json call**

```bash
cd "$(git rev-parse --show-toplevel)"
OUT=/tmp/kimi-probe-01.out
ERR=/tmp/kimi-probe-01.err
kimi -p "Reply with exactly: OK" --print --output-format stream-json \
  > "$OUT" 2> "$ERR"
echo "exit=$?"
echo "--- stdout ---"
cat "$OUT"
echo "--- stderr (first 20 lines) ---"
head -20 "$ERR"
```

Expected: exit 0, stdout contains multiple JSON objects separated by newlines.

- [ ] **Step 2: Extract event shapes with python**

```bash
python3 - <<'PY'
import json, sys
with open("/tmp/kimi-probe-01.out") as f:
    events = [json.loads(line) for line in f if line.strip().startswith("{")]
for i, e in enumerate(events):
    print(f"--- event[{i}] keys: {list(e.keys())}")
    for k in e:
        v = e[k]
        if isinstance(v, str) and len(v) > 80:
            v = v[:80] + "..."
        print(f"   {k!r}: {v!r}" if not isinstance(v, (dict, list)) else f"   {k!r}: <{type(v).__name__}>")
PY
```

- [ ] **Step 3: Identify required fields**

From Step 2 output, identify:
- **Event type key**: the key whose values tag event kind (candidates: `type`, `event`, `role`). Codex expects `role` + `content` flat shape; if a `type` key exists alongside, record both.
- **Session id key and event**: which event carries the session id, and under what key (`session_id`, `id`, `sessionId`).
- **Assistant content key**: where assistant text lives (should be `content` per codex).
- **Stats/result event**: if present, which event signals end-of-turn and what token counts look like.

- [ ] **Step 4: Write doc/probe/01-stream-json.md**

```markdown
# Probe 01: stream-json event taxonomy

## Run
`kimi -p "Reply with exactly: OK" --print --output-format stream-json`

## Raw events (annotated)
(paste python output from Step 2)

## Findings
- **Flat structure confirmed**: events are/are-not nested. (codex source-read predicts flat)
- **event_type_key**: <key name or "none — use role alone">
- **session_id_key**: <key>
- **session_id_event_index**: <which event carries it — 0 is first>
- **assistant_content_key**: <key — codex predicts "content">
- **assistant_role_value**: <expected "assistant">
- **stats_event_present**: <true|false>
- **stats_keys**: <list or null>

## Caveats
<any surprises: mixed event shapes, non-JSON lines, etc.>
```

- [ ] **Step 5: Commit**

```bash
git add doc/probe/01-stream-json.md
git commit -m "probe: stream-json event taxonomy"
```

---

## Task P0.2: Probe kimi.json work_dirs update + session directory hash

**Purpose:** Determine whether `~/.kimi/kimi.json.work_dirs[].last_session_id` updates in `--print` mode, and confirm the hash algorithm for the first-level `~/.kimi/sessions/<hash>/` directory. These drive spec §3.4 session-id fallback strategy.

**Files:**
- Create: `doc/probe/02-work-dirs.md`

- [ ] **Step 1: Snapshot kimi.json and read current work_dirs entry**

```bash
REPO="$(git rev-parse --show-toplevel)"
BEFORE=/tmp/kimi-before.json
AFTER=/tmp/kimi-after.json
cp ~/.kimi/kimi.json "$BEFORE"

SESSION_BEFORE=$(python3 - <<PY
import json, sys
d = json.load(open("$BEFORE"))
wd = [w for w in d.get("work_dirs", []) if w.get("path") == "$REPO"]
print(wd[0].get("last_session_id") if wd else "NONE")
PY
)
echo "before: $SESSION_BEFORE"
```

- [ ] **Step 2: Compute the expected work_dir_hash for the repo path**

```bash
REPO="$(git rev-parse --show-toplevel)"
HASH_MD5=$(python3 -c "import hashlib, sys; print(hashlib.md5(sys.argv[1].encode()).hexdigest())" "$REPO")
HASH_SHA1=$(python3 -c "import hashlib, sys; print(hashlib.sha1(sys.argv[1].encode()).hexdigest())" "$REPO")
echo "md5 of path:  $HASH_MD5"
echo "sha1 of path: $HASH_SHA1"
```

Save both values — the directory kimi creates (Step 4) will match one (probably md5 — 32 hex chars in existing samples) and we want to confirm.

- [ ] **Step 3: Invoke kimi with explicit -w pointing to this repo**

```bash
kimi -p "Reply with exactly: DONE" --print --output-format stream-json -w "$REPO" \
  > /tmp/probe2.out 2>&1
echo "exit=$?"
tail -3 /tmp/probe2.out
```

Expected: exit 0.

- [ ] **Step 4: Compare before/after and identify created directories**

```bash
cp ~/.kimi/kimi.json "$AFTER"
diff "$BEFORE" "$AFTER" || true

REPO="$(git rev-parse --show-toplevel)"
SESSION_AFTER=$(python3 - <<PY
import json
d = json.load(open("$AFTER"))
wd = [w for w in d.get("work_dirs", []) if w.get("path") == "$REPO"]
print(wd[0].get("last_session_id") if wd else "NONE")
PY
)
echo "after: $SESSION_AFTER"

echo "--- top-level dirs created/modified since probe start ---"
# Find dirs under ~/.kimi/sessions modified in the last 2 minutes
find ~/.kimi/sessions -maxdepth 1 -type d -mmin -2 -not -path ~/.kimi/sessions
```

- [ ] **Step 5: Identify the hash algorithm**

```bash
REPO="$(git rev-parse --show-toplevel)"
HASH_MD5=$(python3 -c "import hashlib, sys; print(hashlib.md5(sys.argv[1].encode()).hexdigest())" "$REPO")
# The directory printed in step 4 should match one of these hashes.
# Document which.
echo "md5=$HASH_MD5"
ls -d ~/.kimi/sessions/$HASH_MD5 2>/dev/null && echo "MD5 MATCH" || echo "MD5 NO MATCH — check sha1 / sha256"
```

- [ ] **Step 6: Write doc/probe/02-work-dirs.md**

```markdown
# Probe 02: kimi.json work_dirs + session dir hash

## Environment
- Repo path probed: <$REPO at probe time>
- Session id before: <SESSION_BEFORE>
- Session id after: <SESSION_AFTER>

## Findings
- **work_dirs updated in --print mode**: <true|false>
- **new work_dirs entry created for a fresh path**: <true|false>
- **work_dir hash algorithm**: <md5|sha1|sha256|other>
- **path storage format**: <verbatim-input|realpath-resolved>
- **last_session_id updated synchronously with --print exit**: <true|false>

## Diff of kimi.json (before vs after)
```diff
(paste diff output)
```

## Implication for spec §3.4 Secondary fallback
<If work_dirs DOES update in --print: Secondary path is viable. If NOT: rely exclusively on stream-json event from Probe 01.>
```

- [ ] **Step 7: Commit**

```bash
git add doc/probe/02-work-dirs.md
git commit -m "probe: kimi.json work_dirs + session hash"
```

---

## Task P0.3: Probe stdin delivery for large prompts

**Purpose:** Determine whether kimi reads prompts from stdin (gemini's pattern for prompts > 100KB) or requires everything via `-p "..."`. This decides the large-prompt code path in Phase 2.

**Files:**
- Create: `doc/probe/03-stdin.md`

- [ ] **Step 1: Probe pure stdin with empty `-p`**

```bash
echo "Reply with exactly: OK" | kimi -p "" --print --output-format stream-json \
  > /tmp/probe3a.out 2>&1
echo "exit-a=$?"
tail -3 /tmp/probe3a.out
# Check for "OK" in assistant content, not just exit code
grep -q '"content":.*"OK"' /tmp/probe3a.out && echo "stdin-read=YES" || echo "stdin-read=NO"
```

- [ ] **Step 2: Probe `-p` with inline large prompt (~20KB)**

```bash
python3 -c 'print("Summarize in one word: " + "hello world " * 2000 + "\nReply exactly: LONG")' > /tmp/big-prompt.txt
BIG=$(cat /tmp/big-prompt.txt)
kimi -p "$BIG" --print --output-format stream-json > /tmp/probe3b.out 2>&1
echo "exit-b=$?"
grep -q '"content":.*"LONG"' /tmp/probe3b.out && echo "inline-p=YES" || echo "inline-p=NO"
```

- [ ] **Step 3: Probe tmpfile + command substitution**

```bash
kimi -p "$(cat /tmp/big-prompt.txt)" --print --output-format stream-json > /tmp/probe3c.out 2>&1
echo "exit-c=$?"
grep -q '"content":.*"LONG"' /tmp/probe3c.out && echo "tmpfile-cat=YES" || echo "tmpfile-cat=NO"
```

- [ ] **Step 4: Probe with 200KB prompt via whichever mechanism worked at this scale**

If Step 1 succeeded (stdin works), retry with a 200KB prompt via stdin to hit argv length limits. If stdin didn't work, retry Steps 2-3 at 200KB to find the failure threshold.

```bash
python3 -c 'print("X"*200000 + "\nReply exactly: BIG")' > /tmp/huge-prompt.txt
# Run whichever mechanism succeeded above at 20KB:
cat /tmp/huge-prompt.txt | kimi -p "" --print --output-format stream-json > /tmp/probe3d.out 2>&1
echo "exit-huge-stdin=$?"
```

- [ ] **Step 5: Write doc/probe/03-stdin.md**

```markdown
# Probe 03: stdin + large-prompt delivery

## Results
| Mechanism | 200B (Step 1) | 20KB (Step 2/3) | 200KB (Step 4) | Notes |
|---|---|---|---|---|
| stdin pipe, `-p ""` | <YES/NO> | <YES/NO> | <YES/NO> | |
| inline `-p "$BIG"` | N/A | <YES/NO> | <YES/NO> | shell arg limit |
| tmpfile + `-p "$(cat ...)"` | N/A | <YES/NO> | <YES/NO> | |

## Recommendation (for Phase 2 kimi.mjs)
- **LARGE_PROMPT_STRATEGY** = `<stdin|tmpfile|inline>`
- **LARGE_PROMPT_THRESHOLD** = use strategy above when prompt length exceeds <N> bytes
```

- [ ] **Step 6: Commit**

```bash
git add doc/probe/03-stdin.md
git commit -m "probe: stdin and large-prompt delivery"
```

---

## Task P0.4: Probe --max-steps-per-turn ping stability

**Purpose:** Decide the N value for the authentication ping call. Gemini's Phase 0 gate already used N=3 — this task finds the smallest N that is 3/3 reliable.

**Files:**
- Create: `doc/probe/04-max-steps.md`

- [ ] **Step 1: Run 3 trials each at N=1, N=2, N=3**

```bash
for N in 1 2 3; do
  for i in 1 2 3; do
    OUT=$(kimi -p "ping" --print --output-format stream-json --max-steps-per-turn $N 2>&1)
    ECODE=$?
    # Success = exit 0 AND at least one assistant event with non-empty content
    if [ $ECODE -eq 0 ] && echo "$OUT" | grep -q '"role":\s*"assistant"' && echo "$OUT" | grep -q '"content":\s*"[^"][^"]*"'; then
      RESULT=PASS
    else
      RESULT=FAIL
    fi
    echo "N=$N trial=$i exit=$ECODE result=$RESULT"
  done
done | tee /tmp/probe4.log
```

- [ ] **Step 2: Tally and pick the smallest reliable N**

```bash
python3 - <<'PY'
from collections import defaultdict
counts = defaultdict(lambda: [0,0])  # [pass, total]
for line in open("/tmp/probe4.log"):
    parts = dict(p.split("=") for p in line.strip().split() if "=" in p)
    if "N" in parts:
        n = int(parts["N"])
        counts[n][1] += 1
        if parts.get("result") == "PASS":
            counts[n][0] += 1
for n in sorted(counts):
    p, t = counts[n]
    print(f"N={n}: {p}/{t}")
chosen = next((n for n in sorted(counts) if counts[n][0] == counts[n][1] == 3), None)
print(f"CHOSEN_PING_MAX_STEPS={chosen}")
PY
```

- [ ] **Step 3: Write doc/probe/04-max-steps.md**

```markdown
# Probe 04: --max-steps-per-turn ping stability

## Results (3 trials each)
| N | pass / total | notes |
|---|---|---|
| 1 | ? / 3 | |
| 2 | ? / 3 | |
| 3 | ? / 3 | |

## Conclusion
- **PING_MAX_STEPS = <N>**
- Reason: smallest N with 3/3 pass; chosen to minimize auth probe cost.
- If no N is 3/3: fall back to `--max-steps-per-turn 3` with an extended 30s timeout (document this alternate).
```

- [ ] **Step 4: Commit**

```bash
git add doc/probe/04-max-steps.md
git commit -m "probe: --max-steps-per-turn ping stability"
```

---

## Task P0.5: Probe stream-json failure modes

**Purpose:** Characterize exit codes, stderr shape, and stream state for the three most likely runtime failures — SIGTERM mid-stream, invalid model, bad cwd — so Phase 2 callKimiStreaming can distinguish them.

**Files:**
- Create: `doc/probe/05-failure-modes.md`

- [ ] **Step 1: Interrupt mid-stream**

```bash
kimi -p "Count slowly from 1 to 100, one number per line, with a sentence of explanation for each" \
     --print --output-format stream-json > /tmp/probe5a.out 2>&1 &
PID=$!
sleep 2
kill -TERM $PID 2>/dev/null
wait $PID; ECODE=$?
echo "exit=$ECODE"
echo "--- last 3 lines of stdout ---"
tail -3 /tmp/probe5a.out
```

Record: exit code, whether the stream was cut mid-event (last line is partial JSON), whether any "result"/"end" event was emitted.

- [ ] **Step 2: Invalid model**

```bash
kimi -p "hi" --print --output-format stream-json -m nonexistent-model-9999 \
  > /tmp/probe5b.out 2> /tmp/probe5b.err
echo "exit=$?"
echo "--- stdout ---"
head -5 /tmp/probe5b.out
echo "--- stderr ---"
head -10 /tmp/probe5b.err
```

Record: exit code, whether stderr is JSON or free-form text, whether stdout has a structured error event or is empty.

- [ ] **Step 3: Unreachable cwd**

```bash
kimi -p "hi" --print --output-format stream-json -w /nonexistent/totally-not-a-path \
  > /tmp/probe5c.out 2> /tmp/probe5c.err
echo "exit=$?"
head -5 /tmp/probe5c.err
```

- [ ] **Step 4: Write doc/probe/05-failure-modes.md**

```markdown
# Probe 05: stream-json failure modes

| Scenario | Exit code | stdout state | stderr format | Partial session created? |
|---|---|---|---|---|
| SIGTERM mid-stream | <int> | <complete/partial/empty> | <json/text/empty> | <yes/no> |
| Invalid model | <int> | <complete/partial/empty> | <json/text/empty> | <yes/no> |
| Bad cwd | <int> | <complete/partial/empty> | <json/text/empty> | <yes/no> |

## Recovery recommendations for callKimi / callKimiStreaming
- On non-zero exit, first attempt to parse the last complete JSON event from stdout to capture any partial response.
- Stderr parsing: <if JSON, extract error.message; if text, show verbatim clipped to 200 chars>.
- Partial session directories should be treated as session-less (do not read Secondary fallback).
```

- [ ] **Step 5: Commit**

```bash
git add doc/probe/05-failure-modes.md
git commit -m "probe: stream-json failure modes"
```

---

## Task P0.6: Consolidate probes into machine-readable probe-results.json

**Purpose:** Produce a single JSON file that Phase 1 reads as literal values (no placeholder substitution in Phase 1 code). Fixed schema so Phase 1 author can validate the file is complete.

**Files:**
- Create: `doc/probe/probe-results.json`

- [ ] **Step 1: Draft probe-results.json using probe findings**

Create the file with the exact schema below. Every field must be populated from a probe document; if unknowable, use an explicit `null` or empty array — never leave `TBD`.

```json
{
  "schema_version": 1,
  "probed_at": "2026-04-DDTHH:MM:SS",
  "kimi_version": "1.34.0",
  "platform": "darwin|linux",

  "stream_json": {
    "flat_event_shape": true,
    "event_type_key": "role-or-type",
    "session_id_key": "session_id",
    "session_id_carrier_event_index": 0,
    "assistant_content_key": "content",
    "assistant_role_value": "assistant",
    "stats_event_present": true,
    "stats_keys": ["input_tokens", "output_tokens"]
  },

  "work_dirs": {
    "updated_in_print_mode": true,
    "new_entry_for_fresh_path": true,
    "hash_algorithm": "md5",
    "path_storage_format": "verbatim",
    "last_session_id_updated_synchronously": true
  },

  "large_prompts": {
    "stdin_pipe_works": true,
    "inline_p_works_at_20k": true,
    "tmpfile_cat_works_at_20k": true,
    "stdin_works_at_200k": true,
    "recommended_strategy": "stdin",
    "threshold_bytes": 100000
  },

  "auth_ping": {
    "recommended_max_steps_per_turn": 3,
    "trials": { "n1": "1/3", "n2": "3/3", "n3": "3/3" }
  },

  "failure_modes": {
    "sigterm_mid_stream": { "exit_code": 143, "stdout_state": "partial", "stderr_format": "text" },
    "invalid_model": { "exit_code": 1, "stdout_state": "empty", "stderr_format": "text" },
    "bad_cwd": { "exit_code": 1, "stdout_state": "empty", "stderr_format": "text" }
  }
}
```

Replace every value with the real probe finding. Values above are illustrative placeholders **for the plan**, not for the committed file. The committed file must have real values.

- [ ] **Step 2: Validate with python**

```bash
python3 - <<'PY'
import json
required_top = {"schema_version", "probed_at", "kimi_version", "platform",
                "stream_json", "work_dirs", "large_prompts", "auth_ping", "failure_modes"}
data = json.load(open("doc/probe/probe-results.json"))
missing = required_top - set(data.keys())
assert not missing, f"missing top-level keys: {missing}"
sj = data["stream_json"]
assert "event_type_key" in sj and sj["event_type_key"], "missing event_type_key"
assert "session_id_key" in sj, "missing session_id_key"
assert "assistant_content_key" in sj, "missing assistant_content_key"
wd = data["work_dirs"]
assert "updated_in_print_mode" in wd, "missing work_dirs.updated_in_print_mode"
assert "hash_algorithm" in wd, "missing work_dirs.hash_algorithm"
lp = data["large_prompts"]
assert lp.get("recommended_strategy") in ("stdin", "tmpfile", "inline"), "bad recommended_strategy"
ap = data["auth_ping"]
assert isinstance(ap.get("recommended_max_steps_per_turn"), int), "bad recommended_max_steps_per_turn"
assert data["auth_ping"]["recommended_max_steps_per_turn"] >= 1
assert data["auth_ping"]["recommended_max_steps_per_turn"] <= 5
print("probe-results.json is schema-valid")
PY
```

Expected: `probe-results.json is schema-valid`. If any assertion fails, re-open the corresponding probe doc and fill the missing field.

- [ ] **Step 3: Commit**

```bash
git add doc/probe/probe-results.json
git commit -m "probe: consolidated probe-results.json for Phase 1 consumption"
```

---

## Task P0.7: Finalize Phase 0 and tag

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Append CHANGELOG entry**

Add at the top of `CHANGELOG.md` (below the existing header):

```markdown
## 2026-04-DD HH:MM [<author>]

- **status**: done
- **scope**: doc/probe/
- **summary**: Phase 0 probes complete. 6 probe docs + probe-results.json committed.
  stream-json event shape empirically confirmed flat {role, content}. Session-id
  carried by <event>/<key> (from probe 01). work_dirs update-in-print-mode: <y/n>.
  Large-prompt strategy: <strategy>. Auth ping N=<N>.
- **next**: Hand off to Phase 1 plan writer. Phase 1 plan must read doc/probe/probe-results.json
  at the start of plan authoring and embed literal values — no placeholders allowed.
```

- [ ] **Step 2: Tag the phase**

```bash
git add CHANGELOG.md
git commit -m "chore: Phase 0 probes done — ready for Phase 1 plan"
git tag -a phase-0-probes-done -m "Phase 0 probes complete; probe-results.json ready"
```

- [ ] **Step 3: Verify exit criteria**

```bash
ls -la doc/probe/
git tag | grep phase-0
python3 -c 'import json; json.load(open("doc/probe/probe-results.json"))'
```

Expected: 7 probe files, tag present, JSON valid.

---

## Self-Review

**Spec coverage (this plan only covers spec Appendix A probes):**
- Appendix A item 1 (stream-json event taxonomy) → P0.1 ✅
- Appendix A item 2 (work_dirs + session hash) → P0.2 ✅
- Appendix A item 3 (stdin support) → P0.3 ✅
- Appendix A item 4 (--max-steps-per-turn stability) → P0.4 ✅
- Appendix A item 5 (failure modes) → P0.5 ✅
- Preflight gate (auth precondition) → P0.0 ✅ (added per review)
- Consolidation for Phase 1 → P0.6 ✅ (added to eliminate Phase 1 placeholders)

**Placeholder scan:** the `<N>`, `<y/n>`, `<strategy>` patterns in the CHANGELOG entry of P0.7 are template slots to be filled in **by the executor at commit time**, not unresolved design questions — they collapse to real values as P0.7 executes. The illustrative values in Task P0.6 Step 1 are explicitly labeled "not for the committed file." No placeholder-failure.

**Cross-platform scan:** no `md5`, no `md5sum`, no hardcoded absolute paths to `/Users/bing/...`. All hashing uses `python3 hashlib`. All path anchors use `git rev-parse --show-toplevel` or `$PWD`. ✅

**Type/field consistency:** the JSON schema in P0.6 uses keys that flow to Phase 1 (`event_type_key`, `session_id_key`, `assistant_content_key`, `recommended_max_steps_per_turn`, `recommended_strategy`, `hash_algorithm`). The Phase 1 plan must read these exact field paths.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-20-phase-0-probes.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — one fresh subagent per probe task, human review between. Probes are independent after P0.0 passes, so parallelism is possible but not necessary.

**2. Inline Execution** — run the probes in this session with executing-plans. Slower but lets you interpret probe results in real time and catch weird kimi behavior instantly.

**After this plan completes:** the Phase 1 skeleton plan will be written, reading `probe-results.json` for all literal values — no placeholders, no `<PING_MAX_STEPS>` substitutions. Previous plan `_archive-2026-04-20-phase-0-1-foundation.md` is archived but can be consulted for the full Phase 1 task shape.

Which execution approach?
