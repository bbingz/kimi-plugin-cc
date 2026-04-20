---
description: Run an adversarial Kimi review that challenges the implementation
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|staged|unstaged|branch] [--model <model>] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run:

```bash
KIMI_COMPANION_CALLER=claude node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" adversarial-review "$ARGUMENTS"
```

The companion always emits JSON to stdout matching `plugins/kimi/schemas/review-output.schema.json`. Parse it and present to the user.

This command is review-only: do NOT apply patches or suggest you are about to make changes. Your only job is to run the command and render Kimi's output.

**Top-level fields (same shape as /kimi:review):**
- `ok`: true / false
- `verdict`: `"approve"` | `"needs-attention"` | `"no_changes"` — `"no_changes"` is companion-only on empty diffs.
- `summary`: one-paragraph ship/no-ship assessment (adversarial framing — terse, skeptical)
- `findings`: array of finding objects
- `next_steps`: array of recommended actions
- `truncated`: whether the diff was cut off
- `truncation_notice`: prefilled warning string when `truncated: true`, otherwise `null` — render VERBATIM at the very top of the output
- `retry_used`: whether the first response required a retry
- `retry_notice`: prefilled discreet footnote when `retry_used: true`, otherwise `null` — render VERBATIM at the very END of the output

**If `verdict === "no_changes"`**: tell the user "No changes to review." and stop.

**If `ok === false`**: show `error`, `rawText` (if present, clipped to 500 chars), and note whether a retry was used. Do NOT auto-retry — the companion already tried once. Suggest running `/kimi:adversarial-review --scope staged` or reducing diff size.

**If `ok === true` and `findings` is non-empty:**
1. **If `truncation_notice` is non-null, render it VERBATIM at the very TOP before any verdict, summary, or findings.** Do NOT rewrite. (Phase-3-review G-H2.)
2. Present the `verdict` and `summary` prominently — the adversarial summary is a deliberate ship/no-ship assessment; do not soften it.
3. Sort findings by severity (`critical > high > medium > low`), then by `file` (alphabetical), then by `line_start` (ascending).
4. For each finding, show: severity badge, title, `file:line_start` (or range), body verbatim, recommendation.
5. List `next_steps`.
6. **If `retry_notice` is non-null, render it VERBATIM at the very END after `next_steps`.** Do NOT paraphrase. (Phase-3-review G-H3.)
7. If `/kimi:review` already ran earlier in this conversation, compare findings: both-found (high agreement = real), only-adversarial (potential over-skepticism — still show), only-/kimi:review (potential under-skepticism — also show).

**Execution mode:**
- If `$ARGUMENTS` contains `--wait`, foreground.
- If `$ARGUMENTS` contains `--background`, background.
- Otherwise: estimate size (`git status --short` for working-tree; `git diff --shortstat <base>...HEAD` for branch scope). Recommend background for anything beyond 1–2 files; otherwise foreground. Use `AskUserQuestion` exactly once with the recommended option first.

Background flow returns a `{jobId, pid}` submission. After launching: "Kimi adversarial review started in the background. Check `/kimi:status` for progress."

**Do NOT auto-fix any issues.** Ask the user which items to address. One question at a time if multiple clusters.

### Options

- `--base <ref>` — base ref for `branch` scope (defaults to auto-detected main/master)
- `--scope <...>` — `auto` (default), `staged`, `unstaged`, `working-tree`, `branch`
- `--model <name>` — override default model (see `/kimi:setup`)
- `[focus ...]` — optional focus keywords appended to the prompt (e.g. `auth middleware`)
- `--wait` / `--background` — execution mode override (default: size-based recommendation)
