---
description: Retrieve the full output of a completed Kimi job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" result "$ARGUMENTS" --json
```

Present the full result verbatim. Preserve the original structure:
- verdict/summary/findings/next-steps if it was a review
- full response text if it was a task or ask

If the job has findings, present them ordered by severity.
Do NOT auto-fix any issues. Ask the user which issues to address.
