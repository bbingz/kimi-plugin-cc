# {{LLM}}-plugin-cc Phase 1 Skeleton Implementation Template

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to instantiate this template into a concrete Phase-1 plan for your provider, then execute task-by-task.
>
> **Instantiation workflow:**
> 1. Copy this file to `docs/superpowers/plans/YYYY-MM-DD-phase-1-skeleton.md` in the NEW plugin's repo.
> 2. Global find-and-replace all `{{…}}` placeholders per the substitution table below.
> 3. Run Phase 0 probes against the target CLI first (see `{{KIMI_REPO_ROOT}}/lessons.md` Section E). Amend any T.N section where your provider's reality diverges from Kimi's; record every divergence in the NEW plugin's `lessons.md` Section D.
>
> **Source:** Derived from `kimi-plugin-cc` Phase 1 plan (`2026-04-20-phase-1-skeleton.md`). Preserve the 6-task scaffold unless your Phase 0 probes reveal that a task doesn't apply.

**Goal:** Stand up a minimal Claude Code plugin shell for {{LLM_CAP}} with `/{{LLM}}:setup` passing T1 + T8 (CLI probe + fresh-install probe).

**Architecture:** Mirror `gemini-plugin-cc` / `kimi-plugin-cc` repo layout. Fresh commit per task; keep lib files small + single-responsibility. Zero npm dependencies — Node built-ins only.

**Tech Stack:** Node ≥ 18 (built-ins: `node:fs`, `node:path`, `node:os`, `node:child_process`, `node:string_decoder`, `node:url`). No package.json runtime dependencies.

**Reference spec:** `docs/superpowers/specs/YYYY-MM-DD-{{LLM}}-plugin-cc-design.md` in the new repo.

**Reference source:** `/Users/bing/-Code-/kimi-plugin-cc/` — use this, not gemini-plugin-cc directly. kimi already contains the cross-provider lessons (signal propagation fix, `(none)` skeleton handler, signals-as-data pattern) that gemini-plugin-cc hadn't discovered yet.

---

## Substitution Table

Global find-and-replace these 9 tokens when copying this template into a new plugin's Phase 1 plan.

| Placeholder | Example (minimax-plugin-cc) | Description |
|---|---|---|
| `{{LLM}}` | `minimax` | lowercase plugin name; file-path safe |
| `{{LLM_CAP}}` | `MiniMax` | display name; used in prose + function-name fragments (e.g. `callMiniMax`) |
| `{{LLM_UPPER}}` | `MINIMAX` | all-caps plugin name; used in env-var constants (`{{LLM_UPPER}}_CLI_BIN`, `{{LLM_UPPER}}_EXIT`) |
| `{{LLM_CLI}}` | `minimax` | CLI binary name invoked via spawn |
| `{{LLM_CLI_INSTALL}}` | `pipx install minimax-cli` | primary install command surfaced by `/{{LLM}}:setup` |
| `{{LLM_SESSION_ENV}}` | `MINIMAX_COMPANION_SESSION_ID` | env var for Claude Code session id |
| `{{LLM_STATE_DIR}}` | `~/.claude/plugins/minimax/` | plugin state dir (state.json + jobs/) |
| `{{LLM_HOME_DIR}}` | `~/.minimax/` | provider CLI's own home dir (config, credentials, sessions) |
| `{{KIMI_REPO_ROOT}}` | `/Users/bing/-Code-/kimi-plugin-cc` | source kimi-plugin-cc checkout; used for "lift from kimi file X" directives |

---

## File Structure

**Create (repo root):** `.gitignore`, `README.md`, `CLAUDE.md`, `.claude-plugin/marketplace.json`, `plugins/{{LLM}}/.claude-plugin/plugin.json`, `plugins/{{LLM}}/CHANGELOG.md`

**Create (plugin lib):** `plugins/{{LLM}}/scripts/lib/args.mjs`, `process.mjs`, `git.mjs`, `state.mjs` — (`render.mjs` was proven dead in v0.1 post-review and is NO LONGER ported; see T.5 below for the deletion notice)

