---
description: Delegate investigation, an explicit fix request, or follow-up work to the Kimi rescue subagent
argument-hint: "[--background|--wait] [--resume-last|--fresh] [--model <model>] [what Kimi should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `kimi:kimi-agent` subagent via the `Agent` tool (`subagent_type: "kimi:kimi-agent"`), forwarding the raw user request as the prompt.
`kimi:kimi-agent` is a subagent, not a skill — do not call `Skill(kimi:kimi-agent)` (no such skill) or `Skill(kimi:rescue)` (that re-enters this command and hangs the session). The command runs inline so the `Agent` tool stays in scope; forked general-purpose subagents do not expose it.
The final user-visible response must be Kimi's output verbatim.

Raw user request:
$ARGUMENTS

Resume detection:
- Before dispatching, check if there is a resumable Kimi session:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task-resume-candidate --json
  ```
- If `available: true` and the user did NOT pass `--fresh`:
  Ask the user whether to continue the previous thread or start fresh.
  Prepend `--resume-last` or `--fresh` based on their choice.
- If the user already passed `--resume-last` or `--fresh`, skip this step.

Execution mode:
- If the request includes `--background`, run the subagent in the background.
- If the request includes `--wait`, run the subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags. Do not forward them to `task`.
- `--model`, `--resume-last`, `--fresh` are runtime flags. Preserve them.

Flags to drop silently (gemini v1-review G-H2):
- `--write` — gemini-specific (approval mode gate); kimi has no equivalent. Drop before forwarding. Brief note to the user: "Kimi doesn't distinguish plan-mode from write-mode; it will act on what the prompt asks."
- `--effort low|medium|high` — gemini-specific (reasoning budget). Drop silently; no user-visible note needed.

Forwarding any of the above to `task` would exit 2 (unknown flag); the intent behind them cannot be honored in v0.1, so silent drop + the `--write` warning is the right UX.

Operating rules:
- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Kimi companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary.
- Do not ask the subagent to inspect files, monitor progress, poll status, or do follow-up work.
- If the user did not supply a request AND `--resume-last` is present, proceed with the default continue prompt (the task runtime handles this).
- If the user did not supply a request AND no `--resume-last`, ask what Kimi should investigate or fix.
