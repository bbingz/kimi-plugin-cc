# CHANGELOG

Reverse-chronological, flat format. Cross-AI collaboration log (Claude/Codex/Gemini).

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
