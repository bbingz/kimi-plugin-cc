# kimi-plugin-cc Phase 0 + Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal working skeleton of `kimi-plugin-cc` — a Claude Code plugin that wraps Moonshot Kimi CLI — sufficient to pass spec acceptance tests T1 (`/kimi:setup --json` returns full status) and T8 (install flow on a fresh environment). Probe the 5 unknowns required for later phases.

**Architecture:** Node.js zero-dependency plugin. `scripts/kimi-companion.mjs` is the single entry point dispatched to by command `.md` files. `scripts/lib/kimi.mjs` is the only kimi-specific module; the rest (`args.mjs`, `process.mjs`, `state.mjs`, `render.mjs`, `git.mjs`) are copied from `gemini-plugin-cc` near-verbatim with name/path changes only. Authority for CLI invocation: `kimi -p "<prompt>" --print --output-format stream-json`.

**Tech Stack:** Node.js ≥18 (built-ins only: `node:child_process`, `node:fs`, `node:path`, `node:os`, `node:crypto`, `node:string_decoder`). No npm deps. Moonshot Kimi CLI ≥1.34 as runtime requirement.

**Reference spec:** `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` (especially §3-§5, Appendix A).

**Reference source:** `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/` — this plan references specific files there for "near-copy" tasks. The author must **read each file fully before rewriting locally** (P2 principle: no sed, no cp).

**Exit criteria for this plan:**
- T1 passes: `node scripts/kimi-companion.mjs setup --json` returns `{installed, authenticated, model, version}` all populated
- T8 passes: on a machine without kimi, setup branches to install suggestion
- `doc/probe/*.md` documents 5 probe results
- `skills/kimi-cli-runtime/SKILL.md` v0.1 draft committed
- `skills/kimi-prompting/SKILL.md` skeleton committed

---

## File Structure for this Plan

**Create:**
- `.gitignore`
- `README.md`
- `CLAUDE.md`
- `.claude-plugin/marketplace.json`
- `plugins/kimi/.claude-plugin/plugin.json`
- `plugins/kimi/CHANGELOG.md`
- `plugins/kimi/scripts/kimi-companion.mjs` — main entry dispatcher
- `plugins/kimi/scripts/lib/args.mjs` — near-copy from gemini
- `plugins/kimi/scripts/lib/process.mjs` — near-copy from gemini
- `plugins/kimi/scripts/lib/render.mjs` — near-copy from gemini
- `plugins/kimi/scripts/lib/git.mjs` — near-copy from gemini
- `plugins/kimi/scripts/lib/state.mjs` — near-copy + path changes
- `plugins/kimi/scripts/lib/kimi.mjs` — fully new: core kimi CLI wrapper
- `plugins/kimi/commands/setup.md`
- `plugins/kimi/skills/kimi-cli-runtime/SKILL.md`
- `plugins/kimi/skills/kimi-prompting/SKILL.md`
- `doc/probe/01-stream-json.md` through `05-failure-modes.md`

**Already exists (created during brainstorming):**
- `CHANGELOG.md`
- `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md`

---

## Phase 0: Probes

Purpose: resolve 5 unknowns from spec Appendix A before writing code that depends on them. Each probe produces a `doc/probe/*.md` file that Phase 1 cites when making decisions.

### Task P0.1: Probe stream-json event taxonomy

**Files:**
- Create: `doc/probe/01-stream-json.md`

- [ ] **Step 1: Run a minimal stream-json call and capture output**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
mkdir -p doc/probe
kimi -p "Reply with exactly: OK" --print --output-format stream-json > /tmp/kimi-stream.out 2> /tmp/kimi-stream.err
echo "exit=$?"
```

Expected: exit 0. `/tmp/kimi-stream.out` contains multiple JSON lines (JSONL). `/tmp/kimi-stream.err` may have minor log lines but no stack trace.

- [ ] **Step 2: Inspect event shapes**

Read `/tmp/kimi-stream.out` line by line and record, for each unique event type:
- The field name used for the event type (candidates: `type`, `event`, `kind`)
- The field name carrying the session id (candidates: `session_id`, `id`, `sessionId`)
- The field name carrying assistant content (candidates: `content`, `text`, `delta`, `message.content`)
- Whether there is a final result/stats event and where token counts live

- [ ] **Step 3: Write doc/probe/01-stream-json.md**

Document findings as a table:
```markdown
# Probe: stream-json event taxonomy

## Run
`kimi -p "Reply with exactly: OK" --print --output-format stream-json`

## Events observed (in order)
| Line# | Top-level keys | Event type value | session_id key | content key | stats keys |
|---|---|---|---|---|---|
| 1 | ... | ... | ... | ... | ... |
...

## Conclusions
- EVENT_TYPE_KEY = "<type|event|kind>"
- SESSION_ID_KEY = "<session_id|id|...>"
- ASSISTANT_CONTENT_KEY = "<content|text|...>"
- SESSION_ID_FIRST_APPEARS_IN = "<init|start|first-message|result>"
- STATS_EVENT_TYPE = "<result|end|summary>"

## Raw sample
(pasted 5-10 lines from /tmp/kimi-stream.out)
```

- [ ] **Step 4: Commit**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git init 2>/dev/null; true
git add doc/probe/01-stream-json.md
git commit -m "probe: stream-json event taxonomy"
```

---

### Task P0.2: Probe kimi.json work_dirs update behavior in --print

**Files:**
- Create: `doc/probe/02-work-dirs.md`

- [ ] **Step 1: Snapshot kimi.json, call with explicit -w, diff**

