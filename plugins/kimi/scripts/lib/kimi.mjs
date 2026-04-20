import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { runCommand, binaryAvailable } from "./process.mjs";

// ── Constants ──────────────────────────────────────────────
// All values below are sourced from doc/probe/probe-results.json v3.

const DEFAULT_TIMEOUT_MS = 300_000;
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PARENT_SESSION_ENV = "KIMI_COMPANION_SESSION_ID";
const KIMI_BIN = process.env.KIMI_CLI_BIN || "kimi";
const PING_MAX_STEPS = 1;
const SESSION_ID_STDERR_REGEX = /kimi -r ([0-9a-f-]{36})/;
const LARGE_PROMPT_THRESHOLD_BYTES = 100_000;

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

// Synthetic status for local timeout (we SIGTERM the child). GNU `timeout(1)`
// uses 124 as the "exceeded time limit" convention; POSIX exit codes are
// 0-255 unsigned (gemini review v2 #4: -1 would wrap to 255 and collide with
// real signal-induced exits — avoid). 124 fits in [0,255] and is unused by
// kimi (probe 05 observed only 0/1/2/130/143).
//
// Defensive note (gemini v3-review A5): if a future kimi-cli release ever
// returns 124 for its own reasons (unlikely — the Click / Python runtime
// doesn't naturally use 124), our describeKimiExit will mistake a real
// kimi exit for a local timeout. Monitor: add a probe to Phase 0 test
// sweep when upgrading kimi-cli major versions.
export const KIMI_STATUS_TIMED_OUT = 124;

// ── TOML top-level key scanner (spec §3.6) ─────────────────

export function readTomlTopLevelKey(text, key) {
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) return null;
    const m = line.match(/^(\w+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
    if (m && m[1] === key) return m[2];
  }
  return null;
}

// ── TOML [models.*] section names (for model preflight) ───
//
// Handles both bare keys (`[models.foo]`) and quoted keys with slashes
// (`[models."vendor/model"]`). Quotes are stripped on return so callers can
// match against kimi's own -m flag values (probe 01 confirmed host config
// uses `[models."kimi-code/kimi-for-coding"]`).
export function readTomlModelSectionNames(text) {
  const lines = text.split(/\r?\n/);
  const names = [];
  // Bare:    [models.some_name]
  // Double:  [models."vendor/model"]
  // Single:  [models.'vendor/model']
  const re = /^\[models\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_\-]+))\]\s*(?:#.*)?$/;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(re);
    if (m) names.push(m[1] || m[2] || m[3]);
  }
  return names;
}

let _cachedDefaultModel;
let _cachedConfiguredModels;

function readKimiConfig() {
  try {
    const configPath = path.join(os.homedir(), ".kimi", "config.toml");
    return fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
}

export function readKimiDefaultModel() {
  if (_cachedDefaultModel !== undefined) return _cachedDefaultModel;
  const text = readKimiConfig();
  _cachedDefaultModel = text ? readTomlTopLevelKey(text, "default_model") : null;
  return _cachedDefaultModel;
}

export function readKimiConfiguredModels() {
  if (_cachedConfiguredModels !== undefined) return _cachedConfiguredModels;
  const text = readKimiConfig();
  _cachedConfiguredModels = text ? readTomlModelSectionNames(text) : [];
  return _cachedConfiguredModels;
}

// ── Availability ───────────────────────────────────────────

export function getKimiAvailability(cwd) {
  return binaryAvailable(KIMI_BIN, ["-V"], { cwd });
}

// ── Authentication check (spec §3.7) ───────────────────────

function credentialsDirNonEmpty() {
  try {
    const dir = path.join(os.homedir(), ".kimi", "credentials");
    return fs.readdirSync(dir).some((e) => !e.startsWith("."));
  } catch {
    return false;
  }
}

// Scan the JSONL stdout of a --print --output-format stream-json run
// for at least one assistant event with a non-empty text block. See
// doc/probe/probe-results.json v3 stream_json section for field semantics
// (content is a block list; text lives in blocks where type=="text").
function hasAssistantTextBlock(stdout) {
  if (!stdout) return false;
  for (const raw of stdout.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event.role !== "assistant") continue;
    const blocks = event.content || [];
    const hasText = blocks.some(
      (b) =>
        b &&
        b.type === "text" &&
        typeof b.text === "string" &&
        b.text.trim().length > 0
    );
    if (hasText) return true;
  }
  return false;
}

