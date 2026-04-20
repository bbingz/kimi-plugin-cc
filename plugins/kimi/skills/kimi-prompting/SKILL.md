---
name: kimi-prompting
description: Internal guidance for composing Kimi CLI prompts for coding, review, diagnosis, and research tasks
---

# kimi-prompting (Phase 1 skeleton)

Fully populated in Phase 5 once real prompts have been tested across `/kimi:ask`, `/kimi:review`, `/kimi:rescue`. Phase 1 provides the bones.

## Scope

Guidance for Claude when composing a prompt to send to Kimi via `kimi-companion.mjs`. Not user-facing.

## Universal rules (v0.1)

1. **Output contract first.** State the expected output format in the first paragraph of any task prompt. For JSON responses, explicitly say: "Return ONLY a JSON object matching this schema. No prose before or after. No markdown code fence."
2. **Context in a labeled block.** When passing code / diff / docs, wrap in a clearly labeled heading (`### Diff to review` / `### Files under investigation`).
3. **Language parity.** Kimi's Chinese-language reasoning is strong. If the user prompt is Chinese, keep the system / instruction text in Chinese. Do not force English.
4. **Small `--max-steps-per-turn` on simple Q&A.** For `/kimi:ask`, set a small N (3 is a sensible default). For `/kimi:rescue --write`, allow larger N.
5. **No tool-call expectation.** Do not write prompts that assume tool use unless the command is `/kimi:rescue --write`. `/kimi:ask` should bias toward single-turn answers.

## Placeholder references (filled in Phase 5)

- `references/kimi-prompt-recipes.md` — recipes for common tasks (review / refactor / explain / doc-summarize)
- `references/kimi-prompt-antipatterns.md` — patterns that empirically fail on Kimi (populated from real failures during Phases 2-4)
- `references/prompt-blocks.md` — reusable blocks (task framing, output contracts, `--thinking` triggers)
