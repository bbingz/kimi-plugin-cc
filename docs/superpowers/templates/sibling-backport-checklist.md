# Sibling-Plugin Backport Checklist (post-v0.1 kimi-plugin-cc fixes)

**For:** authors of `minimax-plugin-cc` / `qwen-plugin-cc` / `doubao-plugin-cc` / any future sibling that forked from kimi-plugin-cc's `phase-1-template.md` OR was copy-based from an earlier kimi state.

**Scope:** the 18 findings integrated at `kimi-plugin-cc` tag `phase-5-post-review-3` (commit `54f2fd0`, 2026-04-21) after a **5-way review** (codex + gemini + kimi + qwen + Claude-self empirical probe). Some fixes are mechanical (1-line); some are semantic invariants you must re-examine in your own provider context.

**Read order:** P0 first (correctness / data loss / architecture), P1 next (contract alignment / docs), P2 last (ergonomic / UX polish). Each entry tells you: *what was broken*, *what to change*, and *how to verify*.

**Reference commits** (all on https://github.com/bbingz/kimi-plugin-cc):

| Fix bundle | Commit | Tag |
|---|---|---|
| Phase 5 initial close | `cc10567` | `phase-5-final` |
| 13-item comprehensive 3-way review polish | `ac1cc5b` | `phase-5-post-review` |
| 11-item 4-way review polish | `ab8e8a1` | `phase-5-post-review-2` |
| **18-item 5-way review polish (this doc)** | **`54f2fd0`** | **`phase-5-post-review-3`** |

To see any specific fix's exact diff: `git show <commit> -- <file>` against kimi-plugin-cc.

**Global rule before starting:** do NOT `sed -i 's/kimi/<llm>/g'` globally across your repo. The kimi-plugin-cc code contains legitimate `"kimi-companion"` strings in FALLBACK_STATE_ROOT_DIR, `PARENT_SESSION_ENV` / exit-code constant names with `KIMI_` prefix that are REFERENCED by exports (if you rename only definitions, consumers break), and historical comments that document porting decisions. Use the whitelist approach in §P0-7 below.

---

## P0 — correctness / data loss blockers (backport ASAP)

### P0-1. ~~Fix the dead `<llm>SessionId` field check in `render.mjs`~~ → **Delete `render.mjs` entirely**

**Superseded (2026-04-21 post-v0.1 review):** a full-repo review after the
phase-5-post-review-3 tag proved `render.mjs` has ZERO external importers
— every exported function (`renderSetupReport`, `renderKimiResult`,
`renderJobSubmitted`, `renderStatusReport`, `renderStoredJobResult`,
`renderCancelReport`) is defined but never called. The original
`geminiSessionId` field-rename patch (below) fixed a bug in code that
was never reached in practice. The whole module is now deleted in
kimi-plugin-cc and `phase-1-template.md` T.5 no longer ports it.

**Action for siblings:**

```bash
# If you ported render.mjs from an earlier kimi state or from the original
# gemini-plugin-cc:
git rm plugins/<llm>/scripts/lib/render.mjs
# Then verify nothing imports it:
grep -rn "render\.mjs\|renderSetupReport\|renderKimiResult\|renderJobSubmitted\|renderStatusReport\|renderStoredJobResult\|renderCancelReport" plugins/<llm>/
# Expect: no matches (except possibly historical comments in CHANGELOG.md)
```

If the grep finds an importer, that importer is dead code too — remove
the import + its call site, or (rarely) decide this sibling genuinely
needs text rendering and port the call site inline into the companion.

**Historical context (for siblings that DO have a working importer and
want to keep render.mjs alive):** the original gemini-era bug was
`render.mjs:131 job.geminiSessionId` — the actual field written by
`job-control.mjs` was `kimiSessionId`. Rename to `<llm>SessionId`. But
this is no longer the recommended path — the v0.1 cleanup showed the
right move is to delete the whole module.

**Verify (deletion path):** after deletion, run the sibling's test
suite / T-checklist and confirm no import errors. `/kimi:status`
output comes from companion-emitted JSON rendered by the command
`.md` file; `/kimi:setup` text output comes from companion-local
`formatSetupText`. Neither path touches render.mjs.

---

### P0-2. Close the cancel-during-finalization race in `runWorker`

**Problem:** the foreground worker's write-back sequence was:
```
1. listJobs() → check if status === "cancelled", bail if so
2. writeJobFile()       — writes <jobId>.json
3. upsertJob()          — state.json mutation
```
If `cancelJob()` fires between steps 1 and 2, or 2 and 3, the cancelled state gets clobbered by `completed`/`failed`. Codex H1 + qwen M2 both flagged this.

**Action:** replace the "check + write + upsert" sequence with a single `updateState()` transaction:

```js
let wasCancelled = false;
updateState(workspaceRoot, (state) => {
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) { wasCancelled = true; return; }
  const current = state.jobs[idx];
  if (current.status === "cancelled") { wasCancelled = true; return; }
  // Write result file INSIDE the lock so any reader of final state is
  // guaranteed to find the result file
  writeJobFile(workspaceRoot, jobId, { id: jobId, status, exitCode, result: parsedResult, completedAt: now });
  state.jobs[idx] = { ...current, status, phase, exitCode, pid: null, <llm>SessionId, updatedAt: now };
});
if (wasCancelled) { console.log(`\n[${now}] Job ${jobId} was cancelled during execution`); return; }
```

The streaming worker path (`runStreamingWorker`) already uses this pattern — check yours matches kimi-plugin-cc's ab8e8a1 shape.

**Verify:** start a background task, cancel it just before completion timing, check `<llm>-companion.mjs status --json` shows `cancelled` not `completed`.

---

### P0-3. Unify hook `{ok, reason}` shape with `{ok, error}`

**Problem:** the stop-review-gate hook internally used `{ok: false, reason: "..."}` while the rest of the codebase (errorResult / reviewError) uses `{ok: false, error: "..."}`. Qwen M1 flagged the divergence.

**Action:** in `stop-review-gate-hook.mjs`, rename the internal field:
- `parseStopReviewOutput`: `{ok, reason: null}` → `{ok, error: null}`, `{ok:false, reason: "..."}` → `{ok:false, error: "..."}`
- `runStopReview`: same rename
- Main consumer: `emitDecision({decision: "block", reason: review.error ? ... : ...})` — the **external** Claude Code hook schema still uses `reason` (that's Claude Code's contract, not ours), so only the internal passing changes

**Verify:** `grep -n "reason:" plugins/<llm>/scripts/stop-review-gate-hook.mjs` — all hits should be inside `emitDecision({ decision, reason: ... })`; internal returns use `error`.

---

### P0-4. Strengthen `build<Llm>AdversarialPrompt`'s retry hint

**Problem:** `build<Llm>ReviewPrompt`'s retry block had explicit `do NOT translate them` + `Nothing but the JSON.` wording. The adversarial version dropped both, so adversarial retries were empirically more likely to re-fail on severity-translation or markdown-fence leak.

**Action:** align the adversarial retry hint text to match the review retry hint. Exact string (from kimi 54f2fd0):

```js
return `${base}

[IMPORTANT] Your previous response failed JSON parsing or schema validation. The error was: ${retryHint}
Return ONLY the JSON object — no prose, no markdown fence, no commentary before or after. Nothing but the JSON. Use the EXACT English severity strings (critical/high/medium/low) — do NOT translate them.`;
```

**Verify:** run adversarial review 3 times on a small diff; JSON parse/validate should succeed ≥2 of 3 with at most 1 retry.

---

### P0-5. Add liveness probe + SIGKILL escalation to `cancelJob`

**Problem:** old `cancelJob` sent SIGINT (500ms grace) → SIGTERM, then marked cancelled. Two failures: (a) no up-front liveness probe — if `job.pid` refers to a stale/recycled PID, kimi would kill the wrong process, and (b) no SIGKILL — a worker that ignores SIGTERM stays alive while state says "cancelled".

**Action:** three-step escalation with alive-checks between each step:

```js
if (job.pid) {
  const alive = () => { try { process.kill(job.pid, 0); return true; } catch { return false; } };
  const sendSignal = (sig) => {
    try { process.kill(-job.pid, sig); return true; }
    catch { try { process.kill(job.pid, sig); return true; } catch { return false; } }
  };
  if (!alive()) {
    process.stderr.write(`Warning: job ${jobId} PID ${job.pid} is not alive; marking cancelled without signaling.\n`);
  } else {
    sendSignal("SIGINT"); sleepSync(500);
    if (alive()) { sendSignal("SIGTERM"); sleepSync(500); }
    if (alive()) { sendSignal("SIGKILL"); sleepSync(200); }
  }
}
```

**Verify:** start a task that traps SIGTERM (e.g. wrap the worker in a `trap "" TERM` handler) and verify cancel still terminates within ~1.5s via SIGKILL.

---

### P0-6. "Copy" review.mjs, never cross-import

**Problem:** kimi-plugin-cc's CHANGELOG + lessons.md originally said sibling plugins "import review.mjs verbatim". Gemini flagged the ambiguity — read literally, that implied `import "../../kimi-plugin-cc/..."`, which would break when end users install only your plugin (no kimi-plugin-cc nearby).

**Action:** copy `scripts/lib/review.mjs` verbatim into `plugins/<llm>/scripts/lib/review.mjs`. Your plugin bundle must be self-contained. In your own docs, say "**copy** verbatim," not "import."

---

### P0-7. Plugin-scoped state dir (multi-plugin CLAUDE_PLUGIN_DATA isolation)

**Problem:** in a live Claude Code session with multiple plugins installed, `CLAUDE_PLUGIN_DATA` is shared across all plugins. When kimi's state.mjs wrote to `<CLAUDE_PLUGIN_DATA>/state/<workspace-slug>/state.json`, gemini / codex / qwen companions wrote to the same file. Empirically observed during the 5-way-review probe (single state.json with 13 jobs, mixed `geminiSessionId` / `kimiSessionId` / `write:true` fields from different providers). Consequences: kimi's `pruneJobs` (50-cap) would evict other plugins' jobs; `cleanupOrphanedFiles` would delete their log files.

**Action:** in your `state.mjs`, change `stateRootDir`:

```js
export function stateRootDir() {
  const pluginData = process.env[PLUGIN_DATA_ENV];
  if (pluginData) {
    // Plugin-scoped subdir. MUST NOT collapse back to "state" alone —
    // CLAUDE_PLUGIN_DATA is shared across plugins in multi-plugin sessions.
    return path.join(pluginData, "<llm>", "state");  // your provider name here
  }
  return FALLBACK_STATE_ROOT_DIR;
}
```

**Critical:** the subdir name must be your provider identifier, NOT the literal string `"kimi"` (otherwise minimax's state lands at `<data>/kimi/state/` and collides with kimi's). If you're auditing from my phase-1-template version, the template says `path.join(pluginData, "kimi", "state")` verbatim — you must replace that `"kimi"` → `"<llm>"` when instantiating.

**Verify:** after the fix, start kimi + minimax companions simultaneously in the same workspace. Run `<llm>-companion.mjs status` — each plugin sees only its own jobs. `ls $CLAUDE_PLUGIN_DATA/` shows `kimi/` and `minimax/` subdirs.

**Backwards compat:** existing jobs at the old path are lost after this change. Acceptable — document in lessons.md that upgrading to this shape is a one-time reset.

---

## P1 — contract alignment / docs (do within the week)

### P1-8. Template `errorResult` signature — add `status` + `stdout` fields

**Problem:** `phase-1-template.md` T.6 specified `errorResult({ error, events = [], textParts = [] })`. But `review.mjs`'s `reviewError` expects `transportError.status` to propagate exit codes. If your `<llm>.mjs` implements `errorResult` per the old signature, every review failure produces `status: null` and exit code propagation breaks.

**Action:** your `<llm>.mjs` `errorResult` must include `status` + `stdout`:

```js
export function errorResult({ status = null, error, stdout = "", events = [], textParts = [] }) {
  // ... status propagates via transportError.status; include partialResponse
  // derived from stdout/events so debug consumers can see what <llm> produced
}
```

Downstream `review.mjs` `reviewError` already reads `transportError.status ?? null` — the top-level `status` exists so other consumers (ask / task exit code) can read it directly.

---

### P1-9. Rename path constants in `state.mjs` with a WHITELIST, not global sed

**Problem:** the template's T.4 step told you to `sed -i '' 's/kimi/{{LLM}}/g'` on state.mjs. That clobbers legitimate strings: `FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "kimi-companion")` becomes `"<llm>-companion"` (that's actually fine!), but historical comments ("Gemini's state.mjs… Kimi has no equivalent…") get mangled into nonsense, and intentional references to kimi-plugin-cc context are lost.

