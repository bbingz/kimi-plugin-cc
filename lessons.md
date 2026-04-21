# Lessons: gemini-plugin-cc → kimi-plugin-cc manual migration

Captured during v0.1 build (2026-04-20 through phase-5-final).

This file is load-bearing for the next sibling plugin in the series
(`minimax-plugin-cc` / `qwen-plugin-cc` / `doubao-plugin-cc`). Read it
before writing any phase-0 probe — most of these lessons generalize.

## A. Naming substitution rules (mechanical)

When porting from the template source plugin, apply these rules globally:

| template source | target plugin |
|---|---|
| `gemini` / `Gemini` | `<llm>` / `<Llm>` |
| `~/.gemini/` | `~/.<llm>/` |
| `GEMINI_COMPANION_SESSION_ID` | `<LLM>_COMPANION_SESSION_ID` |
| `gemini-companion.mjs` | `<llm>-companion.mjs` |
| `gemini-agent` | `<llm>-agent` |
| `/gemini:*` | `/<llm>:*` |
| `~/.claude/plugins/gemini/` | `~/.claude/plugins/<llm>/` |
| `callGemini` / `callGeminiStreaming` | `call<Llm>` / `call<Llm>Streaming` |
| `geminiSessionId` | `<llm>SessionId` |

Rule: if you can `sed` it safely (no false positives), do. But re-read the
file after. In Phase 4 we almost missed `|| "ga"` → `|| "ka"` because the
rename wasn't obvious.

## B. Must-rewrite-from-scratch (do not copy)

These 9 files encode provider-specific behavior. Copying them is worse
than starting blank because the copy masks real differences.

1. `scripts/lib/<llm>.mjs` — CLI spawn + parsing + session-ID extraction + model config + errors
2. `commands/setup.md` — install path (npm / pipx / uv / shell), auth probe
3. `commands/review.md` — render rules + truncation/retry-notice handling
4. `prompts/stop-review-gate.md` — ALLOW/BLOCK sentinel expectations
5. `prompts/adversarial-review.md` — attack-surface list varies by model strengths
6. `skills/<llm>-prompting/` — entire directory (recipes, antipatterns, blocks)
7. `skills/<llm>-cli-runtime/SKILL.md` — exit-code table, event taxonomy, constants
8. `skills/<llm>-result-handling/SKILL.md` — render policy (think blocks / Chinese prose / divergence markers)
9. `agents/<llm>-agent.md` — routing flags, tool allowlist, context window size

## C. Almost-pure-copy (≤ 10% changes)

These files are infrastructure that ported mechanically. Still read them
once, still apply naming substitutions, but no substantive rewrite needed.

1. `scripts/lib/args.mjs` — argparse
2. `scripts/lib/git.mjs` — diff/scope collection (Phase 3 added `isEmptyContext` helper)
3. `scripts/lib/process.mjs` — spawn helpers with signal handling
4. `scripts/lib/render.mjs` — text output formatting
5. `scripts/lib/state.mjs` — per-workspace JSON state (path constant changes)
6. `scripts/lib/prompts.mjs` — template loader (14 lines, byte-identical)
7. `scripts/lib/job-control.mjs` — background-job machinery (replace `callGeminiStreaming` binding + rewrite the `onEvent` callback for the new event taxonomy; otherwise identical)
8. `scripts/lib/review.mjs` *(new in Phase 5)* — review parse/validate/retry orchestrator. Fully provider-agnostic; minimax-plugin-cc should **copy this file verbatim** into its own `plugins/<llm>/scripts/lib/review.mjs`. Do NOT cross-import from kimi-plugin-cc at runtime — each plugin bundle must be self-contained so end users don't have a mystery dependency on a sibling repo.
9. `schemas/review-output.schema.json` — output contract; update the
   `verdict` enum and severity enum only if the new LLM emits different categories.

## D. Real pits (appended live across Phase 0–4)

### Pit 1: `kimi -V` is uppercase; `-v` is verbose

