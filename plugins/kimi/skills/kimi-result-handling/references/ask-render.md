# /kimi:ask rendering rules

Command file `plugins/kimi/commands/ask.md` is the authoritative rendering contract for `/kimi:ask`. This file holds the background rationale that the command file condenses into rules.

## Output channel contract

`/kimi:ask` runs in **text mode** by default. The companion writes to stdout:

```
<response verbatim>

(session: <uuid> · model: <name> [· thinkBlocks: N])
```

When `--json` is passed, the entire `{ok, response, sessionId, events, toolEvents, thinkBlocks}` object goes to stdout as pretty-printed JSON. `--stream` (developer-only, blocked when `KIMI_COMPANION_CALLER=claude`) emits one JSONL event per line plus a final `{summary: {...}}` line.

## Presentation to the user (text mode)

1. **Verbatim output.** Present stdout unchanged. No prefix (no "Kimi says:"), no wrapping, no paraphrase, no translation.
2. **Disagreement is the ONLY allowed addition.** One line after the footer: `Note: Claude disagrees on X because Y.` — omit when you agree. This is the sole exception to verbatim.
3. **Chinese responses stay in Chinese.** Do not offer unprompted translation; if the user later asks, translate then.
4. **Think-blocks count is a signal only.** The footer may show `thinkBlocks: N`. Do not fabricate their contents or promise a way to view them until `--show-thinking` lands.

## Error path (exit != 0)

Claude receives stderr with `Error: <msg>` and optional `Partial response:` block. Match the error keyword to one of three declarative suggestions (ask.md specifies them literally):

- `"not configured"` → direct to `/kimi:setup` then `--model <name>`.
- `"timed out"` → split prompt or reduce scope, then retry.
- `"interrupted"` (SIGINT or SIGTERM) → plain "Retry when ready."

**MUST NOT end these with a question mark.** Declarative only. Do NOT auto-retry.

## Silent-failure modes the companion catches

- `!assistantText.trim()` (Task 3.1): think-only or whitespace-only responses fail with `ok: false`, status `0`, raw stdout clipped to 2000 chars.
- Missing sessionId: footer prints `session: unknown (not captured)` AND stderr warning fires in ALL modes (Task 3.1 cash-in).
- Resume-mismatch: runAsk warns when `--resume <sid>` was requested but `result.sessionId !== sid` (gemini G-H1).
