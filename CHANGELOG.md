# CHANGELOG

Reverse-chronological, flat format. Cross-AI collaboration log (Claude/Codex/Gemini).

## 2026-04-20 [Claude Opus 4.7 via Haiku subagents]

- **status**: done
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
