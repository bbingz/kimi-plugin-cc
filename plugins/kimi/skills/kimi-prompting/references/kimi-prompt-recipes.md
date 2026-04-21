# Kimi Prompt Recipes

Starting templates for Kimi task prompts, grounded in Phase 2–4 observations
with `kimi -p "…" --print --output-format stream-json`. Copy the smallest
recipe that fits; trim anything unused.

## Ask (one-shot Q&A)

Default for `/kimi:ask`. Single-turn bias, no tool-use expectation.

```xml
<task>
Answer the following question using only the information provided.
Be concrete; do not hedge unless uncertainty is material.
</task>

<compact_output_contract>
Return a direct answer in under 6 sentences.
If the question admits multiple valid answers, list them numbered; otherwise give one.
Do not prefix the answer with "好的" / "Here's the answer" / "Sure".
</compact_output_contract>

<question>
[user's literal prompt goes here]
</question>
```

## Review (balanced diff review)

Used by `buildReviewPrompt` in `kimi.mjs`. The strict-output rules block is
load-bearing — see `kimi-prompt-antipatterns.md` for why each line exists.

```xml
<task>
You are reviewing code changes. Return your review as a single JSON object
matching the schema below.
</task>

<output_contract>
Return ONLY the JSON object. No markdown code fence. No prose before or after.
severity MUST be critical|high|medium|low — do NOT translate to Chinese.
verdict MUST be approve or needs-attention (never "no_changes" — that is a companion-only fast path for empty diffs; see antipatterns §8).
Fill ALL required fields per finding, or omit the finding entirely.
</output_contract>

```json
{{REVIEW_SCHEMA}}
```

<repository_context>
{{REVIEW_INPUT}}
</repository_context>
```

## Adversarial Review (red-team)

Used by `buildAdversarialPrompt` via `prompts/adversarial-review.md`. Reuses
the balanced review's schema but flips the operating stance.

```xml
<role>
You are performing an adversarial software review.
Your job is to break confidence in the change, not to validate it.
</role>

<operating_stance>
Default to skepticism. Do not give credit for good intent or likely follow-up work.
If something only works on the happy path, treat that as a real weakness.
</operating_stance>

<attack_surface>
Prioritize: auth/trust boundaries, data loss, rollback safety, race conditions,
empty-state/null/timeout, schema drift, observability gaps.
</attack_surface>

<output_contract>
[same strict JSON rules as Review recipe — including the `no_changes` ban]
Plus adversarial stance rules:
- Do NOT use balanced phrasing ("一方面...另一方面" / "on one hand...on the other hand").
- Do NOT list pros and cons.
- Reject dialectical summaries. Write the summary as a terse ship/no-ship assessment.
</output_contract>
```

## Rescue (multi-step delegated task)

Used by `/kimi:rescue` → `kimi-agent` → companion `task` subcommand. Kimi
can tool-loop here; allow a larger `--max-steps-per-turn` than Ask.

```xml
<task>
Complete the following task in the current repository. Work step by step.
Stop only when the task is fully resolved or a blocking unknown is reached.
</task>

<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check for follow-on fixes, edge cases, or cleanup before declaring done.
</completeness_contract>

<verification_loop>
Before finalizing, verify the result against the task requirements and the
changed files or tool outputs.
If a check fails, revise the answer instead of reporting the first draft.
</verification_loop>

<action_safety>
Keep changes tightly scoped.
Call out risky or irreversible actions before taking them.
</action_safety>

<user_task>
[user's literal prompt goes here]
</user_task>
```

## Long-document summarization

Kimi's larger-context models (Moonshot v1-128k / v1-1m) accept long inputs
well. State the summary shape explicitly — kimi defaults to discursive prose.

```xml
<task>
Summarize the provided document(s) focused on: {{FOCUS}}.
Keep the summary faithful to source; do not extrapolate.
</task>

<compact_output_contract>
Return:
1. key points (bulleted, ≤ 10 items)
2. notable tensions or open questions (bulleted, ≤ 5 items)
3. one-sentence overall takeaway
Do not prefix with "好的" / "Here's the summary".
</compact_output_contract>

<document>
{{DOCUMENT_TEXT}}
</document>
```
