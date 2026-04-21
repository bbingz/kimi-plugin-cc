import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

import { callKimiStreaming, statusFromSignal, KIMI_STATUS_TIMED_OUT } from "./kimi.mjs";
import {
  ensureStateDir,
  generateJobId,
  listJobs,
  readJobFile,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  updateState,
  upsertJob,
  writeJobFile,
} from "./state.mjs";

// ── Constants ────────────────────────────────────────────

export const SESSION_ID_ENV = "KIMI_COMPANION_SESSION_ID";
const DEFAULT_MAX_STATUS_JOBS = 8;
const DEFAULT_MAX_PROGRESS_LINES = 4;
const DEFAULT_WAIT_TIMEOUT_MS = 240_000; // 4 minutes
const DEFAULT_POLL_INTERVAL_MS = 2_000;  // 2 seconds

// ── Job creation ─────────────────────────────────────────

// Job-id prefix per kind — short, visually distinctive, kimi-branded.
// The Phase-4 port from gemini-plugin-cc left these as "gr"/"gt"
// (gemini-review / gemini-task); the post-v0.1 review flagged a
// user-visible branding leak — a "kimi" plugin should not emit job ids
// like `gr-lxyz-abc`. Sibling plugins must replace with their own
// two-letter prefix (see phase-1-template.md T.4 whitelist).
const JOB_PREFIXES = {
  review: "kr",
  "adversarial-review": "kr",
  task: "kt",
};

export function createJob({ kind, command, prompt, workspaceRoot, cwd, write = false }) {
  const prefix = JOB_PREFIXES[kind] || "ka";
  const id = generateJobId(prefix);
  const sessionId = process.env[SESSION_ID_ENV] || null;
  const now = new Date().toISOString();

  const job = {
    id,
    kind,
    command,
    prompt: prompt?.slice(0, 200),
    status: "queued",
    phase: "queued",
    pid: null,
    sessionId,
    kimiSessionId: null,
    write,
    createdAt: now,
    updatedAt: now,
    cwd,
  };

  upsertJob(workspaceRoot, job);
  return job;
}

// ── Background execution ─────────────────────────────────

/**
 * Run a job in background via a worker subprocess.
 *
 * The worker runs the actual command, captures the result, and updates
 * job state on completion. We can't rely on child.on("exit") because
 * the parent unref()'s immediately.
 */
export function runJobInBackground({
  job,
  companionScript,
  args,
  workspaceRoot,
  cwd,
}) {
  ensureStateDir(workspaceRoot);

  const logFile = resolveJobLogFile(workspaceRoot, job.id);
  const logFd = fs.openSync(logFile, "w");

  fs.writeSync(logFd, `[${new Date().toISOString()}] Job ${job.id} started\n`);
  fs.writeSync(logFd, `[${new Date().toISOString()}] Command: ${args.join(" ")}\n\n`);

  // Spawn a worker that runs the command and writes the result back
  const child = spawn("node", [companionScript, "_worker", job.id, workspaceRoot, ...args], {
    cwd,
    stdio: ["ignore", logFd, logFd],
    detached: true,
    env: { ...process.env },
  });

  child.unref();
  fs.closeSync(logFd);

  upsertJob(workspaceRoot, {
    id: job.id,
    status: "running",
    phase: "starting",
    pid: child.pid,
  });

  return { jobId: job.id, pid: child.pid };
}

/**
 * Worker entry point — called by the background subprocess.
 * Runs the foreground command, captures JSON output, and persists result.
 */
