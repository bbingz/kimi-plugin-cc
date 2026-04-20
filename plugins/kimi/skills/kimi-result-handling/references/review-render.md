# /kimi:review rendering rationale

Command file `plugins/kimi/commands/review.md` holds the concrete rules (JSON shape, presentation steps, severity badges, sort order). This reference explains the WHY — background rationale that wouldn't fit in the command file's frontmatter-bounded budget.

## Why the retry exists

Kimi's first-shot JSON compliance is historically uneven (spec §4.2; empirical observations include markdown fences, "好的，这是 JSON：" prose preambles, and Chinese severity translations). The companion tries ONCE more with an error hint appended. The retry prompt is sent on the SAME session via `--resume <sid>` — best-effort nudge so kimi sees its prior malformed output and corrects in place rather than re-reasoning from scratch.

UX: if `retry_used === true` and `ok === true`, surface discreetly at the END of the rendered output ("Kimi's first response was malformed; the retry succeeded.") — signals something minor happened without distracting from findings. If `retry_used === true` and `ok === false`, escalate prominently — both attempts failed, and the raw texts (`firstRawText` + `rawText`) help operators debug.

Operator breadcrumb: a stderr warning "kimi review response failed parse/validation; retrying once..." fires before the retry, so background-job logs record the retry rate over time (gemini v1-review G-L3).

## Why severity is English-only

Kimi priors may produce Chinese severity labels ("严重", "高", "中", "低") because the reviewed code is often Chinese-authored. The schema + validator enforce `critical|high|medium|low` as the exact English strings (gemini v1-review G-M1). A translated severity triggers a retry; the retry prompt restates the enum explicitly.

## Why partial findings are rejected

The prompt tells kimi: "fill ALL required fields for findings you include; omit the entire finding if you can't fill them." This prevents half-filled objects (e.g. severity-only, or no line numbers) that the user can't act on. Validation rejects any finding missing: severity, title, body, file, line_start, line_end, confidence, recommendation (codex v1-review C-H1).

## Why truncation is a top-of-render warning

For diffs >150 KB, the kimi call reviews only the first 150 KB slice. Findings returned don't cover the tail. If the warning is buried under the findings list, users assume the review is comprehensive (gemini v1-review G-M3). The command file therefore requires the warning to appear BEFORE verdict/summary — breaking the usual "summary first" pattern is the right tradeoff.

## Non-findings shapes

Two shapes bypass the standard `{verdict, summary, findings, next_steps}` payload:

- **Empty diff fast path**: `{ok: true, verdict: "no_changes", response: "No changes to review.", truncated: false}` — no kimi call. The schema's `verdict` enum accepts `no_changes` specifically for this shape; the validator also accepts it but `buildReviewPrompt` tells kimi NEVER to produce `no_changes` (it's companion-side only).
- **Failure after retry**: `{ok: false, error, rawText?, parseError?, firstRawText?, transportError?, truncated, retry_used, sessionId?}` — all fields nullable except the 4 that are always present (`ok`, `error`, `truncated`, `retry_used`). `transportError` carries the original callKimi status + partialResponse when the failure was at the kimi call level, not at parse/validation.

## Comparison with Claude's own `/review`

When the user has run Claude's built-in `/review` earlier in the conversation:
- **Both found**: overlapping findings (likely real issues) — surface first.
- **Only Kimi**: unique to Kimi — may reflect different priors or language-specific intuition.
- **Only Claude**: unique to Claude — may reflect different priors or blind spots.

Do NOT auto-pick; present three buckets and let the user prioritize.

## Absolutely no auto-fix

Even `low`-severity findings stay read-only until the user asks. Ask one question when multiple issue clusters exist ("Address the SQL injection first? Then the missing tests?"), not a shotgun prompt.
