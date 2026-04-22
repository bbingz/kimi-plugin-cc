# CHANGELOG

Reverse-chronological, flat format. Cross-AI collaboration log (Claude/Codex/Gemini).

## 2026-04-22 [Codex]

- **status**: added
- **scope**: docs/templates
- **summary**: phase-1-template T.6 errorResult signature -> P3 canonical (kind field added, events/textParts dropped); paths.mjs added to Create list. sibling-backport-checklist gets Post-P3 section (C1-C8) covering all P3 items with V2-corrected C6 filter placement (loadState UNCHANGED) and C4 injection point (dispatchStreamWorker, not task-spawn).

## 2026-04-22 [Claude Opus 4.7 — v0.2 P3 Task 7 (C6): SessionEnd narrowing + TTL split]

- **status**: done (Task 7 of 11 in v0.2 P3 polish batch, executed in worktree `feat/v0.2-p3-polish`)
- **scope**: `plugins/kimi/scripts/lib/state.mjs`, `plugins/kimi/scripts/lib/job-control.mjs`, `plugins/kimi/scripts/kimi-companion.mjs`, `plugins/kimi/scripts/session-lifecycle-hook.mjs`, `CHANGELOG.md`
- **summary**: TTL policy for completed jobs with split filter placement after 3-way review of plan v1 flagged two bugs. (1) `state.mjs` now exports `DEFAULT_TTL_DAYS = 7`, `resolveTtlMs()`, `filterExpired(jobs, ttlMs, nowMs)`; `loadState` UNCHANGED (unfiltered); `updateState` applies `filterExpired` INSIDE its lock (both primary + forced-break paths) so physical purge is atomic with any mutation. (2) `job-control.mjs` terminal transitions now persist `completedAt: now` to `state.jobs[]` at the 3 sites that previously only wrote it to `writeJobFile`: `runWorker` state.jobs[idx] assign, `runStreamingWorker` Object.assign, and `cancelJob`'s upsertJob. Without this, the TTL filter keyed on `completedAt` would never match state.jobs rows and be a no-op. (3) `kimi-companion.mjs` `runJobStatus` applies `filterExpired` to the built snapshot's `running`+`recent` arrays (queued/running jobs have no `completedAt` so pass through unchanged); single-job path treats expired as not-found via `filterExpired([single]).length === 0`. (4) `session-lifecycle-hook.mjs` `cleanupSessionJobs` narrows the session-end filter: keeps terminal-status jobs (completed/failed/cancelled) from the ended session so `/kimi:result <jobId>` still works after reopening Claude Code; drops only running/queued.
- **why loadState stays unfiltered (v1 bug caught by gemini CRITICAL convergent)**: `session-lifecycle-hook.mjs:74-88` does unlocked `loadState → saveState`. If `loadState` filtered, the hook's `saveState` would write the filtered view back to disk outside any lock — durably purging expired jobs without synchronization, the exact race we're trying to avoid. Design note: hooks' unlocked `saveState` preserves expired entries on disk; the next `updateState` call in any mutation path reads → filters → writes atomically. Correctness property: `/kimi:status` never shows expired jobs (UX filter), `updateState` is the only physical-purge path (atomic with lock).
- **why completedAt needed on state.jobs (v1 bug caught by codex CRITICAL 3)**: plan v1 asserted `writeJobFile` + per-job JSON was the TTL key, but `filterExpired` runs on `state.jobs[]` (the in-memory state.json list), and those rows never had `completedAt`. Added at all 3 terminal-transition sites for parity. Cancellation path was added per Step 2c (plan left it discretionary).
- **env**: `KIMI_JOB_TTL_DAYS` — unset → default 7 days; `0` → `Infinity` (never expire); invalid (non-digit) → stderr warning `[kimi] ignoring invalid KIMI_JOB_TTL_DAYS=<raw>; using default 7 days` + fallback to default.
- **verifications**: 4× `node --check` clean · Step 9 helpers unit test: `default TTL: PASS`, `filter result: PASS` (fresh+running kept, stale dropped) · Step 10 `KIMI_JOB_TTL_DAYS=0`: `ms === Infinity: PASS`, `ancient job kept: PASS` · Step 11 `KIMI_JOB_TTL_DAYS=abc`: `fallback correct: PASS`, `stderr warning: PASS` · Step 12 SessionEnd grep shows `"completed"` / `"failed"` / `"cancelled"` all present · Step 13 `loadState` body contains zero `filterExpired`/`resolveTtlMs` references (primary anti-regression) · module imports verified: `{DEFAULT_TTL_DAYS, resolveTtlMs, filterExpired}` all live.
- **next**: remaining P3 tasks per plan (9/10/11).

## 2026-04-22 [Claude Opus 4.7 — v0.2 P3 Task 6 (C3): defensive MAX_PROMPT_CHARS cap in kimi.mjs]

- **status**: done (Task 6 of 11 in v0.2 P3 polish batch, executed in worktree `feat/v0.2-p3-polish`)
- **scope**: `plugins/kimi/scripts/lib/kimi.mjs`, `CHANGELOG.md`
- **summary**: added `MAX_PROMPT_CHARS = 1_000_000` defensive cap + `checkPromptSize(prompt, {kind, label})` helper that returns canonical `errorResult` on oversize / `null` to proceed. Guard invoked at the top of `callKimi` (kind:`ask`) and `callKimiStreaming` (kind:`task`). Error envelope: `error` field carries user-actionable remediation ("trim context or split into multiple <label> calls"); `detail` carries the structured diagnostic string (`prompt-too-large: <got> chars > <cap> char cap`). Rationale: kimi-CLI's stdin ceiling is unprobed (Phase-0 went to 150 KB max); explicit failure beats opaque pipe hang. Cap value revisitable in v0.2+ once a probe establishes kimi's real limit — tracked in lessons.md §I.2.
- **plan deviation (streaming Promise contract)**: plan Step 5 snippet said `return guardResult;` literally, but `callKimiStreaming` returns a Promise (existing pre-flight at line 555 wraps via `Promise.resolve(streamErrorResult(...))`). Matched that contract: `return Promise.resolve(guardResult);` so awaiting callers don't break. Verified `p instanceof Promise === true`, `(await p).kind === 'task'`.
- **verifications**: `node --check` clean · oversize callKimi → `ok:false, kind:ask, error='prompt exceeds 1000000 chars (got 1100000); trim context or…', detail='prompt-too-large: 1100000 chars > 1000000 char cap'` · `checkPromptSize('hello', {kind:'ask', label:'ask'}) === null` · oversize callKimiStreaming → Promise resolving to `{ok:false, kind:'task', error:'prompt exceeds…'}` (confirms Promise.resolve wrap is correct).
- **next**: remaining P3 tasks per plan (7/9/10/11).

## 2026-04-22 [Claude Opus 4.7 — v0.2 P3 Task 5 (C8): maxDiffChars parameterization in runReviewPipeline]

- **status**: done (Task 5 of 11 in v0.2 P3 polish batch, executed in worktree `feat/v0.2-p3-polish`)
- **scope**: `plugins/kimi/scripts/lib/review.mjs`, `CHANGELOG.md`
- **summary**: added `maxDiffChars` as explicit pipeline parameter to `runReviewPipeline`, defaulting to `MAX_REVIEW_DIFF_BYTES`. `truncationNotice`'s default now derives from `maxDiffChars` via `formatTruncationNotice(maxDiffChars)` — sibling plugins passing a different budget get a correctly-sized user-facing notice without copy-pasting the template. Destructuring order corrected (`maxDiffChars` inserted BEFORE `truncationNotice` so left-to-right default derivation works). Existing constant name `MAX_REVIEW_DIFF_BYTES` preserved for back-compat; added a clarifying comment that the measurement is JS string length (UTF-16 code units, i.e. chars, NOT UTF-8 bytes) — companion's truncation check uses `context.content.length` at kimi-companion.mjs:~417 and ~:534. Block-comment `maxDiffBytes` → `maxDiffChars` rename landed at 2 sites (header override docs + pipeline signature docs); constant comment is the only new prose.
- **why not rename the constant**: internal-only name (consumers: `review.mjs:23` derives TRUNCATION_NOTICE; `kimi.mjs:10,19` re-exports). Renaming would churn 2 more files outside T5's scope. Honest naming on the new PARAM (`maxDiffChars`) + clarifying comment on the OLD CONSTANT solves the 3-way-review MEDIUM naming finding without widening scope. A future refactor can rename when those consumers are independently touched.
- **verifications**: `node --check` clean · `formatTruncationNotice(MAX_REVIEW_DIFF_BYTES).includes('150 KB')` → `true` · `formatTruncationNotice(16_000).includes('16 KB')` → `true` · `runReviewPipeline({maxDiffChars: 16_000, ...stub})` does not throw; returns `{ok:false}` (stub fails callLLM as expected); `r.truncation_notice` empty because stub doesn't trigger truncation — key outcome is no throw on new param.
- **next**: remaining P3 tasks per plan (6/7/9/10/11).

## 2026-04-22 [Claude Opus 4.7 — v0.2 P3 Task 4 (C4): runLLM seam via dispatchStreamWorker injection]

- **status**: done (Task 4 of 11 in v0.2 P3 polish batch, executed in worktree `feat/v0.2-p3-polish`)
- **scope**: `plugins/kimi/scripts/lib/job-control.mjs`, `plugins/kimi/scripts/kimi-companion.mjs`, `CHANGELOG.md`
- **summary**: `job-control.mjs` no longer imports `callKimiStreaming`; `runStreamingWorker` reads `config.runLLM` (with a guard that throws a helpful error referencing the C4 seam if missing). Companion's `dispatchStreamWorker` injects `config.runLLM = callKimiStreaming` AFTER `JSON.parse` of the rehydrated config file — the only place where provider-specific LLM coupling remains. Task-spawn call site in `runTask` is unchanged (passes no `runLLM`, because functions cannot cross the JSON serialization boundary). `onEvent` closure body preserved byte-for-byte.
- **why this seam shape**: V1 plan proposed injecting `runLLM` at the task-spawn config site, but 3-way plan review (codex) caught that `job-control.mjs:297` writes the config via `JSON.stringify` and `kimi-companion.mjs:833` rehydrates via `JSON.parse` — functions vanish across that boundary. V2 (this task) injects INSIDE the child process's `dispatchStreamWorker`, so the child's own module graph supplies the function reference. Sibling plugins (minimax / qwen / doubao) fork `job-control.mjs` verbatim; only that one line in the sibling's companion changes to `call<Llm>Streaming` — per `sibling-backport-checklist.md` Post-P3 section.
- **verifications**: `node --check` clean on both files · `grep 'callKimiStreaming' job-control.mjs` → 0 matches · guard fires with correct message when `runLLM` absent (`PASS: guard fires`) · fake `runLLM` injected through `runStreamingWorker` is invoked (`PASS: fake runLLM invoked (seam works)`) · both modules import at runtime without stacks.
- **next**: remaining P3 tasks per plan (5/6/7/9/10/11).

## 2026-04-22 [Codex — v0.2 P3 Task 3 (C1): extract resolveRealCwd into shared lib/paths.mjs]

- **status**: done (Task 3 of 11 in v0.2 P3 polish batch, executed in worktree `feat/v0.2-p3-polish`)
- **scope**: `plugins/kimi/scripts/lib/paths.mjs` (NEW), `plugins/kimi/scripts/kimi-companion.mjs`, `plugins/kimi/scripts/session-lifecycle-hook.mjs`, `plugins/kimi/scripts/stop-review-gate-hook.mjs`, `CHANGELOG.md`
- **summary**: extracted `resolveRealCwd(cwd)` into neutral shared module `lib/paths.mjs` with zero provider-specific strings. `kimi-companion.mjs` now imports the helper instead of defining it locally. Both hooks now import the same helper and use `resolveRealCwd(cwd)` as the non-git fallback in `resolveWorkspaceRoot`, so `/tmp` and `/private/tmp` hash to the same workspace slug in non-git paths.
- **verifications**: `grep -i 'kimi' plugins/kimi/scripts/lib/paths.mjs` returned no matches · 4× `node --check` clean · `grep -rn 'fs.realpathSync' plugins/kimi/scripts/` found exactly 1 match in `lib/paths.mjs` · smoke test showed existing cwd realpaths and nonexistent path falls back unchanged.

## 2026-04-22 [Claude Opus 4.7 — v0.2 P3 Task 2 (C5): split enrichJob into pure fn + enrichJobFromDisk IO wrapper]

- **status**: done (Task 2 of 11 in v0.2 P3 polish batch, executed in worktree `feat/v0.2-p3-polish`)
- **scope**: `plugins/kimi/scripts/lib/job-control.mjs`, `CHANGELOG.md`
- **summary**: pure `enrichJob(job, {logPreview, isAlive}) -> {enriched, shouldPersistZombie}` — no file IO, no state mutation, unit-testable. Thin IO wrapper `enrichJobFromDisk(job, workspaceRoot)` reads log preview, probes liveness, invokes pure fn, and preserves existing zombie-persist side effect via `upsertJob`. Redirected 2 in-file call sites (`buildStatusSnapshot` + `buildSingleJobSnapshot`) to the wrapper. No external callers of `enrichJob` existed.
- **pure-read deferred**: `/kimi:status` read path still persists zombie-detected jobs via the wrapper's `upsertJob` call. Fully decoupling read-from-write is out of P3 scope; tracked for v0.2+ in lessons.md §I.2.
- **verifications**: `node --check` clean · pure `enrichJob` smoke test with `{isAlive:false, status:'running', pid:99999}` returns `{enriched:{status:'failed', phase:'failed', detail:'Process exited unexpectedly', progressPreview:'x', elapsed:'0s', kindLabel:'job', …}, shouldPersistZombie:true}` · `kimi-companion.mjs` imports without error and renders usage · `grep -E 'enrichJob\b' plugins/kimi/scripts/` finds only the definition + wrapper internal call (zero stragglers of old `enrichJob(job, workspaceRoot)` signature).
- **next**: Task 3 (C4 rename targets in job-control.mjs — kimiSessionId + SESSION_ID_ENV + KIMI_STATUS_TIMED_OUT) or other unassigned P3 tasks per plan.

## 2026-04-22 [Claude Opus 4.7 — v0.2 P3 Task 1 (C2): canonical errorResult + cross-module migration]

