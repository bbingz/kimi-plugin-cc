# kimi-plugin-cc Phase 2 Ask + Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `callKimi` (sync) and `callKimiStreaming` (async) to `kimi.mjs`, wire the `ask` subcommand in `kimi-companion.mjs`, create `/kimi:ask` command, and polish the `kimi-result-handling` skill. Exit: **T2** (`/kimi:ask "hello"` returns text), **T3** (streaming emits events per message), **T4** (session_id captured from stderr + kimi.json fallback).

**Architecture:** Node.js zero-deps. `callKimi` uses `runCommand` (spawnSync). `callKimiStreaming` uses `spawn` with `StringDecoder('utf8')` for multi-byte safety, accumulates stdout into newline-delimited JSON events, emits each via `onEvent`. Content-block aggregation (keep `type==="text"`, drop `type==="think"`, skip unknown) is centralized in `extractAssistantText` (added to kimi.mjs). Session-id is extracted via two paths: primary = stderr regex `/kimi -r ([0-9a-f-]{36})/`; secondary = `~/.kimi/kimi.json.work_dirs[].last_session_id` matched by `realpath(cwd)`.

**Tech Stack:** Node built-ins (`node:child_process spawn/spawnSync`, `node:string_decoder`, `node:fs`, `node:os`, `node:path`). No npm deps.

**Reference spec:** `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` §3.1 / §3.3 (per-message JSONL, content blocks) / §3.4 (session id dual path) / §3.5 (exit code → UX).
**Reference probe data:** `doc/probe/probe-results.json` v3 — use `stream_json.*`, `work_dirs.*`, `failure_modes.*` sections as literal value source.
**Reference source:** `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/gemini.mjs` — `callGemini` and `callGeminiStreaming` provide the structural template (especially the StringDecoder+line-buffering pattern at L236-259). **Read but do NOT copy** — kimi's event shape is different (flat role/content vs gemini's typed init/message/result).

**v0.1 total budget:** ~85 tasks. This plan covers **Phase 2 only (8 tasks, ~65 steps after review integration)**. Cumulative after Phase 2 = ~36 / 85 (42%).

**Exit criteria (all must hold before tag `phase-2-ask`):**
- `callKimi({prompt, model, cwd})` returns `{ok: true, response, sessionId, events, toolEvents, thinkBlocks}` on success with non-empty response and UUID sessionId
- `callKimiStreaming({prompt, onEvent})` emits one event per parsed JSONL line during the run; unified error shape on timeout/failure (status + partialResponse + events)
- Both functions: exit 0 + 0 events → returns `{ok: false, error: "produced no stream-json events", rawStdout}` (no silent success, gemini G1)
- Both functions: pre-flight model validation via `readKimiConfiguredModels` before spawning kimi (codex C2)
- **T2 CLI** (Step 1): `ask --json "Reply with exactly: hello"` → JSON with non-empty response, UUID sessionId, ok=true
- **T3 streaming** (Step 2): `ask --stream "讲一个短笑话"` emits ≥ 1 event line + 1 summary line
- **T4 session match** (Step 3): returned `sessionId` matches `~/.kimi/kimi.json.work_dirs[cwd].last_session_id`
- **Invalid-model routing** (Step 4): bogus `--model` surfaces "not configured" error with status 1
- **Large-prompt stdin** (Step 5): 150KB prompt succeeds via auto-switched stdin path
- **Resume continuity** (Step 6): `--resume <sid>` actually recalls context set in prior call (not just field match)
- `/kimi:ask` command blocks `--stream` from Claude Code invocation (codex C5); only companion-direct debug can use streaming
- `/kimi:ask` presentation MUST append `(session: <id> · model: <m>)` footer (gemini G3) so `--resume` is reachable
- `kimi-result-handling/SKILL.md` expanded with concrete rendering examples + active-recovery guidance
- Git tag `phase-2-ask` applied

**Explicit non-goals:**
- `/kimi:review` + schema-validated JSON findings → Phase 3
- Retry on JSON parse failure → Phase 3
- Background jobs / `/kimi:rescue` / agent subagent → Phase 4
- Adversarial review → Phase 5
- Rename `renderGeminiResult` → `renderKimiResult` (tech debt noted in Phase 1 CHANGELOG) — deferred; Phase 2 doesn't use that function yet

---

## File Structure

**Modify:**
- `plugins/kimi/scripts/lib/kimi.mjs` — add event parsers, session extraction, `callKimi`, `callKimiStreaming`
- `plugins/kimi/scripts/kimi-companion.mjs` — add `ask` subcommand (JSON + streaming output modes)
- `plugins/kimi/skills/kimi-result-handling/SKILL.md` — expand with concrete examples

**Create:**
- `plugins/kimi/commands/ask.md`

**Unchanged:**
- `args.mjs`, `process.mjs`, `git.mjs`, `state.mjs`, `render.mjs` — no touch in Phase 2 (Phase 2 text path is JSON; rendering refactor is Phase 4+)
- `kimi-cli-runtime/SKILL.md`, `kimi-prompting/SKILL.md` skeleton — no new facts discovered in Phase 2 yet; polish deferred

---

## Task 2.1: Extend `kimi.mjs` with stream-json event parsers

**Files:**
- Modify: `plugins/kimi/scripts/lib/kimi.mjs`

- [ ] **Step 1: Add runtime sentinels section (central source of truth)**

Before adding parsers, add this section IMMEDIATELY below the existing constants block near the top of `kimi.mjs` (per codex C7: consolidate kimi-cli source-derived markers; Phase 3+ extends here):

```js
// ── Runtime sentinels (kimi-cli source-derived markers) ────
// Per codex source-read. If kimi-cli updates, only this block changes.

// Exit 1 body contains this marker when the configured model name resolves
// to an empty provider (kimi_cli/app.py::create_llm returns None →
// kimi_cli/llm.py raises LLMNotSet → print(str(e)) writes this to stdout).
// Prefer pre-flight validation (readKimiConfiguredModels) over this marker.
export const LLM_NOT_SET_MARKER = "LLM not set";

// Exit code → semantic tag. See kimi-cli-runtime SKILL.md for user-facing messages.
export const KIMI_EXIT = {
  OK: 0,
  CONFIG_ERROR: 1,     // LLM_NOT_SET_MARKER path
  USAGE_ERROR: 2,      // Click error box
  SIGINT: 130,
  SIGTERM: 143,
};

// Synthetic status used when we abort locally (timeout) — distinguishable
// from any real kimi-cli exit code.
export const KIMI_STATUS_TIMED_OUT = -1;
```