**Create (plugin core):** `plugins/{{LLM}}/scripts/lib/{{LLM}}.mjs` — CLI-specific primitives (spawn + parse + session-id + model config + errors); THIS IS THE PROVIDER-SPECIFIC FILE. Every sibling plugin writes it from scratch.

**Exit criteria (all must hold before tag `phase-1-skeleton`):**
- Marketplace + plugin.json valid (`claude plugins validate <path>` passes, or marketplace-add + plugin-list succeeds)
- `/{{LLM}}:setup --json` returns `{installed, authenticated, model, version}` on a machine with `{{LLM_CLI}}` installed + logged-in (T1)
- On a machine without `{{LLM_CLI}}`, `/{{LLM}}:setup` surfaces the install recommendation with `{{LLM_CLI_INSTALL}}` (T8)
- Git tag `phase-1-skeleton` applied.

---

## Task T.1: Repo root files + marketplace/plugin manifests

**Files:** `.gitignore`, `README.md`, `CLAUDE.md`, `.claude-plugin/marketplace.json`, `plugins/{{LLM}}/.claude-plugin/plugin.json`, `plugins/{{LLM}}/CHANGELOG.md`

- [ ] **Step 1: Write `.gitignore`**

```
node_modules/
*.log
.DS_Store
/tmp/
plugins/{{LLM}}/scripts/*.tmp
```

- [ ] **Step 2: Write `CLAUDE.md` at repo root**

```markdown
# {{LLM}}-plugin-cc working directory instructions

This repo is a Claude Code plugin that wraps {{LLM_CAP}} CLI. Structure mirrors `{{KIMI_REPO_ROOT}}/` but every file is hand-rewritten (P2).

## Before coding
- Read `docs/superpowers/specs/YYYY-MM-DD-{{LLM}}-plugin-cc-design.md`
- Read `doc/probe/probe-results.json` for literal values (event keys, exit codes, hash algo, etc.)
- Read `{{KIMI_REPO_ROOT}}/lessons.md` (the template's lesson file) and recent 5 entries of `CHANGELOG.md`

## Before committing
- Append CHANGELOG entry (status / scope / summary / next)
- Run T-checklist rows your change could affect
- Never sed/cp from kimi-plugin-cc — read and rewrite
```

- [ ] **Step 3: Write `README.md`**

Minimum viable README: name, status, prereqs, dev-install, commands, license. ≤ 50 lines. Follow `{{KIMI_REPO_ROOT}}/README.md` for structure.