```bash
cp ~/.kimi/kimi.json /tmp/kimi-before.json
SESSION_BEFORE=$(python3 -c "import json; d=json.load(open('/tmp/kimi-before.json')); wd=[w for w in d['work_dirs'] if w['path']=='/Users/bing/-Code-/kimi-plugin-cc']; print(wd[0]['last_session_id'] if wd else 'NONE')")
echo "before: $SESSION_BEFORE"

kimi -p "Reply: DONE" --print --output-format stream-json -w /Users/bing/-Code-/kimi-plugin-cc > /tmp/probe2.out 2>&1
echo "exit=$?"

cp ~/.kimi/kimi.json /tmp/kimi-after.json
SESSION_AFTER=$(python3 -c "import json; d=json.load(open('/tmp/kimi-after.json')); wd=[w for w in d['work_dirs'] if w['path']=='/Users/bing/-Code-/kimi-plugin-cc']; print(wd[0]['last_session_id'] if wd else 'NONE')")
echo "after: $SESSION_AFTER"

diff /tmp/kimi-before.json /tmp/kimi-after.json || true
```

Expected: an entry for `/Users/bing/-Code-/kimi-plugin-cc` appears in `work_dirs` if not present; `last_session_id` is set or updated.

- [ ] **Step 2: Check session directory was created**

```bash
ls -lat ~/.kimi/sessions/ | head -5
# The newest work_dir_hash directory should match the md5 of the cwd
echo -n "/Users/bing/-Code-/kimi-plugin-cc" | md5
```

Note whether kimi uses `md5` or a different hash (SHA256 truncated, etc.) for the first-level directory name.

- [ ] **Step 3: Write doc/probe/02-work-dirs.md**

Record:
- Whether `--print` updates `work_dirs`
- Whether a new work_dirs entry is created for a cwd not previously seen
- The hash algorithm used for the first-level session directory
- Whether `-w <absolute>` is written verbatim into `path` or resolved to realpath
- Whether `last_session_id` is updated inline with `--print` runs or only on interactive exits

If `work_dirs` is NOT updated during `--print` mode, the §3.4 Secondary fallback is broken and we MUST rely on the stream-json event. Flag this prominently.

- [ ] **Step 4: Commit**

```bash
git add doc/probe/02-work-dirs.md
git commit -m "probe: kimi.json work_dirs update behavior"
```

---

### Task P0.3: Probe stdin support for large prompts

**Files:**
- Create: `doc/probe/03-stdin.md`

- [ ] **Step 1: Test piping a prompt via stdin**

```bash
echo "Reply with exactly: OK" | kimi -p "" --print --output-format stream-json > /tmp/probe3a.out 2>&1
echo "exit-a=$?"
tail -2 /tmp/probe3a.out
```

- [ ] **Step 2: Test with large prompt via tmpfile**

```bash
# Generate ~20KB prompt
python3 -c "print('Summarize this text in one word: ' + 'hello world ' * 2000 + '. Reply exactly: LONG')" > /tmp/big-prompt.txt
kimi -p "$(cat /tmp/big-prompt.txt)" --print --output-format stream-json > /tmp/probe3b.out 2>&1
echo "exit-b=$?"
tail -2 /tmp/probe3b.out
```

- [ ] **Step 3: Test stdin + explicit `-p ""`**

```bash
cat /tmp/big-prompt.txt | kimi -p "" --print --output-format stream-json > /tmp/probe3c.out 2>&1
echo "exit-c=$?"
tail -2 /tmp/probe3c.out
```

- [ ] **Step 4: Write doc/probe/03-stdin.md**

Document which of (a/b/c) succeeded, failure modes for any that failed, OS-level argv length limits observed, and the recommended strategy for large prompts:
- If (a) works: use stdin pipe (preferred, matches gemini.mjs pattern)
- If only (b) works: write to tmpfile + `-p "$(cat ...)"` (less elegant, shell-level issues with quoting)
- If only (c) works: stdin with explicit empty `-p ""` placeholder

Set `LARGE_PROMPT_STRATEGY = "<stdin|tmpfile>"` conclusion.

- [ ] **Step 5: Commit**

```bash
git add doc/probe/03-stdin.md
git commit -m "probe: stdin support for large prompts"
```

---

### Task P0.4: Probe --max-steps-per-turn stability for ping calls

**Files:**
- Create: `doc/probe/04-max-steps.md`

- [ ] **Step 1: Run ping at N=1,2,3 three times each**

```bash
for N in 1 2 3; do
  echo "=== N=$N ==="
  for i in 1 2 3; do
    OUT=$(kimi -p "ping" --print --output-format stream-json --max-steps-per-turn $N 2>&1)
    ECODE=$?
    # Count assistant message events in output
    ASSISTANT_COUNT=$(echo "$OUT" | grep -c '"role":"assistant"' || true)
    echo "  run$i: exit=$ECODE assistant_events=$ASSISTANT_COUNT"
  done
done
```

- [ ] **Step 2: Record success criterion**

"Success" = exit 0 AND at least one assistant message event with non-empty content was observed in the stream.

- [ ] **Step 3: Write doc/probe/04-max-steps.md**

Record success rate per N value. Recommend the smallest N with 3/3 success.

```markdown
# Probe: --max-steps-per-turn stability

| N | runs succeeded / 3 | notes |
|---|---|---|
| 1 | ... | ... |
| 2 | ... | ... |
| 3 | ... | ... |

**Conclusion:** `PING_MAX_STEPS = <N>` with reason ...
```

- [ ] **Step 4: Commit**

```bash
git add doc/probe/04-max-steps.md
git commit -m "probe: --max-steps-per-turn ping stability"
```

---

### Task P0.5: Probe stream-json failure modes

**Files:**
- Create: `doc/probe/05-failure-modes.md`

- [ ] **Step 1: Test interrupt mid-stream**