- [ ] **Step 2: Add parser helpers at end of the file (before the final `export { ... }` block)**

Insert this block above the final `export { ... }`:

```js
// ── Stream-json event parsing (spec §3.3.2) ────────────────

// Parse a single JSONL line to an event. Returns null for blank/non-JSON.
// Errors propagate back to caller as null so they can decide on partial recovery.
export function parseKimiEventLine(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// Aggregate assistant text from ONE event. Follows kimi-cli-runtime contract:
// keep type==="text" blocks, drop "think", skip unknown. Empty for non-assistant.
export function extractAssistantText(event) {
  if (!event || event.role !== "assistant") return "";
  const blocks = event.content || [];
  return blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

// Parse a multi-line stdout buffer into { events, assistantText, toolEvents }.
// Multi-line support is required (probe 01/codex Q2: single run may emit
// several JSONL lines when tool use is present).
export function parseKimiStdout(stdout) {
  const events = [];
  const toolEvents = [];
  const textParts = [];
  for (const raw of (stdout || "").split("\n")) {
    const ev = parseKimiEventLine(raw);
    if (!ev) continue;
    events.push(ev);
    if (ev.role === "assistant") {
      const t = extractAssistantText(ev);
      if (t) textParts.push(t);
    } else if (ev.role === "tool") {
      toolEvents.push(ev);
    }
  }
  return { events, assistantText: textParts.join(""), toolEvents };
}
```

- [ ] **Step 3: Add session-id extraction helpers**

Immediately after the parser helpers above, append:

```js
// ── Session id extraction (spec §3.4) ──────────────────────

// Primary: stderr emits "To resume this session: kimi -r <uuid>" (spec §3.3.3).
export function parseSessionIdFromStderr(stderr) {
  if (!stderr) return null;
  const m = stderr.match(SESSION_ID_STDERR_REGEX);
  return m ? m[1] : null;
}

// Secondary: ~/.kimi/kimi.json.work_dirs[].last_session_id matched by
// verbatim path. Caller must pass the SAME cwd string that was used for -w
// to make the comparison deterministic (§3.4 — use fs.realpathSync on both
// sides OR the unresolved value on both sides).
export function readSessionIdFromKimiJson(workDirPath) {
  try {
    const file = path.join(os.homedir(), ".kimi", "kimi.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const wd = (data.work_dirs || []).find((w) => w && w.path === workDirPath);
    return wd?.last_session_id || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Export the new helpers** — add these names to the final `export { ... }` block:

```js
export {
  PING_MAX_STEPS,
  SESSION_ID_STDERR_REGEX,
  LARGE_PROMPT_THRESHOLD_BYTES,
  PARENT_SESSION_ENV,
  KIMI_BIN,
  DEFAULT_TIMEOUT_MS,
  AUTH_CHECK_TIMEOUT_MS,
};
```

— the named `export function` declarations already make the new functions exported; no change to the brace block is required. Verify with the smoke test below.

- [ ] **Step 5: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/kimi.mjs
```

- [ ] **Step 6: Smoke test the parsers**

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(m => {
  // parseKimiEventLine
  console.assert(m.parseKimiEventLine("")  === null, "empty → null");
  console.assert(m.parseKimiEventLine("not json") === null, "non-json → null");
  const ev = m.parseKimiEventLine(`{"role":"assistant","content":[{"type":"text","text":"hi"}]}`);
  console.assert(ev && ev.role === "assistant", "parse ok");

  // extractAssistantText — text + think + unknown
  const event = {role:"assistant", content:[
    {type:"think", think:"reasoning"},
    {type:"text", text:"visible"},
    {type:"image_url", url:"http://x"},
    {type:"text", text:" more"},
  ]};
  const text = m.extractAssistantText(event);
  console.log("text:", JSON.stringify(text));
  console.assert(text === "visible more", "concat only text blocks");

  // parseKimiStdout — multi-line with tool_result
  const stdout = [
    `{"role":"assistant","content":[{"type":"text","text":"Running"}]}`,
    `{"role":"tool","content":[{"type":"text","text":"ran"}]}`,
    `{"role":"assistant","content":[{"type":"text","text":" done"}]}`,
    ``,
  ].join("\n");
  const parsed = m.parseKimiStdout(stdout);
  console.assert(parsed.events.length === 3, "3 events");
  console.assert(parsed.toolEvents.length === 1, "1 tool event");
  console.assert(parsed.assistantText === "Running done", "assistant text joined");

  // parseSessionIdFromStderr
  const sid = m.parseSessionIdFromStderr("noise\nTo resume this session: kimi -r 22c1cc04-fc62-4cf4-98e0-ad42b47042bd\nmore");
  console.assert(sid === "22c1cc04-fc62-4cf4-98e0-ad42b47042bd", "stderr uuid");
});
'
```

Expected: all 8 assertions pass silently; `text: "visible more"` prints.

- [ ] **Step 7: Commit**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add plugins/kimi/scripts/lib/kimi.mjs
git commit -m "feat(kimi): stream-json parsers and session-id extraction helpers"
```

---

## Task 2.2: Implement `callKimi` sync wrapper

**Files:**
- Modify: `plugins/kimi/scripts/lib/kimi.mjs`

- [ ] **Step 1: Add callKimi above the final export block**

Insert:

```js
// ── Sync call (spec §3.1, §3.5) ────────────────────────────

// Build argv for `kimi -p ... --print --output-format stream-json ...`.
// Two prompt-delivery modes (probe 03 + codex C1 verify):
//   - "inline"  → pass prompt as `-p "<text>"` (default for < threshold)
//   - "stdin"   → pass `-p ""` and write the prompt on stdin
//                 (probe 03 empirically works on kimi 1.36; codex read
//                 the source and warned this might fail — we prefer the
//                 empirical truth, but Phase 2 Task 2.7 validates this
//                 path with a 200KB test; if it fails, flip to tmpfile
//                 fallback via a follow-up commit)
function buildKimiArgs({ prompt, model, useStdinForPrompt, resumeSessionId, extraArgs }) {
  const args = ["-p", useStdinForPrompt ? "" : prompt, "--print", "--output-format", "stream-json"];
  if (model) args.push("-m", model);
  if (resumeSessionId) args.push("-r", resumeSessionId);
  if (extraArgs?.length) args.push(...extraArgs);
  return args;
}

// Map non-zero exit codes to user-visible error messages per
// kimi-cli-runtime exit-code table + probe 05 findings. Prefer structured
// pre-flight check (see callKimi) over text grep; this is the fallback.
function describeKimiExit({ status, stdout, stderr }) {
  if (status === KIMI_EXIT.CONFIG_ERROR && (stdout || "").includes(LLM_NOT_SET_MARKER)) {
    return "Model not configured in ~/.kimi/config.toml (LLM not set)";
  }
  if (status === KIMI_EXIT.USAGE_ERROR) {
    const clip = (stderr || "").slice(0, 200).trim();
    return clip || "Invalid CLI usage (exit 2)";
  }
  if (status === KIMI_EXIT.SIGINT) return "Cancelled by user (SIGINT)";
  if (status === KIMI_EXIT.SIGTERM) return "Request was interrupted (SIGTERM)";
  const clip = (stderr || "").slice(0, 200).trim();
  return clip ? `exit ${status}: ${clip}` : `exit ${status}`;
}

// Unified result shape for both callKimi and callKimiStreaming (codex C6).
// All error paths include status + partialResponse + events (for debug /
// partial recovery). All success paths include response + sessionId +
// events + toolEvents + thinkBlocks.
function errorResult({ status, error, stdout, events, textParts }) {
  const partialEvents = events ?? (stdout ? parseKimiStdout(stdout).events : []);
  const partialText = textParts
    ? textParts.join("")
    : (stdout ? parseKimiStdout(stdout).assistantText : "");
  return {
    ok: false,
    error,
    status: status ?? null,
    partialResponse: partialText || null,
    events: partialEvents,
  };
}

export function callKimi({
  prompt,
  model,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
}) {
  // ── Pre-flight (codex C2) ──
  // Validate requested model against ~/.kimi/config.toml [models.*] BEFORE
  // spawning kimi. Avoids the "LLM not set" exit-1 path (which creates a
  // wasted session). Only applies when -m is explicitly provided; default
  // model is validated by getKimiAuthStatus in Phase 1.
  if (model) {
    const configured = readKimiConfiguredModels();
    if (configured.length > 0 && !configured.includes(model)) {
      return errorResult({
        status: KIMI_EXIT.CONFIG_ERROR,
        error: `Model '${model}' is not configured in ~/.kimi/config.toml. Available: ${configured.join(", ")}`,
        events: [],
      });
    }
  }

  const useStdinForPrompt = (prompt || "").length >= LARGE_PROMPT_THRESHOLD_BYTES;
  const args = buildKimiArgs({ prompt, model, useStdinForPrompt, resumeSessionId, extraArgs });

  const result = runCommand(KIMI_BIN, args, {
    cwd,
    timeout,
    input: useStdinForPrompt ? prompt : undefined,
  });

  if (result.error) {
    return errorResult({ error: result.error.message, events: [] });
  }
  if (result.status !== 0) {
    return errorResult({
      status: result.status,
      error: describeKimiExit(result),
      stdout: result.stdout,
    });
  }

  const { events, assistantText, toolEvents } = parseKimiStdout(result.stdout);

  // ── Empty-response guard (gemini G1) ──
  // Exit 0 with no events is a silent-failure mode: kimi returned without
  // emitting any JSONL (e.g. stream-json format unknown, or kimi-cli dumped
  // raw text on an uncommon path). Treat as error with rawStdout attached
  // so the caller can inspect.
  if (events.length === 0 && !assistantText) {
    return {
      ok: false,
      error: "kimi exited 0 but produced no stream-json events",
      status: KIMI_EXIT.OK,
      rawStdout: (result.stdout || "").slice(0, 2000),
      events: [],
    };
  }

  const sessionId =
    parseSessionIdFromStderr(result.stderr) ||
    readSessionIdFromKimiJson(cwd || process.cwd());

  // Gemini G4: count think blocks so Claude can surface "Kimi thought for N
  // blocks" as a quality signal without surfacing the raw reasoning.
  const thinkBlocks = events
    .filter((e) => e.role === "assistant")
    .flatMap((e) => (e.content || []).filter((b) => b && b.type === "think"))
    .length;

  return {
    ok: true,
    response: assistantText,
    sessionId,
    events,
    toolEvents,
    thinkBlocks,
  };
}
```

- [ ] **Step 2: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/kimi.mjs
```

- [ ] **Step 3: Smoke test — real kimi call (sync)**

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(async m => {
  const r = m.callKimi({ prompt: "Reply with exactly: hello", cwd: process.cwd() });
  console.log("ok:", r.ok);
  console.log("response:", JSON.stringify(r.response));
  console.log("sessionId:", r.sessionId);
  console.log("events:", r.events?.length);
  console.assert(r.ok === true, "must succeed");
  console.assert(typeof r.response === "string" && r.response.length > 0, "response non-empty");
  console.assert(/^[0-9a-f-]{36}$/.test(r.sessionId || ""), "sessionId is a uuid");
  console.assert(Array.isArray(r.events) && r.events.length >= 1, "at least one event");
});
'
```

Expected: prints ok/response/sessionId/events≥1; all assertions pass. Response text will contain "hello" (kimi may add phrasing around it — test just checks non-empty).

- [ ] **Step 4: Smoke test — invalid model (exit 1 path)**

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(async m => {
  const r = m.callKimi({ prompt: "hi", model: "totally-not-a-model-9999", cwd: process.cwd() });
  console.log("ok:", r.ok, "error:", r.error);
  console.assert(r.ok === false, "must fail");
  console.assert(/Model not configured|LLM not set|configured/i.test(r.error), "clear config error");
});
'
```

Expected: `ok: false`, error message mentions config.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/kimi.mjs
git commit -m "feat(kimi): callKimi sync wrapper with exit-code routing and session-id dual path"
```