- **status**: done (Task 1 of 11 in v0.2 P3 polish batch, executed in worktree `feat/v0.2-p3-polish`)
- **scope**: `plugins/kimi/scripts/lib/errors.mjs` (NEW), `plugins/kimi/scripts/lib/kimi.mjs`, `plugins/kimi/scripts/lib/review.mjs`, `plugins/kimi/scripts/kimi-companion.mjs`, `CHANGELOG.md`
- **summary**: created neutral leaf module `lib/errors.mjs` with canonical `errorResult({kind, error, status, stdout, detail})` envelope. Renamed kimi.mjs's local `errorResult` → `streamErrorResult` (reflects its actual stream-specific purpose: returns `partialResponse + events` from stdout parse) across 1 definition + 7 callsites. Migrated 4 companion catch blocks (runReview/runAdversarialReview ensureGitRepository catches + runTask 2 USAGE_ERROR exits) and 2 review-fallback synthesis sites (runReview/runAdversarialReview try-block fallbacks) to compose the canonical shape. `reviewError` in `review.mjs` now composes the canonical envelope via spread + preserves all pipeline-specific fields (rawText, parseError, firstRawText, transportError, truncation_notice, retry_used/notice, sessionId).
- **why neutral module**: placing `errorResult` in `job-control.mjs` (original spec location) would have created a circular dependency — job-control.mjs imports from kimi.mjs, and kimi.mjs needs `errorResult` for the C3 prompt-size guard (Task 6). Plus kimi.mjs's existing local `errorResult` has a *different* signature. `lib/errors.mjs` is a leaf with zero imports; every consumer depends ON it but nothing it depends on.
- **plan deviation noted**: plan Step 5a labeled the line-387 catch as "runAsk" with `kind: "ask"`, but line 387 is physically inside `runReview` (runAsk has no top-level try/catch). Used `kind: "review"` to match actual function context. Plan labels 5b and 5c then correctly overlap with 5a.
- **verifications**: 4× `node --check` clean · `errorResult({kind:'ask',error:'x'})` returns `{ok:false,kind:'ask',error:'x',status:null,stdout:'',detail:null}` · `kimi.mjs` loads 33 exports · `reviewError` output keys = `[ok,kind,error,status,stdout,detail,rawText,parseError,firstRawText,transportError,truncated,truncation_notice,retry_used,retry_notice,sessionId]` · `kimi-companion.mjs` prints usage without error.
- **next**: Task 2 (C4 rename targets in job-control.mjs — kimiSessionId + SESSION_ID_ENV + KIMI_STATUS_TIMED_OUT).

## 2026-04-22 [Claude Opus 4.7 — v0.2 P3 polish-batch implementation plan (v2 post-3-way-review)]

- **status**: done (plan only; execution next via `superpowers:subagent-driven-development`)
- **scope**: docs/superpowers/plans/2026-04-22-v0.2-p3-polish-plan.md (NEW, 2176L), CHANGELOG.md
- **spec**: `docs/superpowers/specs/2026-04-22-v0.2-p3-polish-design.md` (committed as `a2954d8`)
- **summary**: produced 11-task / 92-step implementation plan for P3 polish batch. Each task is one commit with pre-change baseline grep → literal code change → post-change verification → commit. Ran **3-way review** (codex + gemini + Claude-self with live probes) on plan v1 → returned 3 CRITICAL + 2 HIGH + 2 MEDIUM + 1 LOW. All findings integrated into v2.
- **3-way review CRITICAL findings (all v2-fixed)**:
  - **Functions can't cross JSON serialization** (codex): `_stream-worker` background spawn writes config to file via `JSON.stringify`; v1 passed `runLLM: callKimiStreaming` at task-spawn site — function would vanish. V2 moves injection into `dispatchStreamWorker` post-JSON-parse (kimi-companion.mjs:843).
  - **`errorResult` already exists in kimi.mjs:415** (codex): v1 would create duplicate identifier + circular dep (job-control.mjs imports kimi.mjs). V2 creates neutral `lib/errors.mjs`; kimi.mjs's existing local helper renamed to `streamErrorResult` (reflects its actual stream-specific purpose: returns `partialResponse` + `events`).
  - **`completedAt` not on state.jobs entries** (codex): `writeJobFile` has it (per-job file) but terminal-status state.jobs writes at `job-control.mjs:188-196, :261-271` do NOT. V1's TTL filter would be no-op. V2 Task 7 adds `completedAt: now` to both state.jobs terminal writes.
  - **loadState filter + unlocked hook RMW** (gemini): if loadState filters the view, `session-lifecycle-hook.mjs:73-86`'s unlocked `loadState → saveState` writes filtered view to disk, durably purging outside any lock — exact race v1 claimed to avoid. V2 removes filter from loadState; filter applied in companion's `runJobStatus` render path only; physical purge inside `updateState`'s lock.
- **3-way review HIGH/MEDIUM/LOW integrations**:
  - Task 1 scope expanded to cover 2 review-fallback synthesis sites (`kimi-companion.mjs:439, :553`) + `review.mjs` `reviewError` composition (codex HIGH 1)
  - §7 Execution handoff now includes per-task implementer-split table (3 codex / 8 Claude-self after post-review re-classification — several "mechanical" tasks became design-touching) (gemini HIGH)
  - New §12 Rollback procedure: `git reset --hard a2954d8` + tag delete + orphan `.config.json` sweep (gemini MEDIUM)
  - Task 11 Step 4 pre-deletes tag for idempotent re-runs (gemini LOW)
- **Plan-vs-spec supersessions** (recorded in §I.2 S-rows at Task 10 for future-fork audit trail):
  - S1: errorResult location changed from `job-control.mjs` (spec) to `lib/errors.mjs` (plan)
  - S2: C4 injection point changed from task-spawn config (spec) to `dispatchStreamWorker` (plan)
  - S3: C6 filter placement changed from `loadState` (spec) to `runJobStatus` render + `updateState` purge (plan)
- **These supersessions are improvements on spec, not violations** — spec's intent (canonical shape / LLM seam / TTL semantics) preserved; only implementation location changes. Siblings forking at spec-level will re-derive the same corrections if they skip these plan notes.
- **Verification in plan**: §3 has 8 per-item verification commands; Task 11 Step 1 aggregates them into a single sweep. Each task ends with syntax check + runtime `import()` + spec-§3 checks. No `tests/` directory (lands in P1).
- **Structure**: 11 tasks preserved from writing-plans output; 92 checkbox steps (up from 91 in v1). Task 1 went from 11 steps to 13 steps (added errors.mjs creation + kimi.mjs rename), Task 4 re-written keeping 11 steps, Task 7 went from 11 to 14 (added completedAt persist + split-filter verification + anti-regression check).
- **Self-review v2**: spec coverage ✓, 3-way findings all referenced 19× throughout, no code-gap placeholders (remaining ellipsis uses are intentional "preserve existing body" instructions), type/name consistency across tasks, ordering dependencies satisfied, zsh-safe quoting, rollback procedure explicit.
- **next**: invoke `superpowers:subagent-driven-development` to execute 11 tasks; mechanical ones (T3 paths.mjs, T8 migration note, T9 templates) → codex subagent; design-touching ones (T1, T2, T4, T5, T6, T7, T10, T11) → Claude-self or fresh Claude subagent. Final integration at Task 11 + tag `v0.2-p3-polish`. User approves or requests changes after each task; do NOT auto-merge without user confirmation.

## 2026-04-22 [Claude Opus 4.7 — v0.2 P3 polish-batch design spec (v2 post-6-way-review)]

- **status**: done (spec only; implementation plan next via `superpowers:writing-plans`)
- **scope**: docs/superpowers/specs/2026-04-22-v0.2-p3-polish-design.md (NEW, 576L), CHANGELOG.md
- **summary**: brainstormed v0.2's ~20-item backlog → 4 sub-projects (P1 Timing / P2 New Commands / P3 Polish / P4 Docs). User chose P3 first per "clear-backpack" ordering. Triage kept 8 of 10 polish items (C1-C8), dropped C9 (PID birth-time, YAGNI) and C10 (Windows+NFS, out of macOS scope). Drafted v1 spec → ran **6-way review** (codex + gemini + kimi + qwen + minimax + Claude-self with live probes) → 14 findings integrated (10 must-fix + 4 should-fix). V1 verdict was 3/5 SHIP: no; v2 addresses every CRITICAL and all convergent findings.
- **6-way review convergent findings**:
  - **CRITICAL** C4 "byte-for-byte sibling copy" claim false (codex-H2 + gemini-C1 + minimax-H1, 3×): `job-control.mjs` has 19 residual kimi strings after C4's proposed change. V2 walks back claim to honest "structurally identical + 3 rename targets" (SESSION_ID_ENV, KIMI_STATUS_TIMED_OUT, kimiSessionId). `sibling-backport-checklist.md` Post-P3 section becomes required P3 deliverable.
  - **CRITICAL** §I.2 referenced but not created (qwen-C1 + minimax-L1, 2×): V2 explicitly marks "new section to create" + lists 4 deferrals (runStreamingWorker crash window, C4 rename targets, C5 status read-only gap, SessionEnd via-updateState migration).
  - **HIGH** TTL in `loadState` unsafe under unlocked RMW in `session-lifecycle-hook.mjs:73-86` (codex-H1 + gemini-M1, 2×): V2 splits — loadState returns filtered view only (no disk write), physical purge moved inside `updateState`'s lock.
  - **HIGH** Sibling templates stale post-P3 (minimax-H2 + qwen-M5, 2×): V2 §6.4 + §6.5 require updates to `phase-1-template.md` T.6 + `sibling-backport-checklist.md` Post-P3 section.
- **Other CRITICAL integrations**:
  - C7 commit SHA corrected: `54f2fd0` → `aa0bde6` (kimi-C1, git log confirmed)
  - C1 `resolveWorkspaceRoot` location fixed: lives in 3 hook/companion files, NOT job-control.mjs (kimi-C2)
  - C6 verification extended to 4 edge cases (TTL=1 / TTL=0 escape / invalid env stderr / physical purge on updateState) per qwen-C2
- **HIGH integrations**:
  - C3 rationale rewritten: v1's "E2BIG/ARG_MAX" framing was technically wrong (stdin has no ARG_MAX limit; probe-results.json v3 confirms kimi uses stdin). V2: "defensive cap until kimi's real stdin ceiling is probed" (codex-H3)
  - C3 return shape gains `kind` field matching C2 errorResult (qwen-H1)
  - §5 decision log each point gains 1-2 line rationale + rejected alternatives (qwen-H2)
  - C1 call-sites: 4 exact line numbers in kimi-companion.mjs (kimi-H3)
  - C6 line-ref: function at :66, filter statement at :85 (kimi-H4)
- **MEDIUM integrations**:
  - C8 parameter renamed `maxDiffBytes` → `maxDiffChars` (codex-M2): measurement is JS string length, not UTF-8 bytes; constant name kept for back-compat + clarifying comment
  - C5 scope narrowed: delivers "testable isolation" not "read-only status"; full decoupling deferred to §I.2 (codex-M1)
- **Structural additions in v2**:
  - New §8 audit trail table: 14 findings → v2 revisions mapping
  - §5 Decision log gains Decision 7 recording the "全部修" choice post-6-way-review
  - §1 files-touched adds `docs/superpowers/templates/` module (2 template files required)
- **Deferrals explicitly recorded in §I.2 (created during P3 execution)**:
  - codex-L1: runStreamingWorker crash window between result-file write and state update
  - C4-residual: 3 rename targets to abstract if minimax encounters friction
  - C5-status-readonly: full zombie-upsert decoupling (requires API-shape split)
  - SessionEnd-via-updateState: lock-hygiene migration
- **Rejected as LOW / cosmetic**: codex-L1 (pre-existing bug out of P3 scope, moved to §I.2), gemini-L1 (4-group labeling arbitrary), kimi-L7/L8 (awkward phrasing / already-verified line numbers), qwen-L1/L2 (verification specificity beyond v2 §3 lists), minimax-L2 (already covered in §6.4 checklist note)
- **Verification**: spec internal cross-references all green — `aa0bde6` git-show confirms gr→kr rename; line numbers (:73 resolveRealCwd def / :94 resolveWorkspaceRoot / :66+:85 cleanupSessionJobs / :13+:21 review.mjs constants) all live-probed and match current HEAD (`8e18587`).
- **next**: invoke `superpowers:writing-plans` to convert spec into literal-code plan at `docs/superpowers/plans/2026-04-22-v0.2-p3-polish-plan.md`; user approves plan → execute (codex for mechanical, Claude-self for design-touching); one commit / one PR / one merge; tag as `v0.2-p3-polish` (no version bump until P1+P2+P3+P4 all land).