Lowercase `-v` silently enables verbose mode on live calls. Use `-V` for
version probe. The CLI's own docs used `-V` but one example in a
community post used `-v`; check with `--help` first.

### Pit 2: `kimi -p ""` rejected on kimi 1.36

Stdin path for large prompts is `--input-format text` + piped input, NOT
`-p ""`. Probe-01 initially claimed `-p ""` worked; Phase 2 T2 empirical
test failed with a Click usage error box. Codex review (C1) caught it.

### Pit 3: `session_id` lives on stderr, not stdout

`--output-format stream-json` emits assistant/tool events on stdout but
the `kimi -r <uuid>` resume hint is on stderr, via
`_print_resume_hint → _emit_fatal_error`. Consumers that do `2>/dev/null`
lose session-id primary path and must fall back to
`~/.kimi/kimi.json → work_dirs[].last_session_id`.

### Pit 4: `work_dirs[].path` is verbatim, not realpath'd

In Phase 2 we thought `/tmp/x` vs `/private/tmp/x` would be normalized
by kimi-cli. It isn't — `kimi.json.work_dirs[].path` stores whatever
string the process saw as cwd at spawn time.

**Status in v0.1 code:** we do NOT call `fs.realpathSync(cwd)` before
spawning kimi. Instead, `callKimi` / `callKimiStreaming` rely on
**single-variable consistency** — the same `cwd` string is passed to
`spawn({ cwd })` AND to `readSessionIdFromKimiJson(cwd)`, so the two
sides are guaranteed to match regardless of whether the path was
already resolved. This works as long as callers don't pass
`/tmp/x` in one breath and `/private/tmp/x` in another.

**v0.2 gap:** if a caller external to the companion (e.g. a hook or
sibling script) reads `kimi.json` directly, it must apply realpath
on the cwd it compares against. Sibling plugins (minimax / qwen /
doubao) should either adopt the same single-variable discipline or
explicitly `fs.realpathSync(cwd)` at the entry point. Consider
promoting this to a helper in `lib/review.mjs` or a dedicated
`lib/paths.mjs` when the second plugin lands.

### Pit 5: `(none)` skeleton defeats naive empty-diff checks

`collectReviewContext` always emits the section heading even on a clean
tree, with `(none)` as the body. A plain `!content.trim()` check never
fires. Fix: `isEmptyContext()` helper in `git.mjs` strips the skeleton
before the check.

### Pit 6: Load-bearing UX strings in markdown rules get dropped on long outputs

Phase 3 `review.md` said "if truncated, warn prominently at the top" and
"if retry used, add a footnote at the end". On 15+ finding lists the
warning and footnote went missing. Fix: promote to JSON fields
(`truncation_notice` / `retry_notice` prefilled strings) + simple
"render <field> VERBATIM" directives.

### Pit 7: `status ?? 0` collapses signal kills

`spawn` with `signal === "SIGINT"` and `status === null` must map to 130,
not 0. Phase 2 codex C1 caught the signal-to-status mapper missing.

### Pit 8: Kimi genuinely remembers small facts across resume

Phase 4 T7: `/kimi:task "remember 4242"` then `task --resume-last "what
number?"` → kimi answered "4242". Not just session-ID plumbing; real
model recall. But don't rely on it for large multi-step state — see
`kimi-prompt-antipatterns.md` pit 3.

### Pit 9: Severity enum leaks into Chinese

Kimi translates `"severity": "critical"` → `"severity": "严重"` unless
explicitly blocked. Schema validator catches it; prompt should too.

### Pit 10: SessionStart hook 5s timeout was too aggressive

First-cold-start SessionStart lifecycle hook hit the timeout on a
warm-boot laptop. Bumped to 15s. Subsequent runs cache the env-write and
finish in <1s.

### Pit 11: Adversarial prompt needs explicit anti-dialectical rules