**Action:** targeted edits only:

1. `path.join(pluginData, "kimi", "state")` → `path.join(pluginData, "<llm>", "state")` — P0-7 above
2. `FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "kimi-companion")` → `path.join(os.tmpdir(), "<llm>-companion")`
3. Leave all comments + doc-strings intact — they document porting decisions

**Verify:** `grep -n '"kimi' plugins/<llm>/scripts/lib/state.mjs` — should return zero hits, OR only hits inside comments.

---

### P1-10. Exit-code taxonomy doc — add 124

**Problem:** `<llm>-cli-runtime/SKILL.md`'s exit-code table originally listed 0/1/2/130/143. After kimi added `KIMI_STATUS_TIMED_OUT = 124` for local-timeout disambiguation (distinct from SIGTERM 143), the doc went stale.

**Action:** add a row:

```markdown
| 124 | Local timeout (companion-enforced) — child spawned but exceeded `<LLM>_STATUS_TIMED_OUT` budget, or background worker exceeded `spawnSync` 600s timeout | "<llm> timed out after Xs" |
```

Update any render code that currently treats 124 as an unknown code.

---

### P1-11. Command `rescue.md` — add an error-handling block

**Problem:** ask.md / review.md / adversarial-review.md / setup.md all had structured error-handling sections in their frontmatter. rescue.md only said "Return the companion stdout verbatim" — leaving Claude unguided when the subagent's Bash call exited non-zero. Gemini M2.

