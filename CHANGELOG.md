# CHANGELOG

Reverse-chronological, flat format. Cross-AI collaboration log (Claude/Codex/Gemini).

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
  - **Review pipeline extracted** to `plugins/kimi/scripts/lib/review.mjs` (provider-agnostic): `MAX_REVIEW_DIFF_BYTES`, `TRUNCATION_NOTICE`, `RETRY_NOTICE`, `extractReviewJson`, `validateReviewOutput`, `reviewError`, `runReviewPipeline`. `RETRY_NOTICE` debranded ("The first response..." vs "Kimi's first...") per codex C2. `kimi.mjs` re-exports for back-compat; `callKimiReview` thin-wrapped to `runReviewPipeline`. Sibling plugins (minimax / qwen / doubao) import review.mjs verbatim.
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
