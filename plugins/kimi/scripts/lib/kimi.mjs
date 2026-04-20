import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