export function runWorker(jobId, workspaceRoot, companionScript, args) {
  // Update phase to running
  upsertJob(workspaceRoot, { id: jobId, phase: "running" });

  // Run the actual command in foreground (within this subprocess)
  const result = spawnSync("node", [companionScript, ...args, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 600_000, // 10 min max
    env: { ...process.env },
  });

  const now = new Date().toISOString();
  // Map signal→status so SIGINT/SIGTERM kills surface 130/143 in the job
  // record, matching the foreground signal-propagation contract (codex
  // Phase-5-v0.1-review H1). Disambiguate the local-timeout case from
  // an external SIGTERM (codex 4-way-review M1): spawnSync's `timeout`
  // option also kills the child with SIGTERM on expiry, so both paths
  // otherwise collapse to 143. Node sets `error.code === "ETIMEDOUT"`
  // on the result object when the timeout fired; route that to 124
  // (GNU `timeout`-convention) so consumers can distinguish.
  let exitCode;
  if (result.error && result.error.code === "ETIMEDOUT") {
    exitCode = KIMI_STATUS_TIMED_OUT;
  } else {
    exitCode = result.status ?? statusFromSignal(result.signal) ?? 1;
  }
  const status = exitCode === 0 ? "completed" : "failed";
  const phase = exitCode === 0 ? "done" : "failed";

  // Try to parse JSON from stdout
  let parsedResult = null;
  const stdout = result.stdout || "";
  const jsonStart = stdout.indexOf("{");
  if (jsonStart >= 0) {
    try {
      parsedResult = JSON.parse(stdout.slice(jsonStart));
    } catch {
      // ignore
    }
  }

  // Cancel race fix (codex 5-way-review H1 + qwen M2): previously this
  // routine read current state, wrote the result file, then called
  // upsertJob — cancel could slip in between the read check and either
  // write, causing completed/failed to clobber a just-set cancelled.
  // Merge the read-check-write into a single updateState transaction so
  // the race window is fully inside one lock.
  const kimiSessionId = parsedResult?.sessionId || null;
  let wasCancelled = false;
  updateState(workspaceRoot, (state) => {
    const idx = state.jobs.findIndex((j) => j.id === jobId);
    if (idx < 0) {
      // Job was pruned from state; log and bail without writing.
      wasCancelled = true;
      return;
    }
    const current = state.jobs[idx];
    if (current.status === "cancelled") {
      wasCancelled = true;
      return;
    }
    // Write the job result file BEFORE committing state so a reader of the
    // final state record is guaranteed to find its result file.
    writeJobFile(workspaceRoot, jobId, {
      id: jobId,
      status,
      exitCode,
      result: parsedResult,
      completedAt: now,
    });
    state.jobs[idx] = {
      ...current,
      status,
      phase,
      exitCode,
      pid: null,
      kimiSessionId,
      updatedAt: now,
    };
  });
  if (wasCancelled) {
    console.log(`\n[${now}] Job ${jobId} was cancelled during execution`);
    return;
  }

  console.log(`\n[${now}] Job ${jobId} ${status} (exit ${exitCode})`);
}

/**
 * Streaming worker — calls callKimiStreaming directly instead of CLI re-entry.
 * Used for task/ask commands. Writes streaming events to log for live progress.
 */
export async function runStreamingWorker(jobId, workspaceRoot, config) {
  upsertJob(workspaceRoot, { id: jobId, phase: "starting" });
  const logFile = resolveJobLogFile(workspaceRoot, jobId);

  function appendLog(msg) {
    try {
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    } catch { /* ignore */ }
  }

  appendLog(`Streaming task started`);
  if (config.resumeSessionId) appendLog(`Resuming session: ${config.resumeSessionId}`);

  const result = await callKimiStreaming({
    prompt: config.prompt,
    model: config.model || null,
    cwd: config.cwd || process.cwd(),
    timeout: config.timeout || 600_000,
    resumeSessionId: config.resumeSessionId || null,
    onEvent: (event) => {
      // Kimi events have no typed envelope — role-based instead.
      // Transition from "starting" to "running" on the first assistant event.
      if (event.role === "assistant") {
        upsertJob(workspaceRoot, { id: jobId, phase: "running" });
        // Extract text blocks and append to progress log for preview.
        const blocks = event.content || [];
        for (const b of blocks) {
          if (b && b.type === "text" && typeof b.text === "string") {
            try { fs.appendFileSync(logFile, b.text); } catch { /* ignore */ }
          }
        }
      } else if (event.role === "tool") {
        appendLog(`Tool: ${event.name || "(unnamed)"}`);
      }
    },
  });

  const now = new Date().toISOString();

  const status = result.ok ? "completed" : "failed";
  const phase = result.ok ? "done" : "failed";
  const kimiSessionId = result.sessionId || null;

  writeJobFile(workspaceRoot, jobId, {
    id: jobId,
    status,
    result,
    completedAt: now,
  });

  // Atomically update only if not cancelled (avoid overwriting user cancel)
  updateState(workspaceRoot, (state) => {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job || job.status === "cancelled") return; // don't overwrite cancel
    Object.assign(job, {
      status,
      phase,
      pid: null,
      kimiSessionId,
      updatedAt: now,
    });
  });

  appendLog(`Job ${jobId} ${status}`);
}

/**
 * Spawn a streaming background worker.
 * Passes config as a JSON file instead of CLI args.
 */
export function runStreamingJobInBackground({
  job,
  companionScript,
  config,
  workspaceRoot,
  cwd,
}) {
  ensureStateDir(workspaceRoot);

  const logFile = resolveJobLogFile(workspaceRoot, job.id);
  const logFd = fs.openSync(logFile, "w");

  fs.writeSync(logFd, `[${new Date().toISOString()}] Job ${job.id} started (streaming)\n`);

  // Write config to a temporary file for the worker to read.
  // Use resolveStateDir (not resolveJobFile) to avoid orphan cleanup deleting it.
  const configFile = path.join(resolveStateDir(workspaceRoot), `${job.id}.config.json`);
  fs.writeFileSync(configFile, JSON.stringify(config));

  const child = spawn("node", [companionScript, "_stream-worker", job.id, workspaceRoot, configFile], {
    cwd,
    stdio: ["ignore", logFd, logFd],
    detached: true,
    env: { ...process.env },
  });

  child.unref();
  fs.closeSync(logFd);

  upsertJob(workspaceRoot, {
    id: job.id,
    status: "running",
    phase: "starting",
    pid: child.pid,
  });

  return { jobId: job.id, pid: child.pid };
}

