---
name: kimi-prompting
description: Internal guidance for composing Kimi CLI prompts for coding, review, diagnosis, and research tasks
---

# kimi-prompting

Internal skill consumed by `kimi-agent` and by the command files before
dispatching to `kimi-companion.mjs`. Not user-invocable.

## Scope

Guidance for Claude when composing a prompt to send to Kimi. Covers task
framing, output contracts, and the empirically-calibrated strict rules
that keep kimi's JSON output parseable.

## Universal rules

1. **Output contract first.** State the expected output format in the first
   paragraph of any task prompt. For JSON responses, explicitly say:
   "Return ONLY a JSON object matching this schema. No prose before or after.
   No markdown code fence." — positive-only instructions are treated as soft
   by kimi; include negative forms.
2. **Context in a labeled block.** When passing code / diff / docs, wrap in
   a clearly labeled XML-tagged section (`<repository_context>` /
   `<document>` / `<diff>`).
3. **Language parity.** Kimi's Chinese-language reasoning is strong. If the
   user prompt is Chinese, keep the meta-language (task framing, contracts)
   in Chinese too. JSON keyword enforcement stays English.
4. **Small `--max-steps-per-turn` on simple Q&A.** For `/kimi:ask`, a small
   N (1–3) prevents runaway tool-use loops. For `/kimi:rescue`, allow larger.
5. **No tool-call expectation in Ask.** Bias toward single-turn answers.

## References

- [Recipes](references/kimi-prompt-recipes.md) — starting templates for ask / review / adversarial-review / rescue / summarization
- [Anti-patterns](references/kimi-prompt-antipatterns.md) — observed failure modes from Phase 2–4 and the fixes that worked
- [Prompt blocks](references/prompt-blocks.md) — reusable XML-tagged blocks (task / output_contract / completeness_contract / grounding_rules / attack_surface / …)

## When to invoke this skill

Any time Claude constructs a new prompt string to pass to Kimi through
`kimi-companion.mjs` (whether via `/kimi:ask`, `/kimi:rescue`, or inside
the `kimi-agent` subagent). Especially needed when the prompt is user-
generated raw text rather than one of the packaged templates in
`plugins/kimi/prompts/`.