```bash
# Start a long-ish call in background and SIGTERM it after 2s
kimi -p "Count slowly from 1 to 100, one number per line, with explanation" \
     --print --output-format stream-json > /tmp/probe5a.out 2>&1 &
PID=$!
sleep 2
kill -TERM $PID 2>/dev/null
wait $PID
echo "exit=$?"
tail -3 /tmp/probe5a.out
```

- [ ] **Step 2: Test invalid model name**

```bash
kimi -p "hi" --print --output-format stream-json -m nonexistent-model-9999 > /tmp/probe5b.out 2>&1
echo "exit=$?"
tail -5 /tmp/probe5b.out
```

- [ ] **Step 3: Test unreachable working directory**

```bash
kimi -p "hi" --print --output-format stream-json -w /nonexistent/path > /tmp/probe5c.out 2>&1
echo "exit=$?"
tail -5 /tmp/probe5c.out
```

- [ ] **Step 4: Write doc/probe/05-failure-modes.md**

Document for each failure:
- Exit code
- Whether any JSON was emitted to stdout before failure
- Whether stderr has a parseable JSON error object or free-form text
- Whether a partial/truncated session record was written to `~/.kimi/sessions/`

This feeds the `callKimiStreaming` error-handling branch.

- [ ] **Step 5: Commit**

```bash
git add doc/probe/05-failure-modes.md
git commit -m "probe: stream-json failure modes"
```

---

### Task P0.6: Consolidate probes into kimi-cli-runtime skill draft

**Files:**
- Create: `plugins/kimi/skills/kimi-cli-runtime/SKILL.md`

- [ ] **Step 1: Write the initial SKILL.md using probe conclusions**

```bash
mkdir -p plugins/kimi/skills/kimi-cli-runtime
```

Content (fill the `<probe-result>` slots from probe docs):

```markdown
---
name: kimi-cli-runtime
description: Internal helper contract for calling the kimi-companion runtime from Claude Code
---

# kimi-cli-runtime

Internal contract for code invoking `scripts/kimi-companion.mjs`. This is not user-facing. Claude uses this skill when dispatched via `/kimi:*` commands or the `kimi-agent` subagent.

## Runtime requirements

- `kimi` CLI ≥ 1.34 on PATH
- `~/.kimi/credentials/` present and non-empty (user ran `kimi login`)
- Node.js ≥ 18

## Companion script subcommands

All companion subcommands return JSON when `--json` is passed. Without `--json`, output is human-readable text.

| Subcommand | Purpose | JSON shape |
|---|---|---|
| `setup --json` | Check availability + auth | `{installed, authenticated, model, version, pathOk}` |
| `ask [options] "<prompt>"` | One-shot query | (streams, see below) |
| `review [options]` | Review current diff | `{verdict, summary, findings[], next_steps[]}` |
| `task [options] "<prompt>"` | Background job | `{jobId, status}` |
| `status` | List jobs | `{jobs: [...]}` |
| `result <jobId>` | Get job result | `{status, response, sessionId}` |
| `cancel <jobId>` | Cancel job | `{ok}` |
| `task-resume-candidate --json` | Check resumable session | `{available, sessionId, cwd}` |

## kimi CLI invocation facts (probe-confirmed)

These constants are the direct result of Phase 0 probes. Do not re-derive.

- **Version check**: `kimi -V` (uppercase). Lowercase `-v` means verbose.
- **Stream format**: `--print --output-format stream-json` emits JSONL.
- **Event taxonomy** (from probe 01):
  - Event type key: `<EVENT_TYPE_KEY>`
  - Session id key: `<SESSION_ID_KEY>`
  - Assistant content key: `<ASSISTANT_CONTENT_KEY>`
  - Session id first appears in: `<SESSION_ID_FIRST_APPEARS_IN>` event
- **Session id fallback** (from probe 02):
  - `~/.kimi/kimi.json.work_dirs[].last_session_id` <IS|IS NOT> updated in `--print` mode
  - If yes, match by exact cwd string; if no, rely solely on stream-json event
- **Large prompts** (from probe 03): use `<stdin|tmpfile>` strategy
- **Ping auth check**: `--max-steps-per-turn <N>` (N from probe 04)
- **Failure modes** (from probe 05):
  - Invalid model: exit `<code>`, stderr is `<json|text>`
  - SIGTERM mid-stream: exit `<code>`, partial stdout present
  - Bad cwd: exit `<code>`, stderr `<text>`

## Output handling contract

- No kimi-native JSON wrapping — structured output (review findings etc.) is produced by prompt engineering; the companion parses assistant text with `indexOf("{")` scan.
- For `/kimi:review`: 1 retry on JSON parse failure with a strengthened prompt. No further retries.
- No Engram sidecar in v0.1.

## Session handling

- Each `/kimi:ask` invocation creates a new session by default.
- `--resume <id>` or `--resume-last` explicitly continues a previous session.
- Do NOT use `kimi -C` (continue-last) — session continuity must be explicit.

## Do NOT

- Do NOT pass `--approval-mode` (kimi does not accept it).
- Do NOT attempt to write to `~/.kimi/`.
- Do NOT parse the kimi CLI TUI — always go through `--print`.
- Do NOT batch multiple prompts into one call.
```

- [ ] **Step 2: Verify file structure**

```bash
ls plugins/kimi/skills/kimi-cli-runtime/SKILL.md
head -5 plugins/kimi/skills/kimi-cli-runtime/SKILL.md
```

Expected: frontmatter with `name: kimi-cli-runtime` and `description: ...`.

- [ ] **Step 3: Commit**