**Action:** add this block (adjust `<llm>` throughout):

```markdown
Error handling:

**If the subagent's Bash call exits non-zero**:
1. Present `stderr` verbatim to the user.
2. If `stdout` has structured JSON, show that too.
3. Map the exit code via the <llm>-cli-runtime skill's exit-code table:
   - `124` → local timeout (worker exceeded 600s budget)
   - `130` → user-initiated SIGINT
   - `143` → SIGTERM (external kill, not local timeout)
   - `1` → resume-mismatch OR generic failure
   - `2` → usage error (bad flag)
4. Add one declarative suggestion based on exit code:
   - `124` → "The task timed out. Split into smaller pieces or use --background."
   - `130`/`143` → "The request was interrupted. Retry when ready."
   - resume-mismatch → "<llm> started a fresh session; prior context was not carried over."
   - `1` other → "Run `/<llm>:setup` to verify CLI + model, then retry."
5. Do NOT retry automatically.
```

---

## P2 — ergonomic / UX / diagnostic polish (nice to have)

### P2-12. Distinguish `role: "system"` events from "think-only"

**Problem:** when `<llm>.mjs` parsed stream-json and got an event with `role: "system"`, it neither accumulated text nor counted toward tools. The empty-text guard then mis-classified the run as "think-only response."