// ── Job queries ──────────────────────────────────────────

export function sortJobsNewestFirst(jobs) {
  return jobs
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function getCurrentSessionId() {
  return process.env[SESSION_ID_ENV] || null;
}

export function filterJobsForCurrentSession(jobs) {
  const sessionId = getCurrentSessionId();
  if (!sessionId) return jobs;
  return jobs.filter((j) => j.sessionId === sessionId);
}

export function getJobKindLabel(job) {
  if (job.kind === "review") return "review";
  if (job.kind === "adversarial-review") return "adversarial";
  if (job.kind === "task") return "task";
  // Note: `/kimi:ask` is synchronous and never goes through createJob, so no
  // "ask" branch is needed — the Phase-4 port carried one over from gemini
  // defensively; removed post-v0.1 review.
  return "job";
}

// ── Job status ───────────────────────────────────────────

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function enrichJob(job, workspaceRoot) {
  const enriched = { ...job };

  // Check if running job is actually still alive
  if (enriched.status === "running" && enriched.pid && !isProcessAlive(enriched.pid)) {
    enriched.status = "failed";
    enriched.phase = "failed";
    enriched.detail = "Process exited unexpectedly";
    upsertJob(workspaceRoot, { id: enriched.id, status: "failed", phase: "failed", pid: null });
  }

  // Add elapsed time
  if (enriched.createdAt) {
    const start = new Date(enriched.createdAt).getTime();
    const end = enriched.status === "running"
      ? Date.now()
      : new Date(enriched.updatedAt || enriched.createdAt).getTime();
    enriched.elapsed = formatElapsedDuration(start, end);
  }

  // Add progress preview from log file
  enriched.progressPreview = readJobProgressPreview(
    resolveJobLogFile(workspaceRoot, enriched.id),
    DEFAULT_MAX_PROGRESS_LINES
  );

  // Add kind label
  enriched.kindLabel = getJobKindLabel(enriched);

  return enriched;
}

function readJobProgressPreview(logFile, maxLines) {
  try {
    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.trim().split("\n");
    // Take last N non-empty lines, strip timestamps
    return lines
      .filter((l) => l.trim())
      .slice(-maxLines)
      .map(stripLogPrefix)
      .join("\n");
  } catch {
    return "";
  }
}

function stripLogPrefix(line) {
  return line.replace(/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z?\]\s*/, "");
}

