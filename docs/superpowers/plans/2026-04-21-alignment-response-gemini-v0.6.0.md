# Plan: gemini-plugin-cc v0.6.0 alignment-review response

**Authoring context**: 2026-04-21, post-PR-#1-merge. bbing received a cross-plugin alignment report from the gemini-plugin-cc maintainer (v0.6.0 baseline). Every claim was file:line-verified in a prior session; this plan is the agreed execution of 11 concrete changes. Full verification rationale + disagreement notes already landed in `lessons.md §I.1` (commit `<already-present-at-HEAD>`).

**Executor**: codex (handoff from Claude). Claude will verify on 2026-04-22.

**Repo**: `/Users/bing/-Code-/kimi-plugin-cc` · branch `main` · expected HEAD at start: `78aeb25` (title: "docs: lessons §I.1 + gitignore .claude/ (baseline for alignment response)") · origin: `https://github.com/bbingz/kimi-plugin-cc`

**Source of truth (the review we're responding to)**: `/Users/bing/-Code-/gemini-plugin-cc/docs/alignment/kimi.md` (external to this repo; gemini maintainer owns it).

---

## Ground rules

1. **One commit** covering all 11 tasks. No amends. No force-push.
2. **Never skip hooks** (`--no-verify`) unless a hook fails and the root cause is itself in-scope.
3. **Stop on any failure**: print the raw error, do NOT roll back, do NOT workaround. Claude will pick up the pieces.
4. **No scope creep**: do not add timing telemetry, `tests/`, prompt abstractions, or anything the plan does not name explicitly. The reviewer's deferred items are deferred on purpose (see §6).
5. **Work on `main`**: if HEAD has moved past `4b1fd5e`, re-verify the exact line numbers in each task before editing — they may have drifted.

---

## Precondition check (run first, STOP if any fail)

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git rev-parse --abbrev-ref HEAD                         # expect: main
git log --oneline -1                                     # expect starts with: 78aeb25
git remote get-url origin                                # expect: https://github.com/bbingz/kimi-plugin-cc (or .git)
node --version                                           # expect: v18+ (v25 is fine)

# Working tree note: this plan doc is untracked; Claude wrote it but
# deliberately did not commit it — codex's commit includes it as one of
# the 10 changes. The ONLY acceptable untracked file at precondition time is:
#   docs/superpowers/plans/2026-04-21-alignment-response-gemini-v0.6.0.md
# .claude/ is now gitignored (committed in 78aeb25).
# Any other dirty / untracked content is a surprise — STOP.
git status --short                                       # expect: ?? docs/superpowers/plans/2026-04-21-alignment-response-gemini-v0.6.0.md (and nothing else)
```

If the branch is not `main`, HEAD is not at `78aeb25`, or `git status` shows anything other than the single untracked plan doc: STOP and leave a note for bbing.

---

## Task 1 — P0 delete dead timing read path (`job-control.mjs`)

**File**: `plugins/kimi/scripts/lib/job-control.mjs`

### 1a — Remove `appendTimingHistory` from the import list

Current lines 7–19:
```js
import {
  appendTimingHistory,
  ensureStateDir,
  generateJobId,
  listJobs,
  readJobFile,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  updateState,
  upsertJob,
  writeJobFile,
} from "./state.mjs";
```

Delete the `  appendTimingHistory,` line. Also verify `readTimingHistory` and `resolveTimingHistoryFile` are not present in this import (if they are, remove those too — at time of authoring only `appendTimingHistory` was listed).

### 1b — Remove the `const timing = result.timing || null;` read

Current line 254 (inside `runStreamingWorker`):
```js
  const timing = result.timing || null;
```

Delete the whole line plus the blank line immediately above it if that leaves a double-blank. The four lines above for context:
```js
  const status = result.ok ? "completed" : "failed";
  const phase = result.ok ? "done" : "failed";
  const kimiSessionId = result.sessionId || null;

  const timing = result.timing || null;
```

After edit:
```js
  const status = result.ok ? "completed" : "failed";
  const phase = result.ok ? "done" : "failed";
  const kimiSessionId = result.sessionId || null;
```

### 1c — Remove the `timing,` field from `writeJobFile`

Current lines 256–262:
```js
  writeJobFile(workspaceRoot, jobId, {
    id: jobId,
    status,
    result,
    timing,
    completedAt: now,
  });
```

Delete the `    timing,` line:
```js
  writeJobFile(workspaceRoot, jobId, {
    id: jobId,
    status,
    result,
    completedAt: now,
  });
```

### 1d — Remove the `if (timing) { … appendTimingHistory(…) }` branch

Current lines 264–274:
```js
  if (timing) {
    const jobRecord = listJobs(workspaceRoot).find((j) => j.id === jobId);
    appendTimingHistory({
      ts: now,
      jobId,
      kind: jobRecord?.kind || "task",
      workspace: workspaceRoot,
      sessionId: process.env[SESSION_ID_ENV] || null,
      timing,
    });
  }
```

Delete the entire block (all 11 lines, including the blank line above it if present). Verify afterwards that no `jobRecord` reference remains that depended on this block.

---

## Task 2 — P0 delete three timing stubs (`state.mjs`)

**File**: `plugins/kimi/scripts/lib/state.mjs`

Current lines 339–358:
```js
// ── Timing history stubs (Phase 4 import resolver) ─────────
//
// Gemini's state.mjs records timing per-job for operator dashboards. Kimi has
// no equivalent stats surface (probe 04: JsonPrinter drops StatusUpdate), so
// we export inert stubs to satisfy job-control.mjs's import set without
// fabricating data. Phase 5+ may wire real timing if kimi exposes it.

export function resolveTimingHistoryFile() {
  return path.join(os.homedir(), ".claude", "plugins", "kimi", "timing-history.jsonl");
}

export function appendTimingHistory(_record) {
  // Intentional no-op in v0.1 — we have no timing data to record.
  return;
}

export function readTimingHistory() {
  // Intentional empty result in v0.1. Callers must handle empty arrays.
  return [];
}
```

Delete the entire block (lines 339–358 plus trailing newline). Do not leave a dangling comment header. The file should end cleanly at `setConfig`'s closing brace + one trailing newline.

---

## Task 3 — P3a `rescue.md` argument-hint provider-neutral

**File**: `plugins/kimi/commands/rescue.md`

Line 3, current:
```yaml
argument-hint: "[--background|--wait] [--resume-last|--fresh] [--model <model>] [what Kimi should investigate, solve, or continue]"
```

Change two things: (1) double quotes → single quotes (Task 4), (2) `what Kimi should investigate` → `what to investigate`.

Final line 3:
```yaml
argument-hint: '[--background|--wait] [--resume-last|--fresh] [--model <model>] [what to investigate, solve, or continue]'
```

Do NOT touch any other line in this file (the body still says "Kimi" because that's Kimi-specific prose, not a generic template).

---

## Task 4 — P3b (covered inside Task 3)

YAML quote normalization was done inline in Task 3. Verification: after Task 3, `grep '^argument-hint:' plugins/kimi/commands/*.md` should show every line starting with `argument-hint: '` (single quote). There should be zero `argument-hint: "` in the command directory.

---

## Task 5 — P3c `adversarial-review.md` option ordering

**File**: `plugins/kimi/commands/adversarial-review.md`

Line 3, current:
```yaml
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|staged|unstaged|branch] [--model <model>] [focus ...]'
```

Swap `[--wait|--background]` → `[--background|--wait]`. Final:
```yaml
argument-hint: '[--background|--wait] [--base <ref>] [--scope auto|working-tree|staged|unstaged|branch] [--model <model>] [focus ...]'
```

---

## Task 6 — §5.2 auth boundary in cli-runtime SKILL.md

**File**: `plugins/kimi/skills/kimi-cli-runtime/SKILL.md`

Current "Runtime requirements" section (lines 10–15):
```md
## Runtime requirements

- `kimi` CLI ≥ 1.34 on PATH (dev box verified against 1.36.0 and 1.37.0)
- `~/.kimi/credentials/` non-empty (user ran `kimi login` interactively)
- Node.js ≥ 18
- Zero npm dependencies — plugin uses only Node built-ins
```

After the `~/.kimi/credentials/` bullet, insert one new bullet on its own line:

```md
- Auth is **100% CLI-managed** — the companion never injects `KIMI_API_KEY` or similar env vars; `kimi login` writes `~/.kimi/credentials/` (OAuth refresh-token handled by kimi-cli itself). The plugin is zero-coupled to Moonshot's auth model — rotating tokens is `kimi logout && kimi login`, no plugin work required.
```

Final block:
```md
## Runtime requirements

- `kimi` CLI ≥ 1.34 on PATH (dev box verified against 1.36.0 and 1.37.0)
- `~/.kimi/credentials/` non-empty (user ran `kimi login` interactively)
- Auth is **100% CLI-managed** — the companion never injects `KIMI_API_KEY` or similar env vars; `kimi login` writes `~/.kimi/credentials/` (OAuth refresh-token handled by kimi-cli itself). The plugin is zero-coupled to Moonshot's auth model — rotating tokens is `kimi logout && kimi login`, no plugin work required.
- Node.js ≥ 18
- Zero npm dependencies — plugin uses only Node built-ins
```

---

## Task 7 — §5.5 `prompts.mjs` module-level rationale comment

**File**: `plugins/kimi/scripts/lib/prompts.mjs`

Current content (whole file, 13 lines):
```js
import fs from "node:fs";
import path from "node:path";

export function loadPromptTemplate(rootDir, name) {
  const promptPath = path.join(rootDir, "prompts", `${name}.md`);
  return fs.readFileSync(promptPath, "utf8");
}

export function interpolateTemplate(template, variables) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : "";
  });
}
```

Prepend this block to the very top of the file (before the `import` lines):

```js
// This module intentionally stays small (~440 bytes). Review-flow prompts
// live in review.mjs (buildReviewPrompt / buildAdversarialPrompt); ask and
// rescue prompts pass through verbatim to the CLI. No prompt-template
// abstraction is planned for v0.1 — if a sibling plugin needs to centralize
// prompts, do it in its own <llm>.mjs rather than forcing the abstraction
// up here. (Rationale added in response to gemini-plugin-cc alignment
// review §5.5.)

```

(Keep the blank line between the comment and the first `import`.)

---

## Task 8 — §5.3 extend `lessons.md §I.1` with Phase-5 timing decision

**File**: `lessons.md`

Section I.1 already exists as of HEAD `78aeb25` (landed in commit "docs: lessons §I.1 + gitignore .claude/ (baseline for alignment response)"). It currently ends with a list titled **What I'm giving back to the gemini maintainer** followed by a `---` separator line and then the Appendix I heading.

Find the line that says exactly:
```md
3. Our `review.mjs` extraction is a net positive; if gemini wants to
   refactor, our `callKimiReview` / `callKimiAdversarialReview` →
   `runReviewPipeline` indirection is the specific shape worth looking
   at (thin CLI-specific adapters, thick pipeline in shared lib).
```

Insert (AFTER that list item, BEFORE the blank line + `---` separator):

```md

**Phase 5 timing decision (v0.1 → v0.2 transition)**:

- **v0.1 choice**: delete the dead stub. Honestly signal "timing not collected" by absence.
- **v0.2 gate condition**: kimi-cli 1.37 re-probe must answer one question — does the `result` event surface per-model usage (analogous to gemini `stats.models`)? Kimi 1.36's `JsonPrinter` dropped `StatusUpdate` (probe 04); 1.37 may have changed.
- **If 1.37 exposes per-model**: adopt gemini §6.1 scaffold end-to-end — six-stage TimingAccumulator (cold / ttft / gen / tool / retry / tail), ndjson global history with flock + trim, `/kimi:timing` in three modes (single-job / `--history` / `--stats`). Primary-model attestation (§6.3) becomes possible.
- **If 1.37 still drops**: implement the CLI-agnostic three-stage subset — cold (spawn → first event), ttft (first event → first text-block), tail (last event → close). These need zero CLI cooperation. Primary-model attestation degrades to "log requested model; cannot verify served model" — honest partial signal, not dead stub.
- **Either way**: `tests/` directory lands together with `timing.mjs`. `sum-invariant` is algebraic and deserves unit tests — gemini has 59, we need a smaller subset tailored to whatever event-schema kimi 1.37 actually emits.
- **Cross-sibling coordination**: if minimax / qwen / doubao want comparable telemetry, they should match gemini's ndjson schema field-for-field so one aggregator works across providers.
```

Preserve the `---` separator + Appendix I heading that follow — they should not move.

---

## Task 9 — housekeeping: `plugins/kimi/CHANGELOG.md` forward-ref

**File**: `plugins/kimi/CHANGELOG.md`

This sub-CHANGELOG is currently stale (says "0.1.0 in progress — Phase 1"). The gemini reviewer was misled by it into thinking progress was at Phase 1 (actual: v0.1 complete + PR #1 merged). Overwrite the entire file contents with:

```md
# kimi plugin CHANGELOG

## 0.1.0 — see repo-root CHANGELOG.md for authoritative history

This sub-CHANGELOG is intentionally minimal. v0.1 development history,
post-v0.1 review integration, and ongoing collaboration entries all live
at the repo-root `CHANGELOG.md`. This file is retained only so tooling
that hard-codes `plugins/kimi/CHANGELOG.md` as a path still finds a
valid file.
```

(Use `Write` tool or equivalent; do not leave any of the old Phase-1 log lines.)

---

## Task 10 — root `CHANGELOG.md` response entry

**File**: `CHANGELOG.md` (repo root)

Current top of file:
```md
# CHANGELOG

Reverse-chronological, flat format. Cross-AI collaboration log (Claude/Codex/Gemini).

## 2026-04-21 [Claude Opus 4.7 — P0 K2.5 naming correction + P1 1.37 flag inventory]
```

Insert the following new entry BETWEEN the header paragraph and the existing `## 2026-04-21 [Claude Opus 4.7 — P0 K2.5 naming correction …]` entry:

```md
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
```

---

## Verification checklist (run after edits, before commit)

```bash
# 1. Syntax: every .mjs under plugins/kimi/scripts must pass node --check
for f in plugins/kimi/scripts/*.mjs plugins/kimi/scripts/lib/*.mjs; do
  node --check "$f" || { echo "SYNTAX FAIL: $f"; exit 1; }
done
echo "syntax: all clean (11 files)"

# 2. Dead-code grep: zero residual timing symbol references in scripts/
grep -rn "appendTimingHistory\|readTimingHistory\|resolveTimingHistoryFile\|result\.timing" plugins/kimi/scripts/ \
  && { echo "FAIL: residual timing symbols"; exit 1; } \
  || echo "timing-residue: zero (expected)"

# 3. Frontmatter quote consistency: all argument-hint lines use single quotes
count_double=$(grep -c '^argument-hint: "' plugins/kimi/commands/*.md | awk -F: '{s+=$2} END{print s+0}')
count_single=$(grep -c "^argument-hint: '" plugins/kimi/commands/*.md | awk -F: '{s+=$2} END{print s+0}')
[ "$count_double" = "0" ] && [ "$count_single" = "8" ] \
  && echo "frontmatter: 8 single-quoted, 0 double-quoted (expected)" \
  || { echo "FAIL: quote counts double=$count_double single=$count_single"; exit 1; }

# 4. Option ordering: no [--wait|--background] residue
grep -rn '\[--wait|--background\]' plugins/kimi/commands/ \
  && { echo "FAIL: residual [--wait|--background]"; exit 1; } \
  || echo "option-ordering: unified on [--background|--wait] (expected)"

# 5. Scope sanity: 9 tracked files modified + 1 untracked plan doc = 10 in `git diff --cached` after `git add`.
#    Refuse if >12 (accidental sprawl).
git add \
  plugins/kimi/scripts/lib/job-control.mjs \
  plugins/kimi/scripts/lib/state.mjs \
  plugins/kimi/scripts/lib/prompts.mjs \
  plugins/kimi/commands/rescue.md \
  plugins/kimi/commands/adversarial-review.md \
  plugins/kimi/skills/kimi-cli-runtime/SKILL.md \
  plugins/kimi/CHANGELOG.md \
  lessons.md \
  CHANGELOG.md \
  docs/superpowers/plans/2026-04-21-alignment-response-gemini-v0.6.0.md
staged=$(git diff --cached --name-only | wc -l | tr -d ' ')
[ "$staged" = "10" ] \
  && echo "diff scope: $staged files staged (expected)" \
  || { echo "FAIL: staged $staged files (expected 10) — review"; exit 1; }

git diff --cached --stat
```

If any check exits non-zero: STOP. Leave the working tree as-is, do not revert, do not commit. bbing will pick it up.

---

## Commit

```bash
git add \
  plugins/kimi/scripts/lib/job-control.mjs \
  plugins/kimi/scripts/lib/state.mjs \
  plugins/kimi/scripts/lib/prompts.mjs \
  plugins/kimi/commands/rescue.md \
  plugins/kimi/commands/adversarial-review.md \
  plugins/kimi/skills/kimi-cli-runtime/SKILL.md \
  plugins/kimi/CHANGELOG.md \
  lessons.md \
  CHANGELOG.md \
  docs/superpowers/plans/2026-04-21-alignment-response-gemini-v0.6.0.md

git commit -m "$(cat <<'EOF'
fix: alignment-review response to gemini v0.6.0 maintainer (11 items)

Gemini-plugin-cc maintainer (v0.6.0 baseline) filed an alignment report
against kimi v0.1.0. Every claim was file:line-verified by Claude on
2026-04-21. This commit integrates 11 concrete changes across P0 / P3 /
§5 clarifications / housekeeping. Plan doc:
docs/superpowers/plans/2026-04-21-alignment-response-gemini-v0.6.0.md

P0 — delete dead timing read path:
  - state.mjs: drop three stub exports (appendTimingHistory,
    readTimingHistory, resolveTimingHistoryFile) + header comment
  - job-control.mjs: drop result.timing read, timing write into
    job file, if (timing) appendTimingHistory branch, and the
    import. v0.1 now honestly signals "timing not collected"
    rather than "collected but always empty".

P3 — command-contract polish:
  - rescue.md argument-hint provider-neutral wording
  - rescue.md frontmatter single quotes (was double)
  - adversarial-review.md option order [--background|--wait]

§5 — clarifications requested by reviewer:
  §5.1 Phase-N definitions — pointer in root CHANGELOG to
       docs/superpowers/specs/... and phase-1-template.md
  §5.2 Auth boundary — cli-runtime SKILL.md explicit: plugin is
       zero-coupled to Moonshot auth; ~/.kimi/credentials is
       CLI-managed via `kimi login`
  §5.3 Phase-5 timing plan — lessons.md §I.1 extended with v0.2
       gate condition (kimi 1.37 per-model re-probe) and
       branching plan (6-stage if exposed, 3-stage subset if not)
  §5.5 prompts.mjs small-size rationale — module comment explains
       review prompts live in review.mjs; no v0.1 abstraction

Housekeeping:
  - plugins/kimi/CHANGELOG.md: stale "Phase 1 in progress"
    replaced with forward-reference to repo-root CHANGELOG
    (drift trap that misled the reviewer).

Not in this commit (rationale in lessons.md §I.1):
  - P1 A-roll / primary-model attestation (needs kimi 1.37 re-probe)
  - P2 tests/ directory (pairs with v0.2 timing)
  - gemini gfg- foreground-job pattern (needs timing to justify)

Verification: node --check clean on all 11 plugins/kimi/scripts/**.mjs;
grep finds zero residual timing-symbol references; 8 commands all
single-quoted with unified [--background|--wait] ordering.
EOF
)"
```

---

## Push

```bash
git push origin main
```

If push rejects (e.g. origin moved): STOP. Do not `git pull --rebase`. Do not force. Leave local commit in place and print the rejection reason. bbing will reconcile.

---

## Final report (for bbing to see in morning)

After everything succeeds, echo the following summary block:

```
========================================
alignment-response-gemini-v0.6.0 — DONE
========================================
Tasks 1–10: all applied
Verification: all checks pass
Commit SHA: <git rev-parse HEAD>
Push: origin/main <ahead-by-0-after-push>
git log --oneline -3:
<output>
Files changed: <output of git diff --stat HEAD~1>
========================================
```

If anything failed at any step, replace the summary with the failing step + raw error and DO NOT proceed past that step.

---

## Out-of-scope (do NOT do, even if tempted)

- ❌ Implement any of the 6-stage timing accumulator — v0.2 material.
- ❌ Create a `tests/` directory — v0.2 material.
- ❌ Add `show_thinking`, `--quiet` mode, or any other kimi-cli flag not already used.
- ❌ Touch `@moonshot-ai/kimi-agent-sdk` wiring — 0.0.3 SDK, deferred.
- ❌ Modify any probe files (`doc/probe/*`) — those are snapshot artifacts.
- ❌ Rename `/kimi:*` commands or change their entry points.
- ❌ `git pull --rebase` or `git fetch --prune` — if origin moved, STOP.
- ❌ Force-push, amend, or skip hooks under any circumstance.

---

## On failure

- If any single task's edit fails (file missing, line shifted, syntax error), STOP immediately.
- Do NOT revert the successful tasks — bbing can inspect partial progress.
- Do NOT attempt alternate paths ("maybe I'll patch it differently") — the plan is the contract.
- Write a single summary line to stdout: `FAILED at Task N: <reason>`.
- Exit with non-zero status so the caller knows.

Claude will see the partial state on 2026-04-22 verification and decide how to proceed.