**Action:** in `parse<Llm>Stdout` + the streaming `processLine`, add a counter:

```js
} else if (ev.role) {
  unexpectedRoleCount++;
}
```

And branch the empty-text error message:

```js
const baseMsg =
  events.length === 0
    ? "<llm> exited 0 but produced no stream-json events"
    : (unexpectedRoleCount > 0 && toolEvents.length === 0 && countThinkBlocks(events) === 0)
      ? `<llm> produced only unexpected-role events (${unexpectedRoleCount} events with no assistant/tool role)`
      : "<llm> produced no visible text (think-only response)";
```

Return `unexpectedRoleCount` in both the success and failure shapes so downstream observability can track it.

---

### P2-13. Extend `cleanupOrphanedFiles` to strip `.config.json` suffix + sweep `state.json.tmp-*`

**Problem:** `cleanupOrphanedFiles` only stripped `.json` and `.log` suffixes when matching job IDs. `<jobId>.config.json` (stream-worker config files) got mis-correlated as orphans and swept. Also, `atomicWriteFileSync` can leak `state.json.tmp-<pid>-<ts>` files if the process is killed between write and rename; no sweeper touched them.

**Action:** two extensions:

```js
const id = file
  .replace(/\.config\.json$/, "")
  .replace(/\.(json|log)$/, "");
```

And add (after the jobs-dir scan):

```js
const stateDir = resolveStateDir(workspaceRoot);
try {
  const stateFile = resolveStateFile(workspaceRoot);
  const stateFileBase = path.basename(stateFile);
  const cutoff = Date.now() - 60_000;
  for (const file of fs.readdirSync(stateDir)) {
    if (!file.startsWith(`${stateFileBase}.tmp-`)) continue;
    try {
      const stat = fs.statSync(path.join(stateDir, file));
      if (stat.mtimeMs < cutoff) removeFileIfExists(path.join(stateDir, file));
    } catch { /* stale already removed */ }
  }
} catch { /* stateDir may not exist yet */ }
```

---

### P2-14. Align prompt recipes with actual `build<Llm>ReviewPrompt` shape

