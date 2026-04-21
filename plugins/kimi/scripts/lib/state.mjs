import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Constants ────────────────────────────────────────────

export const STATE_VERSION = 1;
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "kimi-companion");
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 50;

// ── Path resolution ──────────────────────────────────────

function computeWorkspaceSlug(workspaceRoot) {
  const base = path.basename(workspaceRoot);
  const slug = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const hash = crypto
    .createHash("sha256")
    .update(workspaceRoot)
    .digest("hex")
    .slice(0, 16);
  return `${slug}-${hash}`;
}

export function stateRootDir() {
  const pluginData = process.env[PLUGIN_DATA_ENV];
  if (pluginData) {
    // Plugin-scoped subdir so CLAUDE_PLUGIN_DATA sharing across plugins
    // in a multi-plugin Claude Code session (empirically observed during
    // the 5-way review probe — codex/gemini/kimi/qwen companions all wrote
    // to the same state.json at `<data>/state/<slug>/`) doesn't cause
    // cross-plugin data loss: kimi's `pruneJobs` (50-cap) would otherwise
    // evict gemini's jobs, and `cleanupOrphanedFiles` would delete their
    // log files. A dedicated `/kimi/` subdir isolates this plugin's state
    // regardless of how the harness sets CLAUDE_PLUGIN_DATA.
    //
    // Sibling plugin template note: this is the single line that must be
    // renamed when forking (see docs/superpowers/templates/phase-1-template.md
    // T.4). Do NOT collapse back to a shared `state/` path.
    return path.join(pluginData, "kimi", "state");
  }
  return FALLBACK_STATE_ROOT_DIR;
}

export function resolveStateDir(workspaceRoot) {
  return path.join(stateRootDir(), computeWorkspaceSlug(workspaceRoot));
}

export function resolveStateFile(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), STATE_FILE_NAME);
}

export function resolveJobsDir(workspaceRoot) {
  return path.join(resolveStateDir(workspaceRoot), JOBS_DIR_NAME);
}

export function ensureStateDir(workspaceRoot) {
  fs.mkdirSync(resolveJobsDir(workspaceRoot), { recursive: true });
}

export function resolveJobFile(workspaceRoot, jobId) {
  return path.join(resolveJobsDir(workspaceRoot), `${jobId}.json`);
}

export function resolveJobLogFile(workspaceRoot, jobId) {
  return path.join(resolveJobsDir(workspaceRoot), `${jobId}.log`);
}

// ── Default state ────────────────────────────────────────

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {},
    jobs: [],
  };
}

// ── State I/O ────────────────────────────────────────────

export function loadState(workspaceRoot) {
  const file = resolveStateFile(workspaceRoot);
  const maxRetries = 3;
  let lastError = null;
  let fileExists = false;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      fileExists = true;
      if (!raw.trim()) continue; // empty file from concurrent write
      const state = JSON.parse(raw);
      if (state && typeof state === "object") return state;
    } catch (e) {
      lastError = e;
      // `ENOENT` is the normal "first run" case — not a corruption warning.
      if (e.code === "ENOENT") break;
      fileExists = true;
      if (attempt < maxRetries - 1) {
        const waitUntil = Date.now() + 20;
        while (Date.now() < waitUntil) { /* spin */ }
        continue;
      }
    }
  }
  // Silent fallback to defaultState() hid the user's job history when the
  // file was actually corrupt (qwen 5-way-review M4). Surface a stderr
  // warning on parse failures so the user has a chance to spot + recover.
  if (fileExists && lastError) {
    process.stderr.write(
      `Warning: kimi state file ${file} is unreadable (${lastError.message}); job history reset to defaults.\n`
    );
  }
  return defaultState();
}

// Atomic write: write to a same-directory temp file, then rename over the
// target. POSIX rename is atomic within a filesystem, so concurrent writers
// can't see a torn file. Without this, two background-job completions could
// interleave their writes and one state.json ends up as a hybrid of both
// (codex Phase-5-v0.1-review C1).
//
// Use `fs.writeFileSync` (not `fs.writeSync`) so short-writes are handled
// internally — a raw `writeSync` is allowed to write fewer bytes than
// requested on some filesystems, leaving a truncated JSON that a later
// `loadState()` silently falls back to `defaultState()` on (codex 4-way-
// review M2). No explicit `fsync` — crash-durability is worth ~5–10ms per
// save (qwen L3) and we trade it for speed; an atomic rename is enough to
// prevent torn reads, which is the actual concurrency concern.
//
// On failure between openSync and renameSync, we clean up the temp file
// (qwen-style / codex L1). On Windows + NFS the rename semantics are
// weaker than POSIX; documented in lessons.md Appendix / §H "Path
// storage normalization" — single-machine-local-FS is the v0.1 supported
// target (qwen H1).
function atomicWriteFileSync(targetPath, data) {
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, targetPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw e;
  }
}

export function saveState(workspaceRoot, state) {
  ensureStateDir(workspaceRoot);
  // Prune old jobs
  state.jobs = pruneJobs(state.jobs);
  // Remove orphaned job files
  cleanupOrphanedFiles(workspaceRoot, state.jobs);
  atomicWriteFileSync(
    resolveStateFile(workspaceRoot),
    JSON.stringify(state, null, 2) + "\n"
  );
}