- [ ] **Step 4: Write `.claude-plugin/marketplace.json`**

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "{{LLM}}-plugin",
  "version": "0.1.0",
  "description": "{{LLM_CAP}} CLI plugin for Claude Code",
  "owner": { "name": "bing" },
  "plugins": [
    {
      "name": "{{LLM}}",
      "description": "Use {{LLM_CAP}} from Claude Code to review code or delegate tasks.",
      "version": "0.1.0",
      "author": { "name": "bing" },
      "source": "./plugins/{{LLM}}",
      "category": "development"
    }
  ]
}
```

- [ ] **Step 5: Write `plugins/{{LLM}}/.claude-plugin/plugin.json`**

```json
{
  "name": "{{LLM}}",
  "version": "0.1.0",
  "description": "Use {{LLM_CAP}} from Claude Code to review code or delegate tasks.",
  "author": { "name": "bing" }
}
```

- [ ] **Step 6: Write `plugins/{{LLM}}/CHANGELOG.md`**

Single entry for Phase 1 in-progress. Mirror `{{KIMI_REPO_ROOT}}/plugins/kimi/CHANGELOG.md` initial entry shape.

- [ ] **Step 7: Commit**

```bash
git add .gitignore README.md CLAUDE.md .claude-plugin/ plugins/{{LLM}}/.claude-plugin/ plugins/{{LLM}}/CHANGELOG.md
git commit -m "chore: repo scaffold + marketplace/plugin manifests"
```

---

## Task T.2: Port `args.mjs` + `process.mjs` near-verbatim

**Files:** `plugins/{{LLM}}/scripts/lib/args.mjs`, `plugins/{{LLM}}/scripts/lib/process.mjs`

Both files are zero-kimi-specific — they handle argv parsing and process spawning / signal-to-status mapping. Copy from `{{KIMI_REPO_ROOT}}/plugins/kimi/scripts/lib/{args,process}.mjs` verbatim.

- [ ] **Step 1: Copy args.mjs**

```bash
cp {{KIMI_REPO_ROOT}}/plugins/kimi/scripts/lib/args.mjs plugins/{{LLM}}/scripts/lib/args.mjs
```

Re-read after copy. No substitutions needed; the file is provider-agnostic.

- [ ] **Step 2: Copy process.mjs**

```bash
cp {{KIMI_REPO_ROOT}}/plugins/kimi/scripts/lib/process.mjs plugins/{{LLM}}/scripts/lib/process.mjs
```

**Critical invariant (kimi pit 7):** `runCommand` must preserve `status=null` when a child is signal-killed; must NOT collapse to `status ?? 0`. This is load-bearing for SIGINT/SIGTERM propagation up to exit code 130/143. Do not rewrite.

- [ ] **Step 3: Syntax check + commit**

```bash
node --check plugins/{{LLM}}/scripts/lib/args.mjs
node --check plugins/{{LLM}}/scripts/lib/process.mjs
git add plugins/{{LLM}}/scripts/lib/{args,process}.mjs
git commit -m "feat(lib): port args.mjs + process.mjs near-verbatim from kimi"
```

---

## Task T.3: Port `git.mjs` near-verbatim (with `isEmptyContext` helper)

**Files:** `plugins/{{LLM}}/scripts/lib/git.mjs`

Handles `collectReviewContext` (scope auto/staged/unstaged/working-tree/branch) + `ensureGitRepository` + `isEmptyContext`. Provider-agnostic.

- [ ] **Step 1: Copy git.mjs**

```bash
cp {{KIMI_REPO_ROOT}}/plugins/kimi/scripts/lib/git.mjs plugins/{{LLM}}/scripts/lib/git.mjs
```

**Critical invariant (kimi pit 5):** `isEmptyContext(context)` strips the `(none)` section skeleton before the empty check. Naive `!content.trim()` fails because `collectReviewContext` always emits the headers. Do not drop this helper.

- [ ] **Step 2: Syntax check + commit**

```bash
node --check plugins/{{LLM}}/scripts/lib/git.mjs
git add plugins/{{LLM}}/scripts/lib/git.mjs
git commit -m "feat(lib): port git.mjs near-verbatim from kimi"
```

---

## Task T.4: Port `state.mjs` with path constant rename

**Files:** `plugins/{{LLM}}/scripts/lib/state.mjs`

Per-workspace JSON state (state.json + jobs/ + timing-history.jsonl stub). Only provider-specific piece is the path constant.

- [ ] **Step 1: Copy state.mjs**

```bash
cp {{KIMI_REPO_ROOT}}/plugins/kimi/scripts/lib/state.mjs plugins/{{LLM}}/scripts/lib/state.mjs
```

- [ ] **Step 2: Rename path constants (whitelist — do NOT global-sed)**

Open `plugins/{{LLM}}/scripts/lib/state.mjs` in an editor. A naive
`sed 's/kimi/{{LLM}}/g'` clobbers legitimate strings like
`FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "kimi-companion")` and
historical comments ("Gemini's state.mjs… Kimi has no equivalent…"),
leaving the sibling plugin broken in subtle ways.

Make these 4 targeted edits ONLY:

1. `path.join(pluginData, "kimi", "state")` → `path.join(pluginData, "{{LLM}}", "state")`
   (the plugin-scoped subdir added in kimi-plugin-cc's 5-way review — critical
   for multi-plugin isolation)
2. `FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "kimi-companion")` →
   `FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "{{LLM}}-companion")`
3. `STATE_FILE_NAME = "state.json"` → keep as-is (no rename needed; name is
   already generic)
4. `JOBS_DIR_NAME = "jobs"` → keep as-is

**Leave all comments and doc-strings intact.** They reference the historical
porting context and help future readers trace decisions back to
`kimi-plugin-cc`.

Verify:

```bash
grep -n "\"kimi" plugins/{{LLM}}/scripts/lib/state.mjs
# Expected: zero hits. If any remain, those are legitimate references
# inside comments (acceptable) or a missed path constant (fix).
```

- [ ] **Step 3: Syntax check + commit**

```bash
node --check plugins/{{LLM}}/scripts/lib/state.mjs
git add plugins/{{LLM}}/scripts/lib/state.mjs
git commit -m "feat(lib): port state.mjs with {{LLM}} path constants"
```

---

## Task T.5: ~~Port `render.mjs`~~ — **DELETED (v0.1 post-review)**

`render.mjs` was ported from gemini-plugin-cc in Phase 1 as "near-verbatim"
text-output formatting for setup reports, status snapshots, result views,
and cancel confirmations. **The post-v0.1 review (2026-04-21) proved the
entire module was dead code**: zero external importers across the whole
plugin. The functionality lives elsewhere:

| Former render.mjs export | Where it lives now |
|---|---|
| `renderSetupReport` | `kimi-companion.mjs::formatSetupText` (local) |
| `renderKimiResult` | not needed — `/kimi:ask` text mode writes response verbatim to stdout |
| `renderJobSubmitted` | not needed — companion emits `{jobId, pid}` JSON; command `.md` renders |
| `renderStatusReport` | not needed — `/kimi:status` is JSON-out; command `.md` renders the snapshot |
| `renderStoredJobResult` | not needed — `/kimi:result` is JSON-out; command `.md` renders |
| `renderCancelReport` | not needed — `/kimi:cancel` is JSON-out |

Additionally, the gemini-era `render.mjs` contained a latent bug
(`report.gemini.available` — 5-way review P0-1) that would have crashed
the setup report if ever exercised. Siblings that blind-copied render.mjs
inherit that bug. **Do NOT create `plugins/{{LLM}}/scripts/lib/render.mjs`.**

**Action for sibling plugin authors:** skip this task entirely. If your
companion needs text output for humans (e.g. `/{{LLM}}:setup` non-JSON
mode), write it inline in `{{LLM}}-companion.mjs` — the footer format in
`formatAskFooter` is a good example (short, local, no indirection).

If you already ported render.mjs before reading this, see
`sibling-backport-checklist.md` §P0-1 for the deletion procedure.

---

## Task T.6: Write `{{LLM}}.mjs` — CLI-specific primitives

**Files:** `plugins/{{LLM}}/scripts/lib/{{LLM}}.mjs`

**This is the provider-specific file.** Every sibling plugin writes this from scratch against its Phase-0 probe results. Do NOT copy from kimi.mjs — the structure is the same, but the bindings are all different.

Use `{{KIMI_REPO_ROOT}}/plugins/kimi/scripts/lib/kimi.mjs` as a **shape reference** (not a copy-source). The required structure:

### Required exports

```js
// Constants (populate from Phase-0 probes)
const DEFAULT_TIMEOUT_MS = 300_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PARENT_SESSION_ENV = "{{LLM_SESSION_ENV}}";
const {{LLM_UPPER}}_BIN = process.env.{{LLM_UPPER}}_CLI_BIN || "{{LLM_CLI}}";
const PING_MAX_STEPS = 1;  // VALIDATE via probe — kimi uses 1; your CLI may differ.
const SESSION_ID_STDERR_REGEX = /* PROBE-DERIVED */;
const LARGE_PROMPT_THRESHOLD_BYTES = 100_000;  // kimi's value; re-measure.

