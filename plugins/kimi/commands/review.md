---
description: Run a Kimi code review on the current diff
argument-hint: '[--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--model <model>] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run:

```bash
KIMI_COMPANION_CALLER=claude node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" review "$ARGUMENTS"
```

The companion always emits JSON to stdout matching `plugins/kimi/schemas/review-output.schema.json`. Parse it and present to the user.

**Top-level fields:**
- `ok`: true / false
- `verdict`: `"approve"` | `"needs-attention"` | `"no_changes"` — note: `"no_changes"` is emitted ONLY by the companion when the diff is empty; kimi itself returns only `approve` or `needs-attention`.
- `summary`: one-paragraph overview
- `findings`: array of finding objects (severity, title, body, file, line_start, line_end, confidence, recommendation)
- `next_steps`: array of recommended actions
- `truncated`: whether the diff was cut off
- `truncation_notice`: prefilled warning string when `truncated: true`, otherwise `null` — render VERBATIM at the very top of the output
- `retry_used`: whether the first response required a retry
- `retry_notice`: prefilled discreet footnote when `retry_used: true`, otherwise `null` — render VERBATIM at the very END of the output

**If `verdict === "no_changes"`**: tell the user "No changes to review." and stop.

**If `ok === false`**: show `error`, `rawText` (if present, clipped to 500 chars), and note whether a retry was used. Do NOT auto-retry — the companion already tried once. Suggest running `/kimi:review --scope staged` or reducing diff size.

**If `ok === true` and `findings` is non-empty:**
1. **If `truncation_notice` is non-null, render it VERBATIM at the very TOP before any verdict, summary, or findings.** Do NOT rewrite or summarize the notice string — the companion prefilled it and relies on Claude rendering it unchanged. (Gemini Phase-3-review G-H2: long findings lists cause this warning to get buried when expressed as a rule instead of a data field.)
2. Present the `verdict` and `summary` prominently.
3. Sort findings by severity (`critical > high > medium > low`), then by `file` (alphabetical), then by `line_start` (ascending).
4. For each finding, show:
   - Severity badge (e.g. 🔴 critical, 🟠 high, 🟡 medium, 🔵 low — or plain text if the user dislikes emoji).
   - Title.
   - `file:line_start` (or `file:line_start-line_end` if the range spans).
   - Body verbatim.
   - Recommendation.
5. List `next_steps`.
6. **If `retry_notice` is non-null, render it VERBATIM at the very END after `next_steps`.** Do NOT paraphrase. (Gemini Phase-3-review G-H3: long outputs cause the model to drop the footnote when expressed as a rule.)
7. If Claude's own `/review` already ran earlier this conversation, compare findings: both-found, only-kimi, only-claude buckets.

**Do NOT auto-fix any issues.** Ask the user which items to address. One question at a time if multiple clusters.

### Options

- `--base <ref>` — base ref for `branch` scope (defaults to auto-detected main/master)
- `--scope <...>` — `auto` (default; local mods first, then branch diff), `staged`, `unstaged`, `working-tree`, `branch`
- `--model <name>` — override default model (see `/kimi:setup`)
- `[focus ...]` — optional focus keywords appended to the prompt (e.g. `auth middleware`)