Kimi's Chinese-language training biases it toward dialectical prose
("一方面...另一方面" / "on one hand...on the other hand"). Saying "default
to skepticism" is too soft — the model still produces balanced prose.
Fix (Phase 5 G3): add explicit negative constraints — `Do NOT use
'一方面...另一方面'. Do NOT list pros and cons. Reject dialectical summaries.`
After this change, adversarial summary literally opens with "Do not
ship." on an SQL-injection sample.

## E. CLI-integration checklist (mechanical — run before Phase 0 on next plugin)

For each item, open a probe script in `doc/probe/` and commit the result
to `probe-results.json`.

- [ ] Target CLI supports headless `-p <prompt>` / `--print`?
- [ ] JSON structured output? Flag name? Event taxonomy? Per-token, per-message, or per-turn granularity?
- [ ] `session_id` delivery path — stdout event / stderr hint / local metadata file? Does `--quiet` suppress any of them?
- [ ] `stats` / token-usage available? If dropped by printer, source-read to confirm.
- [ ] Install method — npm / pip / pipx / uv / shell-installer / brew? Post-install PATH issues?
- [ ] Auth — OAuth / API key / local credentials file? Cheapest "am I logged in?" probe?
- [ ] Config file format — JSON / TOML / YAML / custom? Any multi-file layering?
- [ ] Directory layout under `~/.<tool>/`?
- [ ] Exit-code taxonomy — Click usage=2, signal=130/143, in-band config error?
- [ ] Large-prompt delivery — `-p` accepts stdin or empty-string trick? Temp-file fallback needed?
- [ ] `--max-steps-per-turn` or equivalent step budget? Cheapest N that still ping-returns?
- [ ] Session-ID exchange under `--resume` — does session recall actually work or is it just ID plumbing?

## F. LLM-behavior checklist (the "soul" — grounds the prompt-design skill)

These surface only via live prompt experimentation. Allocate Phase 0.5 or
Phase 2 dry runs for them.

- [ ] JSON-output compliance — markdown-fence leaks? Prose preamble? Severity enum translation?
- [ ] Context-window effective utilization — quality cliff at what fraction of claimed window?
- [ ] Rate limits — RPM / TPM / concurrent session cap?
- [ ] Chinese-vs-English prompt → output language switching. Meta-language matching rule (pit 5 + antipattern 5).
- [ ] Tool-call propensity on simple Q&A — does `max-steps=1` starve a routine probe?
- [ ] Reasoning-chain / thinking-block trigger conditions + cost.
- [ ] "Can't do it" expressions — apologetic refusal / empty string / structured error / null field?
- [ ] Dialectical bias on red-team prompts — does "default to skepticism" land, or must you ban "一方面...另一方面" explicitly?

## G. Decision-fork log (cross-AI review 留痕)

Every spec-level or plan-level 3-way review produces accept / reject /
partial-accept entries. Append them here.

### Spec v0.1 (2026-04-20)

- **Accept (codex):** stream-json is native, not synthesized. UTF-8
  StringDecoder mandatory at stdio boundary.
- **Accept (codex):** session-ID via stderr regex + `kimi.json.work_dirs`
  fallback; reject global snapshot diff.
- **Accept (gemini):** skill scaffolds front-load to Phase 1/2, not
  Phase 5.
- **Accept (gemini):** re-scope to include 1-shot retry on review JSON
  parse.
- **Reject (gemini):** MVP-3 command restriction. Full parity preserved.
- **Reject (gemini):** CHANGELOG lock / rollback consensus. Over-eng for
  v0.1.

### Phase 3 plan (2026-04-20)

- **Accept (codex C-H1/H2):** per-finding required-field validator +
  schema-load try/catch before prompt build.
- **Accept (codex C-M1):** reject multiple top-level JSON values in
  extract.
- **Accept (gemini G-H1/2/3):** `isEmptyContext` helper + truncation/
  retry notices as JSON fields.

### Phase 4 plan (2026-04-20)