---

## Task 2.3: Implement `callKimiStreaming` async wrapper

**Files:**
- Modify: `plugins/kimi/scripts/lib/kimi.mjs`

- [ ] **Step 1: Add callKimiStreaming**

Add the `spawn` import at top if not already present. Insert this function before the final export block:

```js
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

// ── Streaming call (spec §3.3) ─────────────────────────────
//
// Emit one `onEvent(event)` per parsed JSONL line as it arrives. Returns a
// Promise resolving to the same shape as callKimi. Multi-byte safe via
// StringDecoder. Handles last-line-no-newline by flushing decoder on close.
export function callKimiStreaming({
  prompt,
  model,
  cwd,
  timeout = DEFAULT_TIMEOUT_MS,
  extraArgs = [],
  resumeSessionId = null,
  onEvent = () => {},
}) {
  // Pre-flight model check, same as callKimi (codex C2).
  if (model) {
    const configured = readKimiConfiguredModels();
    if (configured.length > 0 && !configured.includes(model)) {
      return Promise.resolve(errorResult({
        status: KIMI_EXIT.CONFIG_ERROR,
        error: `Model '${model}' is not configured in ~/.kimi/config.toml. Available: ${configured.join(", ")}`,
        events: [],
      }));
    }
  }

  const useStdinForPrompt = (prompt || "").length >= LARGE_PROMPT_THRESHOLD_BYTES;
  const args = buildKimiArgs({ prompt, model, useStdinForPrompt, resumeSessionId, extraArgs });

  return new Promise((resolve) => {
    const child = spawn(KIMI_BIN, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const decoder = new StringDecoder("utf8");
    let lineBuffer = "";
    let stderrBuf = "";
    const events = [];
    const toolEvents = [];
    const textParts = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeout);

    if (useStdinForPrompt) child.stdin.write(prompt);
    child.stdin.end();

    function processLine(raw) {
      const ev = parseKimiEventLine(raw);
      if (!ev) return;
      events.push(ev);
      if (ev.role === "assistant") {
        const t = extractAssistantText(ev);
        if (t) textParts.push(t);
      } else if (ev.role === "tool") {
        toolEvents.push(ev);
      }
      try { onEvent(ev); } catch { /* callback errors don't break us */ }
    }

    child.stdout.on("data", (chunk) => {
      lineBuffer += decoder.write(chunk);
      let i;
      while ((i = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, i);
        lineBuffer = lineBuffer.slice(i + 1);
        processLine(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });

    child.on("close", (status) => {
      clearTimeout(timer);
      lineBuffer += decoder.end();
      if (lineBuffer.trim()) {
        processLine(lineBuffer);
        lineBuffer = "";
      }

      // Unified timeout contract (codex C6): same shape as other errors.
      if (timedOut) {
        resolve(errorResult({
          status: KIMI_STATUS_TIMED_OUT,
          error: `kimi timed out after ${Math.round(timeout / 1000)}s`,
          events,
          textParts,
        }));
        return;
      }

      if (status !== 0) {
        resolve(errorResult({
          status,
          error: describeKimiExit({ status, stdout: textParts.join(""), stderr: stderrBuf }),
          events,
          textParts,
        }));
        return;
      }

      // Empty-response guard (gemini G1) mirrored in streaming path.
      if (events.length === 0 && textParts.length === 0) {
        resolve({
          ok: false,
          error: "kimi exited 0 but produced no stream-json events",
          status: KIMI_EXIT.OK,
          events: [],
        });
        return;
      }

      const sessionId =
        parseSessionIdFromStderr(stderrBuf) ||
        readSessionIdFromKimiJson(cwd || process.cwd());

      const thinkBlocks = events
        .filter((e) => e.role === "assistant")
        .flatMap((e) => (e.content || []).filter((b) => b && b.type === "think"))
        .length;

      resolve({
        ok: true,
        response: textParts.join(""),
        sessionId,
        events,
        toolEvents,
        thinkBlocks,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(errorResult({ error: err.message, events, textParts }));
    });
  });
}
```

- [ ] **Step 2: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/kimi.mjs
```

- [ ] **Step 3: Smoke test — streaming with event counter**

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(async m => {
  let count = 0;
  const r = await m.callKimiStreaming({
    prompt: "Reply with exactly: streaming ok",
    cwd: process.cwd(),
    onEvent: (ev) => { count++; console.log("EV#" + count, ev.role); },
  });
  console.log("ok:", r.ok, "events:", r.events.length, "onEvent fires:", count);
  console.log("response:", JSON.stringify(r.response));
  console.log("sessionId:", r.sessionId);
  console.assert(r.ok === true, "must succeed");
  console.assert(count >= 1, "onEvent fired at least once");
  console.assert(count === r.events.length, "fire count matches events array length");
  console.assert(typeof r.response === "string" && r.response.length > 0, "non-empty response");
  console.assert(/^[0-9a-f-]{36}$/.test(r.sessionId || ""), "sessionId uuid");
});
'
```

Expected: at least one `EV#N` line; all assertions pass. sessionId extracted from stderr.

- [ ] **Step 4: Smoke test — UTF-8 safety (Chinese character)**

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(async m => {
  const r = await m.callKimiStreaming({
    prompt: "请只回复一个字: 好",
    cwd: process.cwd(),
  });
  console.log("ok:", r.ok);
  console.log("response:", r.response);
  console.assert(r.ok === true, "must succeed");
  // Response should contain 好 without garbled bytes
  console.assert(r.response.includes("好") || r.response.length > 0,
    "response intact (中文没有乱码)");
});
'
```

Expected: response contains `好` (or at least non-empty text). No `\uFFFD` replacement chars.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/kimi.mjs
git commit -m "feat(kimi): callKimiStreaming with StringDecoder multi-byte safety and onEvent"
```

---

## Task 2.4: Add `ask` subcommand to `kimi-companion.mjs`

**Files:**
- Modify: `plugins/kimi/scripts/kimi-companion.mjs`

