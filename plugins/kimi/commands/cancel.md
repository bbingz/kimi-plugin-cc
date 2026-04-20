---
description: Cancel an active Kimi background job
argument-hint: '[job-id] [--any-session]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" cancel "$ARGUMENTS" --json
```

Report whether the job was successfully cancelled.

If no active job was found AND the user did not pass a jobId, the error will hint at `--any-session`. In that case, tell the user:
- "No active Kimi jobs from this terminal. If you submitted one from a different terminal, try `/kimi:cancel --any-session` or `/kimi:cancel <jobId>`."
- Do NOT silently re-run with `--any-session` — that could cancel an unrelated job someone else is running.

If no active jobs exist anywhere (with `--any-session`), just tell the user there are no cancellable jobs.
