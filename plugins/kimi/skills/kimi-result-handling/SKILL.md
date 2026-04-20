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

## Command-specific rendering

**Command files (`plugins/kimi/commands/<name>.md`) are authoritative for their own rendering contract.** They supersede this skill's examples when they disagree. The shape of the companion's stdout also varies per command:

- `/kimi:ask` runs in **text mode** by default. The companion's stdout is `response + "\n" + footer` — Claude presents it **verbatim**, no prefix (no "Kimi says:"), no trailing commentary, no unsolicited follow-up questions. See `ask.md` for the full contract including the declarative error-suggestion templates.
- `/kimi:review` (Phase 3+) runs in JSON mode. Structured findings are the primary payload; prose is commentary. See `review.md` when it lands.
- Other `/kimi:*` commands specify their own rendering in their command files.

This skill holds the **cross-command** rules. If a command file is silent on a situation, fall back to the Presentation rules above.

## Chinese/mixed-language output

Kimi often replies in the same language as the prompt. If the user asked in Chinese, do NOT translate the response to English unless they explicitly asked. Quote verbatim. **Do NOT offer translation as an unprompted follow-up** — `/kimi:ask` specifically forbids appending any commentary. If the user later asks "翻译一下" or similar, translate then.

## Think blocks (future `--show-thinking` flag, not v0.1)

If a future version surfaces `type: "think"` blocks, render them in a collapsed markdown details block — never inline with the main answer:

```
<details>
<summary>Kimi's reasoning</summary>

<think content>

</details>

<visible text response>
```

The footer's `thinkBlocks: N` count (emitted by the companion for /kimi:ask) is a quality signal only — do not fabricate the contents or promise a way to see them while the surface remains v0.1.

## What still needs Phase 5 work

- Review-findings rendering (severity-sorted, deep-linked file references) — waits for `/kimi:review` (Phase 3).
- Disagreement-phrasing library across review vs ask contexts.
- Split this skill into `references/<command>-render.md` modules (gemini G6) when Phase 3 adds `/kimi:review`.