- **Accept (codex C-M1):** `anySession` pushed into `resolveCancelableJob`
  lib option.
- **Accept (gemini G-C1):** stop-gate scanner reads all lines, not
  strict-first.
- **Accept (gemini G-C2):** SessionStart timeout 5s → 15s.
- **Accept (gemini G-H1):** escape-hatch stderr note on review-gate
  enable.
- **Reject (gemini G-H2/M1/M2):** over-specification for v0.1.

### Phase 5 plan (2026-04-20)

- **Accept (codex C1):** `shouldUnpackBlob` must list adversarial-review
  in UNPACK_SAFE_SUBCOMMANDS + new ADVERSARIAL_REVIEW_KNOWN_FLAG regex.
- **Accept (codex C2):** RETRY_NOTICE in review.mjs must be provider-
  neutral ("The first response was malformed..." vs "Kimi's first
  response...") — shared module can't leak brand.
- **Accept (gemini G1):** phase-1-template.md added as Task 5.9 to close
  spec §6.2 "模板沉淀" commitment.
- **Accept (gemini G3):** adversarial prompt hardened with anti-
  dialectical negative constraints (ban "一方面...另一方面", ban pros-and-
  cons, reject dialectical summaries). Verified in T9: summary opens
  "Do not ship."
- **Accept (gemini G4):** T9 acceptance bar converted from eyeball-tone
  to programmatic regex (`/(do not ship|blocks|unsafe|…)/i`).
- **Accept (gemini G5):** lessons.md Appendix I with Kimi's actual
  answers to E+F checklists.
- **Accept (gemini G6):** no_changes hallucination added as antipattern
  8.
- **Accept (gemini G7):** T5 regate mandatory before tag (not T9-only).
- **Reject (codex cwd realpath):** deferred to v0.2. adversarial-review
  doesn't introduce new cwd paths; fix when it materializes.

## H. API behavior contract pits (cross-provider)

The systematic "CLI docs say one thing, actual behavior says another"
surface. Run this checklist on every new provider before writing a plan.

**Claude Code side (not provider CLI, but same surface):**
- [ ] `claude plugins install` accepts only `<plugin>@<marketplace>`, not
      a filesystem path. Dev install = `claude plugins marketplace add
      <path>` first, then `install <plugin>@<marketplace>`.

**Provider CLI side:**
- [ ] Streaming granularity — per-token / per-message / per-turn? Verify
      by inducing SIGTERM midstream and reading residual stdout.
- [ ] Content block structure — string vs typed-block list? Known
      `type` values? Unknown-type policy?
- [ ] Session-ID delivery channels + which survive `--quiet` / CI /
      non-TTY.
- [ ] Stats (token usage) — in printed events? Internal only? Which
      flag exposes?
- [ ] Path storage normalization — verbatim / absolute / symlink-resolved?
      `/tmp` vs `/private/tmp` pitfall.
- [ ] Signal handling — SIGINT / SIGTERM / SIGKILL behavior; graceful
      flush? Partial stdout recovery?
- [ ] Invalid-model reaction — instant reject vs runtime exception with
      a session artifact left behind.
- [ ] Tool-result event shape — same event channel as assistant or
      separate `role: "tool"`?
- [ ] Auth-probe minimal cost — is there a `max-steps=1` or equivalent
      zero-work ping?
- [ ] Upsert semantics — CLI creates `~/.<tool>/…` on first call or
      caller must `mkdir -p`?
- [ ] Resume-session scope — rehydrates full history / only last turn /
      only session-ID plumbing?

## I. Cross-plugin alignment review responses

Distinct from §G (our own 3-way internal review). This section records
feedback received from **sibling-plugin maintainers** after they read
our codebase, with verification results and actions. The first entry
is from the gemini-plugin-cc maintainer (v0.6.0 baseline) on 2026-04-21.

### I.1 Gemini maintainer alignment report — 2026-04-21

**Source**: `/Users/bing/-Code-/gemini-plugin-cc/docs/alignment/kimi.md`
(external to this repo; gemini plugin owns the alignment docs). Reviewer
explicitly invited technical pushback per the `receiving-code-review`
protocol.

**Verification summary** (every claim grounded in file:line):

| Claim | Verified? | Action |
|---|---|---|
| Plugin v0.1.0 | ✅ | — |
| Command surface 8/9 (no `timing`) | ✅ | — |
| `review.mjs` extracted as dedicated lib | ✅ (strength) | — |
| Exit-0-no-events multi-class diagnosis (`kimi.mjs:482-500`) | ✅ (strength) | — |
| P0 — `appendTimingHistory` is a no-op but `job-control.mjs:254,264` reads `result.timing` anyway | ✅ **verified, dead code with misleading intent** | **Fix**: either delete the read path or wire real cold/ttft/tail埋点. v0.1 choice: delete (honest). |
| P1 — A-roll detection missing (`stats.models` parse) | ✅ true, but kimi 1.36 `JsonPrinter` drops `StatusUpdate` (probe 04); cannot add without a 1.37 re-probe confirming whether result-event schema now exposes per-model usage | Defer to v0.2 after probe re-run; file as a Phase-6 task |
| P2 — no `tests/` directory | ✅ | Defer to v0.2; pair with timing work |
| P3 — `rescue.md` argument-hint uses plugin-specific wording | ✅ | Normalize in this pass |

**Where I disagree or the report was incomplete**:

1. **"推断：你还在从 gemini 骨架 fork 出来的初期阶段"** — the reviewer
   read `plugins/kimi/CHANGELOG.md` which says "0.1.0 (in progress —
   Phase 1)". That sub-CHANGELOG is stale; actual progress is v0.1
   complete + PR #1 merged to main. The authoritative CHANGELOG is at
   the repo root. **Lesson for us**: two CHANGELOGs are a drift trap —
   either sync plugin-scoped to reflect current state or deprecate it
   with a pointer to the root.