```bash
git add plugins/kimi/skills/kimi-cli-runtime/SKILL.md
git commit -m "feat(skill): kimi-cli-runtime draft from probe results"
```

---

## Phase 1: Skeleton + Setup

### Task 1.1: Initialize repo and root files

**Files:**
- Create: `.gitignore`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Write .gitignore**

```
node_modules/
*.log
.DS_Store
/tmp/
/plugins/kimi/scripts/*.tmp
```

- [ ] **Step 2: Write CLAUDE.md**

```markdown
# kimi-plugin-cc working directory instructions

This repo is a Claude Code plugin that wraps Moonshot Kimi CLI. It mirrors the structure of `gemini-plugin-cc` at `/Users/bing/-Code-/gemini-plugin-cc/`.

## Before coding
- Read `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` (the spec)
- Read the most recent 5 entries of `CHANGELOG.md` (cross-AI hand-off log)
- If touching a "near-copy" file, read its gemini counterpart first — no sed, no cp

## After coding
- Append CHANGELOG.md entry with `status`, `scope`, `summary`, `next`
- Run the T checklist entries that your change could affect
```

- [ ] **Step 3: Write README.md**

```markdown
# kimi-plugin-cc

Claude Code plugin integrating Moonshot Kimi CLI.

**Status:** v0.1 in development. Spec: `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md`.

## Prerequisites

- [Claude Code](https://claude.ai/code)
- [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) ≥ 1.34 (`uv tool install --python 3.13 kimi-cli`)
- Authenticated Kimi CLI (run `kimi login` interactively once)

## Install (development)

```bash
claude plugins add ./plugins/kimi
```

## Commands (v0.1 incremental)

- `/kimi:setup` — verify kimi CLI installation and auth
- (more coming as phases complete)

## License

MIT
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore README.md CLAUDE.md
git commit -m "chore: repo root files"
```

---

### Task 1.2: Marketplace + plugin manifests

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `plugins/kimi/.claude-plugin/plugin.json`
- Create: `plugins/kimi/CHANGELOG.md`

- [ ] **Step 1: Write .claude-plugin/marketplace.json**

```bash
mkdir -p .claude-plugin
```

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "kimi-plugin",
  "version": "0.1.0",
  "description": "Kimi CLI plugin for Claude Code",
  "owner": {
    "name": "bing"
  },
  "plugins": [
    {
      "name": "kimi",
      "description": "Use Kimi from Claude Code to review code or delegate tasks.",
      "version": "0.1.0",
      "author": {
        "name": "bing"
      },
      "source": "./plugins/kimi",
      "category": "development"
    }
  ]
}
```

- [ ] **Step 2: Write plugins/kimi/.claude-plugin/plugin.json**

```bash
mkdir -p plugins/kimi/.claude-plugin
```

```json
{
  "name": "kimi",
  "version": "0.1.0",
  "description": "Use Kimi from Claude Code to review code or delegate tasks.",
  "author": {
    "name": "bing"
  }
}
```

- [ ] **Step 3: Write plugins/kimi/CHANGELOG.md**

```markdown
# kimi plugin CHANGELOG

## 0.1.0 (in progress)

- Initial scaffold
- `/kimi:setup` command
- Near-copy of gemini-plugin-cc lib files (args/process/render/git/state)
- `kimi.mjs` core wrapper (availability + auth only at this phase)
- `kimi-cli-runtime` skill draft from Phase 0 probes
```

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin plugins/kimi/.claude-plugin plugins/kimi/CHANGELOG.md
git commit -m "feat: marketplace and plugin manifests"
```

---

### Task 1.3: Copy-rewrite `args.mjs` and `process.mjs` (zero kimi-specific logic)

**Files:**
- Create: `plugins/kimi/scripts/lib/args.mjs`
- Create: `plugins/kimi/scripts/lib/process.mjs`

- [ ] **Step 1: Read gemini's args.mjs fully and rewrite locally**

Open `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/args.mjs` in a reading pass. It defines `parseArgs(argv, config)` and `splitRawArgumentString(raw)`. **Zero references to gemini/kimi** — pure argument parsing. The file is 130 lines.