export function getKimiAuthStatus(cwd) {
  if (!credentialsDirNonEmpty()) {
    return { loggedIn: false, detail: "no credentials in ~/.kimi/credentials" };
  }

  // Model preflight (codex review C3): validate default_model is in
  // [models.*] before spending a live session. Distinguishes
  // "auth broken" from "model config broken".
  const defaultModel = readKimiDefaultModel();
  const configured = readKimiConfiguredModels();
  if (configured.length === 0) {
    return {
      loggedIn: null,
      detail: "no [models.*] sections in ~/.kimi/config.toml",
      modelConfigured: false,
    };
  }
  if (defaultModel && !configured.includes(defaultModel)) {
    return {
      loggedIn: null,
      detail: `default model '${defaultModel}' is not declared in ~/.kimi/config.toml [models.*]`,
      model: defaultModel,
      modelConfigured: false,
    };
  }

  const result = runCommand(
    KIMI_BIN,
    [
      "-p", "ping",
      "--print",
      "--output-format", "stream-json",
      "--max-steps-per-turn", String(PING_MAX_STEPS),
    ],
    { cwd, timeout: AUTH_CHECK_TIMEOUT_MS }
  );

  if (result.error) {
    return { loggedIn: false, detail: result.error.message };
  }
  if (result.status !== 0) {
    const stderrClip = (result.stderr || "").slice(0, 200).trim();
    return { loggedIn: false, detail: stderrClip || `exit ${result.status}` };
  }

  if (!hasAssistantTextBlock(result.stdout)) {
    return { loggedIn: false, detail: "ping exited 0 but no assistant text block observed" };
  }

  return {
    loggedIn: true,
    detail: "authenticated",
    model: defaultModel || "unknown",
    modelConfigured: true,
  };
}

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

// Count think blocks across all assistant events. Gemini G4: surfaced as
// a UX signal ("Kimi thought for N blocks") without leaking raw reasoning.
function countThinkBlocks(events) {
  return events
    .filter((e) => e.role === "assistant")
    .flatMap((e) => (e.content || []).filter((b) => b && b.type === "think"))
    .length;
}

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

  // ── No-visible-text guard (gemini G1 + codex/gemini v2-reviews A1) ──
  // If assistant produced no visible text, treat as failure regardless of
  // event count. This catches two silent-failure modes:
  //   (a) Exit 0 + 0 events     (stream-json format unknown / uncommon dump)
  //   (b) Exit 0 + think-only   (reasoning but no surfaced answer — user
  //                              would see "" if we returned ok)
  if (!assistantText) {
    return {
      ok: false,
      error: events.length === 0
        ? "kimi exited 0 but produced no stream-json events"
        : "kimi produced no visible text (think-only response)",
      status: KIMI_EXIT.OK,
      rawStdout: (result.stdout || "").slice(0, 2000),
      events,
      thinkBlocks: countThinkBlocks(events),
    };
  }

  const sessionId =
    parseSessionIdFromStderr(result.stderr) ||
    readSessionIdFromKimiJson(cwd || process.cwd());

  return {
    ok: true,
    response: assistantText,
    sessionId,
    events,
    toolEvents,
    thinkBlocks: countThinkBlocks(events),
  };
}

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

      // No-visible-text guard mirrored in streaming path (same fix as sync).
      // Catches both 0-events and think-only cases.
      const streamedText = textParts.join("");
      if (!streamedText) {
        resolve({
          ok: false,
          error: events.length === 0
            ? "kimi exited 0 but produced no stream-json events"
            : "kimi produced no visible text (think-only response)",
          status: KIMI_EXIT.OK,
          events,
          thinkBlocks: countThinkBlocks(events),
        });
        return;
      }

      const sessionId =
        parseSessionIdFromStderr(stderrBuf) ||
        readSessionIdFromKimiJson(cwd || process.cwd());

      resolve({
        ok: true,
        response: textParts.join(""),
        sessionId,
        events,
        toolEvents,
        thinkBlocks: countThinkBlocks(events),
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(errorResult({ error: err.message, events, textParts }));
    });
  });
}

// ── Exports for Phase 2+ to consume ────────────────────────

export {
  PING_MAX_STEPS,
  SESSION_ID_STDERR_REGEX,
  LARGE_PROMPT_THRESHOLD_BYTES,
  PARENT_SESSION_ENV,
  KIMI_BIN,
  DEFAULT_TIMEOUT_MS,
  AUTH_CHECK_TIMEOUT_MS,
};
