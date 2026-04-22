import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { loadPromptTemplate, interpolateTemplate } from "./prompts.mjs";
import { runCommand, binaryAvailable } from "./process.mjs";
import { errorResult } from "./errors.mjs";
import {
  MAX_REVIEW_DIFF_BYTES,
  TRUNCATION_NOTICE,
  RETRY_NOTICE,
  extractReviewJson,
  validateReviewOutput,
  runReviewPipeline,
  reviewError as reviewErrorImpl,
} from "./review.mjs";
export {
  MAX_REVIEW_DIFF_BYTES,
  TRUNCATION_NOTICE,
  RETRY_NOTICE,
  extractReviewJson,
  validateReviewOutput,
} from "./review.mjs";

// ── Constants ──────────────────────────────────────────────
// All values below are sourced from doc/probe/probe-results.json v3.

// Default per-call timeout. K2.5 agent-swarm mode (see Kimi-K2.5 README
// "Agent Swarm" capability) can reasonably take >5 min on long-horizon
// agentic turns, and kimi-cli 1.37 explicitly keeps the --print loop
// alive while background tasks are running (`fix(soul): keep agent
// loop alive while background tasks are running`, PR #1802). The old
// 300s ceiling would SIGTERM these into exit 143 and users would see
// "Request was interrupted" for what was actually our own premature
// kill. Default pushed to 15 min; env `KIMI_TIMEOUT_MS` lets operators
// widen (e.g. for dedicated agent-swarm scenarios) or tighten (tests).
//
// Parsing is STRICT — the env value must be purely digits. `60s` or
// `60abc` or `60.5` are rejected rather than silently parsed to 60ms
// (footgun: a user who types `KIMI_TIMEOUT_MS=60` expecting seconds
// would otherwise get 60ms and think the plugin is insta-timing-out).
// Invalid values fall back to the default with a stderr hint so the
// user knows their env was ignored. (PR #1 review #2.)
function defaultTimeoutMs() {
  const raw = process.env.KIMI_TIMEOUT_MS;
  if (!raw) return 900_000;
  if (!/^\d+$/.test(raw)) {
    process.stderr.write(
      `Warning: KIMI_TIMEOUT_MS=${JSON.stringify(raw)} is not a pure integer (expected digits only, e.g. "60000" for 60 s). Falling back to 900000 ms default.\n`
    );
    return 900_000;
  }
  const parsed = Number.parseInt(raw, 10);
  return parsed > 0 ? parsed : 900_000;
}
const DEFAULT_TIMEOUT_MS = defaultTimeoutMs();
const AUTH_CHECK_TIMEOUT_MS = 30_000;
const PARENT_SESSION_ENV = "KIMI_COMPANION_SESSION_ID";
const KIMI_BIN = process.env.KIMI_CLI_BIN || "kimi";
const PING_MAX_STEPS = 1;
const SESSION_ID_STDERR_REGEX = /kimi -r ([0-9a-f-]{36})/;
const LARGE_PROMPT_THRESHOLD_BYTES = 100_000;
const KIMI_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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

// ── Defensive large-prompt cap (C3 — P3 polish batch) ─────
//
// kimi-CLI's handling of multi-MB stdin is untested empirically
// (Phase-0 probes went to 150 KB max). This is a DEFENSIVE CAP, not a
// kernel-boundary enforcement — stdin has no ARG_MAX limit (E2BIG
// applies to argv/env only). Until a probe establishes kimi's real
// ceiling, a predictable failure message beats opaque pipe hangs.
//
// 1_000_000 chars ≈ 1 MB ASCII; CJK content compresses worse in UTF-8
// but we measure in chars, so the cap behaves consistently regardless
// of script.
export const MAX_PROMPT_CHARS = 1_000_000;

