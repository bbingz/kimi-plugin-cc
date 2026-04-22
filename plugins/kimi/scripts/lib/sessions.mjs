// lib/sessions.mjs — session resolution + validation for /kimi:continue and /kimi:resume
// Sync + fs-reads only. No network, no shell, no persistent state.
// Spec: docs/superpowers/specs/2026-04-22-v0.2-p2-new-commands-design.md §4.4
// Plan: docs/superpowers/plans/2026-04-23-v0.2-p2-new-commands-plan.md T1–T4

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { errorResult } from "./errors.mjs";

// Function-local homedir() — NOT module-level constants — so HOME env
// overrides in tests work regardless of import order (spec §8.1 S3).
export function kimiJsonPath() { return join(homedir(), ".kimi", "kimi.json"); }
export function sessionsDir()  { return join(homedir(), ".kimi", "sessions"); }

// UUID regex — semi-strict 8-4-4-4-12 hex layout, case-insensitive, no
// version-digit constraint. Rejects 36-dash / wrong-dash-placement / non-hex.
// See spec §4.4 + §7.4 + review round-1 Qwen/MiniMax findings.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// md5 of normalized cwd string — matches kimi-cli's session dir naming (§7.7).
// Consumer MUST pass a realpath-normalized cwd (use lib/paths.mjs#resolveRealCwd).
export function md5CwdPath(normalizedCwd) {
  return createHash("md5").update(normalizedCwd).digest("hex");
}

// Strip ANSI escape codes + ASCII control chars from user-facing stderr strings.
// Prevents terminal-control-sequence injection via hostile cwd names (§6.3 MiniMax).
export function sanitizeForStderr(s) {
  if (s == null) return "?";
  return String(s)
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "") // CSI sequences
    .replace(/[\x00-\x1f\x7f]/g, "");        // ASCII controls (incl. raw ESC, \n, \r, \t, DEL)
}

// Error templates — verbatim from spec §6.1 table.
// Placeholders: {cwdBase}, {sessionId}, {errCode}.
const SESSION_ERROR_REASONS = {
  "no-work-dir":         { status: 1, template: "Error: no prior kimi session for this directory ({cwdBase}). Use /kimi:ask to start one." },
  "kimi-json-missing":   { status: 1, template: "Error: no prior kimi session for this directory ({cwdBase}). Use /kimi:ask to start one." },
  "no-last-session":     { status: 1, template: "Error: no prior kimi session for this directory ({cwdBase}). Use /kimi:ask to start one." },
  "kimi-json-malformed": { status: 1, template: "Error: ~/.kimi/kimi.json is malformed; cannot resolve last session." },
  "session-not-found":   { status: 1, template: "Error: session {sessionId} not found for this directory ({cwdBase})." },
  "session-empty":       { status: 1, template: "Error: session {sessionId} has no stored messages; cannot resume." },
  "invalid-uuid":        { status: 2, template: "Error: invalid sessionId format; expected UUID." },
  "fs-error":            { status: 1, template: "Error: filesystem access failed — {errCode}. Check permissions on ~/.kimi/." },
};

/**
 * Convert a session reason + context into an errorResult() ready for kimi-companion.mjs
 * stderr-write + process.exit(status) pattern.
 * @param {string} reason — one of SESSION_ERROR_REASONS keys
 * @param {object} [ctx={}] — may contain realCwd, sessionId, errCode
 * @param {object} [options={}] — may contain commandOrigin: 'continue' | 'resume'
 */
export function mapSessionReason(reason, ctx = {}, options = {}) {
  const safeCtx = ctx || {};
  const spec = SESSION_ERROR_REASONS[reason];
  if (!spec) {
    return errorResult({
      kind: "sessions",
      error: `Error: internal — unknown session reason '${sanitizeForStderr(reason)}'.`,
      status: 1,
      detail: { reason, ctx: safeCtx },
    });
  }
  // For /kimi:continue, invalid-uuid means kimi.json has a malformed UUID —
  // this is an environment error (exit 1), not a user usage error (exit 2).
  let status = spec.status;
  if (reason === "invalid-uuid" && options.commandOrigin === "continue") {
    status = 1;
  }
  const cwdBase = safeCtx.realCwd != null ? sanitizeForStderr(basename(String(safeCtx.realCwd))) : "?";
  const sessionId = safeCtx.sessionId != null ? sanitizeForStderr(String(safeCtx.sessionId)) : "?";
  const errCode = safeCtx.errCode != null ? sanitizeForStderr(String(safeCtx.errCode)) : "?";
  const filled = spec.template
    .replace("{cwdBase}", cwdBase)
    .replace("{sessionId}", sessionId)
    .replace("{errCode}", errCode);
  return errorResult({ kind: "sessions", error: filled, status, detail: { reason, ...safeCtx } });
}

/**
 * Read ~/.kimi/kimi.json and return the last session UUID for the given cwd + kaos.
 * Per Kimi source-read (metadata.py:51-55), lookup matches on BOTH .path AND .kaos.
 * @param {string} normalizedCwd — realpath-normalized cwd
 * @param {string} [kaos='local'] — kaos backend name
 */
export function resolveContinueTarget(normalizedCwd, kaos = "local") {
  let raw;
  try {
    raw = readFileSync(kimiJsonPath(), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { ok: false, reason: "kimi-json-missing" };
    return { ok: false, reason: "fs-error", detail: { errCode: e.code, errMessage: e.message, path: kimiJsonPath() } };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: "kimi-json-malformed", detail: { parseError: e.message } };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "kimi-json-malformed", detail: { reason: "top-level not an object" } };
  }
  if (!Array.isArray(data.work_dirs)) {
    return { ok: false, reason: "kimi-json-malformed", detail: { reason: "work_dirs missing or not array" } };
  }
  const entry = data.work_dirs.find((w) => w && typeof w === "object" && w.path === normalizedCwd && w.kaos === kaos);
  if (!entry) return { ok: false, reason: "no-work-dir" };
  if (typeof entry.last_session_id !== "string" || entry.last_session_id === "") {
    return { ok: false, reason: "no-last-session" };
  }
  return { ok: true, sessionId: entry.last_session_id };
}

/**
 * Validate that a resume target exists under the given cwd with ≥1 populated message.
 * Per probe v4 Q4.2: session dir has context.jsonl (messages) + state.json + wire.jsonl;
 * "populated" predicate is `context.jsonl exists as regular file && size > 0`.
 * FIFO / dangling-symlink / file-at-dir-pos all handled per spec §7.8.
 * @param {string} normalizedCwd — realpath-normalized cwd
 * @param {string} sessionId — UUID
 */
export function validateResumeTarget(normalizedCwd, sessionId) {
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
    return { ok: false, reason: "invalid-uuid", detail: { candidateId: sessionId } };
  }
  const dir = join(sessionsDir(), md5CwdPath(normalizedCwd), sessionId);
  const ctxPath = join(dir, "context.jsonl");
  try {
    let dirStat;
    try {
      dirStat = statSync(dir);
    } catch (e) {
      if (e.code === "ENOENT") return { ok: false, reason: "session-not-found" };
      throw e;
    }
    if (!dirStat.isDirectory()) return { ok: false, reason: "session-not-found" };
    let ctxStat;
    try {
      ctxStat = statSync(ctxPath);
    } catch (e) {
      if (e.code === "ENOENT") return { ok: false, reason: "session-empty" };
      throw e;
    }
    if (!ctxStat.isFile() || ctxStat.size === 0) return { ok: false, reason: "session-empty" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "fs-error", detail: { errCode: e.code, errMessage: e.message, path: dir } };
  }
}