Write it out at `plugins/kimi/scripts/lib/args.mjs` **byte-for-byte identical**. (This is one of the few exceptions where the P2 hand-rewrite produces the same bytes — which is still valuable: you've read and understood the algorithm.)

```bash
mkdir -p plugins/kimi/scripts/lib
# Open gemini's file, read it top to bottom, then write locally.
```

- [ ] **Step 2: Verify args.mjs parses**

```bash
node --check plugins/kimi/scripts/lib/args.mjs
```

Expected: no output (parse ok).

- [ ] **Step 3: Read gemini's process.mjs fully and rewrite locally**

`process.mjs` exports `runCommand`, `runCommandChecked`, `binaryAvailable`, `formatCommandFailure`. Zero kimi/gemini references. 74 lines.

Write byte-for-byte identical copy to `plugins/kimi/scripts/lib/process.mjs`.

- [ ] **Step 4: Verify**

```bash
node --check plugins/kimi/scripts/lib/process.mjs
```

- [ ] **Step 5: Smoke test**

```bash
node -e 'import("./plugins/kimi/scripts/lib/process.mjs").then(m => { const r = m.binaryAvailable("node", ["-v"]); console.log(r); })'
```

Expected: `{ available: true, detail: "v<something>" }`.

- [ ] **Step 6: Commit**

```bash
git add plugins/kimi/scripts/lib/args.mjs plugins/kimi/scripts/lib/process.mjs
git commit -m "feat(lib): args and process (rewritten from gemini)"
```

---

### Task 1.4: Copy-rewrite `render.mjs` and `git.mjs`

**Files:**
- Create: `plugins/kimi/scripts/lib/render.mjs`
- Create: `plugins/kimi/scripts/lib/git.mjs`

- [ ] **Step 1: Read and rewrite render.mjs**

Source: `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/render.mjs`.

Responsibility: format companion output (findings, streaming deltas, stats blocks).

**Watch for kimi-specific adjustments while reading:**
- Any function rendering "Gemini" banners → rename to "Kimi"
- Any mention of stats fields that may not exist in kimi stream-json (stats can be null in v0.1 per spec §3.3) → ensure null-safe branches exist (they should already, but verify)

Rewrite locally at `plugins/kimi/scripts/lib/render.mjs`. Change every string literal "Gemini" → "Kimi", "gemini" → "kimi" **only where user-visible**. Function/variable names stay the same.

- [ ] **Step 2: Verify**

```bash
node --check plugins/kimi/scripts/lib/render.mjs
```

- [ ] **Step 3: Read and rewrite git.mjs**

Source: `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/git.mjs`.

Responsibility: collect git diffs for review commands (by scope: working-tree / branch / auto).

Zero kimi/gemini-specific strings expected. Rewrite byte-for-byte to `plugins/kimi/scripts/lib/git.mjs`.

- [ ] **Step 4: Verify**

```bash
node --check plugins/kimi/scripts/lib/git.mjs
```

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/render.mjs plugins/kimi/scripts/lib/git.mjs
git commit -m "feat(lib): render and git (rewritten from gemini)"
```

---

### Task 1.5: Rewrite `state.mjs` with kimi paths

**Files:**
- Create: `plugins/kimi/scripts/lib/state.mjs`

- [ ] **Step 1: Read gemini's state.mjs fully**

Source: `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/state.mjs`. 239 lines. It handles state file + jobs dir I/O with a lockfile mechanism.

**kimi changes (exhaustive list)**:
- Line 10: `FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "gemini-companion")` → change `"gemini-companion"` to `"kimi-companion"`.
- Line 183: `export function generateJobId(prefix = "gj")` → change default `"gj"` to `"kj"` (kimi job).
- Everything else: unchanged (including `PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA"` — that's the Claude-injected env var, not a gemini-specific one).

- [ ] **Step 2: Write state.mjs locally**

Write the full 239 lines to `plugins/kimi/scripts/lib/state.mjs` with **only the two changes above**.

- [ ] **Step 3: Verify**

```bash
node --check plugins/kimi/scripts/lib/state.mjs
```

- [ ] **Step 4: Smoke test**

```bash
node -e 'import("./plugins/kimi/scripts/lib/state.mjs").then(m => { const id = m.generateJobId(); console.log("id=", id); console.assert(id.startsWith("kj-"), "prefix should be kj-"); })'
```

Expected: prints `id= kj-<ts>-<hex>` and no assertion error.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/state.mjs
git commit -m "feat(lib): state.mjs with kimi-specific paths"
```

---

### Task 1.6: Create `kimi.mjs` — TOML reader + availability

**Files:**
- Create: `plugins/kimi/scripts/lib/kimi.mjs`

- [ ] **Step 1: Create file with imports and TOML helper**

```bash
touch plugins/kimi/scripts/lib/kimi.mjs
```

Content (initial):

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { binaryAvailable, runCommand } from "./process.mjs";

const DEFAULT_TIMEOUT_MS = 300_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;

const PARENT_SESSION_ENV = "KIMI_COMPANION_SESSION_ID";
const KIMI_BIN = process.env.KIMI_CLI_BIN || "kimi";

// ── TOML top-level key scanner (§3.5) ──────────────────────
//
// Read the value of a top-level string key from a TOML file.
// Does NOT parse sections ([foo]), multi-line strings, arrays,
// or literal strings (single-quoted). v0.1 scope.
export function readTomlTopLevelKey(text, key) {
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) return null;
    const m = line.match(/^(\w+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (m && m[1] === key) return m[2];
  }
  return null;
}

let _cachedDefaultModel = undefined;

export function readKimiDefaultModel() {
  if (_cachedDefaultModel !== undefined) return _cachedDefaultModel;
  try {
    const configPath = path.join(os.homedir(), ".kimi", "config.toml");
    const text = fs.readFileSync(configPath, "utf8");
    _cachedDefaultModel = readTomlTopLevelKey(text, "default_model");
  } catch {
    _cachedDefaultModel = null;
  }
  return _cachedDefaultModel;
}

// ── Availability ───────────────────────────────────────────

export function getKimiAvailability(cwd) {
  return binaryAvailable(KIMI_BIN, ["-V"], { cwd });
}

// Placeholder for Task 1.7
export function getKimiAuthStatus(_cwd) {
  return { loggedIn: false, detail: "not implemented yet" };
}
```

- [ ] **Step 2: Verify parse**

```bash
node --check plugins/kimi/scripts/lib/kimi.mjs
```

