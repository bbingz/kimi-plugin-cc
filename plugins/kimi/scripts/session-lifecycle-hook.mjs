#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

import { resolveRealCwd } from "./lib/paths.mjs";
import { loadState, resolveStateFile, saveState } from "./lib/state.mjs";

const SESSION_ID_ENV = "KIMI_COMPANION_SESSION_ID";

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  if (!process.env.CLAUDE_ENV_FILE || value == null || value === "") {
    return;
  }
  fs.appendFileSync(
    process.env.CLAUDE_ENV_FILE,
    `export ${name}=${shellEscape(value)}\n`,
    "utf8"
  );
}

function terminateProcess(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already gone
    }
  }
}

function resolveWorkspaceRoot(cwd) {
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 3000,
      stdio: "pipe",
    });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch { /* not a git repo */ }
  return resolveRealCwd(cwd);
}

// Clean up jobs belonging to this session in the current workspace only.
// Mirrors gemini-plugin-cc: O(1) per-workspace state file, no global scan.
function cleanupSessionJobs(cwd, sessionId) {
  if (!cwd || !sessionId) return;

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) return;

  const state = loadState(workspaceRoot);
  const sessionJobs = state.jobs.filter((j) => j.sessionId === sessionId);
  if (sessionJobs.length === 0) return;

  for (const job of sessionJobs) {
    if (job.status === "running" || job.status === "queued") {
      terminateProcess(job.pid);
    }
  }

  saveState(workspaceRoot, {
    ...state,
    jobs: state.jobs.filter((j) => j.sessionId !== sessionId),
  });
}

function handleSessionStart(input) {
  appendEnvVar(SESSION_ID_ENV, input.session_id);
}

function handleSessionEnd(input) {
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || process.env[SESSION_ID_ENV];
  cleanupSessionJobs(cwd, sessionId);
}

function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";

  if (eventName === "SessionStart") {
    handleSessionStart(input);
  } else if (eventName === "SessionEnd") {
    handleSessionEnd(input);
  }
}

// Top-level try/catch (qwen 4-way-review H2): if readHookInput throws on
// malformed stdin, or any inner handler throws unexpectedly, Claude Code
// would otherwise see a silent non-zero without a diagnostic. Emit a
// structured error to stderr and exit 1 so the user has something to grep.
try {
  main();
} catch (err) {
  process.stderr.write(
    `[kimi session-lifecycle-hook] fatal: ${err && err.message ? err.message : String(err)}\n`
  );
  process.exit(1);
}