## 2026-04-21 [Claude Opus 4.7 + codex executor — gemini-plugin-cc v0.6.0 alignment-review response]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/{job-control.mjs, state.mjs, prompts.mjs}, plugins/kimi/commands/{rescue.md, adversarial-review.md}, plugins/kimi/skills/kimi-cli-runtime/SKILL.md, plugins/kimi/CHANGELOG.md, lessons.md, CHANGELOG.md, docs/superpowers/plans/2026-04-21-alignment-response-gemini-v0.6.0.md (10 files)
- **source**: `/Users/bing/-Code-/gemini-plugin-cc/docs/alignment/kimi.md` (external; gemini maintainer, v0.6.0 baseline, 2026-04-21)
- **plan-doc**: `docs/superpowers/plans/2026-04-21-alignment-response-gemini-v0.6.0.md` (authored by Claude, executed by codex)
- **summary**: Gemini-plugin-cc maintainer read kimi v0.1.0 against gemini v0.6.0 baseline and filed a P0–P3 alignment report. Every claim was file:line-verified by Claude on 2026-04-21. This commit integrates 11 concrete changes: one P0 dead-code delete, three P3 contract-polish items, four §5 clarifications requested by the reviewer, one sub-CHANGELOG drift fix, and this response entry.
- **Phase-N conventions referenced by reviewer**: for sibling-plugin authors and future AI iterators — `Phase-1 / Phase-4 / Phase-5` etc. in code comments refer to the plan documents at `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` (v0.1 authoring spec) and `docs/superpowers/templates/phase-1-template.md` (sibling-plugin bootstrap map). New siblings should read these two first.
- **P0 — delete dead timing read path**: `appendTimingHistory` was a v0.1 stub that satisfied `job-control.mjs`'s Phase-4 import-resolver without producing data; `job-control.mjs:254,264` read `result.timing` (never set by `callKimiStreaming` → always null) and called the no-op stub. Dead code with misleading "timing is collected" signal. Deleted three stub exports in `state.mjs` + the header comment, deleted the `timing` read/write/branch + import in `job-control.mjs`. v0.1 now honestly signals "timing not collected" by absence.
- **P3a — rescue.md argument-hint provider-neutral**: `[what Kimi should investigate, solve, or continue]` → `[what to investigate, solve, or continue]` so sibling plugins can copy the argument contract with only `s/kimi/<llm>/` instead of also rewriting the descriptive phrase.
- **P3b — frontmatter quote style normalized**: 7/8 commands already used single-quoted YAML scalars; `rescue.md` was double-quoted for no structural reason. Flipped `rescue.md` to single quotes. No semantic change.
- **P3c — `--background` / `--wait` option ordering normalized**: `adversarial-review.md` had `[--wait|--background]`; `rescue.md` had `[--background|--wait]`. Unified on `[--background|--wait]` — background is the more common async path in both commands.
- **§5.2 — Auth boundary documented**: added explicit bullet in `kimi-cli-runtime/SKILL.md` runtime-requirements section: companion never injects `KIMI_API_KEY`; auth is 100% CLI-managed via `kimi login` → `~/.kimi/credentials/`. Plugin is zero-coupled to Moonshot's auth model.
- **§5.3 — Phase 5 timing plan**: recorded as a new sub-section in `lessons.md §I.1` with explicit v0.2 gate condition (kimi-cli 1.37 re-probe for per-model usage) and branching plan (full 6-stage gemini-scaffold if CLI exposes per-model, CLI-agnostic 3-stage subset if not). `tests/` directory is gated on whichever timing path we take.
- **§5.4 — lessons.md contents**: no action; reviewer is free to read. §I.1 is the most relevant cross-plugin entry.
- **§5.5 — prompts.mjs small-size rationale**: added module-level block comment explaining that review-flow prompts live in `review.mjs` (`buildReviewPrompt` / `buildAdversarialPrompt`); ask/rescue prompts pass through verbatim; no v0.1 abstraction planned. Siblings that need centralization should do it in their own `<llm>.mjs`.
- **Sub-CHANGELOG forward-ref**: `plugins/kimi/CHANGELOG.md` was stale ("0.1.0 in progress — Phase 1") and misled the reviewer into thinking progress was still at Phase 1 (actual: v0.1 complete + PR #1 merged at `0bb38bf`). Replaced contents with a forward-reference to the root CHANGELOG + a one-line reason the file is retained. Root cause of this drift: two CHANGELOGs for one plugin → one always goes stale; lesson generalizable to siblings.
- **Deferred (documented in `lessons.md §I.1`)**:
  - **P1 A-roll / primary-model attestation**: needs kimi 1.37 re-probe first to confirm whether `JsonPrinter` still drops per-model usage.
  - **P2 `tests/` directory**: pairs naturally with v0.2 timing work.
  - **Gemini `gfg-` foreground-job pattern**: intentionally absent — its unified-timing-path justification doesn't apply when we don't collect timing.
- **Disagreements (recorded in `lessons.md §I.1`)**:
  1. Reviewer inferred "still in Phase 1" from stale sub-CHANGELOG — not true, v0.1 complete + PR #1 merged at `0bb38bf`.
  2. "§2 首行噪声截取 ❓ 未确认" — confirmed **not applicable**: kimi CLI emits clean JSONL from byte 0 (probe-results.json v3 `top_level_keys_observed: [role, content]`); gemini CLI v0.37.1's noise-prefix is a gemini-only quirk.
  3. Gemini foreground `gfg-` prefix intentionally not copied — see "Deferred" above.
- **Verification**: `node --check` clean on all 11 `plugins/kimi/scripts/**/*.mjs`; `grep -rn 'appendTimingHistory\|readTimingHistory\|resolveTimingHistoryFile\|result\.timing' plugins/kimi/scripts/` returns zero matches; all 8 commands' `argument-hint:` lines start with single quotes; zero `[--wait|--background]` residue in commands/.
- **Handback to gemini maintainer** (for next `baseline.md` iteration):
  1. §6.3 primary-model attestation needs a "CLI must emit per-model usage in `result` event" prerequisite caveat — not every sibling CLI does this.
  2. The "stale sub-CHANGELOG drift" trap is sibling-generic; consider a line in baseline about plugin-scoped vs. repo-root logging conventions (we picked the wrong default by having both).
  3. Our `review.mjs` extraction (thin CLI-specific adapters → thick shared pipeline) is the specific shape worth looking at if gemini refactors review out of `gemini.mjs`.
- **next**: Claude verifies on 2026-04-22; gemini maintainer reads `baseline.md` merge diff in their next iteration.

## 2026-04-21 [Claude Opus 4.7 — P0 K2.5 naming correction + P1 1.37 flag inventory]

- **status**: done
- **scope**: plugins/kimi/skills/kimi-prompting/references/kimi-prompt-antipatterns.md, plugins/kimi/skills/kimi-cli-runtime/SKILL.md, plugins/kimi/scripts/lib/kimi.mjs, docs/superpowers/handoffs/2026-04-21-post-v0.1-review-session.md, CHANGELOG.md
- **summary**: Post-PR-#1-merge, user asked to re-verify kimi-cli state and whether "kimi-agent" makes our usage easier. Cross-source verification (GitHub Releases + local `kimi 1.37.0 --help` probe + `MoonshotAI/Kimi-K2.5` README) caught a **naming error** in the PR #1 work: I had consistently written "K2.6 Agent" / "K2.6 Agent Swarm" but Moonshot's flagship is **Kimi-K2.5** (no K2.6 release exists), and "Agent Swarm" is a published K2.5 capability. Correction landed in 2 files where the doc is load-bearing (antipattern §9 for sibling-plugin author reference + kimi.mjs comment for code-reader context), with a non-load-bearing errata notice on the 2026-04-21 handoff doc (which is preserved as-written for historical fidelity).
- **P0 changes (K2.5 rename + factual correction)**:
  - `kimi-prompt-antipatterns.md` §9 rewritten: all "K2.6" references → "K2.5"; removed the invented `K2.6 Agent` / `K2.6 Agent Swarm` product names (not real) and replaced with generic "agent-mode model variants" language anchored to the verified K2.5 Agent Swarm capability quote from `MoonshotAI/Kimi-K2.5` README. Also added a paragraph clarifying that kimi-cli 1.37's `--agent [default|okabe]` is an agent **specification** (tool/skill bundle), orthogonal to the `-m <model>` choice, to prevent operators from conflating the two.
  - `plugins/kimi/scripts/lib/kimi.mjs:29` comment block (timeout rationale): "K2.6 agent models (released 2026-04-20)" → "K2.5 agent-swarm mode (see Kimi-K2.5 README)", with explicit PR-#1802 citation.
  - `docs/superpowers/handoffs/2026-04-21-post-v0.1-review-session.md`: added errata header noting the mis-naming and pointing forward to the corrected antipattern. Historical body preserved verbatim.
- **P1 changes (kimi-cli 1.37 flag inventory in cli-runtime skill)**:
  - `kimi-cli-runtime/SKILL.md` runtime-requirements line updated to note 1.37.0 now verified (was "1.36.0").
  - Added new section "Kimi-CLI 1.37 flag inventory (informational)" with a full table of every `kimi --help` flag, marking which the companion uses vs not, plus why each non-used flag was evaluated and deferred (`--quiet`: rejected because we need JSONL to separate `think`/`text` reliably; `--plan`: deferred to v0.2 `/kimi:plan` candidate; `--agent`: orthogonal to model choice, operator-only; `--wire`: gated on potential Kimi Agent SDK adoption in v0.2+). Plus an "empirical facts re-confirmed on 1.37" sub-section capturing: stream-json shape unchanged, stderr `kimi -r <uuid>` regex still matches, `-r <bogus-uuid>` in `--print` still silently re-creates (PR #1716's "raise error" only fires in interactive), and the PR #1802 keep-loop-alive fix as rationale for the current 900s default.
- **What I rejected (P2) and why** — user asked whether the newly released `@moonshot-ai/kimi-agent-sdk` (Node/Python/Go SDK built on kimi-cli's wire protocol) would make plugin development easier. Evaluated: Node SDK is at `0.0.3` (API will churn), requires `zod` peer dep (breaks our zero-npm-dep story), and provides richer events (TurnBegin/ToolCall/ToolResult/SubagentEvent) that we don't yet surface in any `/kimi:*` command. Documented the decision in P1 flag inventory `--wire` row as "gated on v0.2+ adoption" so future sibling-plugin authors know the option exists without falling into the trap of adopting a 0.0.x SDK.
- **Verification**: `node --check` clean on `kimi.mjs`; grep confirms zero remaining `K2\.6` / `k2\.6` references in `plugins/kimi/scripts/` and `plugins/kimi/skills/` (handoff doc retains them intentionally with the errata header pointing forward); grep confirms antipattern §9 now uses `kimi-k2.5-agent` / `kimi-agent` pattern names that match Moonshot's actual namespace conventions.
- **Methodology note (for lessons.md v0.2 update)**: this correction exists because the 2026-04-20 session relied on a tweet summary (`@Kimi_Moonshot`) without cross-checking against the actual model repo. When a tweet and a repo disagree on a model's version number, the repo wins. Protocol going forward: for any claim about a specific Kimi model version or feature, fetch at least one of `MoonshotAI/Kimi-<model>` README, `kimi --help` local, or GitHub Releases before writing to a load-bearing doc. The 2026-04-21 handoff's own lesson-about-version-triple-sourcing (GitHub Releases + PyPI + Homebrew) was correctly applied to kimi-cli 1.37 but NOT to the model layer — gap closed now.
- **next**: commit + push; update `MEMORY.md` / `project_current_progress.md` to reflect correction; v0.2 planning picks up `/kimi:plan`, `/kimi:scaffold` (for agent-mode models), and Kimi Agent SDK evaluation when SDK hits 0.1.x.

## 2026-04-21 [Claude Opus 4.7 — PR #1 self-review feedback: strict timeout parse + agent-keyword hint]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/kimi.mjs, plugins/kimi/skills/kimi-prompting/references/kimi-prompt-antipatterns.md, CHANGELOG.md
- **summary**: PR #1 self-review flagged 2 minor fixable issues (plus 2 wont-fix). Integrated both.
  - **PR #1 review #2** (lenient `KIMI_TIMEOUT_MS` parse): `Number.parseInt("60s", 10)` returned `60`, accepted as 60ms — footgun for a user who types `KIMI_TIMEOUT_MS=60` expecting 60 seconds. Tightened to `/^\d+$/` pure-digit match; non-matching input now emits a stderr warning naming the offending value + expected format, then falls back to the 900000 ms default. Verified: `60s`, `60.5`, `-5` all warn + fallback; `60000` still works; `0` silently falls back (parses but fails `>0`, same as before — no warning needed since 0 could be an intentional "disable" marker even if we treat it as fallback).
  - **PR #1 review #3** (ambiguous agent-model detection in antipattern §9): previous doc said "don't pass `-m k2.6-agent`" but didn't tell operators what TOML section title to look for in their `~/.kimi/config.toml`. Added a keyword-spotting rule ("if the section title or display name contains `agent` or `swarm`, treat as agent variant") + 5 worked examples covering the K2.6 family and the "Kimi for Code" rebrand.
- **Not addressed (PR #1 review #1 + #4 — non-blocking)**: #1 (job id prefix migration visible in `/kimi:status` for users who have pre-existing `gr-*`/`gt-*` jobs) — functionally fine, just visually mixed; no action for v0.1 internal but worth a release note if v0.2 goes public. #4 (`resolveWorkspaceRoot` double-realpath idempotent-no-op when cwd is pre-realpath'd) — short-circuit not worth the complexity; leave as is.
- **Verification**: `node --check` clean. 6-case parse smoke: `(no env / 60000 / 60s / 60.5 / -5 / 0)` → all expected values + warnings.
- **next**: force-push commit to PR #1 branch; reply to original review thread with "applied 2 of 4; #1 + #4 wont-fix".

## 2026-04-21 [Claude Opus 4.7 — self-review follow-up: resolveWorkspaceRoot slug consistency]

- **status**: done
- **scope**: plugins/kimi/scripts/kimi-companion.mjs, CHANGELOG.md
- **summary**: Self-review of the prior commit (aa0bde6) caught a latent regression: my H3 realpath fix normalized cwd at 4 kimi-spawn entry points (runAsk / runReview / runAdversarialReview / runTask) but NOT at the 4 other sites (runSetup / runJobStatus / runJobResult / runJobCancel / runTaskResumeCandidate), which continued to pass raw `process.cwd()` to `resolveWorkspaceRoot`. In git repos this was a non-issue — `git rev-parse --show-toplevel` already returns a canonical absolute path so all callers got the same slug. **But in non-git scratch dirs on macOS** (`/tmp/foo` symlinked to `/private/tmp/foo`), the two caller styles hashed to different workspace slugs — splitting state.json between the "setup/status/cancel" side and the "review/task" side, losing job continuity within a single session. Smoke-tested with symlinked tmpdir on Linux to confirm the race before shipping.
- **Fix**: move realpath normalization INTO `resolveWorkspaceRoot`'s non-git fallback (`return resolveRealCwd(cwd)` instead of `return cwd`). One line; git repo path untouched (since git already returns canonical); all callers now agree in non-git contexts regardless of whether they realpath'd upstream.
- **Verification**: node --check clean; smoke test with symlinked tmpdir shows `resolveWorkspaceRoot(link)` === `resolveWorkspaceRoot(realpath(link))` after the fix (would be !== before).
- **next**: self-review report → open PR.

## 2026-04-21 [Claude Opus 4.7 — post-v0.1 read-only review fixes + K2.6 agent follow-up]

- **status**: done
- **scope**: plugins/kimi/scripts/kimi-companion.mjs, plugins/kimi/scripts/lib/{job-control.mjs, kimi.mjs, render.mjs (deleted)}, plugins/kimi/skills/kimi-prompting/references/kimi-prompt-antipatterns.md, docs/superpowers/templates/{phase-1-template.md, sibling-backport-checklist.md}, CHANGELOG.md
- **summary**: Comprehensive read-only review (2 parallel Explore agents + direct source verification) uncovered 3 High + 1 Medium findings against the phase-5-post-review-3 HEAD. Plus kimi-cli 1.37.0 + K2.6 agent released 2026-04-20 (triple-verified via GitHub Releases + PyPI + Homebrew — earlier single-source WebFetch summary had paraphrased the changelog and I didn't cross-check until asked). 7 fixes integrated:
  - **H1 — `JOB_PREFIXES` still gemini-branded** (job-control.mjs:31): `review: "gr"` / `"adversarial-review": "gr"` / `task: "gt"` → `"kr"` / `"kr"` / `"kt"`. User-visible branding leak in job ids across `/kimi:status` output (`gr-lxyz-abc` in a plugin called "kimi"). The Phase-4 port's `ga→ka` rename only touched the fallback prefix; the three main paths were missed.
  - **H2 — `render.mjs` is dead code with a bug** (plugins/kimi/scripts/lib/render.mjs, deleted): zero external importers across the whole repo (verified by grep); companion uses local `formatSetupText` / `formatAskFooter`, and all other commands emit JSON that the command `.md` files render. The module still contained `report.gemini.available` (line 21) — a stale copy-paste from gemini-plugin-cc that would crash the setup report if ever called. Deleted the file; updated `phase-1-template.md` T.5 from "port near-verbatim" to "DELETED — do not port" with a table mapping former exports to their replacements; rewrote `sibling-backport-checklist.md` P0-1 from field-rename fix to full-module deletion guide (the original 5-way P0-1 patched a bug in code that was never reached).
  - **H3 — cwd not realpath-normalized** (kimi-companion.mjs): spec §3.4 and probe 06 require "use `fs.realpathSync(cwd)` on both sides" when comparing spawn cwd against `~/.kimi/kimi.json.work_dirs[].path` (stored verbatim-absolute-normalized, no symlink resolution). macOS `/tmp` → `/private/tmp` mismatch silently broke the Secondary session-id fallback. Added `resolveRealCwd(cwd)` helper (try/catch → fallback to original on ENOENT/EACCES); wired into all 4 sites that spawn kimi: `runAsk` (line 257), `runReview` (366), `runAdversarialReview` (462), `runTask` (587). The 4 sites that only call `resolveWorkspaceRoot` (status/result/cancel/resume-candidate) intentionally left alone — git returns canonical paths itself.
  - **M1 — dead `ask` branch in `getJobKindLabel`** (job-control.mjs:351): `/kimi:ask` is synchronous and never goes through `createJob`; the branch was a defensive carry-over from the Phase-4 gemini port. Removed + documented why.
  - **T1 — `DEFAULT_TIMEOUT_MS` too tight for K2.6 agent** (kimi.mjs:29): 300_000 (5 min) → `defaultTimeoutMs()` reading `KIMI_TIMEOUT_MS` env with a 900_000 (15 min) default. Motivation: K2.6 agent (released 2026-04-20) runs long-horizon turns; kimi-cli 1.37.0 explicitly keeps the `--print` loop alive while background tasks are running (`fix(soul): keep agent loop alive while background tasks are running` — verbatim from GitHub Releases). The old 5-min ceiling SIGTERM'd legitimate long turns into exit 143, surfacing "Request was interrupted" for what was actually our own kill. Invalid env values fall back to 900s.
  - **T2 — K2.6 Agent antipattern doc** (kimi-prompt-antipatterns.md §9): added anti-pattern entry explaining that K2.6 Agent / K2.6 Agent Swarm models are scaffold/full-stack builders (per @Kimi_Moonshot tweet: "Video hero section, WebGL shaders, real backends. From one prompt. React 19 + TypeScript + Vite + Tailwind + shadcn/ui + Three.js + GSAP + Framer Motion + auth + database"). Their system prior overrides our `STRICT OUTPUT RULES` prompt-layer constraints empirically often. Do not pass `-m k2.6-agent` (or variants) to `/kimi:ask` / `/kimi:review` / `/kimi:adversarial-review`; agent models are appropriate for `/kimi:rescue` / `/kimi:task --background`. `readKimiConfiguredModels` doesn't distinguish agent from chat, so this is operator hygiene, not validator hygiene. v0.2 backlog: `/kimi:scaffold` command to expose the agent capability explicitly.
  - **template sync (H2 cascades)**: `phase-1-template.md`:46 "Create (plugin lib)" list no longer mentions `render.mjs`; T.5 rewritten with deletion rationale + replacement table. `sibling-backport-checklist.md` P0-1 rewritten from field-rename fix to full-file deletion guide + kept historical context for siblings that still have a working importer.
- **Verification**: `node --check` on kimi-companion.mjs / kimi.mjs / job-control.mjs / review.mjs / state.mjs / args.mjs / git.mjs / process.mjs / prompts.mjs / session-lifecycle-hook.mjs / stop-review-gate-hook.mjs all clean (see trailing bash step). No behavioral regression path: H1/M1 are name-only; H2 deletes unreachable code; H3 and T1 strictly widen acceptance (realpath fallback preserves old behavior; timeout lengthens); T2 is docs-only.
- **Deferred**: Review M2 (enrichJob side-effect during read-only status query — would need to split into pure+apply, breaking API shape; defer for v0.2 or until concurrency becomes a real complaint), M3 (args.mjs trailing-backslash literal preservation — benign edge case), M4 (SessionEnd clears completed-job state — design question, not bug; flag in lessons.md for v0.2 discussion), L1-L4 nits, and the Phase 0 probe rerun on kimi-cli 1.37 (`--print` close-timing under the "keep loop alive" fix; stderr format when the new "killing background task X" hint is present). The probe rerun needs live kimi 1.37 + K2.6 config to validate; file this as a Phase-6 task.
- **Cross-source verification for kimi-cli 1.37.0 / K2.6 claims**: GitHub Releases (1.37.0 @ 2026-04-20 16:01), PyPI (1.37.0 @ 2026-04-20), Homebrew (1.35.0 stable, lagging — normal). An earlier WebSearch run reported "PyPI latest is 1.30.0" — false, that search hit a stale/wrong index. Lesson for future: when two independent searches disagree on a version number, hit at least one more authoritative source before writing it down.
- **next**: commit to branch `claude/review-plugin-implementation-B0JEg`; user decides whether to push + merge. If pushed, update `project_current_progress.md` to mark H1-H3 + T1/T2 integrated.

## 2026-04-21 [Claude Opus 4.7 — sibling-backport doc (post-phase-5-post-review-3)]

- **status**: done
- **scope**: docs/superpowers/templates/sibling-backport-checklist.md (new, 409 lines), CHANGELOG.md
- **summary**: wrote a 409-line actionable backport checklist for minimax/qwen/doubao plugin authors. Covers all 18 findings from the 5-way review (P0 + P1 + P2), with exact code snippets parameterized on `<llm>`, verification steps per item, and a §Global rule warning against `sed -g s/kimi/<llm>/g` (clobbers FALLBACK_STATE_ROOT_DIR + historical comments). Explicitly callouts the subdir-rename gotcha in P0-7 (siblings must replace `"kimi"` → their own provider name, not leave it).
- **next**: push to GitHub; minimax author pulls and applies. Future polish passes append to this file's section rather than retroactively renumbering P0/P1/P2.

## 2026-04-21 [Claude Opus 4.7 — 5-way review polish (phase-5-post-review-3)]

- **status**: done
- **scope**: plugins/kimi/scripts/{lib/{kimi.mjs, review.mjs, state.mjs, job-control.mjs, render.mjs}, kimi-companion.mjs, stop-review-gate-hook.mjs}, plugins/kimi/commands/rescue.md, plugins/kimi/prompts/(unchanged), plugins/kimi/skills/{kimi-cli-runtime/SKILL.md, kimi-prompting/references/kimi-prompt-recipes.md, kimi-result-handling/SKILL.md}, docs/superpowers/templates/phase-1-template.md, README.md (unchanged), CHANGELOG.md, lessons.md
- **summary**: **5-way review** (codex + gemini + kimi + qwen + Claude-self as 5th reviewer with live empirical probes) at HEAD `ab8e8a1`. Vote: 2-yes / 3-no (codex + gemini + qwen flagged SHIP:no). **My own probe uncovered 2 findings the agents couldn't see** (since they only do static file reads): (a) `render.mjs:131 job.geminiSessionId` is dead code — field renamed to `kimiSessionId` in Phase 4 port but render wasn't updated, so `/kimi:status` never surfaces the Resume hint; (b) multi-plugin `CLAUDE_PLUGIN_DATA` sharing in a live Claude Code session causes kimi's `state.json` to co-mingle with gemini/codex/qwen jobs — verified by reading the actual state file (13 jobs, mixed `geminiSessionId`/`kimiSessionId`/`write:true` fields).
- **Full 18-item integration:**
  - **P0 (7)**:
    - **#1 render.mjs:131 dead-code**: `job.geminiSessionId` → `job.kimiSessionId` (1 line, Resume hint now surfaces)
    - **#2 cancel race** (codex H1 + qwen M2 convergent): `runWorker` now wraps writeJobFile + state-mutation in a single `updateState` transaction so a cancel-during-finalization can't clobber a completed/failed write OR vice versa
    - **#3 stop-review-gate-hook shape divergence** (qwen M1): internal `{ok, reason}` → `{ok, error}` to match `errorResult`/`reviewError`; `emitDecision` boundary still emits Claude Code's `reason` field (external contract preserved)
    - **#4 buildAdversarialPrompt retry hint weaker** (kimi M1): strengthened to mirror `buildReviewPrompt`'s retry block ("Nothing but the JSON" + anti-translation reminder)
    - **#5 cancelJob liveness + escalation** (codex M1): up-front `kill(pid,0)` probe prevents signaling stale PIDs; three-step escalation SIGINT → SIGTERM → SIGKILL with alive-checks between
    - **#6 "import review.mjs verbatim" doc ambiguity** (gemini Critical): CHANGELOG + lessons.md now explicitly say "**copy** verbatim into their own `plugins/<llm>/scripts/lib/review.mjs`" — clarifies it's a repo-local artifact, NOT cross-repo import
    - **#7 multi-plugin state dir self-defense** (my probe): `stateRootDir()` now returns `<pluginData>/kimi/state/` instead of `<pluginData>/state/`; isolates kimi's state.json from sibling plugins even when `CLAUDE_PLUGIN_DATA` is shared (which it empirically is, based on 5-way-probe state file contents)
  - **P1 (4)**:
    - **#8 phase-1-template errorResult contract** (gemini H1): added `status` + `stdout` fields to the template's `errorResult` signature so sibling plugins don't accidentally produce a review.mjs with `transportError.status = null`
    - **#9 phase-1-template T.4 sed whitelist** (gemini H2): replaced blind `s/kimi/{{LLM}}/g` with 4 targeted edits and explicit "leave comments intact" guidance; prevents clobbering `FALLBACK_STATE_ROOT_DIR = "kimi-companion"` and historical doc-strings
    - **#10 kimi-cli-runtime exit-code table** (qwen M5): added exit 124 (local timeout, distinct from SIGTERM 143) per codex 4-way M1 fix
    - **#11 rescue.md error block** (gemini M2): added full error-handling section with exit-code map + declarative suggestions (mirrors ask.md/review.md convention)
  - **P2 (7)**:
    - **#12 role=system silent-collapse** (codex L2): `parseKimiStdout` now tracks `unexpectedRoleCount`; error message distinguishes "think-only" from "only unexpected-role events" so diagnostic is accurate
    - **#13 orphan tmp + config collector** (codex L1): `cleanupOrphanedFiles` now strips `.config.json` suffix (previously mis-correlated stream-worker config files as orphans) AND sweeps `state.json.tmp-*` leftovers older than 60s
    - **#14 kimi-prompt-recipes schema fence** (gemini M3): `<schema>{{REVIEW_SCHEMA}}</schema>` → ```` ```json {{REVIEW_SCHEMA}} ``` ```` to match actual `buildReviewPrompt` output shape
    - **#15 resume mismatch exit code** (qwen M3): `--resume <uuid>` returning a different session now exits 1 instead of 0; response stays on stdout so answer is visible, but exit code signals continuity contract broke
    - **#16 corrupt state.json stderr warning** (qwen M4): `loadState` now emits a stderr warning when the file exists but is unparseable (previously silent `defaultState()` fallback hid the user's lost job history)
    - **#17 TRUNCATION_NOTICE parameterization** (gemini H3 + qwen M1 convergent): `runReviewPipeline` now accepts `truncationNotice` + `retryNotice` overrides; `formatTruncationNotice(maxBytes)` helper exported for sibling plugins with a different `MAX_REVIEW_DIFF_BYTES`
    - **#18 result-handling rule #3 scope** (kimi L4): "Never auto-execute" now explicitly lists all `/kimi:*` commands (not just ask/review) and notes the `/kimi:rescue` tool_call exception
- **Verification**: T5 PASS (needs-attention, 4 findings), T9 PASS (needs-attention, 4 findings, red-team regex matched), H2 `--scope stagged` exits 2, `formatTruncationNotice(32000)` produces "32 KB" string, `stateRootDir()` returns path under `/kimi/state/`. All 7 .mjs files `node --check` clean.
- **Deferred to v0.2 / case-by-case**: codex L2 PID identity check via birth-time (OS-specific, complex), gemini L1 MiniMax verification (sandbox blocked cross-repo read), kimi L1-3 (already verified LOW / minor), future cross-plugin state write protocol if the harness changes CLAUDE_PLUGIN_DATA semantics.
- **next**: tag `phase-5-post-review-3`, push to GitHub, sync memory. Then minimax-plugin-cc author pulls the updated template.

## 2026-04-21 [Claude Opus 4.7 — 4-way review polish (phase-5-post-review-2)]

- **status**: done
- **scope**: plugins/kimi/scripts/{lib/{kimi.mjs,review.mjs,state.mjs,job-control.mjs}, session-lifecycle-hook.mjs, stop-review-gate-hook.mjs}, plugins/kimi/prompts/adversarial-review.md, plugins/kimi/skills/{kimi-result-handling/SKILL.md, kimi-prompting/references/kimi-prompt-antipatterns.md}, README.md, lessons.md, CHANGELOG.md
- **summary**: 4-way review (codex + gemini + kimi + qwen, parallel) dispatched post install — vote 3-yes / 1-no (gemini). Meta-result: **kimi as reviewer produced substantive, calibrated findings including self-critique of its own Appendix-I rates, proving the plugin works end-to-end.** 11 accepted findings integrated:
  - **kimi bug (`buildReviewPrompt` focusLine)**: previous `\nfocus\n` collapsed summary+focus without blank-line separator; kimi attention was treating focus as summary continuation. Fix: `\n\nfocus` for symmetric spacing.
  - **kimi M1 + gemini H2 (adversarial stance scope)**: anti-dialectical rules were applied globally; now scoped — `summary` banned balanced phrasing, `finding.body` allowed to include comparative evidence ("This file elsewhere uses X, making Y a regression"). Prompt section rewritten with explicit scope headers.
  - **kimi M3 (auto-execute policy vs enforcement)**: `kimi-result-handling/SKILL.md` §3 expanded with note clarifying "Never auto-execute" is presentation-layer policy, not sandbox; companion does not parse imperatives out of kimi output.
  - **kimi M1 (antipatterns §5 exception)**: added mixed Chinese-narrative + English-code exception to the meta-language-matching rule. Keep STRICT OUTPUT RULES in English regardless of chat language — Chinese meta pushes kimi toward translating English enum values.
  - **kimi H1 (Appendix I calibration footnote)**: added warning that 25%/15%/35% JSON-compliance rates are Phase 2-3 qualitative bands (n≈10-15), not calibrated benchmarks. Sibling plugins should re-measure.
  - **qwen H2 (hook scripts top-level try/catch)**: both `session-lifecycle-hook.mjs` and `stop-review-gate-hook.mjs` wrap `main()` in try/catch → structured stderr error + exit 1 on throw. Claude Code's hook framework now sees actionable diagnostics instead of silent non-zero.
  - **qwen M2 (reviewError `status` field)**: added top-level `status` to the `reviewError` shape, defaulting to `transportError?.status ?? null`. Consumers can now rely on `result.status` uniformly regardless of failure origin (transport vs parse vs schema).
  - **codex M1 (`runWorker` ETIMEDOUT disambig)**: background worker now checks `result.error?.code === "ETIMEDOUT"` and routes to 124 (GNU timeout convention) instead of collapsing to 143 SIGTERM. Local-timeout vs external-cancel distinguishable in the job record.
  - **codex M2 (atomicWriteFileSync short-write)**: replaced manual `openSync/writeSync/fsync/closeSync` pair with `fs.writeFileSync` (handles short-writes internally) + `renameSync`. Dropped `fsync` per qwen L3 (~5-10ms saved per save; atomic rename is sufficient for the torn-read concern). Added temp-file cleanup on failure.
  - **codex L4 (validateReviewOutput reverse-range guard)**: `line_end >= line_start` now enforced. Reverse ranges like `{start: 42, end: 10}` previously passed validation and confused renderers.
  - **gemini C1 (README `$PWD` trap)**: install instructions now lead with an explicit `cd /path/to/kimi-plugin-cc` step + inline warning. `$PWD` still used but the footgun is surfaced.
- **Non-accepted / deferred to v0.2**: gemini H3 + qwen M1 convergent ask to parameterize `MAX_REVIEW_DIFF_BYTES` + TRUNCATION/RETRY_NOTICE through `runReviewPipeline` — right move, but best done when minimax-plugin-cc actually needs a different budget (avoid premature over-engineering). kimi M2 `no_changes` whitespace-only path — deferred as edge case, LLM's `approve` on trivial whitespace diff is defensible. qwen H1 Windows + NFS portability — single-machine-macOS v0.1 target; document-only and already noted in lessons.md §H.
- **Verification**: T5 PASS (verdict=needs-attention, 4 findings), T9 PASS (verdict=needs-attention, 4 findings, red-team regex matched). Smoke tested reviewError.status (null default + transportError propagation) and validateReviewOutput line_end reverse-range rejection — both passing.
- **next**: tag `phase-5-post-review-2`. v0.1 now truly frozen for sibling kickoff — minimax-plugin-cc can fork `phase-1-template.md` cleanly.

## 2026-04-21 [Claude Opus 4.7 — v0.1 comprehensive 3-way review integration]

- **status**: done
- **scope**: plugins/kimi/scripts/{kimi-companion.mjs, lib/{kimi.mjs, job-control.mjs, state.mjs}}, plugins/kimi/commands/{review.md, setup.md}, plugins/kimi/skills/{kimi-prompting/references/kimi-prompt-recipes.md, kimi-result-handling/SKILL.md}, README.md, lessons.md, docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md, docs/superpowers/templates/phase-1-template.md, CHANGELOG.md
- **summary**: Comprehensive v0.1 review dispatched pre-sibling-kickoff (codex + gemini parallel). Both returned **SHIP: no**. 12 findings integrated into a single polish pass:
  - **codex C1 (CRITICAL — state race)**: `saveState` + `writeJobFile` now use atomic temp-file+rename via new `atomicWriteFileSync` helper. `updateState` no longer silently falls back to unlocked write after 10 retries; replaced with one forced lock-break + exclusive write attempt, and a structured error if that also fails.
  - **codex C2 (CRITICAL — template path hardcoded)**: `phase-1-template.md` CLAUDE.md block changed `../kimi-plugin-cc/lessons.md` → `{{KIMI_REPO_ROOT}}/lessons.md`. Matching edit propagated to the template's `mirrors` line.
  - **codex C3 (CRITICAL — lessons.md lied about realpath fix)**: Pit 4 rewritten to accurately describe what's in the code (single-variable-consistency between spawn `cwd` and `readSessionIdFromKimiJson(cwd)` — NO `fs.realpathSync` is called). v0.2 gap flagged explicitly for siblings.
  - **codex H1 (HIGH — background signal propagation)**: `job-control.mjs:runWorker` now maps `result.signal` through the newly-exported `statusFromSignal` helper, so SIGINT/SIGTERM background-job exits surface 130/143 in the job record (matching foreground contract).
  - **codex H2 (HIGH — silent --scope fallback)**: new `validateScopeOption` in `kimi-companion.mjs` rejects invalid values with exit 2 (USAGE_ERROR). Validation runs BEFORE the background branch for `/kimi:adversarial-review` so bg jobs can't swallow the error. Verified: `--scope stagged` now exits 2 with a structured JSON error.
  - **codex H3 (HIGH — malformed JSONL silent drop)**: `parseKimiEventLine` return shape changed from nullable event to `{ok, kind, event?, error?, raw?}`. `parseKimiStdout` + streaming path both track `malformedCount`. Non-zero counts surface as (a) a stderr breadcrumb on otherwise-successful runs and (b) an annotated error message on empty-text failures ("(and N malformed JSONL lines silently dropped)"). `malformedCount` propagates in the callKimi / callKimiStreaming return envelope.
  - **codex M1 (setup.md review-gate docs)**: reworded to reflect Phase-4-live reality; escape-hatch note added per phase-4-polish gemini G-H1.
  - **codex L1 (unused emitJson)**: resolved by threading `emitJson` through `validateScopeOption(options.scope, emitJson)` at both review + adversarial-review call sites.
  - **gemini G-C1 (CRITICAL — recipes missing no_changes ban)**: `kimi-prompt-recipes.md` Review + Adversarial Review recipes' `<output_contract>` now explicitly include `(never "no_changes" — companion-only fast path; see antipatterns §8)`. Aligns recipes with Antipattern 8 + `validateReviewOutput` enforcement.
  - **gemini G-C2 (CRITICAL — spec §1.4 stale install command)**: `claude plugins add ./plugins/kimi` → correct `marketplace add <repo-path>` + `install kimi@kimi-plugin` two-step flow with explicit note referencing appendix H.
  - **gemini G-H1 (HIGH — template token count)**: "Global find-and-replace these 7 tokens" → "9 tokens" to match the expanded substitution table (added `{{LLM_UPPER}}` + `{{KIMI_REPO_ROOT}}` in Phase 5).
  - **gemini G-H2**: partial overlap with codex C2 (the CLAUDE.md-as-embedded-in-template issue). Repo-level `CLAUDE.md` verified clean (does NOT contain `../kimi-plugin-cc/lessons.md` — gemini misread).
  - **gemini G-M1 (kimi-result-handling stale)**: deleted "What still needs Phase 5 work" section; removed "Phase 1 early draft" subtitle; updated references section to include adversarial-review render rules pointer.
  - **gemini G-M2 (README hardcoded path)**: `/Users/bing/-Code-/kimi-plugin-cc` → `$PWD`. Commands section expanded to list all 8 v0.1 slash commands (was 1).
  - **gemini G-L1 (review.md argument-hint)**: dropped `<>` around scope enum (matches adversarial-review.md style).
- **Verification**: T5 PASS (`/kimi:review` → needs-attention, 4 findings). T9 PASS (`/kimi:adversarial-review` → needs-attention, 4 findings, red-team regex matched). H2 smoke PASS (`--scope stagged` exits 2 with structured JSON error on both review + adversarial-review).
- **Non-convergent / declined**: gemini claimed `CLAUDE.md:12` has `../kimi-plugin-cc/lessons.md` — verified false (only the template's embedded CLAUDE.md block had it, already fixed by codex C2 edit). No other declined findings.
- **next**: update `phase-5-final` tag to include this polish (or add a `phase-5-post-review` tag); memory files (project_current_progress.md) refresh to reflect new HEAD. Then minimax-plugin-cc Phase 0 kickoff can proceed using the corrected template.

## 2026-04-20 [Claude Opus 4.7 — Phase 5 final: v0.1 close]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/{review.mjs (new), kimi.mjs}, plugins/kimi/scripts/kimi-companion.mjs, plugins/kimi/prompts/adversarial-review.md (new), plugins/kimi/commands/adversarial-review.md (new), plugins/kimi/skills/kimi-prompting/**, lessons.md (new), docs/superpowers/templates/phase-1-template.md (new), CHANGELOG.md
- **summary**: Phase 5 closes v0.1. 10 tasks, 10 commits, post-execution 3-way review integrated.
  - **`/kimi:adversarial-review`** live: red-team variant of `/kimi:review` with same output schema; prompt template at `plugins/kimi/prompts/adversarial-review.md` has STRICT OUTPUT RULES + ADVERSARIAL STANCE RULES (anti-dialectical constraints). T9 PASS empirically: on SQL-injection + fake-auth sample diff, summary opens literally "Do not ship." with 4 findings (vs balanced review's 2); regex red-team gate passes.
  - **Review pipeline extracted** to `plugins/kimi/scripts/lib/review.mjs` (provider-agnostic): `MAX_REVIEW_DIFF_BYTES`, `TRUNCATION_NOTICE`, `RETRY_NOTICE`, `extractReviewJson`, `validateReviewOutput`, `reviewError`, `runReviewPipeline`. `RETRY_NOTICE` debranded ("The first response..." vs "Kimi's first...") per codex C2. `kimi.mjs` re-exports for back-compat; `callKimiReview` thin-wrapped to `runReviewPipeline`. Sibling plugins (minimax / qwen / doubao) **copy** review.mjs verbatim into their own `plugins/<llm>/scripts/lib/review.mjs` — it is a repo-local artifact, NOT a cross-repo import target (avoids end-user brittleness from a dependency outside the plugin bundle).
  - **`kimi-prompting` skill finalized**: SKILL.md (46L) + 3 references — `kimi-prompt-recipes.md` (140L: ask / review / adversarial / rescue / summarization), `kimi-prompt-antipatterns.md` (101L: 8 observed failures including `no_changes` hallucination per gemini G6), `prompt-blocks.md` (148L: reusable XML blocks).
  - **`lessons.md`** (314L) at repo root per spec §6.2: sections A-H populated with Phase 0–5 reality (11 real pits documented, 2 checklists, cross-AI decision log, Kimi's own checklist answers appendix).
  - **`phase-1-template.md`** (427L) at `docs/superpowers/templates/` per spec §6.2 "模板沉淀" (gemini G1): parameterized over 9 placeholders (`{{LLM}}`, `{{LLM_CAP}}`, `{{LLM_UPPER}}`, `{{LLM_CLI}}`, `{{LLM_CLI_INSTALL}}`, `{{LLM_SESSION_ENV}}`, `{{LLM_STATE_DIR}}`, `{{LLM_HOME_DIR}}`, `{{KIMI_REPO_ROOT}}`). Tasks T.1-T.6 compressed from kimi Phase-1 plan's 1500 lines of provider-specific content.
  - **Pre-execution 3-way review integrated** (plan v1→v2): codex C1 (`shouldUnpackBlob` allowlist adversarial-review), C2 (RETRY_NOTICE debrand), gemini G1 (phase-1-template scope), G3 (adversarial anti-dialectical rules), G4 (T9 regex gate), G5 (lessons Appendix I), G6 (no_changes antipattern), G7 (T5 regate pre-tag). 8 findings all integrated to plan v2 at d9a702d.
  - **Post-execution 3-way review** on HEAD 46d9767: codex 0C/0H/0M/1L; gemini 2C/2H/4M but most were stale plan-v1 findings already resolved (only H3 net-new). Integrated: codex L1 (review.mjs comment debrand to fully zero-kimi) + gemini H3 (commands/adversarial-review.md step 7 tightened with overlap heuristic). Polish commit 17ef0b6.
  - **Re-gate PASS before tag**: T5 (balanced review) verdict=needs-attention, findings=2; T9 (adversarial) verdict=needs-attention, findings=4, red-team regex matched. Zero regression from refactor.
- **v0.1 deliverables per spec §1.2**: 8 commands ✓ / 3 skills ✓ / 1 agent ✓ / 2 hooks ✓ / 1 schema ✓ / marketplace ✓ / independent git repo ✓ / lessons.md ✓ / CHANGELOG ✓ / phase-1-template ✓ — all green.
- **next**: tag `phase-5-final`. v0.2 backlog: codex M1 cwd realpath, codex L1 shape unification, gemini G-C2 E2BIG >1MB, gemini G-M1 thinkBlocks `--show-thinking` flag, job-control.mjs adapter extraction (gemini G-C2). Pending sibling-plugin kickoff: minimax-plugin-cc using phase-1-template.md.

## 2026-04-20 [Codex — Phase 5 Task 5.1 review primitive extraction]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/{review.mjs (new), kimi.mjs}, CHANGELOG.md
- **summary**: Extracted provider-agnostic review constants + parse/validate/error helpers into `scripts/lib/review.mjs`, removed the duplicated bodies from `kimi.mjs`, and added top-level re-exports there so existing consumers keep importing the review constants/functions from `./kimi.mjs` unchanged. Deleted the completed Phase-5 extraction TODO and kept the seam visible with a short shared-module note.
- **next**: Task 5.2 can move the review orchestrator into `review.mjs` without changing the public import surface.

## 2026-04-20 [Claude Opus 4.7 — Phase 4 post-review polish]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/job-control.mjs, plugins/kimi/scripts/kimi-companion.mjs
- **summary**: Third impl-layer 3-way review (codex + gemini, parallel) after `phase-4-background` tag. Codex: 0C/0H/1M/3L. Gemini: 2C/2H/2M/4L. Integrated both signals that held up to scrutiny; declined findings already handled or explicitly Phase 5 scope.
  - **codex C-M1 (Medium — integrated)**: pushed `--any-session` logic into `resolveCancelableJob(workspaceRoot, reference, {anySession})` as a library-level option. runJobCancel now just passes the flag through; companion.mjs no longer imports `listJobs` / `sortJobsNewestFirst` (unused after the refactor). Future callers reusing the library see the same semantics without re-implementing the session-filter bypass.
  - **gemini G-H1 (High — integrated as docs)**: `/kimi:setup --enable-review-gate` now emits a stderr note at enable-time explaining the escape hatch (new terminal → `/kimi:setup --disable-review-gate`, or edit `stopReviewGate:false` in state.json). Addresses the "user traps themselves in a BLOCK loop" UX risk without adding a bypass flag (would weaken the gate's intent).
- **Declined with rationale**:
  - **codex C-L1/L2/L3** (gemini-reference comments in stop-review-gate-hook / kimi-agent / rescue): traceability citations explaining where each design decision came from. Keep.
  - **gemini G-C1** (SessionEnd race + orphan logs): VERIFIED MITIGATED. `saveState` already calls `cleanupOrphanedFiles` synchronously when removing jobs; worker writes are try-wrapped. `writeFileSync` of state JSON is atomic enough for this concurrency pattern.
  - **gemini G-C2** (job-control.mjs extraction coupling): explicitly Phase 5 scope — no action this phase.
  - **gemini G-H2** (--write safety net): already documented in rescue.md + kimi-agent.md; no kimi-cli flag exists to enforce read-only mode; wait for kimi-cli to add one or v0.2 to synthesize.
  - **gemini G-M1** (SessionEnd 5s timeout): SIGTERM to process group is correct; 5s is adequate for typical cleanup; silent failure is acceptable tradeoff.
  - **gemini G-M2** (`kimi:kimi-agent` namespace): structurally required by Claude Code's `pluginName:agentName` convention.
- **next**: author docs/superpowers/plans/YYYY-MM-DD-phase-5-adversarial-polish.md. Phase 5 closes v0.1: `/kimi:adversarial-review` + kimi-prompting references/ + lessons.md final + sibling-plugin extraction (review pipeline → shared `scripts/lib/review.mjs`, job-control adapter pattern per gemini G-C2).

## 2026-04-20 [Claude Opus 4.7 — Phase 4 background + agent]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/{job-control.mjs (new), prompts.mjs (new), state.mjs}, plugins/kimi/scripts/{kimi-companion.mjs, session-lifecycle-hook.mjs (new), stop-review-gate-hook.mjs (new)}, plugins/kimi/hooks/hooks.json (new), plugins/kimi/prompts/stop-review-gate.md (new), plugins/kimi/agents/kimi-agent.md (new), plugins/kimi/commands/{rescue,status,result,cancel}.md (new)
- **summary**: Background-job + agent surface. Executed Phase 4 v2 plan via subagent-driven-development (9 tasks). Plan itself went through 1 round of 3-way review before execution (v1→v2, 9 findings integrated: codex C-M1/M2/M3/M4 + gemini G-C1/C2/H1/H2/H3+M1).
  - **Task 4.1**: Ported `job-control.mjs` (599 lines) from gemini-plugin-cc via mechanical sed rebind (callGeminiStreaming→callKimiStreaming, geminiSessionId→kimiSessionId, env var rename, import path, "ga"→"ka" prefix). Removed `approvalMode` from streaming config + rewrote onEvent for kimi's role-based event taxonomy (Phase 2 probe: no typed init/message/result envelope). Created `prompts.mjs` (14-line byte-aligned port) + 3 timing-history stubs in state.mjs (v0.1 has no stats surface — no-op stubs acceptable).
  - **Task 4.2**: `runTask` foreground + background subcommand. Foreground uses empty onEvent (v2 codex C-M1: avoid stderr/stdout double-output); background uses `runStreamingJobInBackground` with detached + tmpfile config. Resume resolution via `resolveResumeCandidate` + `candidate.kimiSessionId`. `DEFAULT_CONTINUE_PROMPT` (bilingual) for `--resume-last` with no prompt.
  - **Task 4.3**: `runJobStatus` / `runJobResult` / `runJobCancel` / `runTaskResumeCandidate` handlers. `runJobCancel` has `--any-session` flag (v2 G-H3+M1) bypassing per-session safety filter. `UNPACK_SAFE_SUBCOMMANDS` extended with 5 new entries + `TASK_KNOWN_FLAG` regex.
  - **Task 4.4**: Real `dispatchWorker` + `dispatchStreamWorker` dispatchers. `dispatchStreamWorker` wraps `runStreamingWorker` in try/finally so tmpfile cleanup always runs (v2 codex C-M2).
  - **Task 4.5**: `session-lifecycle-hook.mjs` (SessionStart sets env / SessionEnd cleans session jobs) + `stop-review-gate-hook.mjs` (relaxed ALLOW/BLOCK scanner per v2 gemini G-C1 — scans all lines, not strict first-line). `hooks.json` with SessionStart timeout 15s (v2 gemini G-C2 — up from 5s for cold starts). Setup extended with `--enable/disable-review-gate` + per-workspace-scope comment + `stopReviewGateWorkspace` status field (v2 codex C-M3).
  - **Task 4.6**: `prompts/stop-review-gate.md` template. Wording aligned with relaxed parser — "first line preferred but preamble tolerated" rather than strict first-line-only.
  - **Task 4.7**: `agents/kimi-agent.md` thin-forwarder. Dropped `--write` and `--effort` flags (no kimi equivalent per spec §4.3) with explicit "drop silently" section + plan-vs-write-mode warning (v2 gemini G-H1).
  - **Task 4.8**: `commands/rescue.md` + `status.md` + `result.md` + `cancel.md`. rescue.md drops `--write/--effort` before forwarding (v2 G-H2). cancel.md documents `--any-session` + explicit "don't auto-retry with --any-session" rule (prevents cancelling unrelated jobs).
- **Exit criteria met**: T6-foreground PASS (response "TASK_OK", UUID sid); T6-background PASS (completed in 3 polls, kimiSessionId captured); T7-resume PASS with kimi actually remembering "4242" across resume (not just `resumed: true` wiring); cancel PASS (state transitions to cancelled). Manual `/kimi:rescue` interactive check deferred to soak.
- **Deferred**: gemini G-M2 (stop-gate latency docs) — opt-in toggle, acceptable; `/kimi:adversarial-review` (Phase 5); kimi-prompting skill content (Phase 5); `--write` flag on task (v0.2); timing-history (v0.2 observability polish).
- **Cumulative**: 53/85 tasks (62%). Git tag `phase-4-background` applied.
- **next**: author docs/superpowers/plans/YYYY-MM-DD-phase-5-adversarial-polish.md. Phase 5 closes v0.1: `/kimi:adversarial-review` + kimi-prompting references/ + lessons.md final + sibling-plugin template extraction (promote review pipeline to shared `scripts/lib/review.mjs`).

## 2026-04-20 [Claude Sonnet 4.6 — Phase 4 Task 4.4: _worker + _stream-worker dispatch]

- **status**: done
- **scope**: plugins/kimi/scripts/kimi-companion.mjs
- **summary**: Replaced `dispatchWorker` and `dispatchStreamWorker` placeholder functions (Task 4.3 stubs that emitted "not implemented yet" + exit 2) with real implementations. `dispatchWorker` is sync — validates args (≥3), destructures jobId/workspaceRoot/forwarded, calls `runWorker(jobId, workspaceRoot, SELF, forwarded)`, exits 0. `dispatchStreamWorker` is async — validates args (≥3), lazy-imports `node:fs`, loads JSON config from tmpfile, calls `await runStreamingWorker(...)` inside try/finally that always unlinks the tmpfile (C-M2 leak fix). Both emit usage-hint to stderr and exit 2 on too-few args. Syntax check passes; smoke tests confirm stderr hint + exit=2 for both subcommands.
- **next**: Task 4.5 — remaining Phase 4 tasks.

## 2026-04-20 [Claude Sonnet 4.6 — Phase 4 Task 4.1: job-control + prompts port]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/job-control.mjs (new), plugins/kimi/scripts/lib/prompts.mjs (new), plugins/kimi/scripts/lib/state.mjs (+3 stubs)
- **summary**: Ported `job-control.mjs` (599 lines) from gemini-plugin-cc with 5 sed substitutions (callGeminiStreaming→callKimiStreaming, geminiSessionId→kimiSessionId, GEMINI_COMPANION_SESSION_ID→KIMI_COMPANION_SESSION_ID, import path, "ga"→"ka" prefix). Removed `approvalMode` param and rewrote onEvent callback for kimi's role-based (non-typed) event model. Created `prompts.mjs` (byte-aligned 14-line port). Added 3 timing-history stubs to state.mjs (`resolveTimingHistoryFile`, `appendTimingHistory`, `readTimingHistory`) as intentional no-ops — kimi has no stats surface in v0.1. All 3 files pass `node --check` and smoke test.
- **next**: Task 4.2 — port `kimi-agent` worker script + `/kimi:status` + `/kimi:result` + `/kimi:cancel` commands.

## 2026-04-20 [Claude Opus 4.7 — Phase 3 post-review polish]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/{git.mjs, kimi.mjs, render.mjs}, plugins/kimi/scripts/kimi-companion.mjs, plugins/kimi/commands/review.md
- **summary**: Second impl-layer 3-way review (codex + gemini, parallel) after `phase-3-review` tag. Codex: 0C/1H/1M/1L. Gemini: 0C/3H/3M/3L. All High findings integrated into two follow-up commits:
  - **Commit (plumbing)** — codex C-H1 + C-L1 + gemini G-H1:
    - runReview now propagates `result.transportError?.status ?? 1` on failure, restoring Phase 2's SIGINT=130 / SIGTERM=143 signal propagation that Phase 3 regressed.
    - `renderReviewResult` in render.mjs deleted as dead code (/kimi:review is JSON-only end-to-end; the prose renderer was never called).
    - `isEmptyContext(context)` extracted into git.mjs — owns the coupling to `formatSection`'s `(none)` sentinel shape locally; kimi-companion.mjs no longer grep-scans the skeleton.
  - **Commit (render signals)** — gemini G-H2 + G-H3 + G-M2 + G-M3:
    - `truncation_notice` + `retry_notice` fields added to the review JSON payload. Prefilled by `TRUNCATION_NOTICE`/`RETRY_NOTICE` constants in kimi.mjs when `truncated` / `retry_used` respectively. review.md renders VERBATIM instead of relying on Claude's rendering discipline on long outputs (where rules at step 1 or step 6 empirically get buried or dropped).
    - review.md verdict bullet now explicitly documents the `no_changes` divergence (companion-only; kimi returns approve or needs-attention).
    - `no_changes` fast-path in runReview emits the full 10-field shape for consumer parity.
    - Phase-5 TODO comment added next to callKimiReview marking the review pipeline (buildReviewPrompt + extractReviewJson + validateReviewOutput + reviewError + callKimiReview) as a clean extraction point for a future shared `scripts/lib/review.mjs` module (sibling-plugin reuse).
- **Deferred**: codex C-M1 (extractor walk-all-top-level-objects; rare scenario + retry covers it), gemini G-M1 (finding line-number validation against diff hunks; Phase 4/5 tracking), gemini G-L1/L2/L3 (informational).
- **next**: author docs/superpowers/plans/YYYY-MM-DD-phase-4-background-agent.md. Phase 4 adds `/kimi:rescue` + port job-control.mjs + `/kimi:status` + `/kimi:result` + `/kimi:cancel` + `kimi-agent` subagent + SessionEnd + Stop hooks.

## 2026-04-20 [Claude Opus 4.7 — Phase 3 /kimi:review + 1-shot retry]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/kimi.mjs, plugins/kimi/scripts/kimi-companion.mjs, plugins/kimi/scripts/lib/render.mjs, plugins/kimi/commands/review.md (new), plugins/kimi/schemas/review-output.schema.json (new), plugins/kimi/skills/kimi-result-handling/{SKILL.md, references/ask-render.md (new), references/review-render.md (new)}
- **summary**: /kimi:review end-to-end with JSON parse/validate + 1-shot retry. Executed Phase 3 v2 plan via subagent-driven-development (8 tasks + 1 inline bugfix).
  - **Task 3.1 (housekeeping)**: `!assistantText.trim()` whitespace guard in callKimi + callKimiStreaming (codex Phase-2-review M3); sessionId-null stderr warning extended to JSON + stream runAsk paths (codex M2); `renderGeminiResult` → `renderKimiResult` rename.
  - **Task 3.2 (SKILL split)**: `kimi-result-handling/SKILL.md` slimmed to cross-command rules; created `references/ask-render.md` with /kimi:ask rendering rationale. `references/review-render.md` deliberately deferred to Task 3.6 (v2 plan: avoid scaffold-then-overwrite). Also removed a duplicated "## Think blocks" section and a stale "Split this skill" TODO.
  - **Task 3.3 (schema)**: `plugins/kimi/schemas/review-output.schema.json` byte-aligned from gemini-plugin-cc, verdict enum extended with `"no_changes"` for the companion-side fast path (gemini v1-review G-H2).
  - **Task 3.4 (review lib)**: `MAX_REVIEW_DIFF_BYTES=150_000`; `buildReviewPrompt` (strong kimi constraints: no markdown fence, no prose preamble, no Chinese severity, all-or-none findings); `extractReviewJson` (3 dirty modes + reject multi-top-level per codex v1-review C-M1); `validateReviewOutput` (per-finding required keys + enums + bounds; rejects `no_changes` from kimi output, codex C-H1); `callKimiReview` with `reviewError` unified failure shape + try/catch around schema load (codex C-H2) + stderr retry breadcrumb (gemini G-L3) + `resumeSessionId` on retry.
  - **Task 3.5 (companion)**: `runReview` subcommand with `aliasMap: {m: "model"}`; outer try/catch wrapping `callKimiReview`; dispatcher wire-up; `UNPACK_SAFE_SUBCOMMANDS` extended with `review` + `REVIEW_KNOWN_FLAG` regex + all-positionals fallback branch.
  - **Task 3.6 (command + reference)**: `commands/review.md` with truncation warning at step 1 of presentation (gemini v1-review G-M3); `references/review-render.md` holds ONLY background rationale (retry reasoning, severity-english policy, partial-findings rejection, truncation prominence, non-findings shapes, /review comparison).
  - **Task 3.7 inline fix**: `collectReviewContext` always emits a `(none)` skeleton even for zero-diff repos, making the naive `!content.trim()` check unreachable and the `no_changes` fast path dead. Fixed by stripping `(none)` sections before the check — gemini-plugin-cc has the same filter.
- **Exit criteria met**: T5 PASS (off-by-one flagged as high/critical severity with correct line numbers), empty-diff PASS (no_changes fast path), invalid-model PASS (pre-flight routing), extractor-modes 6/6 PASS (all 3 dirty modes + edge cases), truncation PASS (337KB diff handled).
- **Deferred further**: codex Phase-2-review M1 (cwd realpath), codex L1 (cosmetic shape unification), gemini G-C2 (E2BIG >1MB), gemini G-M1 (thinkBlocks UX phrasing), gemini G-M2 (sibling-plugin template extraction — Phase 5 scope).
- **Cumulative**: 44/85 tasks (52%). Git tag `phase-3-review` applied.
- **next**: author docs/superpowers/plans/YYYY-MM-DD-phase-4-background-agent.md. Phase 4 adds `/kimi:rescue` + job-control.mjs + kimi-agent subagent + SessionEnd/Stop hooks.

## 2026-04-20 [Claude Opus 4.7 — Phase 2 post-review polish]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/kimi.mjs, plugins/kimi/scripts/lib/process.mjs, plugins/kimi/scripts/kimi-companion.mjs, plugins/kimi/skills/kimi-result-handling/SKILL.md
- **summary**: First impl-layer 3-way review (codex + gemini, parallel) after `phase-2-ask` tag. Codex returned 1 Critical / 2 High / 3 Medium / 1 Low; gemini returned 2 Critical / 3 High / 2 Medium / 1 Low. Integrated all Critical + High into two follow-up commits:
  - **Commit 0cbb7cf (correctness)** — codex C1/H1/H2: runCommand preserved `status=null` instead of collapsing to 0; callKimi/callKimiStreaming map `signal=SIGINT/SIGTERM → status=130/143` via new `statusFromSignal` helper; streaming `close(code, signal)` signature picked up; stdin EPIPE/ERR_STREAM_DESTROYED swallowed + `writable` guard; describeKimiExit SIGINT text changed "Cancelled" → "Interrupted" so ask.md's `"interrupted"` template router matches both signal paths (gemini G-H2 partial).
  - **Commit 1ac264f (UX consistency)** — gemini G-C1/G-H1/G-H3: SKILL.md's `/kimi:ask` subsections rewritten to defer to ask.md (they previously contradicted the verbatim-presentation contract — assumed JSON consumer, instructed "Kimi says:" prefix, offered unprompted "Translate to English?"); runAsk now emits a stderr warning when `resumeSessionId` was requested but returned `sessionId` differs.
- **deferred to Phase 3+**: codex M1 (cwd realpath normalization), codex M2 (sessionId-null warning in JSON/stream modes), codex M3 (whitespace-only response trim), codex L1 (unified empty-response shape), gemini G-C2 (E2BIG for >1MB prompts — our 150KB test PASS, not a Phase 2 blocker), gemini G-M1 (thinkBlocks UX tease phrasing), gemini G-M2 (sibling-plugin template extraction — Phase 5 scope).
- **next**: author docs/superpowers/plans/YYYY-MM-DD-phase-3-review-retry.md. Phase 3 opens with Task 3.0 (modularize kimi-result-handling SKILL into `references/<command>-render.md` — addresses gemini G6), then `/kimi:review` with git-diff collection, schema-validated JSON findings, 1-shot JSON-parse retry.

## 2026-04-20 [Claude Opus 4.7 — Phase 2 ask + streaming]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/kimi.mjs, plugins/kimi/scripts/kimi-companion.mjs, plugins/kimi/commands/ask.md (new), plugins/kimi/skills/kimi-result-handling/SKILL.md, doc/probe/probe-results.json
- **summary**: /kimi:ask implemented end-to-end with sync, JSON, and (developer-only) streaming modes. Executed Phase 2 v4 plan via subagent-driven-development (8 tasks + 1 follow-up fix).
  - **Runtime sentinels** (Task 2.1): `LLM_NOT_SET_MARKER`, `KIMI_EXIT` table, `KIMI_STATUS_TIMED_OUT=124` (GNU timeout convention; avoids POSIX wraparound).
  - **Parsers** (2.1): `parseKimiEventLine` / `extractAssistantText` (keep `text`, drop `think`, skip unknown) / `parseKimiStdout` (multi-line JSONL) / `parseSessionIdFromStderr` / `readSessionIdFromKimiJson`.
  - **callKimi** (2.2): sync wrapper with model pre-flight, unified `errorResult` helper, empty-response guard (`!assistantText` regardless of event count — catches think-only silent-failure mode), `thinkBlocks` surface.
  - **callKimiStreaming** (2.3): async `spawn` + StringDecoder("utf8") multi-byte safety, per-event `onEvent` callback, unified timeout contract (status=124). DRY helper `countThinkBlocks` extracted (addresses Task 2.2 code-review minor).
  - **runAsk** (2.4): --json / --stream / -m / -r flags; rejects `-X=` short-form (codex v3 A3); `KIMI_COMPANION_CALLER=claude` env gate blocks --stream from /kimi:ask; arg-unpack uses `ASK_KNOWN_FLAG` allowlist regex (codex v2 A3: no `startsWith("-")` mis-split); footer always shows session (even "unknown (not captured)" — exposes capture bugs, codex v3 A2); `process.exit(result.status ?? 1)` propagates kimi's original exit code.
  - **/kimi:ask command** (2.5): verbatim-presentation contract, MUST NOT prepend/append commentary (gemini v4-4), declarative-only error suggestions (MUST NOT end with "?", gemini v4-5).
  - **kimi-result-handling SKILL** (2.6): concrete rendering patterns for /kimi:ask success, partialResponse, Chinese output, think blocks.
  - **Empirical fix** (Task 2.7 follow-up): kimi 1.36 rejects `-p ""` ("Prompt cannot be empty") — switched stdin mode to `--input-format text` + no `-p` flag. codex C1 was correct after all; probe-results.json rationale updated.
- **Exit criteria met**: T2 PASS (sync JSON), T3 PASS (streaming JSONL + summary), T4 PASS (sessionId ↔ kimi.json), invalid-model PASS (pre-flight routes exit=1 with available list), large-prompt PASS (150KB via --input-format text), resume positive PASS, reverse WARN (kimi-cli doesn't validate bogus sid — documented, not a blocker).
- **Tag**: `phase-2-ask` — cumulative progress 36/85 tasks = 42%.
- **next**: author `docs/superpowers/plans/YYYY-MM-DD-phase-3-review-retry.md`. Phase 3 opens with Task 3.0 (modularize kimi-result-handling SKILL into `references/<command>-render.md` — G6 addressed) then adds `/kimi:review` with git-diff collection, schema-validated JSON findings, 1-shot parse retry.

## 2026-04-20 [Claude Sonnet 4.6 — Task 2.7 follow-up: fix stdin path uses --input-format text]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/kimi.mjs, doc/probe/probe-results.json
- **summary**: Task 2.7 Step 5 failed with EPIPE because `-p ""` is rejected by kimi 1.36 ("Prompt cannot be empty"). Fixed `buildKimiArgs`: stdin mode now omits `-p` entirely and passes `--input-format text`; inline mode unchanged (uses `-p prompt` via `args.unshift`). Updated probe-results.json rationale + implications_for_phase_1. Verified: 150KB large-prompt test PASS, inline smoke PASS.
- **next**: continue Task 2.7 remaining steps per Phase 2 v4 plan.

## 2026-04-20 [Claude Opus 4.7 — Phase 2 plan v4 after THIRD 3-way review]

- **status**: done
- **scope**: docs/superpowers/plans/2026-04-20-phase-2-ask-streaming.md
- **summary**: Third 3-way review round. Both reviewers agreed v3 A7 was not fully closed (resume test could false-positive). Codex also flagged A2 silent session omission + A3 short-flag =form. Gemini flagged A2/A6 as partial (prompt-level wording is weak). Consolidated 7 v4 changes:
  - **v4-1 (High, convergent)**: resume test now has positive + reverse + stability branches (bogus 00000000-… must be rejected or logged as WARN; sid must match a valid uuid in kimi.json).
  - **v4-2 (Medium)**: footer always shows `session: <id|unknown>`; runAsk writes stderr warning when sessionId null. No more silent omission.
  - **v4-3 (Medium)**: runAsk rejects short-form `-X=Y` positionals with a clear usage error — previously they leaked into the prompt.
  - **v4-4 (Medium)**: ask.md MUST NOT prepend/append commentary (no "这是 Kimi 的回答：" intros). Disagreement note is the only allowed addition.
  - **v4-5 (Medium)**: ask.md error suggestions are literal declarative templates; MUST NOT end with "?".
  - **v4-6 (Low)**: no doc typo found; v3 already clean.
  - **v4-7 (Low)**: KIMI_STATUS_TIMED_OUT = 124 has defensive comment about future kimi-cli collision.
  - **Phase 3 Task 3.0** explicitly recorded in audit section: kimi-result-handling SKILL.md will be split into `references/<command>-render.md` modules when review joins (stops G6 snowballing).
- **next**: subagent-driven execution of plan-2-ask-streaming v4. After 3 review rounds the plan is stable enough to execute; further rounds would be diminishing returns.

## 2026-04-20 [Claude Opus 4.7 — Phase 1 live-install verified]

- **status**: done
- **scope**: README.md, docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md (§6.2 lessons §H), install flow
- **summary**: Resolved Phase 1 T1.16 Steps 2-3 (live-integration) via the correct Claude Code install path.
  - `claude plugins install ./plugins/kimi` fails with "not found in any configured marketplace" — the subcommand takes a NAME from a registered marketplace, not a filesystem path.
  - Correct flow: `claude plugins marketplace add <repo-root>` (or `.claude-plugin/marketplace.json` path) → `claude plugins install <plugin>@<marketplace-name>`. For this repo: `kimi@kimi-plugin`.
  - Verified: `kimi-plugin` marketplace registered (Source: File /Users/bing/-Code-/kimi-plugin-cc/.claude-plugin/marketplace.json), `kimi@kimi-plugin v0.1.0` installed (user scope, enabled). Slash commands require a Claude Code session restart to pick up.
  - README updated with the correct two-step install. Spec §6.2 lessons.md §H gained a new "Claude Code 侧陷阱" subsection so the next plugin (minimax/qwen) won't hit this.
- **next**: after restart, run `/kimi:setup` in Claude Code to verify end-to-end.

## 2026-04-20 [Claude Opus 4.7 — Phase 2 plan v3 after second 3-way review]

- **status**: done
- **scope**: docs/superpowers/plans/2026-04-20-phase-2-ask-streaming.md
- **summary**: Second 3-way review caught 2 BLOCKERS in v2 that both codex and gemini independently flagged (convergent signal → real problems). 7 total fixes integrated:
  - **A1 (BLOCKER, convergent)**: empty-response guard widened from `events.length === 0 && !assistantText` to just `!assistantText` — now catches think-only responses (events=1 with only think blocks, no visible text).
  - **A2 (BLOCKER)**: footer generation moved from ask.md `**MUST** append` prompt instruction (fragile) to companion code in text-mode path (`formatAskFooter`). ask.md now says "present stdout verbatim" — no Claude formatting drift.
  - **A3 (BLOCKER)**: `shouldUnpackBlob` ask branch narrowed from `tokens[0].startsWith("-")` to a known-flag allowlist regex — `-v my prompt` no longer mis-splits.
  - **A4 (High, convergent)**: env gate switched from `CLAUDE_PLUGIN_ROOT` (command.md already uses it — tautological; may leak into dev shells) to dedicated `KIMI_COMPANION_CALLER=claude` explicitly exported by ask.md bash.
  - **A5 (High)**: `KIMI_STATUS_TIMED_OUT` changed from `-1` (POSIX wraparound to 255, collides with real exits) to `124` (GNU timeout convention, unused by kimi).
  - **A6 (Medium)**: `/kimi:ask` error path no longer asks follow-up questions — only one-sentence suggestions. Keeps one-shot command semantics.
  - **A7 (Low, convergent)**: Task 2.7 Step 6 resume test rewritten — verifies `-r` wiring (flag accepted, exit 0, valid UUID) instead of brittle "remember 42" semantic recall.
- **next**: subagent-driven execution of plan-2-ask-streaming v3.

## 2026-04-20 [Claude Opus 4.7 — Phase 2 plan v2 after 3-way review]

- **status**: done
- **scope**: docs/superpowers/plans/2026-04-20-phase-2-ask-streaming.md
- **summary**: Integrated 11 findings (1 Critical + 5 High + 3 Medium + 2 defer) from plan-level 3-way review; 2 more left as verify-during-execution.
  - Critical: gemini G1 empty-response guard (exit 0 + 0 events returns ok=false now); codex C3 ask-blob flag unpacking; codex C4 exit status propagation.
  - High: codex C2 pre-flight model check via readKimiConfiguredModels; codex C5 block --stream from /kimi:ask; codex C6 unified errorResult shape; gemini G3 mandatory session footer in ask.md; gemini G5 large-prompt + resume-continuity tests.
  - Medium: codex C7 runtime sentinels block in kimi.mjs (LLM_NOT_SET_MARKER / KIMI_EXIT / KIMI_STATUS_TIMED_OUT); gemini G4 thinkBlocks count; gemini G7 active-recovery paths in ask.md; codex C1 kept empirically (probe 03) with Task 2.7 re-verify at 150KB.
  - Deferred: gemini G6 SKILL modularization to Phase 3 (with review skill); gemini G9 renderGeminiResult rename to Phase 5 polish.
- **next**: subagent-driven execution of plan-2-ask-streaming.

## 2026-04-20 [Claude Opus 4.7 — Phase 1 skeleton]

- **status**: done
- **scope**: plugins/kimi/** (new), .claude-plugin/marketplace.json (new), repo root files (.gitignore/README.md/CLAUDE.md)
- **summary**: Phase 1 skeleton complete across 14 commits. The plugin is structurally complete and CLI-layer verified.
  - Lib files hand-rewritten from gemini-plugin-cc (P2 principle, no sed/cp): `args.mjs` (c8db8ba), `process.mjs` (dcf3252), `render.mjs` (3a881a6 — stats inline removed; kept function names `renderGeminiResult` etc. per "function names unchanged" rule — flagged as Phase 2 rename candidate), `git.mjs` (e289bf5), `state.mjs` (0022b68 — only 2 literal changes: `kimi-companion` dir, `kj-` job prefix).
  - `kimi.mjs` (a8f78d3 + 21262ca): TOML top-level key scanner, `[models.*]` section scanner (handles bare + double-quoted + single-quoted keys; strips quotes — real host config has `[models."kimi-code/kimi-for-coding"]`), `getKimiAvailability`, `getKimiAuthStatus` (with model preflight before ping; returns `{loggedIn: null, modelConfigured: false}` when default_model is missing from configured list to distinguish from auth failure), `readKimiDefaultModel`, `readKimiConfiguredModels`, exported constants PING_MAX_STEPS=1 / SESSION_ID_STDERR_REGEX / LARGE_PROMPT_THRESHOLD_BYTES=100000 / PARENT_SESSION_ENV / KIMI_BIN / DEFAULT_TIMEOUT_MS / AUTH_CHECK_TIMEOUT_MS. Constant assertion runs in smoke test and verifies regex extracts UUID from a hardcoded probe-01 stderr sample.
  - `kimi-companion.mjs` (3e355ca): dispatcher with `setup` subcommand and guarded arg-unpack heuristic (`shouldUnpackBlob` requires sub=="setup" AND every token starts with "-", so Phase 2 positional prompts won't get split). JSON and human-format paths both validated.
  - `commands/setup.md`: dynamic AskUserQuestion option filtering; 0-installer text fallback; official install URL `https://cdn.kimi.com/binaries/kimi-cli/install.sh` (codex-verified; previous plans used wrong moonshot.cn URL).
  - 3 skills: `kimi-cli-runtime/SKILL.md` (all literals from probe-results.json v3 — no placeholders), `kimi-prompting/SKILL.md` skeleton + `references/.gitkeep`, `kimi-result-handling/SKILL.md` early draft (content aggregation rules + think-block drop + stats-unavailable guidance).
  - **T1 PASS** (setup --json returns installed=true, version populated, authenticated=true, model=kimi-code/kimi-for-coding, configured_models=[...], installers={shellInstaller:true, uv:true, pipx:false}).
  - **T8 PASS** (KIMI_CLI_BIN=/nonexistent → installed=false, version=null, authenticated=false, installers still populated).
  - **Formatter text path PASS** (three-line human-readable output verified: `installed: yes (kimi, version 1.36.0)` / `authenticated: yes` / `default model: kimi-code/kimi-for-coding`).
  - **`claude plugins validate ./plugins/kimi` PASS** (manifest clean).
  - **T1.16 Steps 2-3 PENDING MANUAL**: `claude plugins install` + live `/kimi:setup` inside a Claude Code session needs operator action. Tag represents code-state readiness, not live-integration. If live test later fails, add a fix commit and retag.
- **next**: author `docs/superpowers/plans/YYYY-MM-DD-phase-2-ask-streaming.md`. Phase 2 implements `callKimi` + `callKimiStreaming` with multi-line JSONL parsing and content-block text aggregation per kimi-cli-runtime contract. Also: consider renaming `renderGeminiResult` → `renderKimiResult` in render.mjs as a Phase 2 task (tech debt from T1.5).

## 2026-04-20 [Claude Opus 4.7 — Phase 1 plan v2 after 3-way review]

- **status**: done
- **scope**: docs/superpowers/plans/2026-04-20-phase-1-skeleton.md (12 integrated findings), docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md (§6.2 template sentence)
- **summary**: plan-level 3-way review caught 4 Critical/High correctness bugs before execution:
  - [Critical] Original Task 1.15 called `claude plugins add` — this subcommand does not exist (actual: `install | validate | disable | enable | list | marketplace | uninstall | update`). Plan now uses `claude plugins validate` (Task 1.16 Step 1) and flags the live-session `/kimi:setup` check as MANUAL (can't be automated inside a subagent).
  - [High] Task 1.8 TOML regex `/^\[models\.([^\]]+)\]\s*$/` did not handle quoted keys with slashes. Host kimi config uses `[models."kimi-code/kimi-for-coding"]` — regex now handles bare / double-quoted / single-quoted forms and strips quotes.
  - [High] Task 1.9 auth ping ran without verifying default_model is actually in [models.*] — would misreport "LLMNotSet" config errors as auth failures. Added model preflight; returns `{loggedIn: null, modelConfigured: false}` to distinguish.
  - [High] Task 1.11 install URL was wrong (`kimi.moonshot.cn/cli/install.sh` → 404). Corrected to `https://cdn.kimi.com/binaries/kimi-cli/install.sh | bash`.
  - [High] Tasks 1.3-1.7 smoke tests now include `Object.keys` parity check against gemini-plugin-cc source — catches silent API drift from hand-rewrites.
  - [High] Task 1.8 Step 3 includes "constant assertion" — SESSION_ID_STDERR_REGEX / PING_MAX_STEPS / LARGE_PROMPT_THRESHOLD_BYTES / PARENT_SESSION_ENV verified against hardcoded samples.
  - [High] Task 1.3 header notes Tasks 1.3-1.7 are independent and can be dispatched in parallel.
  - [Medium] Task 1.10 dispatcher heuristic now gated on `sub === "setup"` + "every token starts with -" so Phase 2 position args (prompts with spaces) won't get split.
  - [Medium] Header exit-criteria adds user-visible check (`installed: yes` / `default model: <name>` in human-format output).
  - [Medium] spec §6.2 adds "templatize Phase 1 Tasks 1.1-1.6" sentinel for minimax/qwen follow-ups.
  - Rejected: gemini G5 (split state.mjs rewrite into 3 steps — only 2 literal constants change, rewrite is already minimal); gemini G8 (merge syntax-check + smoke-test into one step — fine-grained steps aid audit).
- **next**: execute plan-1-skeleton via subagent-driven-development.

## 2026-04-20 [Claude Opus 4.7 — Phase 0 remediation after 3-way review]

- **status**: done
- **scope**: doc/probe/probe-results.json (v3), doc/probe/06-fresh-path.md (new), docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md (§3.3/§3.4/§3.5/§4.2/§6.2)
- **summary**: Integrated 13 findings from codex + gemini 3-way review of Phase 0 probes.
  **Codex source-read corrections** (read kimi-cli at ~/.local/share/uv/tools/kimi-cli/lib/python3.13/site-packages/):
  - [Critical Q2] stream-json is **per-message**, not per-turn; single kimi run can emit multiple JSONL lines when tool use occurs (tool_result is a separate role='tool' event).
  - [High Q3] SIGTERM empty-stdout is because LLM hadn't produced content, not kimi buffering; `flush=True` is everywhere; no SIGTERM handler so SIGKILL is safe.
  - [Medium Q4] Session.create() does upsert new work_dirs entries on fresh paths (source: kimi_cli/session.py). probe-results.json changed new_entry_for_fresh_path: false → true.
  - [Medium Q5] stderr resume hint writes directly to sys.stderr, unaffected by --quiet — only at risk if CALLER discards stderr.
  - [High Q6] Invalid model (exit 1, "LLM not set") creates a wasted session; Phase 1 must pre-validate model name against ~/.kimi/config.toml [models.*].
  - [Medium Q7] stats events exist internally (StatusUpdate) but JsonPrinter drops them — confirmed unavailable in v0.1.
  **Empirical probe P0.8 (fresh-path, added after review)**: confirmed upsert behavior live; confirmed path storage is verbatim (md5 of input string matches session dir; md5 of realpath does NOT). Codex's "canonical()" read means normalize but NOT symlink-resolve. Phase 1 must use fs.realpathSync(cwd) consistently on both sides of work_dirs comparison.
  **Gemini strategic adjustments**:
  - [P1] spec §3.3 rewritten: content aggregation rules (only type=="text" blocks, default drop think blocks, skip unknown types without erroring), session_id from stderr explicit, stats section deleted (v0.1 can't), UX expectation set to paragraph-level increments (not per-token).
  - [P1] spec new §3.5: CLI exit code → command UX mapping table (0/1/2/130/143/other).
  - [P1] spec §4.2 /kimi:setup: model preflight from config.toml added.
  - [P1] spec §6.2 lessons.md: new section H "API 行为契约陷阱" — 10-item checklist of systematic traps that recur across provider CLIs (stream granularity, structured-field location, session_id channel, stats reachability, path storage, SIGTERM truth, invalid-model behavior, tool_result event shape, auth-probe cost, upsert behavior).
  - § 3 subsection renumbering: old §3.5 → §3.6, §3.6 → §3.7, §3.7 → §3.8, §3.8 → §3.9.
- **next**: tag phase-0-final; then author docs/superpowers/plans/2026-04-20-phase-1-skeleton.md using probe-results.json v3 as literal-value source.

## 2026-04-20 [Claude Opus 4.7 via Haiku subagents]

- **status**: superseded-by-revision
- **scope**: doc/probe/
- **summary**: Phase 0 probes complete. 6 probe docs + probe-results.json (schema v2) committed across 7 commits (621c7ca..03f2937). All 5 runtime unknowns resolved:
  - **stream-json is per-turn JSONL** (one JSON object per completed agent turn, not per-token); assistant text lives in `content[]` blocks where `type=="text"`, field `.text`.
  - **session_id only in stderr** via pattern `kimi -r <uuid>` — NOT in stdout JSON. Secondary fallback via `~/.kimi/kimi.json.work_dirs[].last_session_id` is viable (updates synchronously in --print mode).
  - **Hash algorithm** for session directory first level: **md5** of work_dir path (verbatim, no realpath).
  - **Large prompts**: stdin pipe with `-p ""` is recommended (cross-platform); threshold 100000 bytes.
  - **Auth ping**: `--max-steps-per-turn 1` is 3/3 reliable.
  - **Failure modes**: exit 143 (SIGTERM), exit 1 with stdout "LLM not set" (invalid model), exit 2 with Click error box on stderr (bad cwd).
  Critical adjustment for Phase 1 design: codex's source-read prediction of flat `{role, content:string}` shape was partially wrong — content is a block list. Also stream-json name is a misnomer; it's structured-json-per-turn, not token-streaming. Phase 1 streaming UX must adapt (no mid-turn rendering).
- **next**: write `docs/superpowers/plans/2026-04-20-phase-1-skeleton.md` using `doc/probe/probe-results.json` for all literal values — no placeholders. Then 3-way review that plan before execution.

## 2026-04-20 [Claude Opus 4.7]

- **status**: done
- **scope**: docs/superpowers/plans/
- **summary**: Plan v2 after 3-way review. Archived the combined Phase 0+1 plan
  and split it into `2026-04-20-phase-0-probes.md` (live) plus a deferred Phase 1
  skeleton plan (to be written after Phase 0 tags).
  Key fixes driven by review:
  - Gemini [HIGH] — Phase 0+1 bundling caused placeholder patterns (`<PING_MAX_STEPS>` etc.) that violate writing-plans "no placeholder" rule. Split resolves it: Phase 0 outputs probe-results.json which Phase 1 reads as literal values.
  - Codex [High] — stream-json events are flat `{role, content}` per source read of `kimi_cli/ui/print/visualize.py`; simplified Task P0.1 matching logic.
  - Codex [High] — hardcoded `/Users/bing/...` paths and macOS-only `md5` command replaced with `git rev-parse` / `$PWD` and python3 hashlib.
  - Codex [High] — added Task P0.0 preflight gate (kimi installed + logged in) as hard precondition for all probes.
  - Added total v0.1 budget estimate (~85 tasks across 5 phases) to plan header.
  - 7 other Phase-1-specific fixes (state.mjs defaults, dispatcher arg-unpack bug, AskUserQuestion ≥2 items, T1/T8 stricter pass criteria, near-copy task granularity, integration validation) deferred to the Phase 1 plan which will be written post-Phase-0.
- **next**: execute `2026-04-20-phase-0-probes.md` (7 tasks). On `phase-0-probes-done` tag, author Phase 1 plan using probe-results.json for literal values.



Entry format:
```
## YYYY-MM-DD HH:MM [author]
- **status**: draft | in-progress | done | handed-off-to-<X> | blocked
- **scope**: <files/areas>
- **summary**: <what+why>
- **next**: <optional handoff note>
```

## 2026-04-20 [Claude Opus 4.7]

- **status**: done
- **scope**: docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md
- **summary**: spec v0.2 after 3-way review. Major revisions:
  - §3.3 original "kimi has no stream-json, synthesize events" was factually wrong; kimi supports `--print --output-format stream-json` natively (codex catch). Rewritten to use native JSONL + StringDecoder for UTF-8 safety.
  - §3.4 session_id acquisition: abandoned "global snapshot diff" (race-prone) in favor of two-path strategy — primary from stream-json event, fallback from `~/.kimi/kimi.json.work_dirs[].last_session_id` by cwd match.
  - §3.5 config.toml reading: replaced regex with a minimal top-level key scanner (still zero deps). Key name confirmed as `default_model`.
  - §4.2 setup: added post-install PATH re-probe via absolute path; promoted uv `--python 3.13` as official path.
  - §6.4 phase reshuffle: skills no longer deferred to Phase 5; `kimi-cli-runtime` drafted in Phase 1, `kimi-prompting` skeleton in Phase 1, `kimi-result-handling` initial in Phase 2. Phase 0 probe gate added.
  - §1.3/§3.2 1-shot JSON parse retry restored from v0.2 exclusion into v0.1 scope (gemini catch on Kimi Chinese-prose bias).
  - §6.2 lessons.md skeleton expanded with LLM behavioral axis (JSON compliance, token decay, rate limits, tool-calling bias, reasoning chain).
  - §6.3 CHANGELOG entries now carry status field as hand-off signal.
  - Appendix A pruned from 5 unknowns to 5 truly-to-probe items.
- **next**: user to approve revised spec; then invoke superpowers:writing-plans to generate PLAN.md.

## 2026-04-20 [Claude Opus 4.7]

- **status**: superseded-by-v0.2
- **scope**: docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md
- **summary**: initial design spec for kimi-plugin-cc
  - Full-parity port of gemini-plugin-cc to Moonshot Kimi CLI
  - 8 commands / 3 skills / 1 agent / 2 hooks / 1 schema
  - Independent repo at /Users/bing/-Code-/kimi-plugin-cc/
  - Session model: mirror gemini (new session per /kimi:ask; --resume <id> for explicit continue)
  - Structured output: prompt engineering + indexOf("{") scan (kimi has no -o json)
  - Streaming: synthesized init/message/result events wrapping `kimi -p --print` stdout
  - Session ID: snapshot-diff of ~/.kimi/sessions/ directory
  - Defer to v0.2: ACP integration, Engram sidecar, -C continue semantics, auto-retry
  - Spec: docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md
  - Authored by: Claude Code (Opus 4.7), after 6-section brainstorming with user
  - Status: draft, pending 3-way review by codex + gemini