2. **"§2 首行噪声截取 ❓ 未确认"** — confirmed **not applicable** to kimi.
   Gemini CLI v0.37.1 emits a noise prefix before the first `{` on
   `stream-json`; kimi CLI is clean JSONL from the first byte (probe
   v3: `top_level_keys_observed: ["role", "content"]` with no noise
   prefix observation). Our parser doesn't need the `strip-until-first-{`
   dance — it would be speculative complexity.

3. **"§3 foreground 也生成 job ❓"** — confirmed **absent by design**. Gemini
   creates a `gfg-` prefix foreground job to unify the timing collection
   path. We don't collect timing in v0.1, so there's no unified path to
   feed — a foreground synthetic job would be pure overhead. If/when we
   do timing in v0.2, this design pattern becomes relevant.

**P1 nuance (A-roll / primary-model attestation)**: reviewer's concern
is valid (Moonshot does have "requested X, served Y" scenarios at quota
edges). But the gemini approach (`stats.models` object in `result`
event) assumes the CLI surfaces per-model accounting. Kimi 1.36's
`JsonPrinter` drops `StatusUpdate`. Before adopting gemini's `§6.3`
pattern we need a fresh probe on 1.37 to check whether the drop-path
changed. If it didn't, A-roll verification reduces to "log `requestedModel`
only; cannot verify served model" — which is weaker than gemini's
two-sided check but still worth recording.

**Methodology lesson taken from this review** (added to §D as pit
worth watching): *a stub that is imported but never produces data is
worse than no stub.* The `appendTimingHistory` case satisfied the
Phase-4 import resolver but read like real infrastructure to a reader
coming in cold. Fix is either connect it or remove it; keeping a
named function that does nothing invites callers to assume the
opposite. The gemini reviewer caught this in minutes on first read —
we'd missed it through 5-way internal review because everyone who
looked at it already knew it was a stub.

**What I'm giving back to the gemini maintainer** (for next-iteration
`baseline.md` merge):