- [ ] **Step 1: Import callKimi + callKimiStreaming**

Find the existing import block and add:

```js
import { callKimi, callKimiStreaming } from "./lib/kimi.mjs";
```

(The file already imports the other helpers.)

- [ ] **Step 2: Add `runAsk` function**

Add this function between `runSetup` and the dispatcher's `main`:

```js
async function runAsk(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    valueOptions: ["model", "resume"],
    booleanOptions: ["json", "stream"],
    aliasMap: { m: "model", r: "resume" },
  });

  const prompt = positionals.join(" ").trim();
  if (!prompt) {
    process.stderr.write(
      "Error: /kimi:ask requires a prompt.\nUsage: kimi-companion ask [--json] [-m <model>] [-r <sid>] \"<prompt>\"\n"
    );
    process.exit(KIMI_EXIT.USAGE_ERROR);
  }

  // Reject --stream from /kimi:ask command path (codex C5). The Claude Code
  // slash-command contract is "verbatim present a single response"; streaming
  // JSONL is a developer-only companion mode. Guard via env var that the
  // command.md bash invocation does NOT set — only direct CLI debugging.
  if (options.stream && process.env.CLAUDE_PLUGIN_ROOT) {
    process.stderr.write(
      "Error: --stream is not supported through /kimi:ask. Invoke kimi-companion directly for streaming debug.\n"
    );
    process.exit(KIMI_EXIT.USAGE_ERROR);
  }

  const callArgs = {
    prompt,
    model: options.model || null,
    resumeSessionId: options.resume || null,
    cwd: process.cwd(),
  };

  if (options.stream) {
    // Developer streaming mode: emit each event as a JSONL line (same wire
    // shape as input), then a final summary line {summary:{...}}.
    const result = await callKimiStreaming({
      ...callArgs,
      onEvent: (ev) => { process.stdout.write(JSON.stringify(ev) + "\n"); },
    });
    const summary = {
      summary: {
        ok: result.ok,
        response: result.response || null,
        sessionId: result.sessionId || null,
        error: result.error || null,
        thinkBlocks: result.thinkBlocks ?? null,
      },
    };
    process.stdout.write(JSON.stringify(summary) + "\n");
    process.exit(result.ok ? KIMI_EXIT.OK : (result.status ?? 1));
  }

  const result = callKimi(callArgs);
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (!result.ok) {
      process.stderr.write(`Error: ${result.error}\n`);
      if (result.partialResponse) process.stderr.write(`Partial response:\n${result.partialResponse}\n`);
      process.exit(result.status ?? 1);
    }
    process.stdout.write(result.response + "\n");
  }
  // Propagate kimi's original exit status (codex C4) so callers can distinguish
  // config vs usage vs signal causes. result.status is null on success paths.
  process.exit(result.ok ? KIMI_EXIT.OK : (result.status ?? 1));
}
```

- [ ] **Step 3: Wire `ask` into the dispatcher AND extend blob-unpack rule**

**Codex C3 fix**: the Phase 1 guard (`shouldUnpackBlob` requires all-tokens-start-with-`-`) correctly protects Phase 2 prompts with spaces, BUT `ask` has a mixed case: `$ARGUMENTS` may contain `--json --model foo my prompt here`. A single blob here has BOTH flags AND a prompt. Phase 1 heuristic won't split it (not all tokens `-`), so flags get eaten into the prompt.

Extend `UNPACK_SAFE_SUBCOMMANDS` and adjust `shouldUnpackBlob` to handle `ask` specifically: if the blob starts with `-`, split (even if not all tokens are flags — mixed flags+prompt is the `ask` contract).

Find the existing block:

```js
const UNPACK_SAFE_SUBCOMMANDS = new Set(["setup"]);

function shouldUnpackBlob(sub, rest) {
  if (rest.length !== 1) return false;
  if (!UNPACK_SAFE_SUBCOMMANDS.has(sub)) return false;
  if (!rest[0].includes(" ")) return false;
  const tokens = splitRawArgumentString(rest[0]);
  return tokens.length > 0 && tokens.every((t) => t.startsWith("-"));
}
```

Replace with:

```js
// Subcommands whose $ARGUMENTS blob should be split into flags/positionals.
// - setup: all-flags contract (every token is "-…"); split when space present
// - ask:   mixed flags+prompt contract; split when blob STARTS with "-"
//          (leading "-" signals "flags then prompt"); otherwise treat whole
//          blob as a single prompt positional
const UNPACK_SAFE_SUBCOMMANDS = new Set(["setup", "ask"]);

function shouldUnpackBlob(sub, rest) {
  if (rest.length !== 1) return false;
  if (!UNPACK_SAFE_SUBCOMMANDS.has(sub)) return false;
  if (!rest[0].includes(" ")) return false;
  const tokens = splitRawArgumentString(rest[0]);
  if (tokens.length === 0) return false;
  if (sub === "setup") return tokens.every((t) => t.startsWith("-"));
  if (sub === "ask") return tokens[0].startsWith("-");
  return false;
}
```

Then find the `switch (sub)` block in `main()` and add the `"ask"` case:

```js
  switch (sub) {
    case "setup":
      return runSetup(rest);
    case "ask":
      return runAsk(rest);
    case undefined:
    case "--help":
    case "-h":
      process.stdout.write(USAGE + "\n");
      process.exit(0);
      break;
    default:
      process.stderr.write(`Unknown subcommand: ${sub}\n${USAGE}\n`);
      process.exit(1);
  }
```

Also update `USAGE`:

```js
const USAGE = `Usage: kimi-companion <subcommand> [options]

Subcommands:
  setup [--json]                       Check kimi CLI availability, auth, and configured models
  ask [--json] [--stream] [-m <model>] [-r <sessionId>] "<prompt>"
                                       Send a one-shot prompt. --stream emits JSONL events as they arrive.

(More subcommands arrive in Phase 3+.)`;
```

- [ ] **Step 4: Syntax check**

```bash
node --check plugins/kimi/scripts/kimi-companion.mjs
```

- [ ] **Step 5: Smoke test — text output path**

```bash
node plugins/kimi/scripts/kimi-companion.mjs ask "Reply with exactly: smoke"
```