// Exit code taxonomy (populate from Phase-0 exit probe)
export const {{LLM_UPPER}}_EXIT = {
  OK: 0,
  CONFIG_ERROR: 1,      // "no model configured" path; verify your CLI's marker
  USAGE_ERROR: 2,       // Click-style usage errors; may not apply to non-Click CLIs
  SIGINT: 130,
  SIGTERM: 143,
  STATUS_TIMED_OUT: 124,
};

// Per-provider error markers
export const LLM_NOT_SET_MARKER = /* PROBE-DERIVED — what exit-1 stdout looks like */;

// Parsers (stream-json event → internal types)
function parse{{LLM_CAP}}EventLine(rawLine) { /* provider-specific taxonomy */ }
export function extractAssistantText(event) { /* per-block extraction */ }
export function parse{{LLM_CAP}}Stdout(text) { /* non-streaming mode */ }

// Session-ID helpers
export function parseSessionIdFromStderr(stderr) { /* regex against PROBE value */ }
export function readSessionIdFrom{{LLM_CAP}}Json(cwd) { /* secondary path */ }

// Status mapping
export function statusFromSignal(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return null;
}
export function describe{{LLM_CAP}}Exit(status, { stderr = "", stdout = "" } = {}) {
  /* exit code → user-facing message, per your CLI's taxonomy */
}