export function formatElapsedDuration(startMs, endMs) {
  const seconds = Math.round((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

// ── Status snapshots ─────────────────────────────────────

export function buildStatusSnapshot(workspaceRoot, { showAll = false } = {}) {
  const jobs = listJobs(workspaceRoot);
  const sorted = sortJobsNewestFirst(jobs);
  const limit = showAll ? sorted.length : DEFAULT_MAX_STATUS_JOBS;
  const enriched = sorted
    .slice(0, limit)
    .map((j) => enrichJob(j, workspaceRoot));

  const running = enriched.filter((j) => j.status === "running" || j.status === "queued");
  const recent = enriched.filter((j) => j.status !== "running" && j.status !== "queued");

  return {
    totalJobs: jobs.length,
    running,
    recent,
  };
}

export function buildSingleJobSnapshot(workspaceRoot, jobId) {
  const jobs = listJobs(workspaceRoot);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;
  return enrichJob(job, workspaceRoot);
}

// ── Job resolution for result/cancel ─────────────────────

export function resolveResultJob(workspaceRoot, reference) {
  const jobs = listJobs(workspaceRoot);
  const terminal = jobs.filter(
    (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled"
  );
  return matchJobReference(terminal, reference);
}

export function resolveCancelableJob(workspaceRoot, reference, { anySession = false } = {}) {
  const jobs = listJobs(workspaceRoot);
  const active = jobs.filter(
    (j) => j.status === "queued" || j.status === "running"
  );
  // Without an explicit reference, don't grab active jobs owned by other Claude sessions.
  // Explicit job-id still matches across sessions for precise targeting.
  // Callers can opt into cross-session resolution via `{anySession:true}` —
  // equivalent to how Phase-4-impl-review C-M1 suggested pushing the
  // companion's `--any-session` branch into this library. The option wins
  // over the default current-session filter so /kimi:cancel --any-session
  // reaches jobs submitted from other terminals.
  if (!reference && !anySession) {
    const currentSession = getCurrentSessionId();
    if (currentSession) {
      return matchJobReference(
        active.filter((j) => j.sessionId === currentSession),
        reference
      );
    }
  }
  return matchJobReference(active, reference);
}

function matchJobReference(jobs, reference) {
  if (!reference) {
    // Return most recent
    const sorted = sortJobsNewestFirst(jobs);
    return sorted[0] || null;
  }

  // Exact match
  const exact = jobs.find((j) => j.id === reference);
  if (exact) return exact;

  // Prefix match
  const prefix = jobs.filter((j) => j.id.startsWith(reference));
  if (prefix.length === 1) return prefix[0];

  return null;
}

// ── Wait for job ────────────────────────────────────────

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

export function waitForJob(workspaceRoot, jobId, {
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = buildSingleJobSnapshot(workspaceRoot, jobId);
    if (!snapshot) return { error: "Job not found", waitTimedOut: false };
    if (snapshot.status !== "queued" && snapshot.status !== "running") {
      return { ...snapshot, waitTimedOut: false };
    }
    sleepSync(pollIntervalMs);
  }

  const final = buildSingleJobSnapshot(workspaceRoot, jobId);
  return { ...final, waitTimedOut: true, timeoutMs };
}

// ── Job cancellation ─────────────────────────────────────

export function cancelJob(workspaceRoot, jobId) {
  const jobs = listJobs(workspaceRoot);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return { cancelled: false, reason: "Job not found" };

  if (job.status !== "running" && job.status !== "queued") {
    return { cancelled: false, reason: `Job is ${job.status}, not cancellable` };
  }

  // Three-step signal escalation with up-front liveness probe
  // (codex 5-way-review M1): SIGINT → SIGTERM → SIGKILL. Each step
  // checks `kill(pid, 0)` liveness; once the worker is gone we stop.
  // The up-front probe prevents sending any signal to a stale PID that
  // the OS might have reused for an unrelated process. (Perfect
  // identity-match requires OS-specific PID-birth-time heuristics and
  // is left for v0.2.)
  if (job.pid) {
    const alive = () => {
      try { process.kill(job.pid, 0); return true; }
      catch { return false; }
    };
    const sendSignal = (sig) => {
      // Try process-group kill first (detached workers spawn with their
      // own pgid so this hits the worker + kimi child + any intermediate
      // shells in one go), fall back to direct PID kill.
      try { process.kill(-job.pid, sig); return true; }
      catch {
        try { process.kill(job.pid, sig); return true; }
        catch { return false; }
      }
    };
    if (!alive()) {
      // Stale PID — record "cancelled" without signaling anything to
      // avoid the PID-reuse footgun.
      process.stderr.write(`Warning: job ${jobId} PID ${job.pid} is not alive; marking cancelled without signaling.\n`);
    } else {
      sendSignal("SIGINT");
      sleepSync(500);
      if (alive()) {
        sendSignal("SIGTERM");
        sleepSync(500);
        if (alive()) {
          sendSignal("SIGKILL");
          sleepSync(200); // brief grace for the OS to reap
        }
      }
    }
  }

  upsertJob(workspaceRoot, {
    id: jobId,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
  });

  return { cancelled: true, jobId };
}

// ── Resume candidate ────────────────────────────────────

/**
 * Find the latest completed task job with a kimiSessionId for resumption.
 * Hard-scoped to the current Claude session — prevents implicit resume of
 * another session's thread. Aligns with codex-plugin-cc PR #83.
 */
export function resolveResumeCandidate(workspaceRoot) {
  const jobs = listJobs(workspaceRoot);
  const currentSession = getCurrentSessionId();

  let taskJobs = jobs
    .filter((j) => j.kind === "task" && j.status === "completed" && j.kimiSessionId)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  if (currentSession) {
    taskJobs = taskJobs.filter((j) => j.sessionId === currentSession);
  }

  if (taskJobs.length === 0) return null;
  const candidate = taskJobs[0];
  return {
    available: true,
    candidate: {
      id: candidate.id,
      status: candidate.status,
      prompt: candidate.prompt,
      kimiSessionId: candidate.kimiSessionId,
      completedAt: candidate.updatedAt,
    },
  };
}

// ── Read stored job result ───────────────────────────────

export function readStoredJobResult(workspaceRoot, jobId) {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  const data = readJobFile(jobFile);
  if (data?.result) return data.result;

  // Fall back to parsing log file
  try {
    const logContent = fs.readFileSync(
      resolveJobLogFile(workspaceRoot, jobId),
      "utf8"
    );
    const jsonStart = logContent.lastIndexOf("\n{");
    if (jsonStart >= 0) {
      return JSON.parse(logContent.slice(jsonStart + 1));
    }
  } catch {
    // ignore
  }

  return null;
}