**Problem:** `<llm>-prompt-recipes.md` Review example showed `<schema>{{REVIEW_SCHEMA}}</schema>` — but the actual `build<Llm>ReviewPrompt` function uses a ```` ```json ```` fence around the schema. Siblings reading the recipe and writing their prompts would mismatch.

**Action:** update the recipe's `<schema>` wrapper to a `json` fence:

````markdown
```json
{{REVIEW_SCHEMA}}
```
````

---

### P2-15. Exit non-zero on `--resume` UUID mismatch

**Problem:** `--resume <uuid>` that didn't match the returned session resulted in a stderr warning + exit 0. User would see the answer and assume context carried over.

**Action:** in `runAsk` (or your equivalent), track whether a mismatch happened:

```js
let resumeMismatched = false;
if (callArgs.resumeSessionId && result.ok && result.sessionId &&
    result.sessionId !== callArgs.resumeSessionId) {
  process.stderr.write(`Warning: requested --resume ${callArgs.resumeSessionId} did not match returned session ${result.sessionId}; <llm> likely started a fresh session and prior context was not carried over.\n`);
  resumeMismatched = true;
}
process.exit(result.ok ? (resumeMismatched ? 1 : <LLM>_EXIT.OK) : (result.status ?? 1));
```

The response still prints to stdout — user sees the answer — but the non-zero exit nudges Claude's render to flag the continuity failure.

---

### P2-16. `loadState` should warn on parse failure (not silently fall back to default)

**Problem:** if the user's state.json is corrupted (manual edit, disk error, race from a buggy third-party), `loadState` silently returned `defaultState()`. Job history vanished without a clue.

**Action:** track the last error + file existence; emit a stderr warning when the file existed but parsing failed:

```js
if (fileExists && lastError) {
  process.stderr.write(
    `Warning: <llm> state file ${file} is unreadable (${lastError.message}); job history reset to defaults.\n`
  );
}
return defaultState();
```

Don't emit for `ENOENT` — that's the normal first-run case.

---

### P2-17. Parameterize `TRUNCATION_NOTICE` / `RETRY_NOTICE` in `runReviewPipeline`

**Problem:** `review.mjs` had `TRUNCATION_NOTICE` hardcoded to "150 KB" and `RETRY_NOTICE` hardcoded. If your provider uses a smaller context window and you override `MAX_REVIEW_DIFF_BYTES`, the notice string lies.

**Action:** already done in review.mjs if you copied verbatim from 54f2fd0. `runReviewPipeline` now accepts:

```js
runReviewPipeline({
  ...,
  truncationNotice: formatTruncationNotice(50_000),  // your budget
  retryNotice: "(Our first response was malformed; the retry succeeded.)",  // if you want provider-specific wording
});
```

Plus a new exported helper:

```js
export function formatTruncationNotice(maxDiffBytes) {
  const budgetKb = Math.round(maxDiffBytes / 1000);
  return TRUNCATION_NOTICE_TEMPLATE.replace("{BUDGET_KB}", String(budgetKb));
}
```

---

### P2-18. Broaden `<llm>-result-handling` rule #3 scope

**Problem:** the "Never auto-execute" rule originally listed `/kimi:ask` and `/kimi:review`. That's narrower than reality — EVERY `/<llm>:*` command emits output Claude must not interpret as shell. Kimi L4.

**Action:** rewrite the scope note:

```markdown
> **Note on rule #3 scope**: "Never auto-execute" is a presentation-layer policy, not a sandbox. <Llm>'s free-text output is rendered as-is; the companion does not parse imperatives, and Claude Code's command parser does not scan `/<llm>:*` output as shell. This applies to **all** `/<llm>:*` commands. The one exception: `/<llm>:rescue` may return structured `tool_call` events (e.g. `apply_patch`) which the companion forwards as tool events, not free-text imperatives — those are a distinct channel with their own authorization model.
```

---

## Verification checklist (before tagging your sibling's post-backport state)

- [ ] `grep -rn "geminiSessionId\|kimiSessionId" plugins/<llm>/` — only your provider's field name matches
- [ ] Full T-checklist: setup, ask, review, adversarial-review, rescue (foreground + background), cancel mid-stream
- [ ] `<llm>-companion.mjs status --json` after a cancelled task shows `status: "cancelled"`, not `completed`
- [ ] Adversarial review on a small diff produces summary matching the red-team regex `/do not ship|blocks|unsafe|reject/i`
- [ ] `<llm>-companion.mjs review --scope bogus` exits 2 with structured JSON error (not 0)
- [ ] `stateRootDir()` resolves to `<CLAUDE_PLUGIN_DATA>/<llm>/state/`, NOT `<CLAUDE_PLUGIN_DATA>/state/`
- [ ] Install the plugin in a fresh Claude Code session that also has kimi-plugin-cc installed, run one task from each, verify neither plugin shows the other's jobs in `/<llm>:status`
- [ ] `grep -n '"kimi\b' plugins/<llm>/` — zero hits outside intentional comments

---

## Maintenance note

This doc captures the state of post-phase-5 polish in kimi-plugin-cc. Future kimi fixes may add to this list. When kimi tags a new `phase-N-post-review-M`, diff against the previous tag and append any new backport items below. Don't retroactively rewrite P0/P1/P2 labels — they're calibrated to the risk *at time of discovery*, which is useful archaeology.

---

## Post-P3 additions (2026-04-22; target: kimi-plugin-cc@v0.2-p3-polish)

P3 adds 8 polish items to v0.1; sibling forks should apply the following. Several are **rename-only** and mechanical; the adapter seam (P3-C4) intentionally stops short of full abstraction because the "minimax on the other side" data point isn't in yet. When it arrives, extend; don't pre-abstract.

### P3-C1. Copy `paths.mjs` verbatim

**Action:** copy `plugins/kimi/scripts/lib/paths.mjs` byte-for-byte into `plugins/<llm>/scripts/lib/paths.mjs`. Zero string substitution. File contains only `node:fs` import + `resolveRealCwd` function.

Import from `<llm>-companion.mjs` + both hooks (`session-lifecycle-hook.mjs` + `stop-review-gate-hook.mjs`). Their `resolveWorkspaceRoot` non-git fallback must call `resolveRealCwd(cwd)` instead of returning raw `cwd`.

### P3-C2. Canonical `errorResult` in `lib/errors.mjs` + catch-block migration

**Action:** create neutral leaf module `plugins/<llm>/scripts/lib/errors.mjs` (NOT in job-control.mjs — that would circular-dep with <llm>.mjs which already imports from it). Export `errorResult({ kind, error, status = null, stdout = "", detail = null })`.

Migrate every `{ ok: false, error: <msg> }` catch-block write in `<llm>-companion.mjs` to `errorResult({ kind: "<cmd>", error: <msg> })` where `<cmd>` ∈ `"ask" | "review" | "adversarial-review" | "task"`.

If your `<llm>.mjs` has a local `errorResult` function (kimi's did — stream-specific, returns `partialResponse + events`), rename it to `streamErrorResult` and add `import { errorResult } from "./errors.mjs"` for the canonical helper's new callers (notably C3's guard). Also update `reviewError` in `review.mjs` to compose the base envelope by spreading `...errorResult({kind: "review", error, status})` at the top of its return.

### P3-C3. Defensive `MAX_PROMPT_CHARS` cap in `<llm>.mjs`

**Action:** add `MAX_PROMPT_CHARS = 1_000_000` constant + `checkPromptSize(prompt, { kind, label })` helper to `<llm>.mjs`; guard `call<Llm>` + `call<Llm>Streaming` with early return. Measurement is char count (UTF-16 code units), not bytes — kimi's rationale applies identically to any provider using stdin for prompts.

If your `call<Llm>Streaming` returns a Promise (likely), wrap the early return with `Promise.resolve(guardResult)` to preserve the Promise contract.

### P3-C4. `runLLM` seam via `dispatchStreamWorker` injection (NOT task-spawn config)

**Action:** in `job-control.mjs`, remove the direct import of `call<Llm>Streaming`; make `runStreamingWorker` read `config.runLLM` (with guard). In `<llm>-companion.mjs`'s `dispatchStreamWorker` function, inject `config.runLLM = call<Llm>Streaming;` AFTER the `JSON.parse` line that rehydrates the config file, BEFORE the `try { await runStreamingWorker(...) }` block.

**Why not at task-spawn site?** The background-worker path serializes config via `JSON.stringify`; functions cannot cross JSON. Injection must be in the child process after rehydration. This was CRITICAL in kimi's 3-way plan review.

**Residual rename targets (not covered by C4 — sed these when forking):**
- `SESSION_ID_ENV = "KIMI_COMPANION_SESSION_ID"` → `"<LLM_UPPER>_COMPANION_SESSION_ID"` (user-visible env var; cross-file contract)
- `KIMI_STATUS_TIMED_OUT` import from `./<llm>.mjs` (naming follows provider)
- `kimiSessionId` field (in state.json + ~8 code references) → `<llm>SessionId`

These three weren't abstracted because doing so without a second real plugin would be premature. If your fork hits friction on any, extend the abstraction in the kimi repo and we all benefit.

### P3-C5. `enrichJob` pure + IO wrapper split

**Action:** `enrichJob(job, { logPreview, isAlive })` becomes pure (exported); returns `{ enriched, shouldPersistZombie }`. Thin `enrichJobFromDisk(job, workspaceRoot)` wrapper does IO + optional `upsertJob` persist. Callers on the status read path switch to the wrapper. Future decoupling of status-reads-mutate-state is deferred in kimi's lessons.md §I.2.

### P3-C6. `<LLM_UPPER>_JOB_TTL_DAYS` + correct filter placement

**Action:** env var name is provider-scoped — rename `KIMI_JOB_TTL_DAYS` → `<LLM_UPPER>_JOB_TTL_DAYS` when forking. Export `DEFAULT_TTL_DAYS = 7`, `resolveTtlMs()`, `filterExpired()` from state.mjs (these stay generic). Stderr warning prefix `[kimi]` → `[<llm>]`.

**CRITICAL placement (caught by kimi's 3-way plan review)**:
- `loadState` MUST NOT be modified (UNCHANGED from v0.1). Reason: hooks like `session-lifecycle-hook.mjs` do unlocked `loadState → saveState`; if loadState filtered, the hook would durably purge outside any lock.
<!-- loadState MUST NOT be modified -->
- `updateState` applies `filterExpired` INSIDE its lock, between `loadState` and `mutate`. This is the ONLY physical-purge path.
- Render path (e.g., `<llm>-companion.mjs`'s `runJobStatus`) applies `filterExpired` to the jobs list before rendering — this is the user-facing purged view.

SessionEnd's `cleanupSessionJobs` filter becomes status-aware: keep `completed | failed | cancelled` even for ended session; drop only `running | starting | queued`.

### P3-C7. **kimi-only** — do NOT copy

kimi's `gr-*/gt-*` migration note is kimi-specific history. Siblings never inherited the gemini-derived prefix — skip this item entirely.

### P3-C8. `maxDiffChars` parameterization in `review.mjs`

**Action:** `runReviewPipeline` signature adds `maxDiffChars` parameter; default = `MAX_REVIEW_DIFF_BYTES` constant (historically named "bytes" but measures chars — back-compat; leave with clarifying comment). `truncationNotice` default auto-derives from `maxDiffChars` via `formatTruncationNotice(maxDiffChars)`.

---

## Verification checklist additions (post-P3)

- [ ] `grep -rn "fs.realpathSync" plugins/<llm>/scripts/` returns exactly one runtime match (in `lib/paths.mjs`; comment-only hits in other files are acceptable)
- [ ] `grep -n "call<Llm>Streaming" plugins/<llm>/scripts/lib/job-control.mjs` returns zero matches (import + call removed; `runLLM` seam active)
- [ ] `grep -n "kimi\|Kimi\|KIMI" plugins/<llm>/scripts/lib/paths.mjs` returns zero matches
- [ ] `grep -n "kimi\|Kimi\|KIMI" plugins/<llm>/scripts/lib/errors.mjs` returns zero matches
- [ ] `<LLM_UPPER>_JOB_TTL_DAYS=0 /<llm>:status --json` retains expired jobs; `=abc` emits `[<llm>] ignoring invalid` stderr warning + falls back to default
- [ ] SessionEnd narrowing: running-then-ended-session jobs get dropped; completed-then-ended-session jobs stay until TTL
- [ ] `loadState` body contains ZERO references to `filterExpired` / `resolveTtlMs` (anti-regression — this was a v1-plan bug)

Last updated: 2026-04-22, reflecting kimi-plugin-cc commit `v0.2-p3-polish` (P3 integration; supersedes Phase 5 and incorporates 6-way-review-approved design spec + 3-way-review-on-plan findings).

---

## P2 New Commands additions (2026-04-23)

For siblings gemini-plugin-cc, minimax-plugin-cc, qwen-plugin-cc, and eventual doubao-plugin-cc:

### P2-N1. Create `{plugin}/commands/continue.md` with `{plugin}:continue` naming

**Action:** frontmatter `description`, `argument-hint: '<prompt>'`, `allowed-tools: Bash(node:*)`. Body: companion invocation + render rules (see `plugins/kimi/commands/continue.md` for template). Error-message mapping table follows §6.2 of kimi's spec.

### P2-N2. Create `{plugin}/commands/resume.md` with `{plugin}:resume <sessionId> <prompt>`

**Action:** same shape as continue.md, argument-hint `<sessionId> <prompt>`.

### P2-N3. Create `{plugin}/scripts/lib/sessions.mjs`

**Action:** mirror kimi's module structure but adapt to the plugin's upstream CLI conventions — must be probed separately (see P2-N5 below). Module exports:
- `UUID_RE` — semi-strict 8-4-4-4-12 hex
- `md5CwdPath(normalizedCwd)` — (may or may not apply to sibling CLIs)
- `sanitizeForStderr(s)` — copy verbatim (provider-agnostic)
- `SESSION_ERROR_REASONS` + `mapSessionReason(reason, ctx, options)` — reason keys may rename `kimi-json-*` → `{plugin}-config-*`; templates adapt to sibling's config-file path
- `resolveContinueTarget(normalizedCwd, kaos)` — per-plugin config-file shape
- `validateResumeTarget(normalizedCwd, sessionId)` — per-plugin session-dir layout

### P2-N4. Remove `--resume` (or equivalent) from `{plugin}/commands/ask.md` if present

**Sibling scan conducted 2026-04-22** — NONE of gemini / minimax / qwen ask.md had `--resume` at that time:
- `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/commands/ask.md` — no --resume
- `/Users/bing/-Code-/minimax-plugin-cc/plugins/minimax/commands/ask.md` — no --resume
- `/Users/bing/-Code-/qwen-plugin-cc/plugins/qwen/commands/ask.md` — explicitly "always a new conversation; resume via /qwen:rescue"

Re-verify before claiming this step as no-op. If a sibling has since added it, remove as BREAKING with a CHANGELOG entry.

### P2-N5. Probe upstream CLI's session semantics per-plugin

Kimi's `kimi.json + work_dirs array + md5(realpath(cwd))/sessions/uuid/{context.jsonl,state.json,wire.jsonl}` layout is **kimi-cli-specific**. Sibling CLIs likely use different:
- Config file name and path (e.g., `~/.gemini/` vs `~/.config/minimax/`)
- Session storage scheme (may not use md5-of-path; may use SQLite; may store in single JSONL)
- Resume flag name (Gemini has no `-r`; Qwen uses `/qwen:rescue --resume-last`)
- Cross-cwd scoping (may not be cwd-scoped at all)

Do NOT assume: the `~/.kimi/` dir path, md5 hashing, or the 3-file session layout. Each sibling plugin needs its own probe.

### P2-N6. Ghost-session risk: probe whether the sibling CLI has a similar silent-session-creation bug

kimi-cli 1.37's ghost behavior (probe v4 Q4.0) may or may not apply to sibling CLIs. Check each by the same throwaway-cwd + fabricated-UUID experiment. If the sibling CLI is safe against ghost, wrapper-side validation is still defensible as input-sanity hardening — but the "BREAKING: ghost-session hardened" CHANGELOG framing doesn't apply.

### P2-N7. Companion `runContinue` / `runResume` helpers

Mirror kimi's `plugins/kimi/scripts/kimi-companion.mjs` additions:
- runContinue: rejects flags; resolves via `resolveContinueTarget` → validates via `validateResumeTarget` → calls the plugin's `call<LLM>` wrapper with `resumeSessionId` + `cwd: realCwd` + distinct timing kind; emits resume-mismatch warning on sessionId divergence.
- runResume: same shape without the resolve step; accepts user-provided sessionId.
- runAsk: reject `--resume` / `-r` / `--resume=<val>` explicitly at top (parseArgs does NOT error on unknown long flags). Remove `resume` from `valueOptions` + `aliasMap`.

### P2-N8. Tests (mandatory)

- `tests/sessions.test.mjs` unit suite — fakeHome + fakeHomeWithSession helpers are mostly portable; update config-file path + session-dir structure per sibling CLI. Expected ~30-50 cases covering all reasons.
- `tests/commands-p2.test.mjs` integration — spawn-based (simpler than ESM mocks).
- `tests/ask-no-resume-guard.test.mjs` — **mandatory** structural regression guard.

### P2-N9. CHANGELOG BREAKING framing

Only applicable if sibling had `--resume` on ask. Otherwise an "Added" entry only:
- Added `/plugin:continue <prompt>` and `/plugin:resume <sessionId> <prompt>`.
- Added `lib/sessions.mjs`.
- probe-v4 findings committed.

### P2-N10. lessons.md updates

Each sibling's P2 closeout adds a subsection under §I.3 (or next §I.N) documenting its own decisions and deferred items. Cross-reference kimi's P2 closeout for shared design patterns.

---

Last updated: 2026-04-23, reflecting kimi-plugin-cc commit `v0.2-p2-new-commands` (P2 integration; supersedes P3 additions).
