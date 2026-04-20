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

## Concrete rendering patterns

### `/kimi:ask` response

If the companion returned `{ok: true, response: "...", sessionId: "<uuid>"}`:

```
Kimi says:

<response verbatim>

---
(session: <sessionId>)

Note: <any disagreement with Claude's view, or "Claude agrees.">
```

### `/kimi:ask` with partialResponse

If the companion returned `{ok: false, error: "...", partialResponse: "..."}`:

```
Kimi errored: <error>

Partial response before the error:
<partialResponse>

Retry with a different model or smaller prompt.
```

### Chinese/mixed-language output

Kimi will often reply in the same language as the prompt. If the user asked in Chinese, do NOT translate the response to English unless they explicitly asked. Quote verbatim and offer: "Translate to English?" as a follow-up.

### Think blocks (future `--show-thinking` flag, not v0.1)

If surfaced, render in a collapsed markdown details block:

```
<details>
<summary>Kimi's reasoning</summary>

<think content>

</details>

<visible text response>
```

## What still needs Phase 5 work

- Review-findings rendering (severity-sorted, deep-linked file references) — waits for `/kimi:review` (Phase 3).
- Disagreement-phrasing library across review vs ask contexts.