// Error helper for transport failures — must include `status` field per
// the review.mjs `reviewError` contract (sibling plugins importing review.mjs
// rely on `result.status` being populated so `transportError.status` can
// propagate exit codes). Pass `status: null` when the failure isn't
// transport-layer (e.g. schema-load error). Empty `status` means Claude's
// render layer falls back to generic exit 1.
export function errorResult({ status = null, error, stdout = "", events = [], textParts = [] }) {
  /* uniform shape — include `status` field so review.mjs exit-code
     propagation works; include `partialResponse` derived from stdout/events
     so debug-mode consumers can see what kimi actually produced */
}

// Core CLI functions
export function call{{LLM_CAP}}({ prompt, model, cwd, timeout, extraArgs, resumeSessionId }) { /* ... */ }
export function call{{LLM_CAP}}Streaming({ ..., onEvent }) { /* ... */ }
export function get{{LLM_CAP}}Availability(cwd) { /* `{{LLM_CLI}} -V` or equivalent */ }
export function get{{LLM_CAP}}AuthStatus(cwd) { /* credentials check + optional ping */ }
export function read{{LLM_CAP}}DefaultModel() { /* parse config file */ }
export function read{{LLM_CAP}}ConfiguredModels() { /* list model names from config */ }
```

### Pre-implementation checklist (from `{{KIMI_REPO_ROOT}}/lessons.md` Section E + F)

Before you write a single line of `{{LLM}}.mjs`, answer these. Each answer becomes a code constant or a structural choice:

**CLI-integration (Section E)**:
- [ ] Headless flag — `-p`, `--prompt`, `--input`? Empty-string accepted?
- [ ] stream-JSON flag — `--output-format stream-json`? JSONL? Per-token / per-message / per-turn?
- [ ] `session_id` delivery — stdout event / stderr hint / local metadata file / multiple channels?
- [ ] Path storage — verbatim / absolute / symlink-resolved? Match `fs.realpathSync(cwd)` on your side if needed.
- [ ] Exit-code taxonomy — 0 / 1 / 2 / 130 / 143 / 124 / others?
- [ ] Large-prompt stdin — supported? Flag? Temp-file fallback?
- [ ] Step-budget flag — `--max-steps-per-turn` or equivalent?

**LLM-behavior (Section F)**:
- [ ] JSON-output compliance — markdown fence leak rate? Preamble rate? Severity enum translation rate?
- [ ] Language switching — Chinese prompt → Chinese output? Meta-language matching rule applies?
- [ ] Tool-call propensity on simple Q&A — does unbounded step budget starve?
- [ ] Refusal expression — apologetic prose / empty string / structured error?

### Implementation order (suggested)

1. Constants block (populate from probes)
2. `get{{LLM_CAP}}Availability` (simplest — just `-V` / `--version`)
3. `read{{LLM_CAP}}DefaultModel` + `read{{LLM_CAP}}ConfiguredModels` (config file parsing)
4. `parseSessionIdFromStderr` + `readSessionIdFrom{{LLM_CAP}}Json`
5. `get{{LLM_CAP}}AuthStatus` (credentials-dir check + ping with `PING_MAX_STEPS`)
6. `parse{{LLM_CAP}}EventLine` + `extractAssistantText` + `parse{{LLM_CAP}}Stdout`
7. `call{{LLM_CAP}}` (one-shot non-streaming)
8. `call{{LLM_CAP}}Streaming` (reuses parse helpers via `onEvent`)

### Steps

- [ ] **Step 1:** Answer the pre-implementation checklist. Commit the answers to `lessons.md` Section D in your NEW plugin.

- [ ] **Step 2:** Write the constants block. Syntax-check with `node --check`.

- [ ] **Step 3 through N:** Implement in the suggested order. After each function, write a smoke test via `node --input-type=module -e "..."` that exercises the function end-to-end (not just syntax). Commit per function.

- [ ] **Step (N+1): T1 + T8 acceptance**

T1 — on a machine with `{{LLM_CLI}}` installed + authenticated:

```bash
node plugins/{{LLM}}/scripts/{{LLM}}-companion.mjs setup --json
# Expected: { installed: true, authenticated: true, model: "...", version: "..." }
```

T8 — on a fresh machine (or with `{{LLM_CLI}}` PATH masked):

```bash
env PATH=/usr/bin node plugins/{{LLM}}/scripts/{{LLM}}-companion.mjs setup --json
# Expected: { installed: false, ... } + install recommendation mentioning {{LLM_CLI_INSTALL}}
```

Both must pass before `phase-1-skeleton` tag.

---

## Hand-off to Phase 2

Phase 2 (`/{{LLM}}:ask` + streaming) pins to:
- `call{{LLM_CAP}}` + `call{{LLM_CAP}}Streaming` in `{{LLM}}.mjs`
- `/{{LLM}}:ask` command file
- stream-json (or provider equivalent) integration
- T2 / T3 / T4 gates (headless response / streaming increments / session-id recovery)

Do NOT start Phase 2 until T1+T8 green + `phase-1-skeleton` tagged.

### Phase 2 new-file inventory (preview)

These files are created in Phase 2, not Phase 1:
- `plugins/{{LLM}}/commands/ask.md`
- `plugins/{{LLM}}/skills/{{LLM}}-cli-runtime/SKILL.md` (first draft)
- `plugins/{{LLM}}/skills/{{LLM}}-result-handling/SKILL.md` (first draft)
- New exports in `{{LLM}}.mjs`: the streaming path + per-event parsers
- `plugins/{{LLM}}/scripts/{{LLM}}-companion.mjs` grows the `ask` subcommand

Lift structure from `{{KIMI_REPO_ROOT}}/docs/superpowers/plans/2026-04-20-phase-2-ask-streaming.md` when ready.

---

## Template self-review

After instantiating this template into a concrete Phase-1 plan, verify:

1. **No unreplaced placeholders.** Run `grep -oE '\{\{[A-Z_]+\}\}' docs/superpowers/plans/YYYY-MM-DD-phase-1-skeleton.md | sort -u` — expected: empty output.
2. **Task order intact.** T.1 → T.6 in that order; T.6 is the CLI-specific write-from-scratch task (biggest).
3. **All commit hooks present.** Each task ends with `git add ... && git commit -m "..."`.
4. **Exit criteria match the target provider.** T1 + T8 reference `{{LLM_CLI}}` and `{{LLM_CLI_INSTALL}}` — verify these are your provider's real values after substitution.
5. **Cross-refs resolve.** `{{KIMI_REPO_ROOT}}/lessons.md` path exists; `{{KIMI_REPO_ROOT}}/plugins/kimi/scripts/lib/*.mjs` files exist.

---

## Provenance

Derived from kimi-plugin-cc Phase 1 plan tasks 1.1 through 1.8 (minus the skill-draft and hook tasks, which materialize in Phase 2+ for sibling plugins). Compressed from ~1500 lines of kimi-specific plan into ~450 lines of parameterized template.

Template change history:
- 2026-04-20 phase-5-final: first version, extracted from kimi-plugin-cc Phase 1 plan per spec §6.2 "模板沉淀" and gemini Phase-5-plan G1.