- [ ] **Step 3: Smoke test TOML reader and availability**

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(m => {
  const sample = `
# comment
default_model = "kimi-k2-latest"
other_key = "ignored"
[model]
default = "not_this_one"
`;
  console.log("default_model =", m.readTomlTopLevelKey(sample, "default_model"));
  console.assert(m.readTomlTopLevelKey(sample, "default_model") === "kimi-k2-latest", "toml parse");
  console.assert(m.readTomlTopLevelKey(sample, "default") === null, "should not match in-section key");
  console.log("availability =", m.getKimiAvailability());
});
'
```

Expected: prints `default_model = kimi-k2-latest`, no assertion errors, availability shows kimi version (or `{available:false, detail:"not found"}` if kimi not in PATH).

- [ ] **Step 4: Commit**

```bash
git add plugins/kimi/scripts/lib/kimi.mjs
git commit -m "feat(kimi): toml reader and availability check"
```

---

### Task 1.7: Implement `getKimiAuthStatus` with ping-call

**Files:**
- Modify: `plugins/kimi/scripts/lib/kimi.mjs`

- [ ] **Step 1: Read probe 04 to get chosen PING_MAX_STEPS**

Open `doc/probe/04-max-steps.md`. Note the chosen N (likely 1 or 2). Below, substitute `<PING_MAX_STEPS>` with that number.

- [ ] **Step 2: Read probe 01 to get event key names**

Open `doc/probe/01-stream-json.md`. Note EVENT_TYPE_KEY, SESSION_ID_KEY, ASSISTANT_CONTENT_KEY.

- [ ] **Step 3: Replace the `getKimiAuthStatus` placeholder**

Replace the placeholder in `kimi.mjs` (the function that currently returns `{ loggedIn: false, detail: "not implemented yet" }`) with:

```js
// ── Authentication check ───────────────────────────────────

function credentialsDirNonEmpty() {
  try {
    const dir = path.join(os.homedir(), ".kimi", "credentials");
    const entries = fs.readdirSync(dir);
    return entries.some((e) => !e.startsWith("."));
  } catch {
    return false;
  }
}