export function updateState(workspaceRoot, mutate) {
  ensureStateDir(workspaceRoot);
  const lockFile = resolveStateFile(workspaceRoot) + ".lock";
  const maxRetries = 10;
  const retryDelayMs = 50;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Acquire exclusive lock
      const lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.closeSync(lockFd);

      try {
        const state = loadState(workspaceRoot);
        mutate(state);
        saveState(workspaceRoot, state);
        return state;
      } finally {
        removeFileIfExists(lockFile);
      }
    } catch (e) {
      if (e.code === "EEXIST") {
        // Lock held by another process, retry after delay
        const waitUntil = Date.now() + retryDelayMs * (attempt + 1);
        while (Date.now() < waitUntil) { /* spin */ }

        // Clean up stale locks (older than 30s)
        try {
          const stat = fs.statSync(lockFile);
          if (Date.now() - stat.mtimeMs > 30_000) {
            removeFileIfExists(lockFile);
          }
        } catch { /* lock already removed */ }
        continue;
      }
      throw e;
    }
  }

  // Last-resort path after exhausting retries: attempt ONE forced lock-break
  // + exclusive write. Better than the previous unconditional unlocked write,
  // because the unlocked path allowed an interleaved mutate+save from another
  // process to clobber our change entirely (codex Phase-5-v0.1-review C1).
  // The forced break is safe-ish because we've already waited ~30s worth of
  // retry windows; a lock older than that is almost certainly abandoned.
  removeFileIfExists(lockFile);
  try {
    const lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
    fs.closeSync(lockFd);
    try {
      const state = loadState(workspaceRoot);
      mutate(state);
      saveState(workspaceRoot, state);
      return state;
    } finally {
      removeFileIfExists(lockFile);
    }
  } catch (e) {
    // Two processes simultaneously broke the lock + raced to create it. Give
    // up with a structured error; caller can choose to retry or surface.
    throw new Error(`state.json update contention: could not acquire lock after ${maxRetries} retries + forced break (${e.message})`);
  }
}

function pruneJobs(jobs) {
  return jobs
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, MAX_JOBS);
}

function cleanupOrphanedFiles(workspaceRoot, jobs) {
  const jobIds = new Set(jobs.map((j) => j.id));
  const jobsDir = resolveJobsDir(workspaceRoot);
  try {
    for (const file of fs.readdirSync(jobsDir)) {
      // Job artifacts: <jobId>.json (result), <jobId>.log (streaming log),
      // <jobId>.config.json (stream-worker config). Strip whichever known
      // suffix matches so we correctly correlate to the job id.
      const id = file
        .replace(/\.config\.json$/, "")
        .replace(/\.(json|log)$/, "");
      if (!jobIds.has(id)) {
        removeFileIfExists(path.join(jobsDir, file));
      }
    }
  } catch {
    // jobsDir may not exist yet
  }
  // Also sweep leaked `state.json.tmp-*` temps left by atomicWriteFileSync
  // on crash (codex 5-way-review L1). A tmp file that's older than ~60s
  // definitely doesn't belong to an in-flight write and is safe to remove.
  const stateDir = resolveStateDir(workspaceRoot);
  try {
    const stateFile = resolveStateFile(workspaceRoot);
    const stateFileBase = path.basename(stateFile);
    const cutoff = Date.now() - 60_000;
    for (const file of fs.readdirSync(stateDir)) {
      if (!file.startsWith(`${stateFileBase}.tmp-`)) continue;
      try {
        const stat = fs.statSync(path.join(stateDir, file));
        if (stat.mtimeMs < cutoff) {
          removeFileIfExists(path.join(stateDir, file));
        }
      } catch { /* stale already removed by another process */ }
    }
  } catch {
    // stateDir may not exist yet
  }
}

function removeFileIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

// ── Job operations ───────────────────────────────────────

export function generateJobId(prefix = "kj") {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString("hex");
  return `${prefix}-${ts}-${rand}`;
}

export function upsertJob(workspaceRoot, jobPatch) {
  return updateState(workspaceRoot, (state) => {
    const now = new Date().toISOString();
    const idx = state.jobs.findIndex((j) => j.id === jobPatch.id);
    if (idx >= 0) {
      state.jobs[idx] = { ...state.jobs[idx], ...jobPatch, updatedAt: now };
    } else {
      state.jobs.push({
        ...jobPatch,
        createdAt: jobPatch.createdAt || now,
        updatedAt: now,
      });
    }
  });
}

export function listJobs(workspaceRoot) {
  return loadState(workspaceRoot).jobs;
}

export function writeJobFile(workspaceRoot, jobId, payload) {
  ensureStateDir(workspaceRoot);
  const file = resolveJobFile(workspaceRoot, jobId);
  atomicWriteFileSync(file, JSON.stringify(payload, null, 2) + "\n");
}

export function readJobFile(jobFile) {
  try {
    return JSON.parse(fs.readFileSync(jobFile, "utf8"));
  } catch {
    return null;
  }
}

export function removeJobFile(jobFile) {
  removeFileIfExists(jobFile);
}

// ── Config operations ────────────────────────────────────

export function getConfig(workspaceRoot) {
  return loadState(workspaceRoot).config || {};
}

export function setConfig(workspaceRoot, key, value) {
  updateState(workspaceRoot, (state) => {
    state.config = state.config || {};
    state.config[key] = value;
  });
}

// ── Timing history stubs (Phase 4 import resolver) ─────────
//
// Gemini's state.mjs records timing per-job for operator dashboards. Kimi has
// no equivalent stats surface (probe 04: JsonPrinter drops StatusUpdate), so
// we export inert stubs to satisfy job-control.mjs's import set without
// fabricating data. Phase 5+ may wire real timing if kimi exposes it.

export function resolveTimingHistoryFile() {
  return path.join(os.homedir(), ".claude", "plugins", "kimi", "timing-history.jsonl");
}

export function appendTimingHistory(_record) {
  // Intentional no-op in v0.1 — we have no timing data to record.
  return;
}

export function readTimingHistory() {
  // Intentional empty result in v0.1. Callers must handle empty arrays.
  return [];
}