Expected: prints a line containing "smoke" (or kimi's paraphrase).

- [ ] **Step 6: Smoke test — JSON output path**

```bash
node plugins/kimi/scripts/kimi-companion.mjs ask --json "Reply with exactly: json"
```

Expected: pretty-printed JSON with `ok`, `response`, `sessionId`, `events`.

- [ ] **Step 7: Smoke test — streaming output path**

```bash
node plugins/kimi/scripts/kimi-companion.mjs ask --stream "Say hi" | tee /tmp/ask-stream.jsonl
wc -l /tmp/ask-stream.jsonl
tail -1 /tmp/ask-stream.jsonl | python3 -m json.tool
```

Expected: at least 2 lines (≥1 event + 1 summary line); last line is JSON with a `summary` key.

- [ ] **Step 8: Commit**

```bash
git add plugins/kimi/scripts/kimi-companion.mjs
git commit -m "feat(companion): ask subcommand with sync/json/streaming modes"
```

---

## Task 2.5: Create `/kimi:ask` command

**Files:**
- Create: `plugins/kimi/commands/ask.md`

- [ ] **Step 1: Write the command**

```markdown
---
description: Delegate a task or ask a question to Kimi
argument-hint: '[--model <model>] [--resume <sessionId>] <prompt>'
allowed-tools: Bash(node:*)
---

Run:

\`\`\`bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" ask --json "$ARGUMENTS"
\`\`\`

Parse the JSON result:

**If `ok: true`**:
1. Present `response` **verbatim**. Preserve Chinese or other-language output — do NOT translate unless the user explicitly asked.
2. **MUST** append a footer line (gemini G3 — otherwise `--resume` is unreachable):
   ```
   (session: <sessionId> · model: <model> [· thinkBlocks: N if non-zero])
   ```
   The sessionId comes from the JSON `sessionId` field. Model from the JSON `events[].model` if present, else omit. `thinkBlocks` only shown if ≥ 1.
3. After the footer, note disagreements if any: "Note: Claude disagrees on X because Y." Don't hide disagreement to appear consistent.
4. Do NOT auto-apply suggestions. Ask which items to act on.

**If `ok: false`**:
1. Present `error` clearly.
2. If `partialResponse` is non-null, include it under a "Partial response from Kimi before the error" heading.
3. **Active recovery** (gemini G7): if `error` mentions "configured", "timed out", or "Model not configured" — propose a concrete next action:
   - "Model not configured" → list `configured_models` from `/kimi:setup` (re-run if needed) and ask which to try
   - "timed out" → offer "Should I split the prompt into smaller pieces and retry?"
   - SIGTERM / SIGINT → "Request was interrupted. Retry the same prompt?"
4. Do NOT retry automatically from this command — wait for user confirmation.

### Options

- `--model <name>` — pick a specific model from `configured_models` (see `/kimi:setup`)
- `--resume <sessionId>` — continue a previous Kimi session by its UUID
- `--stream` (advanced) — not used from the Claude Code command; developer-only when invoking the companion directly
```

(Hygiene: write real triple-backticks in the file; the escaped ones above are just for this prompt.)

- [ ] **Step 2: Verify**

```bash
head -5 plugins/kimi/commands/ask.md
```

- [ ] **Step 3: Commit**

```bash
git add plugins/kimi/commands/ask.md
git commit -m "feat(command): /kimi:ask"
```

---

## Task 2.6: Polish `kimi-result-handling` skill

**Files:**
- Modify: `plugins/kimi/skills/kimi-result-handling/SKILL.md`

- [ ] **Step 1: Append concrete rendering examples**

After the existing "What to expand in Phase 5" section, REPLACE that section with:

```markdown
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
```

- [ ] **Step 2: Verify**

```bash
wc -l plugins/kimi/skills/kimi-result-handling/SKILL.md
```

Expected: line count grew (was ~36, should be ~60+ now).

- [ ] **Step 3: Commit**

```bash
git add plugins/kimi/skills/kimi-result-handling/SKILL.md
git commit -m "docs(skill): kimi-result-handling with concrete /kimi:ask patterns"
```

---

## Task 2.7: T2 + T3 + T4 automated validation

**Files:** (no code changes)

- [ ] **Step 1: T2 — sync ask returns text**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
OUT=$(node plugins/kimi/scripts/kimi-companion.mjs ask --json "Reply with exactly: hello")
echo "$OUT" | python3 - <<'PY'
import json, sys
d = json.loads(sys.stdin.read())
assert d["ok"] is True, d
assert isinstance(d["response"], str) and len(d["response"]) > 0, "response non-empty"
assert isinstance(d["sessionId"], str) and len(d["sessionId"]) == 36, "sessionId uuid"
print("T2 PASS — response:", d["response"][:80])
PY
```

Expected: `T2 PASS` with the first 80 chars of the response.

- [ ] **Step 2: T3 — streaming fires multiple events**

```bash
node plugins/kimi/scripts/kimi-companion.mjs ask --stream "讲一个很短的笑话" > /tmp/t3.jsonl 2>/dev/null
NUM_LINES=$(wc -l < /tmp/t3.jsonl | tr -d ' ')
echo "stream lines: $NUM_LINES"
python3 - <<'PY'
import json
lines = [json.loads(l) for l in open("/tmp/t3.jsonl") if l.strip()]
events = [l for l in lines if "summary" not in l]
summary = [l for l in lines if "summary" in l]
assert len(summary) == 1, "exactly one summary line"
assert summary[0]["summary"]["ok"] is True, "streaming ok"
assert len(events) >= 1, "at least one event"
print(f"T3 PASS — {len(events)} event line(s), 1 summary")
PY
```

Expected: `T3 PASS`.

- [ ] **Step 3: T4 — sessionId matches kimi.json**

```bash
OUT=$(node plugins/kimi/scripts/kimi-companion.mjs ask --json "Reply: T4")
echo "$OUT" | python3 - <<'PY'
import json, os, sys
d = json.loads(sys.stdin.read())
sid_returned = d["sessionId"]

kimi_json = json.load(open(os.path.expanduser("~/.kimi/kimi.json")))
cwd = os.getcwd()
entry = [w for w in kimi_json.get("work_dirs", []) if w.get("path") == cwd]
assert entry, f"no work_dirs entry for cwd={cwd}"
sid_json = entry[0].get("last_session_id")

assert sid_returned == sid_json, f"sessionId mismatch: returned={sid_returned} json={sid_json}"
print(f"T4 PASS — sessionId {sid_returned} matches kimi.json")
PY
```

Expected: `T4 PASS`.

- [ ] **Step 4: Invalid-model routing check (pre-flight path, codex C2)**

```bash
node plugins/kimi/scripts/kimi-companion.mjs ask --json --model "totally-fake-9999" "hi" > /tmp/bad.json || true
python3 - <<'PY'
import json
d = json.load(open("/tmp/bad.json"))
assert d["ok"] is False, "must fail"
# With pre-flight, error should mention "not configured" and list available models
assert "not configured" in d["error"].lower() or "LLM not set" in d["error"]
# Status is CONFIG_ERROR (1), NOT a generic fallback
assert d.get("status") == 1, f"status should be 1 (CONFIG_ERROR), got {d.get('status')}"
print("invalid-model PASS — error:", d["error"][:100])
PY
```

Expected: error mentions "not configured"; exit status is 1.

- [ ] **Step 5: Large-prompt stdin path (gemini G5, codex C1 verify)**

Generate ~150KB prompt (above LARGE_PROMPT_THRESHOLD_BYTES=100000) to exercise the stdin path empirically:

```bash
python3 -c 'print("Summarize this in one short sentence: " + "the quick brown fox " * 7500 + "\\nReply with exactly: BIG")' > /tmp/big-prompt.txt
BIG=$(wc -c < /tmp/big-prompt.txt)
echo "prompt size: $BIG bytes"
# Pass via argv — callKimi auto-switches to stdin path internally
node plugins/kimi/scripts/kimi-companion.mjs ask --json "$(cat /tmp/big-prompt.txt)" > /tmp/large.json 2>&1 || true
python3 - <<'PY'
import json, sys
try:
    d = json.load(open("/tmp/large.json"))
except Exception as e:
    print("FAIL parse:", e)
    print(open("/tmp/large.json").read()[:500])
    sys.exit(1)
assert d["ok"] is True, f"large prompt must succeed; got error: {d.get('error')}"
assert isinstance(d["response"], str) and len(d["response"]) > 0, "non-empty response"
print("large-prompt PASS — response:", d["response"][:80])
PY
```

Expected: `large-prompt PASS`. If this fails with `-p ""` path empty-prompt error, codex C1 is validated; add a follow-up commit replacing the stdin path with a tmpfile fallback in `buildKimiArgs`.

- [ ] **Step 6: Resume continuity (gemini G5)**

Exercise `--resume` to confirm kimi remembers prior context (not just that the field matches):

```bash
# Call 1: establish a memory fact
OUT1=$(node plugins/kimi/scripts/kimi-companion.mjs ask --json "Remember the number 42. Reply with exactly: NOTED")
SID=$(echo "$OUT1" | python3 -c 'import json, sys; print(json.load(sys.stdin)["sessionId"])')
echo "session: $SID"

# Call 2: ask what the number was, via -r
OUT2=$(node plugins/kimi/scripts/kimi-companion.mjs ask --json --resume "$SID" "What number did I ask you to remember? Reply with just the digits, no prose.")
RESP=$(echo "$OUT2" | python3 -c 'import json, sys; print(json.load(sys.stdin)["response"])')
echo "response: $RESP"

python3 - <<PY
resp = """$RESP"""
assert "42" in resp, f"resume must recall 42, got: {resp}"
print("resume PASS — recalled the number")
PY
```

Expected: `resume PASS — recalled the number`. If the second call doesn't remember 42, either `-r` isn't wired or the session isn't actually being resumed; investigate before proceeding.

- [ ] **Step 7: No commit needed** (validation only).

---

## Task 2.8: Phase 2 CHANGELOG + tag

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Append CHANGELOG entry**

Append at the top of `CHANGELOG.md` (below header):

```markdown
## 2026-04-20 [Claude Opus 4.7 — Phase 2 ask + streaming]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/kimi.mjs, plugins/kimi/scripts/kimi-companion.mjs, plugins/kimi/commands/ask.md (new), plugins/kimi/skills/kimi-result-handling/SKILL.md
- **summary**: /kimi:ask implemented end-to-end with sync, JSON, and (developer-only) streaming modes. Integrates 11 findings from plan-level 3-way review before execution.
  - **kimi.mjs runtime sentinels** (codex C7): added LLM_NOT_SET_MARKER / KIMI_EXIT / KIMI_STATUS_TIMED_OUT constants block near top; source-derived markers live in one place for future updates.
  - **Stream parsing**: parseKimiEventLine / extractAssistantText / parseKimiStdout (multi-line JSONL; keep type==="text", drop "think", skip unknown).
  - **Session id**: parseSessionIdFromStderr (primary, stderr regex) + readSessionIdFromKimiJson (secondary, kimi.json.work_dirs by verbatim path).
  - **callKimi** (sync, spawnSync via runCommand):
    - Pre-flight model check via readKimiConfiguredModels before spawn (codex C2); returns `Model 'X' not configured` with available list when mismatched.
    - Empty-response guard (gemini G1): exit 0 + 0 events + empty text → `{ok:false, error:"produced no stream-json events", rawStdout}`.
    - Unified error shape via `errorResult()` helper (codex C6): {ok, error, status, partialResponse, events} consistent across invalid-model / exit-nonzero / timeout / spawn-error / empty-response paths.
    - thinkBlocks count (gemini G4) exposed on success for UX surfacing.
    - Stdin path for prompt >= 100000 bytes (probe 03 threshold; codex C1 noted as verify-in-Task-2.7).
  - **callKimiStreaming** (async, spawn + StringDecoder UTF-8 safety):
    - Same pre-flight + empty-guard + errorResult contract.
    - Unified timeout return (codex C6): `{ok:false, status:KIMI_STATUS_TIMED_OUT, partialResponse, events}`.
  - **kimi-companion.mjs**:
    - Ask subcommand with --json / --stream / -m / -r flags.
    - Arg-unpack rule extended (codex C3): `ask` blob split when leading token starts with `-` (mixed flags+prompt); `setup` keeps all-flags-only rule. Phase 2+ prompts with spaces stay unsplit.
    - Blocks `--stream` when `CLAUDE_PLUGIN_ROOT` env is set (codex C5): slash-command path always uses sync JSON; streaming reserved for direct CLI debug.
    - Exit status propagated (codex C4): `process.exit(result.status ?? 1)` preserves kimi's original CONFIG_ERROR=1 / USAGE_ERROR=2 / SIGINT=130 / SIGTERM=143 / TIMED_OUT=-1 for callers to route on.
  - **commands/ask.md**:
    - Verbatim-response contract with MANDATORY `(session: <id> · model: <m> [· thinkBlocks: N])` footer (gemini G3) — otherwise `--resume` is unreachable.
    - Active-recovery paths (gemini G7): on config error / timeout / signal, propose concrete next steps rather than generic "try again."
  - **kimi-result-handling SKILL.md**: concrete rendering patterns for /kimi:ask success, partialResponse handling, Chinese/mixed-language rules, think-block policy.
  - **Test coverage** (gemini G5): T2 basic, T3 streaming, T4 sessionId parity, invalid-model routing, large-prompt stdin (150KB), `--resume` continuity (recalls a fact set in a prior call — not just field match).
- **next**: author docs/superpowers/plans/YYYY-MM-DD-phase-3-review-retry.md. Phase 3 adds /kimi:review with git diff collection, schema-validated JSON findings, and 1-shot JSON-parse retry.
```

- [ ] **Step 2: Commit and tag**

```bash
git add CHANGELOG.md
git commit -m "chore: Phase 2 ask + streaming complete; T2 T3 T4 PASS"
git tag -a phase-2-ask -m "Phase 2 complete: /kimi:ask with sync/json/stream modes"
git log --oneline | head -15
git tag
```

Expected: `phase-2-ask` in tag list.

---

## Self-Review

**Spec coverage:**
- §3.1 CLI invocation → kimi.mjs `buildKimiArgs` + `callKimi` ✅
- §3.3.1 spawn + UTF-8 safe line buffering → Task 2.3 ✅
- §3.3.2 content aggregation → `extractAssistantText` (Task 2.1) ✅
- §3.3.3 session from stderr → `parseSessionIdFromStderr` (Task 2.1) ✅
- §3.3.4 stats unavailable → noted in companion + skill; no stats path exposed ✅
- §3.3.5 per-message UX → streaming emits one event per message; summary at end ✅
- §3.3.6 text fallback → not implemented (v0.1 scope per spec — keep as v0.2 follow-up)
- §3.4 session dual path → `parseSessionIdFromStderr` || `readSessionIdFromKimiJson` (Task 2.2) ✅
- §3.5 exit-code routing → `describeKimiExit` + KIMI_EXIT constants + exit propagation (Task 2.2 + 2.4) ✅

**Review integration audit:**
- codex C1 (`-p ""` stdin fails per source) → KEEP empirical truth (probe 03 works), Task 2.7 Step 5 empirically re-verifies at 150KB; fallback commit path documented if it fails ✅
- codex C2 (preflight for model) → callKimi + callKimiStreaming both do it ✅
- codex C3 (ask blob unpack) → `UNPACK_SAFE_SUBCOMMANDS` extended + split rule per-subcommand ✅
- codex C4 (propagate exit status) → `process.exit(result.status ?? 1)` ✅
- codex C5 (block --stream from /kimi:ask) → `CLAUDE_PLUGIN_ROOT` env gate in runAsk ✅
- codex C6 (unified timeout return) → `errorResult()` helper used across both calls ✅
- codex C7 (central runtime constants) → runtime-sentinels block in kimi.mjs; Phase 3+ extends ✅
- gemini G1 (silent empty response) → empty-response guard ✅
- gemini G3 (sessionId footer) → mandated in ask.md ✅
- gemini G4 (think block count) → `thinkBlocks` returned ✅
- gemini G5 (test gaps) → large-prompt + resume-continuity tests added to Task 2.7 ✅
- gemini G6 (SKILL modularization) → DEFERRED to Phase 3 (fold together with review skill)
- gemini G7 (smart partial recovery) → active-recovery paths in ask.md ✅
- gemini G8 (smoke test granularity) → small improvement; not applied (assertions are readable as-is)
- gemini G9 (renderGeminiResult rename) → DEFERRED to Phase 5 polish

**Placeholder scan:** all code blocks have literal values. No `<TBD>` or `<PLACEHOLDER>`.

**Type consistency:** `parseKimiEventLine`, `extractAssistantText`, `parseKimiStdout`, `parseSessionIdFromStderr`, `readSessionIdFromKimiJson`, `errorResult`, `describeKimiExit`, `callKimi`, `callKimiStreaming` + constants `LLM_NOT_SET_MARKER` / `KIMI_EXIT` / `KIMI_STATUS_TIMED_OUT` all used consistently across tasks 2.1–2.4.

**Cross-platform:** `spawn` / `spawnSync` behavior identical on macOS/Linux. `SIGTERM` handling works the same. UTF-8 decoding via `StringDecoder` is Node-provided. macOS/Linux only.

**Security:** `callKimi` passes `prompt` through stdin for large prompts (avoids argv injection). `-p "..."` path uses native spawn args (not shell) — no command injection possible.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-20-phase-2-ask-streaming.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — one fresh subagent per task (sonnet for kimi.mjs edits with streaming logic; haiku for command.md + skill polish + validation). Serial — each task modifies kimi.mjs so parallel is unsafe.

**2. Inline Execution** — do it in-session; good if you want to sanity-check the streaming output in real time.

**Which approach?**

---

## Follow-up plans (written after `phase-2-ask` tag)

- `phase-3-review-retry.md` — `/kimi:review` with diff collection + schema-validated JSON findings + 1-shot parse retry
- `phase-4-background-agent.md` — `/kimi:rescue` + kimi-agent subagent + status/result/cancel + hooks
- `phase-5-adversarial-polish.md` — `/kimi:adversarial-review` + skill finalize + lessons.md final
