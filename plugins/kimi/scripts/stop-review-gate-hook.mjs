#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import { getConfig, listJobs } from "./lib/state.mjs";
import { sortJobsNewestFirst } from "./lib/job-control.mjs";
import { resolveRealCwd } from "./lib/paths.mjs";
import { runCommand } from "./lib/process.mjs";

const STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function emitDecision(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(message) {
  if (message) process.stderr.write(`${message}\n`);
}

function resolveWorkspaceRoot(cwd) {
  const r = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : resolveRealCwd(cwd);
}

function buildStopReviewPrompt(input = {}) {
  const lastAssistantMessage = String(input.last_assistant_message ?? "").trim();
  const template = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
  const claudeResponseBlock = lastAssistantMessage
    ? ["Previous Claude response:", lastAssistantMessage].join("\n")
    : "";
  return interpolateTemplate(template, { CLAUDE_RESPONSE_BLOCK: claudeResponseBlock });
}

function parseStopReviewOutput(rawOutput) {
  const text = String(rawOutput ?? "").trim();
  if (!text) {
    return {
      ok: false,
      error: "The stop-time Kimi review returned no output. Run /kimi:review --wait manually or bypass the gate.",
    };
  }
  // Scan ALL lines for the ALLOW/BLOCK sentinel (gemini v1-review G-C1:
  // kimi empirically adds prose preambles — "好的，这是审查：" — before
  // structured output, which would cause the gemini strict-first-line
  // parser to fail and default to BLOCK, trapping users in their session).
  // First match wins; "ambiguous" inputs where both appear are extremely
  // unlikely in practice and would BLOCK first due to ALLOW being the
  // expected bias (see template).
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ALLOW:")) return { ok: true, error: null };
    if (trimmed.startsWith("BLOCK:")) {
      const detail = trimmed.slice("BLOCK:".length).trim() || text;
      return { ok: false, error: `Kimi stop-time review found issues: ${detail}` };
    }
  }
  return {
    ok: false,
    error: "The stop-time Kimi review returned an unexpected answer (no ALLOW/BLOCK sentinel found). Run /kimi:review --wait manually or bypass the gate.",
  };
}

function runStopReview(cwd, input = {}) {
  const scriptPath = path.join(SCRIPT_DIR, "kimi-companion.mjs");
  const prompt = buildStopReviewPrompt(input);
  const result = spawnSync(process.execPath, [scriptPath, "ask", "--json", prompt], {
    cwd, encoding: "utf8", timeout: STOP_REVIEW_TIMEOUT_MS, env: { ...process.env },
  });

  if (result.error?.code === "ETIMEDOUT") {
    return { ok: false, error: "The stop-time Kimi review timed out after 15 minutes." };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      error: detail ? `The stop-time Kimi review failed: ${detail}` : "The stop-time Kimi review failed.",
    };
  }

  try {
    const stdout = result.stdout || "";
    const jsonStart = stdout.indexOf("{");
    if (jsonStart >= 0) {
      const payload = JSON.parse(stdout.slice(jsonStart));
      if (payload.response) return parseStopReviewOutput(payload.response);
      if (payload.error) return { ok: false, error: payload.error };
    }
  } catch { /* fall through */ }

  return { ok: false, error: "The stop-time Kimi review returned invalid output." };
}

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = getConfig(workspaceRoot);

  const jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const runningJob = jobs.find((j) => j.status === "queued" || j.status === "running");
  const runningNote = runningJob
    ? `Kimi task ${runningJob.id} is still running. Check /kimi:status.`
    : null;

  if (!config.stopReviewGate) {
    logNote(runningNote);
    return;
  }

  const review = runStopReview(cwd, input);
  if (!review.ok) {
    // Internal `{ok, error}` shape aligned with `reviewError` / `errorResult`
    // per qwen 5-way-review M1 (previously used `{ok, reason}` which diverged
    // from the rest of the codebase). The Claude Code hook protocol still
    // expects `{decision, reason}` on stdout, so we emit `reason: review.error`
    // at the boundary — internal shape is unified, external contract is
    // preserved.
    emitDecision({
      decision: "block",
      reason: runningNote ? `${runningNote} ${review.error}` : review.error,
    });
    return;
  }

  logNote(runningNote);
}

// Top-level try/catch (qwen 4-way-review H2). The stop-review gate runs
// inside a 15-min hook budget; silent failure would leave Claude blocked
// with no diagnostic. On fatal error, emit to stderr + exit 1 so the
// hook framework logs something actionable.
try {
  main();
} catch (err) {
  process.stderr.write(
    `[kimi stop-review-gate-hook] fatal: ${err && err.message ? err.message : String(err)}\n`
  );
  process.exit(1);
}