1. Primary-model attestation (§6.3 "A-roll") needs a caveat in baseline:
   the pattern depends on the CLI emitting per-model usage in the
   `result` event. Not every sibling CLI does. Document this dependency
   as a prerequisite, not an assumption.
2. The "stale sub-CHANGELOG" trap is not kimi-specific; whatever gemini
   does for plugin-scoped vs. repo-root CHANGELOGs should be called out
   as guidance for siblings (we picked the wrong default by having both).
3. Our `review.mjs` extraction is a net positive; if gemini wants to
   refactor, our `callKimiReview` / `callKimiAdversarialReview` →
   `runReviewPipeline` indirection is the specific shape worth looking
   at (thin CLI-specific adapters, thick pipeline in shared lib).

**Phase 5 timing decision (v0.1 → v0.2 transition)**:

- **v0.1 choice**: delete the dead stub. Honestly signal "timing not collected" by absence.
- **v0.2 gate condition**: kimi-cli 1.37 re-probe must answer one question — does the `result` event surface per-model usage (analogous to gemini `stats.models`)? Kimi 1.36's `JsonPrinter` dropped `StatusUpdate` (probe 04); 1.37 may have changed.
- **If 1.37 exposes per-model**: adopt gemini §6.1 scaffold end-to-end — six-stage TimingAccumulator (cold / ttft / gen / tool / retry / tail), ndjson global history with flock + trim, `/kimi:timing` in three modes (single-job / `--history` / `--stats`). Primary-model attestation (§6.3) becomes possible.
- **If 1.37 still drops**: implement the CLI-agnostic three-stage subset — cold (spawn → first event), ttft (first event → first text-block), tail (last event → close). These need zero CLI cooperation. Primary-model attestation degrades to "log requested model; cannot verify served model" — honest partial signal, not dead stub.
- **Either way**: `tests/` directory lands together with `timing.mjs`. `sum-invariant` is algebraic and deserves unit tests — gemini has 59, we need a smaller subset tailored to whatever event-schema kimi 1.37 actually emits.
- **Cross-sibling coordination**: if minimax / qwen / doubao want comparable telemetry, they should match gemini's ndjson schema field-for-field so one aggregator works across providers.

---

## Appendix I: Kimi's actual checklist answers (gemini Phase-5-plan G5)

Sections E and F above are blank checklists for the *next* sibling plugin
to fill in. This appendix records the answers Kimi's own Phase 0–4 probes
produced, so future readers can see concrete examples of what "answering
the checklist" looks like.

### E answers (CLI-integration)

| Question | Kimi 1.36 answer |
|---|---|
| Headless `-p`? | Yes: `kimi -p "<prompt>" --print --output-format stream-json`. Empty `-p ""` rejected; use `--input-format text` + stdin. |
| JSON output taxonomy | Per-turn JSONL (one event per fully-emitted message); no typed `init`/`message`/`result` envelope — role-based (`{role:"assistant",content:[blocks]}` / `{role:"tool",...}`). |
| `session_id` delivery | Primary: stderr regex `/kimi -r ([0-9a-f-]{36})/` (not suppressed by `--quiet`). Secondary: `~/.kimi/kimi.json.work_dirs[].last_session_id` keyed by verbatim `-w` path. |
| Stats availability | Token usage internally tracked but `JsonPrinter` drops via `case _: pass`. No flag exposes it; v0.1 renders nothing. |
| Install method | Official: shell installer script. Alt: `uv tool install --python 3.13 kimi-cli` (explicit Python pin avoids 3.12/3.11 mismatch). Fallback: `pipx install kimi-cli` (PATH may not auto-resolve). |
| Auth | `~/.kimi/credentials/` non-empty + ping-call success. `kimi login` is interactive only — `/kimi:setup` cannot automate. |
| Config format | TOML (`~/.kimi/config.toml`); top-level key `default_model`. |
| Directory layout | `~/.kimi/{config.toml, kimi.json, credentials/, sessions/<md5(path)>/<uuid>/, logs/}` — sessions is TWO-LEVEL (work_dir hash / session uuid). |
| Exit codes | 0 OK, 1 LLM-not-set, 2 Click usage error (Unicode boxed stderr), 130 SIGINT, 143 SIGTERM. |
| Large-prompt path | `--input-format text` + piped stdin. `LARGE_PROMPT_THRESHOLD_BYTES = 100_000`. |
| `--max-steps-per-turn` | `PING_MAX_STEPS = 1` works for ping. Rescue uses default (unbounded / kimi-controlled). |
| Session recall under `--resume` | Real (not just plumbing). T7 confirmed kimi remembered "4242" across resume. Caveat: multi-step tool state is unreliable. |

