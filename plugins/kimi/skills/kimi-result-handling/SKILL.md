---
name: kimi-result-handling
description: Internal guidance for presenting Kimi output back to the user
---

# kimi-result-handling (Phase 1 early draft)

How Claude should render and reason about kimi's output after receiving it from `kimi-companion.mjs`. Applies to all `/kimi:*` commands.

## The invariant

The companion has already aggregated content blocks into a final `response` string per the rules in `kimi-cli-runtime`. This skill is about what to do with that string.

## Presentation rules

1. **Quote kimi verbatim.** When showing a kimi response to the user, do not paraphrase or compress it. Kimi's output language (Chinese is common) must be preserved — do NOT translate unless the user asked.
2. **Flag disagreements.** If your own analysis differs from kimi's, say so explicitly: "Note: Claude disagrees on X because Y." Don't hide disagreement to appear consistent.
3. **Never auto-execute.** Kimi may suggest commands, code changes, or file edits. Do NOT apply them silently. Ask which items to act on.
4. **Respect the channel.** For `/kimi:review`, the structured JSON is the primary payload; prose is commentary. For `/kimi:ask`, the string is the primary payload.

## Think blocks

Per `kimi-cli-runtime`, the default companion drops `type: "think"` blocks. If a future version surfaces them (e.g. via `--show-thinking`), render them in a collapsed details block — never inline with the main answer. Think content is reasoning, not conclusions.

## Unknown block types

If the companion ever surfaces a raw block with an unfamiliar `type` (e.g. `image_url`), do not guess its meaning. Tell the user: "Kimi returned a `<type>` block that this plugin version does not render. Raw contents: ..."

## Token usage / stats

v0.1 cannot obtain token counts (kimi drops `StatusUpdate` in JsonPrinter). Do NOT claim the response "cost X tokens" or estimate context window usage — you don't have that data.

## Error output

If the companion returns an error status (non-zero exit), show it directly with context. Do NOT try to re-run. Use the exit-code map in `kimi-cli-runtime` to interpret the cause and choose the right user-facing message.

## What to expand in Phase 5

- Chinese-vs-English rendering nuances observed across `/kimi:ask` usage
- Review findings render order (severity-first, stable sort)
- Diff-aware presentation for `/kimi:review`
- Concrete examples of disagreement-flagging phrasing
