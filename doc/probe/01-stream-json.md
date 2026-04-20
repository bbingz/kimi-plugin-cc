# Probe 01: stream-json event taxonomy

## Run
`kimi -p "Reply with exactly: OK" --print --output-format stream-json`

## Raw events (annotated)
```
=== event[0] ===
Keys: ['role', 'content']
  'content': <list len=2>
    [0]: ['type', 'think', 'encrypted']
       'type': 'think'
       'think': "The user wants me to reply with exactly \"OK\". This is a very..."
       'encrypted': None
    [1]: ['type', 'text']
       'type': 'text'
       'text': 'OK'
  'role': 'assistant'
```

## Findings
- **flat_event_shape**: false (the `content` key contains a list of block objects, each with their own `type` key, not a simple string)
- **event_type_key**: "none — use role + nested content[].type" (top-level has `role`, but event kind is tagged by nested `content[i].type` values like "think" and "text")
- **session_id_key**: "n/a in stdout; appears only in stderr" (session ID is conveyed via stderr message "To resume this session: kimi -r <uuid>", not in JSON)
- **session_id_event_index**: n/a (session_id not in JSON events)
- **session_id_event_type**: n/a (session_id not in JSON events; must be parsed from stderr)
- **assistant_content_key**: "content" (but it's a list of block objects, not a string)
- **assistant_role_value**: "assistant"
- **stats_event_present**: false (no separate stats event; the single event is role + content blocks)
- **stats_keys**: n/a (no stats event observed)

## Caveats
**Key divergence from Codex prediction**: 
- Codex predicted flat shape with direct `role` and `content` keys at top level. The `role` key IS at top level, but **`content` is not a simple string — it's a list of block objects**, each with `type` ("think", "text", etc.) and type-specific fields.
- Session ID is **not in the JSON stream at all**; it appears only in stderr as a resumable session reference.
- The `content` list contains multiple content blocks (e.g., internal thinking block + text response block), so parsing must iterate through `content[]` and check `type` on each.
- No formal "event_type_key" at top level; event discrimination happens via nested `content[i].type` values.
