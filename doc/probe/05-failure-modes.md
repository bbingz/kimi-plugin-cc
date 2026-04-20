# Probe 05: stream-json failure modes

## Results

| Scenario | Exit code | stdout state | stderr format | Partial session created? |
|---|---|---|---|---|
| SIGTERM mid-stream | 143 | empty | empty | no |
| Invalid model | 1 | text ("LLM not set") | text (session resume) | yes |
| Bad cwd | 2 | empty | text (CLI error) | no |

## Raw outputs per scenario

### SIGTERM mid-stream
- exit: 143
- stdout: (empty - no output captured)
- stderr: (empty)
- **observation**: kimi appears to buffer all output until completion. When SIGTERM is sent before the LLM response completes, the process terminates without flushing stdout. No partial JSON is available.

### Invalid model
- exit: 1
- stdout:
```
LLM not set
```
- stderr:
```

To resume this session: kimi -r 107bb459-8309-4c26-9ed0-0be81fbb3485
```
- stderr format: **text** (multiline, includes session ID for resume)
- **observation**: kimi does not reject invalid model names at CLI validation time. Instead, it creates a session and fails during LLM initialization with a generic "LLM not set" message to stdout. stderr contains a resume session hint (non-error text). This suggests the model validation occurs after session creation.

### Bad cwd
- exit: 2
- stdout: (empty)
- stderr:
```
Usage: kimi [OPTIONS] COMMAND [ARGS]...
Try 'kimi -h' for help.
╭─ Error ──────────────────────────────────────────────────────────────────────╮
│ Invalid value for '--work-dir' / '-w': Directory '/nonexistent/path/xyz'     │
│ does not exist.                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
```
- **observation**: caught by Click CLI validation before any session is created. stderr is plain text (CLI framework formatted error box). Exit code 2 is standard CLI usage error.

## Successful stream-json format (baseline)
For reference, a successful completion produces:
- exit: 0
- stdout (single line, valid JSON):
```json
{"role":"assistant","content":[{"type":"think","think":"...","encrypted":null},{"type":"text","text":"..."}]}
```
- stderr: (empty, or session resume hint)
- **observation**: stream-json output is actually a single JSON object on one line (despite the name), not newline-delimited stream format.

## Recovery recommendations for Phase 1 callKimi / callKimiStreaming

### On SIGTERM (exit 143)
- **Action**: Treat as signal-terminated session. Do NOT attempt to parse stdout for partial JSON.
- **stderr parsing**: Ignored; likely empty anyway.
- **Handling**: Return a signal-aware error message to user, e.g. `"Request was interrupted by user (signal 15)"`.
- **Partial session**: Do NOT store session ID; session is not valid for resumption after signal termination.
- **Retry strategy**: Safe to retry from scratch.

### On invalid model name (exit 1, "LLM not set")
- **Action**: Parse stdout first line; if it reads `"LLM not set"`, treat as model error.
- **stderr parsing**: Extract the session ID from `kimi -r <uuid>` pattern if user wants to debug, but do NOT suggest resume as a recovery path.
- **stderr format**: Text; extract pattern with regex `kimi -r ([a-f0-9-]+)` if needed for diagnostics.
- **Handling**: Return error `"Model configuration failed. Check model name and authentication."` Do NOT expose session ID to user unless explicitly requested.
- **Partial session**: A session directory IS created (per P0.2), but in failed state. Clean up work_dirs last_session_id after reporting the error.
- **Retry strategy**: Require explicit user action (different model name, auth check) before retry.

### On bad working directory (exit 2)
- **Action**: Check if stderr contains "Invalid value for '--work-dir'" pattern.
- **stderr parsing**: Text (CLI framework error). Extract directory path from error message.
- **Handling**: Return clear filesystem error, e.g. `"Working directory does not exist: /nonexistent/path/xyz. Create it or use a valid path."`.
- **Partial session**: No session created; no cleanup needed.
- **Retry strategy**: Require user to fix directory before retry.

## Summary for error routing

1. **exit 143** (SIGTERM): Signal termination, no recovery attempt.
2. **exit 1** with `"LLM not set"`: Model configuration error, clear message, no resume.
3. **exit 2** (and contains "Invalid value for"): CLI validation error, suggest fix, no session created.
4. **exit 0** with empty stdout: Unexpected success case; treat as "no response generated."
5. **exit N (other)**: Check stderr; if text-based CLI error, treat as validation failure; if no stderr, treat as internal error and surface partial stdout JSON if available.

## Notes for stream-json format
- Despite the format name `stream-json`, output is **not streaming** and **not newline-delimited**. It is a single valid JSON object.
- This means partial-response recovery after SIGTERM is not feasible (no lines to parse).
- Consider documenting this as a gap: for long generations, users cannot interrupt and retrieve partial work. Mitigation: offer a `--stream-raw` or `--stream-ndjson` format in a future phase.