### F answers (LLM-behavior)

> **⚠ Calibration note** (kimi 4-way-review H1, self-reported by Kimi-as-reviewer): The rate percentages below are **qualitative bands from Phase 2–3 dry runs with n ≈ 10–15 samples** (not calibrated benchmarks from a test suite). Treat as directional signals, not regression baselines; if a future phase sees "30% markdown fence rate" that is within noise, not a degradation. When sibling plugins run their own Phase-0 probes they should re-measure against their own provider + model + prompt pair and record fresh numbers.

| Question | Kimi v1-128k answer |
|---|---|
| JSON compliance | Weak. Markdown fence ~25% of raw runs; `好的，这是 JSON：` preamble ~15%; severity enum translation to Chinese ~35% without explicit ban. Strict negative rules + schema validator catch all three. |
| Context window effective use | Not empirically bounded in v0.1. Observed good quality up to ~50K prompt. Future probes should test 128K ceiling. |
| Rate limits | Not observed during v0.1 probes (single-caller, low volume). |
| Chinese/English switch | Meta-language matching rule: if user prompt is Chinese, meta-language (task framing, contracts) should be Chinese. JSON keyword enforcement stays English. Mismatch causes unpredictable output language. |
| Tool-call propensity | High. Ping without `--max-steps-per-turn 1` burns 5–6 steps before giving up. |
| Reasoning chain | Emitted as `content[].type === "think"` blocks; dropped by default extractor. `think` blocks observed especially on review tasks. |
| Refusal expression | Terse apologetic Chinese prose ("抱歉，我无法..."). Does not produce structured error. Treat as "low-confidence finding" rather than hard fail. |
| Dialectical bias on red-team | Strong. "Default to skepticism" alone insufficient. Must add negative constraints banning "一方面...另一方面" / pros-and-cons framing. After Phase 5 G3 fix, adversarial output opens "Do not ship." on a shared SQL-injection sample. |

## Appendix II: Phase tag map

| Tag | Commit | Summary |
|---|---|---|
| `phase-0-final` | 18276a0 | Probes 01-06 done; probe-results.json v3 authoritative |
| `phase-1-skeleton` | 23f625f | Repo skeleton; `/kimi:setup` passes via marketplace install |
| `phase-2-ask` | b5ed35f | `/kimi:ask` + streaming; T2/T3/T4 PASS |
| `phase-2-polish` | cc71b7c | 3-way review integrated (codex C1/H1/H2 + gemini G-C1/H1/H3) |
| `phase-3-review` | ff1fc69 | `/kimi:review` + 1-shot retry; T5 PASS |
| `phase-3-polish` | 3a8af73 | Post-review polish (codex C-H1/L1 + gemini G-H1/H2/H3/M2/M3) |
| `phase-4-background` | 52f1091 | `/kimi:rescue` + background + agent + hooks; T6/T7 PASS |
| `phase-4-polish` | 75ae5fe | Post-review polish (codex C-M1 + gemini G-H1) |
| `phase-5-final` | (set by Task 5.10) | Adversarial-review + review.mjs extraction + skill + lessons.md + phase-1-template; T9 + T5-regate PASS; v0.1 frozen |
