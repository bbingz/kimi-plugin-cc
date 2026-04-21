---
name: kimi-cli-runtime
description: Internal helper contract for calling the kimi-companion runtime from Claude Code
---

# kimi-cli-runtime

Internal contract for code invoking `scripts/kimi-companion.mjs`. Not user-facing. Claude uses this skill implicitly when dispatched via `/kimi:*` commands or the `kimi-agent` subagent.

## Runtime requirements

- `kimi` CLI ≥ 1.34 on PATH (dev box has 1.36.0)
- `~/.kimi/credentials/` non-empty (user ran `kimi login` interactively)
- Node.js ≥ 18
- Zero npm dependencies — plugin uses only Node built-ins

## Companion script subcommands

| Subcommand | Purpose | JSON shape |
|---|---|---|
| `setup --json` | Check install + auth + models | `{installed, version, authenticated, authDetail, model, configured_models[], installers}` |
| `ask [options] "<prompt>"` | (Phase 2) One-shot query | streaming events then `{response, sessionId}` |
| `review [options]` | (Phase 3) Review current diff | `{verdict, summary, findings[], next_steps[]}` |
| `task [options] "<prompt>"` | (Phase 4) Background job | `{jobId, status}` |
| `status` / `result <jobId>` / `cancel <jobId>` | (Phase 4) Job lifecycle | per gemini plugin parity |
| `task-resume-candidate --json` | (Phase 4) Resumable session | `{available, sessionId, cwd}` |

## Kimi CLI invocation facts (from doc/probe/probe-results.json v3)

These constants are the direct result of Phase 0 probes + codex source-read. Do NOT re-derive or re-probe.

- **Version flag**: `kimi -V` (**uppercase**). `-v` means verbose.
- **Headless format**: `kimi -p "<prompt>" --print --output-format stream-json` emits **per-message JSONL** (not per-token streaming).
- **Event shape**:
  - Top-level keys: `role`, `content`
  - `role` ∈ `{"assistant", "tool"}` (maybe more)
  - `content` is a **list of blocks**, each block has `type`: `"text"`, `"think"`, `"image_url"`, `"audio_url"`, `"video_url"` (source-defined set; probe observed only text + think)
  - **NO top-level `type` field** as event tag
- **Multi-line per run**: a single kimi invocation CAN emit multiple JSONL lines (each tool_result is a separate `role:"tool"` event; each assistant turn another line). The parser MUST handle multi-line accumulation.
- **Session ID**: NOT in stdout JSON. Only in stderr via regex `/kimi -r ([0-9a-f-]{36})/`. Source-verified unconditional emission (not gated by `--quiet`).
- **Session ID fallback**: `~/.kimi/kimi.json.work_dirs[].last_session_id` where `path` matches the passed `-w` exactly. Updated synchronously in `--print` mode.
- **Path storage**: **verbatim** (not symlink-resolved). Always pass `-w fs.realpathSync(cwd)` and compare against `work_dirs[i].path` with the same form.
- **Hash algorithm** for `~/.kimi/sessions/<hash>/`: md5 of path string.
- **Default model**: TOML scalar `default_model` at the top level of `~/.kimi/config.toml`.
- **Configured models**: TOML sections `[models.<name>]` (one per name). Name may be bare (`[models.foo]`) or quoted with slashes (`[models."vendor/model"]`). Strip quotes when extracting.
- **Large prompts**: pipe via stdin with `-p ""` when `prompt.length >= 100000` bytes.
- **Auth ping**: `--max-steps-per-turn 1` is 3/3 reliable; use 30s timeout.
- **Model preflight**: validate `-m <name>` exists in `configured_models` BEFORE calling kimi to avoid wasted sessions (exit 1 + "LLM not set" path).
- **Stats / token usage**: NOT surfaced in stream-json. kimi emits `StatusUpdate` internally but `JsonPrinter` drops it. v0.1 cannot expose token stats.

## Exit code map

| exit | Meaning | User-facing message |
|---|---|---|
| 0 | Success | (parse JSONL, render response) |
| 1 | `LLMNotSet` (unknown model name) | "Model `<X>` not configured in ~/.kimi/config.toml" |
| 2 | Click usage error (bad `-w`, bad flag) OR `--scope` enum mismatch (qwen H2 companion-side) | Show stderr error box verbatim |
| 124 | Local timeout (companion-enforced) — child spawned but exceeded `KIMI_STATUS_TIMED_OUT` budget, or background worker exceeded `spawnSync` 600s timeout | "kimi timed out after Xs" |
| 130 | SIGINT | "Cancelled by user" |
| 143 | SIGTERM (external kill; distinct from 124 local timeout per codex 5-way-review M1) | "Request was interrupted" |
| other | Internal | Show exit code + stderr first 200 chars |

## Assistant text extraction contract (for Phase 2+)

Given an assistant event `{role: "assistant", content: [...]}`:

```js
const text = (event.content || [])
  .filter(b => b && b.type === "text" && typeof b.text === "string")
  .map(b => b.text)
  .join("");
```

- Drop `type === "think"` blocks by default (reasoning channel; surface only with an explicit flag).
- Skip unknown block types without erroring; preserve the raw block for debug logs.
- `event.tool_calls` is at the top level, parallel to content — preserve for job tracking in `/kimi:rescue`; ignore for `/kimi:ask`.

## Do NOT

- Do NOT pass `--approval-mode` (kimi does not accept it).
- Do NOT write to `~/.kimi/`.
- Do NOT parse the kimi TUI — always go through `--print`.
- Do NOT assume stats are available in v0.1.
- Do NOT use `kimi -C` (continue-last) — session continuity must be explicit via `-r <sessionId>`.