// Returns canonical errorResult on oversize; null if OK to proceed.
// Caller passes { kind, label } — kind for the error envelope shape
// (C2), label for the human-readable "multiple X calls" message.
export function checkPromptSize(prompt, { kind, label }) {
  const chars = prompt.length;
  if (chars > MAX_PROMPT_CHARS) {
    return errorResult({
      kind,
      error: `prompt exceeds ${MAX_PROMPT_CHARS} chars (got ${chars}); trim context or split into multiple ${label} calls`,
      status: null,
      stdout: "",
      detail: `prompt-too-large: ${chars} chars > ${MAX_PROMPT_CHARS} char cap`,
    });
  }
  return null;
}

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

// Parse a single JSONL line to an event. Returns { ok: true, event } for a
// parsed event, { ok: false, kind: "blank" } for blank/non-JSON (benign
// skip), or { ok: false, kind: "malformed", error, raw } for a line that
// looked like JSON (starts with `{`) but failed JSON.parse. Callers use the
// malformed-count to distinguish "empty response" from "corrupted JSONL"
// (codex Phase-5-v0.1-review H3).
export function parseKimiEventLine(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { ok: false, kind: "blank" };
  if (!trimmed.startsWith("{")) return { ok: false, kind: "blank" };
  try {
    return { ok: true, event: JSON.parse(trimmed) };
  } catch (e) {
    return { ok: false, kind: "malformed", error: e.message, raw: trimmed };
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

// Parse a multi-line stdout buffer into { events, assistantText, toolEvents,
// malformedCount, unexpectedRoleCount }. Multi-line support is required
// (probe 01/codex Q2: single run may emit several JSONL lines when tool use
// is present). `malformedCount` surfaces lines that looked like JSON but
// failed parse; `unexpectedRoleCount` surfaces events that parsed fine but
// had a role other than `assistant`/`tool` (e.g. `system` — codex 5-way-
// review L2). The two counts let callers distinguish four empty-text modes:
// (a) no events, (b) think-only, (c) corrupted JSONL, (d) only-system-roles.
export function parseKimiStdout(stdout) {
  const events = [];
  const toolEvents = [];
  const textParts = [];
  let malformedCount = 0;
  let unexpectedRoleCount = 0;
  for (const raw of (stdout || "").split("\n")) {
    const result = parseKimiEventLine(raw);
    if (!result.ok) {
      if (result.kind === "malformed") malformedCount++;
      continue;
    }
    const ev = result.event;
    events.push(ev);
    if (ev.role === "assistant") {
      const t = extractAssistantText(ev);
      if (t) textParts.push(t);
    } else if (ev.role === "tool") {
      toolEvents.push(ev);
    } else if (ev.role) {
      unexpectedRoleCount++;
    }
  }
  return { events, assistantText: textParts.join(""), toolEvents, malformedCount, unexpectedRoleCount };
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

// Two prompt-delivery modes (verified empirically in Task 2.7 Step 5):
//   - "inline"  → pass prompt as `-p "<text>"` (default for < LARGE_PROMPT_THRESHOLD_BYTES)
//   - "stdin"   → pass `--input-format text` (NO `-p` flag) and write the prompt on stdin.
//                 kimi 1.36 rejects `-p ""` with "Prompt cannot be empty", so we must
//                 omit `-p` entirely in stdin mode. `--input-format text` activates the
//                 stdin-read path per `kimi -h`: "Must be used with --print and the
//                 input must be piped in via stdin."
function buildKimiArgs({ prompt, model, useStdinForPrompt, resumeSessionId, extraArgs }) {
  const args = ["--print", "--output-format", "stream-json"];
  if (useStdinForPrompt) {
    args.push("--input-format", "text");
  } else {
    args.unshift("-p", prompt);
  }
  if (model) args.push("-m", model);
  if (resumeSessionId) args.push("-r", resumeSessionId);
  if (extraArgs?.length) args.push(...extraArgs);
  return args;
}

// Map a posix signal name to the conventional exit code (128 + N).
// Used to recover lost exit-code semantics when Node reports
// status=null + signal=<name> for signaled children (codex C1).
// Exported so job-control.mjs can apply the same mapping to
// background-worker exits (Phase-5-v0.1-review H1).
export function statusFromSignal(signal) {
  if (signal === "SIGINT") return KIMI_EXIT.SIGINT;
  if (signal === "SIGTERM") return KIMI_EXIT.SIGTERM;
  return null;
}

// Map non-zero exit codes to user-visible error messages per
// kimi-cli-runtime exit-code table + probe 05 findings. Prefer structured
// pre-flight check (see callKimi) over text grep; this is the fallback.
// SIGINT message includes "interrupted" keyword so ask.md's declarative
// template router (gemini Phase-2-review G-H2) can match it alongside SIGTERM.
function describeKimiExit({ status, stdout, stderr }) {
  if (status === KIMI_EXIT.CONFIG_ERROR && (stdout || "").includes(LLM_NOT_SET_MARKER)) {
    return "Model not configured in ~/.kimi/config.toml (LLM not set)";
  }
  if (status === KIMI_EXIT.USAGE_ERROR) {
    const clip = (stderr || "").slice(0, 200).trim();
    return clip || "Invalid CLI usage (exit 2)";
  }
  if (status === KIMI_EXIT.SIGINT) return "Interrupted by user (SIGINT)";
  if (status === KIMI_EXIT.SIGTERM) return "Request was interrupted (SIGTERM)";
  const clip = (stderr || "").slice(0, 200).trim();
  return clip ? `exit ${status}: ${clip}` : `exit ${status}`;
}

// Unified result shape for both callKimi and callKimiStreaming (codex C6).
// All error paths include status + partialResponse + events (for debug /
// partial recovery). All success paths include response + sessionId +
// events + toolEvents + thinkBlocks.
//
// Stream-specific error record for callKimi / callKimiStreaming failure paths.
// Returns events + partialResponse derived from stdout parse — that's why
// this can't be replaced by the canonical errorResult from ./errors.mjs.
// Kept local; callers within this file reference it by the new name.
function streamErrorResult({ status, error, stdout, events, textParts, exitCode, signal, timings }) {
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
    // P1 additions (Task 7): propagate transport-layer timing / exit signals
    // through error paths so render / history layers see a uniform shape.
    exitCode: exitCode ?? null,
    signal: signal ?? null,
    timings: timings ?? null,
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
  const guardResult = checkPromptSize(prompt, { kind: "ask", label: "ask" });
  // T6 I-1: enrich canonical errorResult with stream-shape fields so the guard
  // return is a superset of `streamErrorResult`. Downstream readers expecting
  // `partialResponse`/`events` on any non-ok callKimi return don't see
  // undefined on the oversize path.
  // P1 T7: extend with null {exitCode, signal, timings} — spawn never happened
  // so there's nothing to time.
  if (guardResult) return { ...guardResult, partialResponse: null, events: [], exitCode: null, signal: null, timings: null };

  // ── Pre-flight (codex C2) ──
  // Validate requested model against ~/.kimi/config.toml [models.*] BEFORE
  // spawning kimi. Avoids the "LLM not set" exit-1 path (which creates a
  // wasted session). Only applies when -m is explicitly provided; default
  // model is validated by getKimiAuthStatus in Phase 1.
  if (model) {
    const configured = readKimiConfiguredModels();
    if (configured.length > 0 && !configured.includes(model)) {
      // Pre-flight rejection — spawn never happened, timings stay null.
      return streamErrorResult({
        status: KIMI_EXIT.CONFIG_ERROR,
        error: `Model '${model}' is not configured in ~/.kimi/config.toml. Available: ${configured.join(", ")}`,
        events: [],
      });
    }
  }

  const useStdinForPrompt = (prompt || "").length >= LARGE_PROMPT_THRESHOLD_BYTES;
  const args = buildKimiArgs({ prompt, model, useStdinForPrompt, resumeSessionId, extraArgs });

  // P1 T7 Part B: sync timing. spawnSync is opaque — we can't see firstEventAt
  // intra-stream, so we approximate as closedAt when events exist (lossy but
  // consistent with spec §3.3 sync-wrapper contract).
  const spawnedAt = Date.now();
  const result = runCommand(KIMI_BIN, args, {
    cwd,
    timeout,
    input: useStdinForPrompt ? prompt : undefined,
  });
  const closedAt = Date.now();
  const stderrText = result?.stderr?.toString?.() ?? "";
  const timedOut = /timed out waiting for background tasks/.test(stderrText);

  if (result.error) {
    return streamErrorResult({
      error: result.error.message,
      events: [],
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      timings: { spawnedAt, firstEventAt: null, lastEventAt: null, closedAt, timedOut, bgWaitEntered: false },
    });
  }

  // Map signaled exits (status=null + signal=SIGINT/SIGTERM) back to 130/143
  // so describeKimiExit + caller's process.exit() preserve POSIX semantics.
  const effectiveStatus = result.status ?? statusFromSignal(result.signal);
  if (effectiveStatus !== 0) {
    // Best-effort bgWait heuristic from partial parse (non-ok exit may still
    // have emitted events). Mirrors the streaming-path heuristic.
    const { events: partialEvents = [] } = parseKimiStdout(result.stdout || "");
    const bgWaitEntered = partialEvents.some(
      (e) => String(e?.type || "").toLowerCase().includes("backgroundtask") ||
             String(e?.category || "").toLowerCase().includes("background")
    );
    const firstEventAt = partialEvents.length > 0 ? closedAt : null;
    return streamErrorResult({
      status: effectiveStatus,
      error: describeKimiExit({ ...result, status: effectiveStatus }),
      stdout: result.stdout,
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      timings: { spawnedAt, firstEventAt, lastEventAt: firstEventAt, closedAt, timedOut, bgWaitEntered },
    });
  }

  const { events, assistantText, toolEvents, malformedCount, unexpectedRoleCount } = parseKimiStdout(result.stdout);

  // ── No-visible-text guard (gemini G1 + codex Phase-2-review M3 trim) ──
  // If assistant produced no visible text OR only whitespace, treat as
  // failure regardless of event count. Catches five silent-failure modes:
  //   (a) Exit 0 + 0 events       (stream-json format unknown / uncommon dump)
  //   (b) Exit 0 + think-only     (reasoning but no surfaced answer)
  //   (c) Exit 0 + whitespace     (e.g. only "   \n" — visually empty to user)
  //   (d) Exit 0 + malformed JSONL (corrupted stream — codex Phase-5 H3)
  //   (e) Exit 0 + only system events (codex 5-way-review L2)
  // P1 T7: bgWait + firstEventAt approximation for the sync path (shared
  // by the no-visible-text error return and the ok:true return below).
  const bgWaitEntered = events.some(
    (e) => String(e?.type || "").toLowerCase().includes("backgroundtask") ||
           String(e?.category || "").toLowerCase().includes("background")
  );
  const firstEventAt = events.length > 0 ? closedAt : null;
  const lastEventAt = firstEventAt;

  if (!assistantText.trim()) {
    const malformedNote = malformedCount > 0
      ? ` (and ${malformedCount} malformed JSONL line${malformedCount > 1 ? "s" : ""} silently dropped)`
      : "";
    const baseMsg =
      events.length === 0
        ? "kimi exited 0 but produced no stream-json events"
        : (unexpectedRoleCount > 0 && toolEvents.length === 0 && countThinkBlocks(events) === 0)
          ? `kimi produced only unexpected-role events (${unexpectedRoleCount} events with no assistant/tool role)`
          : "kimi produced no visible text (think-only response)";
    return {
      ok: false,
      error: baseMsg + malformedNote,
      status: KIMI_EXIT.OK,
      rawStdout: (result.stdout || "").slice(0, 2000),
      events,
      thinkBlocks: countThinkBlocks(events),
      malformedCount,
      unexpectedRoleCount,
      // P1 additions:
      exitCode: result.status ?? null,
      signal: result.signal ?? null,
      timings: { spawnedAt, firstEventAt, lastEventAt, closedAt, timedOut, bgWaitEntered },
    };
  }

  // Stderr breadcrumb for partial corruption on otherwise-successful runs.
  if (malformedCount > 0) {
    process.stderr.write(
      `Warning: ${malformedCount} malformed JSONL line${malformedCount > 1 ? "s" : ""} in kimi output; response may be incomplete.\n`
    );
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
    malformedCount,
    // P1 additions:
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    timings: { spawnedAt, firstEventAt, lastEventAt, closedAt, timedOut, bgWaitEntered },
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
  const guardResult = checkPromptSize(prompt, { kind: "task", label: "task" });
  // T6 I-1: same shape-merge as callKimi — guard return becomes a superset of
  // streamErrorResult so streaming consumers see `partialResponse`/`events`.
  if (guardResult) return Promise.resolve({ ...guardResult, partialResponse: null, events: [], exitCode: null, signal: null, timings: null });

  // Pre-flight model check, same as callKimi (codex C2).
  if (model) {
    const configured = readKimiConfiguredModels();
    if (configured.length > 0 && !configured.includes(model)) {
      return Promise.resolve(streamErrorResult({
        status: KIMI_EXIT.CONFIG_ERROR,
        error: `Model '${model}' is not configured in ~/.kimi/config.toml. Available: ${configured.join(", ")}`,
        events: [],
      }));
    }
  }

  const useStdinForPrompt = (prompt || "").length >= LARGE_PROMPT_THRESHOLD_BYTES;
  const args = buildKimiArgs({ prompt, model, useStdinForPrompt, resumeSessionId, extraArgs });

  // P1 T7 Part A: timing state. `spawnedAt` captured BEFORE the spawn() call
  // so it reflects our intent to launch (not post-fork clock). `firstEventAt`
  // / `lastEventAt` stamped on each successful event push in processLine.
  // `bgWaitEntered` is a heuristic (spec B3) — kimi-cli 1.37 Notification /
  // BackgroundTask envelopes surface via top-level `type` / `category`
  // fields; the substring match will yield 0 true events if the actual
  // runtime strings differ, which is a safe default pending probe-v5
  // confirmation.
  const spawnedAt = Date.now();
  let firstEventAt = null;
  let lastEventAt = null;
  let bgWaitEntered = false;

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
    let malformedCount = 0;
    let unexpectedRoleCount = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }, timeout);

    // Swallow expected broken-pipe errors when kimi exits early (e.g. rejects a
    // bad flag before we finish writing a 150KB prompt). Without this, EPIPE
    // escapes Promise scope and crashes the companion (codex Phase-2-review H2).
    child.stdin.on("error", (err) => {
      if (err && (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED")) return;
      /* otherwise let close/error handlers surface it via child.on("error") */
    });
    try {
      if (useStdinForPrompt && child.stdin.writable) child.stdin.write(prompt);
      if (child.stdin.writable) child.stdin.end();
    } catch { /* child already exited; close handler will resolve */ }

    function processLine(raw) {
      const result = parseKimiEventLine(raw);
      if (!result.ok) {
        if (result.kind === "malformed") malformedCount++;
        return;
      }
      const ev = result.event;
      events.push(ev);
      // P1 T7 Part A: stamp event timings + bgWait heuristic immediately
      // after the successful push. Closure-captured from the outer function
      // scope (declared above `new Promise(...)`). See spec B3 for the
      // heuristic's safe-default rationale.
      if (firstEventAt == null) firstEventAt = Date.now();
      lastEventAt = Date.now();
      if (
        !bgWaitEntered &&
        (String(ev?.type || "").toLowerCase().includes("backgroundtask") ||
         String(ev?.category || "").toLowerCase().includes("background"))
      ) {
        bgWaitEntered = true;
      }
      if (ev.role === "assistant") {
        const t = extractAssistantText(ev);
        if (t) textParts.push(t);
      } else if (ev.role === "tool") {
        toolEvents.push(ev);
      } else if (ev.role) {
        unexpectedRoleCount++;
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

    child.on("close", (status, signal) => {
      clearTimeout(timer);
      lineBuffer += decoder.end();
      if (lineBuffer.trim()) {
        processLine(lineBuffer);
        lineBuffer = "";
      }

      // Unified timeout contract (codex C6): same shape as other errors.
      // Check BEFORE signal mapping — our SIGTERM was self-inflicted.
      if (timedOut) {
        resolve(streamErrorResult({
          status: KIMI_STATUS_TIMED_OUT,
          error: `kimi timed out after ${Math.round(timeout / 1000)}s`,
          events,
          textParts,
          // P1 additions: stamp closedAt now; timedOut=true always here.
          exitCode: status ?? null,
          signal: signal ?? null,
          timings: { spawnedAt, firstEventAt, lastEventAt, closedAt: Date.now(), timedOut: true, bgWaitEntered },
        }));
        return;
      }

      // Map signaled exits back to 128+N (codex Phase-2-review H1). Node emits
      // status=null + signal when the child dies to a signal; without this the
      // caller's `result.status ?? 1` folds SIGINT/SIGTERM into a plain exit 1.
      const effectiveStatus = status ?? statusFromSignal(signal);
      if (effectiveStatus !== 0) {
        resolve(streamErrorResult({
          status: effectiveStatus,
          error: describeKimiExit({ status: effectiveStatus, stdout: textParts.join(""), stderr: stderrBuf }),
          events,
          textParts,
          // P1 additions:
          exitCode: status ?? null,
          signal: signal ?? null,
          timings: {
            spawnedAt,
            firstEventAt,
            lastEventAt,
            closedAt: Date.now(),
            timedOut: /timed out waiting for background tasks/.test(stderrBuf || ""),
            bgWaitEntered,
          },
        }));
        return;
      }

      // ── No-visible-text guard (gemini G1 + codex Phase-2-review M3 trim) ──
      // If assistant produced no visible text OR only whitespace, treat as
      // failure regardless of event count. Catches three silent-failure modes:
      //   (a) Exit 0 + 0 events     (stream-json format unknown / uncommon dump)
      //   (b) Exit 0 + think-only   (reasoning but no surfaced answer)
      //   (c) Exit 0 + whitespace   (e.g. only "   \n" — visually empty to user)
      //   (d) Exit 0 + malformed JSONL (stream-json was corrupted mid-line;
      //       previously silent via null-dropping in parseKimiEventLine —
      //       codex Phase-5-v0.1-review H3).
      const streamedText = textParts.join("");
      if (!streamedText.trim()) {
        const malformedNote = malformedCount > 0
          ? ` (and ${malformedCount} malformed JSONL line${malformedCount > 1 ? "s" : ""} silently dropped)`
          : "";
        const baseMsg =
          events.length === 0
            ? "kimi exited 0 but produced no stream-json events"
            : (unexpectedRoleCount > 0 && toolEvents.length === 0 && countThinkBlocks(events) === 0)
              ? `kimi produced only unexpected-role events (${unexpectedRoleCount} events with no assistant/tool role)`
              : "kimi produced no visible text (think-only response)";
        resolve({
          ok: false,
          error: baseMsg + malformedNote,
          status: KIMI_EXIT.OK,
          events,
          thinkBlocks: countThinkBlocks(events),
          malformedCount,
          unexpectedRoleCount,
          // P1 additions: the spawn succeeded (exit 0) but produced no text.
          exitCode: status ?? null,
          signal: signal ?? null,
          timings: {
            spawnedAt,
            firstEventAt,
            lastEventAt,
            closedAt: Date.now(),
            timedOut: /timed out waiting for background tasks/.test(stderrBuf || ""),
            bgWaitEntered,
          },
        });
        return;
      }

      // Surface a stderr breadcrumb whenever the stream contained malformed
      // lines, even if the response itself was usable — helps operators spot
      // partial corruption before it turns into a quality regression.
      if (malformedCount > 0) {
        process.stderr.write(
          `Warning: ${malformedCount} malformed JSONL line${malformedCount > 1 ? "s" : ""} in kimi stream; response may be incomplete.\n`
        );
      }

      const sessionId =
        parseSessionIdFromStderr(stderrBuf) ||
        readSessionIdFromKimiJson(cwd || process.cwd());

      // P1 T7 Part A: success resolve extends with timings + exitCode + signal.
      // closedAt stamped here; timedOut sourced from stderr scan for the
      // kimi-cli 1.37 "timed out waiting for background tasks" marker.
      resolve({
        ok: true,
        response: textParts.join(""),
        sessionId,
        events,
        toolEvents,
        thinkBlocks: countThinkBlocks(events),
        malformedCount,
        // P1 additions:
        exitCode: status ?? null,
        signal: signal ?? null,
        timings: {
          spawnedAt,
          firstEventAt,
          lastEventAt,
          closedAt: Date.now(),
          timedOut: /timed out waiting for background tasks/.test(stderrBuf || ""),
          bgWaitEntered,
        },
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      // P1 additions: spawn-level errors — status/signal unknown at this
      // level (child.on("error") fires for ENOENT / EACCES before close
      // emits), so propagate null. closedAt = now; timedOut falsy unless
      // stderr already mentioned the bg-tasks marker.
      resolve(streamErrorResult({
        error: err.message,
        events,
        textParts,
        exitCode: null,
        signal: null,
        timings: {
          spawnedAt,
          firstEventAt,
          lastEventAt,
          closedAt: Date.now(),
          timedOut: /timed out waiting for background tasks/.test(stderrBuf || ""),
          bgWaitEntered,
        },
      }));
    });
  });
}

// ── Adversarial review prompt ──────────────────────────────
//
// Loads prompts/adversarial-review.md (Task 5.3) and interpolates
// TARGET_LABEL / USER_FOCUS / REVIEW_INPUT / REVIEW_SCHEMA. Same retry-hint
// semantics as buildReviewPrompt: a terse error nudge appended at the end
// so kimi corrects in place. TARGET_LABEL derives from the git context
// (branch vs. working-tree); caller fills it in.
export function buildAdversarialPrompt({ context, focus, schemaPath, retryHint = null }) {
  const schema = fs.readFileSync(schemaPath, "utf8").trim();
  const template = loadPromptTemplate(KIMI_PLUGIN_ROOT, "adversarial-review");
  const base = interpolateTemplate(template, {
    TARGET_LABEL: context.summary || "working tree changes",
    USER_FOCUS: focus || "No extra focus provided.",
    REVIEW_INPUT: context.content,
    REVIEW_SCHEMA: schema,
  });
  if (!retryHint) return base;
  // Retry hint lives outside the XML tags — the template is a fixed artifact,
  // and kimi's correction attention is on the final paragraph regardless.
  // Strengthened to match `buildReviewPrompt` retry block (kimi 5-way-review
  // M1): adversarial retries were empirically more likely to re-fail because
  // the hint lacked the explicit anti-translation reminder and the absolute
  // "Nothing but the JSON" wording.
  return `${base}

[IMPORTANT] Your previous response failed JSON parsing or schema validation. The error was: ${retryHint}
Return ONLY the JSON object — no prose, no markdown fence, no commentary before or after. Nothing but the JSON. Use the EXACT English severity strings (critical/high/medium/low) — do NOT translate them.`;
}

export function buildReviewPrompt({ context, focus, schemaPath, retryHint = null }) {
  const schema = fs.readFileSync(schemaPath, "utf8").trim();
  // Focus wording (gemini v1-review G-M2): "Focus area: X" was ambiguous
  // between weight-toward vs limit-to. "Pay particular attention" clarifies
  // it's a weight cue while preserving room to flag out-of-focus criticals.
  // Kimi-4way-review bug: previous version had `\nPay particular...\n`, which
  // collapsed summary+focus into one block without a blank line separator and
  // caused kimi's attention to treat the focus cue as a summary continuation.
  // Fix: lead with `\n\n` so summary and focus cue are visually distinct.
  const focusLine = focus
    ? `\n\nPay particular attention to: ${focus}. You may still report critical issues outside this area.`
    : "";
  const retryBlock = retryHint
    ? `\n\n[IMPORTANT] Your previous response failed JSON parsing or schema validation. The error was: ${retryHint}\nReturn ONLY the JSON object — no prose, no markdown fence, no commentary before or after. Nothing but the JSON. Use the EXACT English severity strings (critical/high/medium/low) — do NOT translate them.\n`
    : "";

  // Kimi constraint wording is tighter than gemini's (spec §4.2): kimi
  // empirically adds "好的，这是 JSON：" prose preambles and sometimes wraps
  // output in markdown fences despite explicit instructions. Our prompt tells
  // it exactly what NOT to do in addition to what to do.
  return `You are reviewing code changes. Return your review as a single JSON object matching this schema:

\`\`\`json
${schema}
\`\`\`

STRICT OUTPUT RULES (kimi-plugin-cc §4.2):
- Return ONLY the JSON object.
- No markdown code fence around it (no \`\`\`json ... \`\`\`).
- No prose before (no "好的" / "Here is" / "This review").
- No prose after (no "让我知道" / "Let me know").
- \`severity\` MUST be one of the EXACT English strings: critical, high, medium, low. Do NOT translate these to Chinese (gemini v1-review G-M1; kimi priors may produce 严重/高/中/低 — those FAIL schema validation).
- \`verdict\` MUST be: approve or needs-attention (never "no_changes" — that's a companion-side fast path for empty diffs).
- For each finding you DO include, fill ALL required fields: severity, title, body, file, line_start, line_end, confidence, recommendation. Empty findings array is fine if the diff is clean; partially-filled findings are rejected.
- Do NOT fabricate line numbers. If you are unsure of exact lines, omit the entire finding.${retryBlock}

${context.summary}${focusLine}

${context.content}`;
}

// ── Review primitives (moved to review.mjs in Phase 5) ────
// extractReviewJson, validateReviewOutput, reviewError now live in
// plugins/kimi/scripts/lib/review.mjs so sibling plugins can share them
// without copy-paste. The first five symbols are re-exported above for
// back-compat; reviewError stays a local binding for callKimiReview.
const reviewError = reviewErrorImpl;

// High-level wrapper: build prompt → callKimi → extract → validate → retry
// once if parse or validation fails. Returns a shape extended with
// { verdict, summary, findings, next_steps, truncated, retry_used, sessionId }
// on success, or the reviewError shape above on failure.
//
// Kimi's first-shot JSON compliance is historically uneven (spec §4.2 motivates
// the retry). The retry prompt appends a terse error hint so kimi corrects in
// place rather than re-reasoning from scratch. Reusing the same session via
// `resumeSessionId` is a best-effort nudge; kimi 1.36's session store retains
// prior messages so the model sees its own malformed output when correcting.
export function callKimiReview({ context, focus, schemaPath, model, cwd, timeout, truncated = false }) {
  return runReviewPipeline({
    buildPrompt: buildReviewPrompt,
    callLLM: callKimi,
    context, focus, schemaPath, model, cwd, timeout, truncated,
    retryWarning: "Warning: kimi review response failed parse/validation; retrying once with error hint...\n",
  });
}

export function callKimiAdversarialReview({ context, focus, schemaPath, model, cwd, timeout, truncated = false }) {
  return runReviewPipeline({
    buildPrompt: buildAdversarialPrompt,
    callLLM: callKimi,
    context, focus, schemaPath, model, cwd, timeout, truncated,
    retryWarning: "Warning: kimi adversarial-review response failed parse/validation; retrying once with error hint...\n",
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