export function getKimiAuthStatus(cwd) {
  if (!credentialsDirNonEmpty()) {
    return { loggedIn: false, detail: "no credentials in ~/.kimi/credentials" };
  }

  const result = runCommand(
    KIMI_BIN,
    [
      "-p", "ping",
      "--print",
      "--output-format", "stream-json",
      "--max-steps-per-turn", String(<PING_MAX_STEPS>),
    ],
    { cwd, timeout: AUTH_CHECK_TIMEOUT_MS }
  );

  if (result.error) {
    return { loggedIn: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    return { loggedIn: false, detail: (result.stderr || "").slice(0, 200) || `exit ${result.status}` };
  }

  // Look for an assistant message event in the JSONL stream
  const hasAssistant = (result.stdout || "")
    .split("\n")
    .some((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return false;
      try {
        const ev = JSON.parse(trimmed);
        // <EVENT_TYPE_KEY> and <ASSISTANT_CONTENT_KEY> from probe 01
        return ev && typeof ev === "object" && (
          (ev.role === "assistant" && typeof ev.<ASSISTANT_CONTENT_KEY> === "string") ||
          (ev.<EVENT_TYPE_KEY> === "message" && ev.role === "assistant")
        );
      } catch {
        return false;
      }
    });

  if (!hasAssistant) {
    return { loggedIn: false, detail: "ping call succeeded but no assistant event" };
  }

  return {
    loggedIn: true,
    detail: "authenticated",
    model: readKimiDefaultModel() || "unknown",
  };
}
```

**Note:** Replace `<PING_MAX_STEPS>`, `<EVENT_TYPE_KEY>`, `<ASSISTANT_CONTENT_KEY>` with actual values from probes. If probe values conflict with the assumptions in the code (e.g., kimi uses `content` nested under `message`), adjust the check logic accordingly.

- [ ] **Step 4: Verify parse**

```bash
node --check plugins/kimi/scripts/lib/kimi.mjs
```

- [ ] **Step 5: Smoke test against real kimi (if logged in)**

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(m => {
  console.log(m.getKimiAuthStatus(process.cwd()));
});
'
```

Expected (if authenticated): `{ loggedIn: true, detail: "authenticated", model: "<model>" }`. If not authenticated: `{ loggedIn: false, detail: "..." }` with a readable reason.

- [ ] **Step 6: Commit**

```bash
git add plugins/kimi/scripts/lib/kimi.mjs
git commit -m "feat(kimi): auth status via ping-call"
```

---

### Task 1.8: Write `kimi-companion.mjs` entry with `setup` subcommand

**Files:**
- Create: `plugins/kimi/scripts/kimi-companion.mjs`

- [ ] **Step 1: Write the dispatcher + setup logic**

```js
#!/usr/bin/env node
import process from "node:process";
import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { getKimiAvailability, getKimiAuthStatus, readKimiDefaultModel } from "./lib/kimi.mjs";
import { binaryAvailable } from "./lib/process.mjs";

const USAGE = `Usage: kimi-companion <subcommand> [options]

Subcommands:
  setup [--json]    Check kimi CLI availability and auth state

(More subcommands arrive in Phase 2+.)`;

function runSetup(rawArgs) {
  // Support both "setup --json" and "setup" plus later flags like --enable-review-gate
  const { options } = parseArgs(rawArgs, {
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"],
  });

  const availability = getKimiAvailability();
  const installers = {
    shellInstaller: binaryAvailable("sh", ["-c", "command -v curl"]).available,
    uv: binaryAvailable("uv", ["--version"]).available,
    pipx: binaryAvailable("pipx", ["--version"]).available,
  };

  let auth = { loggedIn: false, detail: "not checked" };
  if (availability.available) {
    auth = getKimiAuthStatus(process.cwd());
  }

  const status = {
    installed: availability.available,
    version: availability.available ? availability.detail : null,
    authenticated: auth.loggedIn,
    authDetail: auth.detail,
    model: auth.model || readKimiDefaultModel() || null,
    installers,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
  } else {
    process.stdout.write(formatSetupText(status) + "\n");
  }
  process.exit(0);
}

function formatSetupText(s) {
  const lines = [];
  lines.push(`installed:     ${s.installed ? `yes (${s.version})` : "no"}`);
  lines.push(`authenticated: ${s.authenticated ? "yes" : `no (${s.authDetail})`}`);
  lines.push(`default model: ${s.model || "(not set)"}`);
  if (!s.installed) {
    lines.push("");
    lines.push("Installers detected:");
    lines.push(`  shell curl:  ${s.installers.shellInstaller ? "yes" : "no"}`);
    lines.push(`  uv:          ${s.installers.uv ? "yes" : "no"}`);
    lines.push(`  pipx:        ${s.installers.pipx ? "yes" : "no"}`);
  }
  return lines.join("\n");
}

// ── Dispatcher ─────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);

  // Claude invokes us with: kimi-companion <sub> "$ARGUMENTS"
  // "$ARGUMENTS" may arrive as a single shell-quoted arg; unpack it.
  let [sub, ...rest] = argv;
  if (rest.length === 1 && !rest[0].startsWith("-") && rest[0].includes(" ")) {
    rest = splitRawArgumentString(rest[0]);
  }

  switch (sub) {
    case "setup":
      return runSetup(rest);
    case undefined:
    case "--help":
    case "-h":
      process.stdout.write(USAGE + "\n");
      process.exit(0);
      break;
    default:
      process.stderr.write(`Unknown subcommand: ${sub}\n${USAGE}\n`);
      process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Verify parse**

```bash
node --check plugins/kimi/scripts/kimi-companion.mjs
```

- [ ] **Step 3: Run `setup --json`**

```bash
node plugins/kimi/scripts/kimi-companion.mjs setup --json
```

Expected: JSON with `installed`, `authenticated`, `version`, `model`, `installers` keys. On your machine (kimi 1.34 installed, logged in), should return `{installed: true, authenticated: true, ...}`.

This is **T1 pass criterion**.

- [ ] **Step 4: Run `setup` without --json**

```bash
node plugins/kimi/scripts/kimi-companion.mjs setup
```

Expected: human-readable three-line status.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/kimi-companion.mjs
git commit -m "feat(companion): setup subcommand with availability and auth"
```

---

### Task 1.9: Write `/kimi:setup` command markdown

**Files:**
- Create: `plugins/kimi/commands/setup.md`

- [ ] **Step 1: Write the command file**

```bash
mkdir -p plugins/kimi/commands
```

```markdown
---
description: Check whether the local Kimi CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(uv:*), Bash(pipx:*), Bash(sh:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" setup --json "$ARGUMENTS"
```

If the result's `installed` is `false`:
- Check `installers.shellInstaller` / `installers.uv` / `installers.pipx`
- Use `AskUserQuestion` exactly once with these options (skip any option where the installer is not available):
  - `Install via shell script (Recommended, official)` (runs `sh -c "$(curl -fsSL https://kimi.moonshot.cn/cli/install.sh)"`)
  - `Install via uv` (runs `uv tool install --python 3.13 kimi-cli`)
  - `Install via pipx` (runs `pipx install kimi-cli`, mark as "unverified" in the option label)
  - `Skip for now`
- If the user picks an install option, run the corresponding command
- After install succeeds, re-run the setup subcommand. If it still reports `installed: false` but `~/.local/bin/kimi` exists, tell the user: "kimi is installed at `~/.local/bin/kimi` but not on your PATH. Add `~/.local/bin` to PATH and reopen your shell, then re-run `/kimi:setup`."

If the result's `installed: true` but `authenticated: false`:
- Do NOT auto-run `kimi login` (it's interactive, won't work from a tool call)
- Tell the user exactly: "Run `! kimi login` in the terminal to authenticate interactively, then re-run `/kimi:setup`."

If both `installed: true` and `authenticated: true`:
- Print the full status JSON block for the user's reference.
- If the user passed `--enable-review-gate` or `--disable-review-gate`, acknowledge (the runtime toggles this in state.json — implemented in Phase 4).

Output rules:
- Present the final setup output verbatim to the user.
- Do NOT paraphrase the status JSON. Let the user see the fields.
- Do NOT suggest installation changes if already installed and authenticated.
```

- [ ] **Step 2: Verify the file exists and has the right frontmatter**

```bash
head -6 plugins/kimi/commands/setup.md
```

- [ ] **Step 3: Commit**

```bash
git add plugins/kimi/commands/setup.md
git commit -m "feat(command): /kimi:setup"
```

---

### Task 1.10: Write `kimi-prompting` skill skeleton

**Files:**
- Create: `plugins/kimi/skills/kimi-prompting/SKILL.md`
- Create: `plugins/kimi/skills/kimi-prompting/references/.gitkeep`

- [ ] **Step 1: Create skeleton**

```bash
mkdir -p plugins/kimi/skills/kimi-prompting/references
touch plugins/kimi/skills/kimi-prompting/references/.gitkeep
```

```markdown
---
name: kimi-prompting
description: Internal guidance for composing Kimi CLI prompts for coding, review, diagnosis, and research tasks inside the kimi plugin
---

# kimi-prompting (skeleton)

This skill is drafted here but fully written in Phase 5 once real prompts have been tested across `/kimi:ask`, `/kimi:review`, `/kimi:rescue`.

## Scope

Guidance for Claude when composing a prompt to send to Kimi via `kimi-companion.mjs`. Not user-facing.

## Universal rules (v0.1 confirmed)

1. **Output contract first.** State the expected output format in the first paragraph of any task prompt. For JSON responses, explicitly say "Return ONLY a JSON object matching this schema. No prose before or after. No markdown code fence."
2. **Context in a labeled block.** When passing code/diff/docs, wrap in a clearly labeled block (`### Diff to review` / `### Files under investigation`).
3. **Language parity.** Kimi's Chinese-language reasoning is strong. If the user prompt is Chinese, keep the system/instruction text in Chinese too. Do not force English.
4. **No tool-call loops on simple questions.** For straightforward Q&A (e.g., `/kimi:ask`), set `--max-steps-per-turn` to a small value (e.g., 3). For `/kimi:rescue --write`, allow larger N.

## Placeholder sections (filled in Phase 5)

- `references/kimi-prompt-recipes.md` — recipes for common tasks (review / refactor / explain / doc-summarize)
- `references/kimi-prompt-antipatterns.md` — patterns that empirically fail on Kimi (populated from real failures during Phases 2-4)
- `references/prompt-blocks.md` — reusable blocks: task framing, output contracts, `--thinking` invocation
```

- [ ] **Step 2: Verify**

```bash
ls plugins/kimi/skills/kimi-prompting/
head -5 plugins/kimi/skills/kimi-prompting/SKILL.md
```

- [ ] **Step 3: Commit**

```bash
git add plugins/kimi/skills/kimi-prompting/
git commit -m "feat(skill): kimi-prompting skeleton (fleshed out in Phase 5)"
```

---

### Task 1.11: T1 + T8 validation and Phase 1 CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: T1 — setup --json on this (authenticated) machine**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node plugins/kimi/scripts/kimi-companion.mjs setup --json
```

Verify output has all these keys populated (not null): `installed`, `version`, `authenticated`, `model`. `installers` field is present (value depends on what's installed).

If `installed: true` but `authenticated: false` → fix auth logic or re-run `kimi login` interactively.
If `installed: true` and `authenticated: true` → **T1 pass**.

- [ ] **Step 2: T8 — simulate fresh-environment setup**

Run with a deliberately broken `kimi` to simulate "not installed":

```bash
KIMI_CLI_BIN=/nonexistent/kimi node plugins/kimi/scripts/kimi-companion.mjs setup --json
```

Verify output has `installed: false` and `installers` sub-object with the real detection results for shellInstaller/uv/pipx.

**T8 pass** means the companion returns structured info sufficient for `/kimi:setup` command.md to branch into the install flow.

- [ ] **Step 3: Append CHANGELOG entry**

Append to `CHANGELOG.md` at top (below the existing v0.2 spec entry):

```markdown
## 2026-04-20 [Claude Opus 4.7]

- **status**: done
- **scope**: Phase 0 probes + Phase 1 skeleton (kimi-plugin-cc)
- **summary**: Completed Phase 0 (5 probes documented at doc/probe/) and Phase 1 (repo skeleton, lib files, kimi.mjs core, kimi-companion.mjs with setup subcommand, /kimi:setup command.md, kimi-cli-runtime skill v0.1 draft, kimi-prompting skill skeleton). T1 and T8 pass.
- **next**: hand off to Phase 2 plan (ask + streaming). Probe results inform Phase 2 stream parsing decisions — any Phase 2 author must read doc/probe/01-stream-json.md before implementing callKimiStreaming.
```

- [ ] **Step 4: Final Phase 1 commit**

```bash
git add CHANGELOG.md
git commit -m "chore: Phase 0+1 complete; T1 and T8 pass"
```

- [ ] **Step 5: Tag a phase milestone**

```bash
git tag -a phase-1-foundation -m "Phase 0+1 complete: skeleton, probes, /kimi:setup"
```

---

## Self-Review Checklist

After completing the plan, verify:

1. **Spec coverage (partial — this plan covers spec §6.4 Phase 0 + Phase 1 only):**
   - Spec §2 file structure: ✅ all Phase-1 files in this plan
   - Spec §3.1 CLI invocation: kimi.mjs imports ✅, full call path is Phase 2
   - Spec §3.5 TOML reader: ✅ Task 1.6
   - Spec §3.6 auth check: ✅ Task 1.7
   - Spec §4.2 /kimi:setup: ✅ Task 1.9
   - Spec §5.1 state dir: state.mjs uses `kimi-companion` fallback root ✅ (Task 1.5)
   - Spec Appendix A probes: ✅ all 5 in Phase 0
   - Deferred to later plans: §3.2 (JSON retry — Phase 3), §3.3 (streaming — Phase 2), §3.4 (session_id — Phase 2, needs probes from Phase 0), §4 commands besides setup, §6.2 full lessons.md (Phase 5).

2. **Types/signatures consistency:** `getKimiAvailability`, `getKimiAuthStatus`, `readKimiDefaultModel`, `readTomlTopLevelKey`, `KIMI_BIN` used consistently across tasks 1.6-1.8. `KIMI_COMPANION_SESSION_ID` env name mentioned in kimi.mjs imports — actual use comes in Phase 2.

3. **Placeholder scan:** The `<PING_MAX_STEPS>`, `<EVENT_TYPE_KEY>`, `<ASSISTANT_CONTENT_KEY>` in Task 1.7 are intentional — they're probe-dependent substitutions, clearly marked with substitution instructions. These are not placeholder-failures; they are inputs from completed probe tasks.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-20-phase-0-1-foundation.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Good fit for this plan because tasks are independent after Phase 0 probes land.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch with checkpoints. Good fit if you want to steer probe interpretation in real time.

**Which approach?**

---

## Follow-up plans (written after this plan's phase-1-foundation tag)

- `2026-XX-XX-phase-2-ask-streaming.md` — `/kimi:ask` + stream-json parsing + result-handling skill
- `2026-XX-XX-phase-3-review-retry.md` — `/kimi:review` + schema + 1-shot JSON retry
- `2026-XX-XX-phase-4-background-agent.md` — rescue/status/result/cancel + kimi-agent + hooks
- `2026-XX-XX-phase-5-adversarial-polish.md` — /kimi:adversarial-review + skill finalize + lessons.md

Each subsequent plan is authored AFTER the previous phase tag lands, so that probe results and implementation reality inform the next plan's details.
