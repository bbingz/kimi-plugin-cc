#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  getKimiAvailability,
  getKimiAuthStatus,
  readKimiDefaultModel,
  readKimiConfiguredModels,
  callKimi,
  callKimiStreaming,
  callKimiReview,
  callKimiAdversarialReview,
  KIMI_EXIT,
  MAX_REVIEW_DIFF_BYTES,
} from "./lib/kimi.mjs";
import {
  createJob,
  runStreamingJobInBackground,
  runStreamingWorker,
  runWorker,
  runJobInBackground,
  buildStatusSnapshot,
  buildSingleJobSnapshot,
  resolveResultJob,
  resolveCancelableJob,
  waitForJob,
  cancelJob,
  resolveResumeCandidate,
  readStoredJobResult,
  SESSION_ID_ENV,
} from "./lib/job-control.mjs";
import { upsertJob, getConfig, setConfig } from "./lib/state.mjs";
import { binaryAvailable } from "./lib/process.mjs";
import { ensureGitRepository, collectReviewContext, isEmptyContext } from "./lib/git.mjs";

// Plugin root is two levels above this file (scripts/kimi-companion.mjs →
// plugins/kimi). Used for loading packaged schemas.
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Absolute path to this file — needed for background respawn.
const SELF = fileURLToPath(import.meta.url);

// Accepted values for `--scope` (shared by /kimi:review + /kimi:adversarial-review).
// Invalid values must exit 2 (USAGE_ERROR) rather than silently falling back to
// "auto" — a typo like `--scope stagged` previously reviewed the wrong diff
// with no error (codex Phase-5-v0.1-review H2).
const VALID_REVIEW_SCOPES = new Set(["auto", "staged", "unstaged", "working-tree", "branch"]);

function validateScopeOption(scope, emitJson) {
  if (scope === undefined || scope === null || scope === "") return "auto";
  if (VALID_REVIEW_SCOPES.has(scope)) return scope;
  const msg = `Invalid --scope value: ${JSON.stringify(scope)}. Expected one of: ${[...VALID_REVIEW_SCOPES].join(", ")}.`;
  if (emitJson) process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + "\n");
  else process.stderr.write("Error: " + msg + "\n");
  process.exit(2);
}

// Normalize cwd so the spawned `kimi` child sees the SAME path string that
// our post-call `readSessionIdFromKimiJson(cwd)` lookup uses. kimi stores
// `~/.kimi/kimi.json.work_dirs[].path` verbatim (probe 06: "canonical()
// normalizes but does NOT resolve symlinks"), then our Secondary fallback
// does a `===` match. On macOS /tmp resolves to /private/tmp; without
// realpath, spawn cwd `/tmp/foo` ends up stored as `/tmp/foo` by kimi, but
// if a future caller passes `/private/tmp/foo` for lookup they miss. The
// fix is to pick one form and use it consistently — realpath is the safer
// choice because it's stable across `cd` through symlinks. Failures
// (ENOENT, EACCES) fall back to the original string; worst case behavior
// is identical to pre-fix, not worse. (Review H3 / spec §3.4.)
function resolveRealCwd(cwd) {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return cwd;
  }
}

// Resolve the git workspace root for the given cwd (background job tracking
// scopes state to the workspace). Falls back to cwd when not in a git repo.
function resolveWorkspaceRoot(cwd) {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd, encoding: "utf8", timeout: 3000, stdio: "pipe",
    });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch { /* not a git repo */ }
  return cwd;
}

const USAGE = `Usage: kimi-companion <subcommand> [options]

Subcommands:
  setup [--json] [--enable-review-gate|--disable-review-gate]
                                       Check kimi CLI availability, auth, and configured models
  ask [--json] [--stream] [-m <model>] [-r <sessionId>] "<prompt>"
                                       Send a one-shot prompt. --stream emits JSONL events as they arrive.
  review [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [-m <model>] [focus...]
                                       Review current diff. Always emits JSON matching review-output schema.
  adversarial-review [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [-m <model>] [--background|--wait] [focus...]
                                       Adversarial (red-team) review on current diff. Same schema; same JSON envelope.
  task [--json] [--background|--wait] [--resume-last|--fresh] [-m <model>] "<prompt>"
                                       Delegate an open-ended task to kimi. Background spawns a detached worker; foreground streams progress.
  status [job-id] [--all] [--wait] [--json]
                                       Show background-job status.
  result [job-id] [--json]             Fetch a completed job's full output.
  cancel [job-id] [--any-session] [--json]
                                       Cancel a running background job. Default scope is current
                                       terminal session; --any-session reaches jobs submitted from
                                       other terminals (useful when the jobId is forgotten).
  task-resume-candidate [--json]       Probe for a resumable prior task (used by /kimi:rescue).

(Internal: _worker / _stream-worker are background re-entry points; do not call directly.)`;

// Detects which installers the user has available for /kimi:setup to suggest.
function detectInstallers() {
  return {
    shellInstaller: binaryAvailable("sh", ["-c", "command -v curl"]).available,
    uv: binaryAvailable("uv", ["--version"]).available,
    pipx: binaryAvailable("pipx", ["--version"]).available,
  };
}

function runSetup(rawArgs) {
  const { options } = parseArgs(rawArgs, {
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"],
  });

  // Review-gate toggle (spec §4.2 `/kimi:setup --enable/disable-review-gate`).
  // State is PER-WORKSPACE (codex v1-review C-M3): getConfig/setConfig route
  // through `resolveStateFile(workspaceRoot)` which slugs the repo path
  // under ~/.claude/plugins/kimi/<workspace-slug>/state.json. Enabling the
  // gate in one repo does NOT enable it globally. Document this in the
  // user-visible output below + run the toggle from the repo you want
  // gated.
  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    process.stderr.write("Error: pass only one of --enable-review-gate / --disable-review-gate.\n");
    process.exit(KIMI_EXIT.USAGE_ERROR);
  }
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
    // Escape-hatch note (gemini Phase-4-impl-review G-H1): users who hit a
    // persistent BLOCK response would otherwise feel trapped — the gate adds
    // up to 15 min to every session stop, and BLOCK cannot be dismissed
    // from inside the blocked session. Surface the exit door at enable-time.
    process.stderr.write(
      [
        "Note: stop-review-gate enabled for this workspace.",
        "  • Each session stop will call kimi (up to 15 min timeout).",
        "  • If kimi returns BLOCK and you need to exit, open a new terminal and run:",
        "      /kimi:setup --disable-review-gate",
        "    (or edit stopReviewGate to false in ~/.claude/plugins/kimi/<slug>/state.json)",
        "",
      ].join("\n")
    );
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
  }

  const availability = getKimiAvailability();
  const installers = detectInstallers();

  let auth = { loggedIn: false, detail: "not checked (kimi not installed)" };
  let configured = [];
  if (availability.available) {
    auth = getKimiAuthStatus(process.cwd());
    configured = readKimiConfiguredModels();
  }

  const status = {
    installed: availability.available,
    version: availability.available ? availability.detail : null,
    authenticated: auth.loggedIn === true,
    authDetail: auth.detail,
    model: auth.model || readKimiDefaultModel() || null,
    configured_models: configured,
    installers,
    stopReviewGate: getConfig(workspaceRoot).stopReviewGate === true,
    // Tell consumers exactly WHICH workspace this gate setting belongs to
    // so it's obvious when (and where) to toggle (C-M3).
    stopReviewGateWorkspace: workspaceRoot,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
  } else {
    process.stdout.write(formatSetupText(status) + "\n");
  }
  process.exit(0);
}

function formatSetupText(s) {
  const lines = [];
  lines.push(`installed:     ${s.installed ? `yes (${s.version})` : "no"}`);
  lines.push(`authenticated: ${s.authenticated ? "yes" : `no (${s.authDetail})`}`);
  lines.push(`default model: ${s.model || "(not set)"}`);
  if (s.configured_models.length > 0) {
    lines.push(`configured:    ${s.configured_models.join(", ")}`);
  }
  if (!s.installed) {
    lines.push("");
    lines.push("Installers detected:");
    lines.push(`  shell curl:  ${s.installers.shellInstaller ? "yes" : "no"}`);
    lines.push(`  uv:          ${s.installers.uv ? "yes" : "no"}`);
    lines.push(`  pipx:        ${s.installers.pipx ? "yes" : "no"}`);
  }
  return lines.join("\n");
}

async function runAsk(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    valueOptions: ["model", "resume"],
    booleanOptions: ["json", "stream"],
    aliasMap: { m: "model", r: "resume" },
  });

  // Reject "-X=value" short-form flags (codex v3-review A3). parseArgs
  // treats these as positionals, which would silently leak into the prompt.
  // Narrowly match only single-letter short + '=' so legitimate prompts
  // containing dashes aren't rejected.
  for (const p of positionals) {
    if (/^-[a-zA-Z]=/.test(p)) {
      process.stderr.write(
        `Error: '${p}' — short flags cannot use '=' form. Use '-m value' (space-separated) or the long form '--model=value'.\n`
      );
      process.exit(KIMI_EXIT.USAGE_ERROR);
    }
  }

  const prompt = positionals.join(" ").trim();
  if (!prompt) {
    process.stderr.write(
      "Error: /kimi:ask requires a prompt.\nUsage: kimi-companion ask [--json] [-m <model>] [-r <sid>] \"<prompt>\"\n"
    );
    process.exit(KIMI_EXIT.USAGE_ERROR);
  }

  // Reject --stream when invoked from /kimi:ask (codex C5 + v2 review A4).
  // Gate uses a dedicated env var KIMI_COMPANION_CALLER that commands/ask.md
  // EXPLICITLY sets to "claude". Don't rely on CLAUDE_PLUGIN_ROOT (always
  // set when companion.mjs is invoked via command.md — tautology; also may
  // leak into dev shells). Developer CLI debugging leaves this env unset.
  if (options.stream && process.env.KIMI_COMPANION_CALLER === "claude") {
    process.stderr.write(
      "Error: --stream is not supported through /kimi:ask. Invoke kimi-companion directly for streaming debug.\n"
    );
    process.exit(KIMI_EXIT.USAGE_ERROR);
  }

  const callArgs = {
    prompt,
    model: options.model || null,
    resumeSessionId: options.resume || null,
    // Realpath so spawn-cwd and the post-call `readSessionIdFromKimiJson`
    // lookup use the same string form (see resolveRealCwd above).
    cwd: resolveRealCwd(process.cwd()),
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
    if (result.ok && !result.sessionId) {
      process.stderr.write(
        "Warning: session_id could not be captured. --resume will not work for this call.\n"
      );
    }
    process.stdout.write(JSON.stringify(summary) + "\n");
    process.exit(result.ok ? KIMI_EXIT.OK : (result.status ?? 1));
  }

  const result = callKimi(callArgs);
  if (options.json) {
    if (result.ok && !result.sessionId) {
      process.stderr.write(
        "Warning: session_id could not be captured. --resume will not work for this call.\n"
      );
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (!result.ok) {
      process.stderr.write(`Error: ${result.error}\n`);
      if (result.partialResponse) process.stderr.write(`Partial response:\n${result.partialResponse}\n`);
      process.exit(result.status ?? 1);
    }
    // Text path: response + footer (gemini v2-review A2). Footer is
    // generated in CODE so Claude / the user can just present verbatim —
    // markdown "MUST" instructions in ask.md proved too fragile.
    process.stdout.write(result.response + "\n");
    process.stdout.write(formatAskFooter(result, callArgs.model) + "\n");
    // Visible warning on silent session-id capture failure (codex v3 A2):
    // this shouldn't normally happen (probe 01 + 02 proved both paths work),
    // but if it does we want the user to know --resume won't work.
    if (!result.sessionId) {
      process.stderr.write(
        "Warning: session_id could not be captured. --resume will not work for this call.\n"
      );
    }
  }
  // Resume-mismatch warning (gemini Phase-2-review G-H1): kimi 1.36 silently
  // ignores a bogus or expired -r <sid> and mints a fresh session (Task 2.7
  // Step 6 "reverse WARN" documented this). When the user explicitly asked to
  // resume a specific sid but got a different one back, flag it — otherwise
  // they'd see a valid-looking footer and assume their context carried over.
  // Post-5-way-review: exit non-zero (qwen M3) so Claude's render layer
  // surfaces the mismatch as a "something went wrong" signal rather than
  // quietly succeeding — the answer is valid but the continuity contract
  // the user asked for is broken.
  let resumeMismatched = false;
  if (callArgs.resumeSessionId && result.ok && result.sessionId &&
      result.sessionId !== callArgs.resumeSessionId) {
    process.stderr.write(
      `Warning: requested --resume ${callArgs.resumeSessionId} did not match returned session ${result.sessionId}; kimi likely started a fresh session and prior context was not carried over.\n`
    );
    resumeMismatched = true;
  }
  // Propagate kimi's original exit status (codex C4) so callers can distinguish
  // config vs usage vs signal causes. result.status is null on success paths.
  // Resume-mismatch on an otherwise-ok run → exit 1 (qwen 5-way-review M3):
  // stdout/response stays intact so user sees kimi's answer; exit code signals
  // the session-continuity contract failed so Claude renders a visible note.
  process.exit(
    result.ok
      ? (resumeMismatched ? 1 : KIMI_EXIT.OK)
      : (result.status ?? 1)
  );
}

// One-line footer appended to /kimi:ask text output. Keep short — it's
// supposed to be unobtrusive. session is ALWAYS shown (even as "unknown")
// so the user knows a session existed but capture failed (codex v3-review A2);
// silent omission hides a bug instead of exposing it.
function formatAskFooter(result, requestedModel) {
  const parts = [];
  parts.push(`session: ${result.sessionId || "unknown (not captured)"}`);
  const m = requestedModel || readKimiDefaultModel();
  if (m) parts.push(`model: ${m}`);
  if (result.thinkBlocks && result.thinkBlocks > 0) parts.push(`thinkBlocks: ${result.thinkBlocks}`);
  return `\n(${parts.join(" · ")})`;
}

async function runReview(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    valueOptions: ["model", "base", "scope"],
    booleanOptions: ["json"],
    aliasMap: { m: "model" },
  });

  // /kimi:review ALWAYS emits JSON (reference/review-render.md). The --json
  // flag is accepted for consistency with ask but the default is also json.
  const emitJson = true;

  // Realpath once so both the kimi spawn (inside callKimiReview) and our
  // session-id lookup see the same canonical cwd (see resolveRealCwd above).
  // git operations on the same path are unaffected — git resolves symlinks
  // internally. (Review H3 / spec §3.4.)
  const cwd = resolveRealCwd(process.cwd());
  try {
    ensureGitRepository(cwd);
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + "\n");
    process.exit(1);
  }

  const scope = validateScopeOption(options.scope, emitJson);
  const base = options.base || null;
  const context = collectReviewContext(cwd, { base, scope });

  // collectReviewContext ALWAYS returns a non-empty content string (section
  // skeleton with `(none)` bodies even on a clean tree). Ask the git module
  // whether the context is semantically empty rather than regex-scanning
  // the skeleton here — that keeps the coupling to formatSection's shape
  // local to git.mjs (gemini Phase-3-review G-H1).
  if (isEmptyContext(context)) {
    // no_changes is companion-emitted only — kimi itself never produces this
    // verdict (review.md + review-render.md document the divergence). Field
    // shape matches the callKimiReview success contract for consistency.
    process.stdout.write(JSON.stringify({
      ok: true,
      verdict: "no_changes",
      response: "No changes to review.",
      truncated: false,
      truncation_notice: null,
      retry_used: false,
      retry_notice: null,
    }, null, 2) + "\n");
    process.exit(0);
  }

  let truncated = false;
  if (context.content.length > MAX_REVIEW_DIFF_BYTES) {
    context.content = context.content.slice(0, MAX_REVIEW_DIFF_BYTES)
      + "\n\n... [TRUNCATED — diff exceeded review budget] ...";
    truncated = true;
  }

  const focus = positionals.join(" ").trim() || null;
  const schemaPath = path.join(ROOT_DIR, "schemas", "review-output.schema.json");

  // Defensive wrapper (codex v1-review C-H2): callKimiReview already catches
  // schema-load/prompt-rebuild via its own try/catch, but any other unexpected
  // throw (fs race, OOM) must NOT escape as an uncaught exception.
  let result;
  try {
    result = callKimiReview({
      context,
      focus,
      schemaPath,
      model: options.model || null,
      cwd,
      truncated,
    });
  } catch (e) {
    result = {
      ok: false,
      error: `Unexpected error during review: ${e.message}`,
      truncated,
      retry_used: false,
    };
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");

  // Extend sessionId-null warning (Task 3.1 cash-in carries over here too).
  if (result.ok && !result.sessionId) {
    process.stderr.write(
      "Warning: session_id could not be captured. --resume will not work for this review.\n"
    );
  }

  // Propagate kimi's exit status when the failure happened at the transport
  // layer (codex Phase-3-review C-H1). Without this, SIGINT/SIGTERM-killed
  // reviews would exit 1 instead of 130/143, losing Phase 2's signal
  // semantics. reviewError packs transport status in `transportError.status`;
  // non-transport failures (parse/validate) fall back to exit 1.
  process.exit(
    result.ok
      ? KIMI_EXIT.OK
      : (result.transportError?.status ?? 1)
  );
}

async function runAdversarialReview(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait"],
    valueOptions: ["base", "scope", "model", "cwd"],
    aliasMap: { m: "model" },
  });

  // Adversarial-review ALWAYS emits JSON (same contract as /kimi:review).
  const emitJson = true;

  // Realpath so spawn cwd and session-id lookup agree (see resolveRealCwd).
  const cwd = resolveRealCwd(options.cwd || process.cwd());
  try {
    ensureGitRepository(cwd);
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + "\n");
    process.exit(1);
  }

  // Validate --scope BEFORE the background branch so a typo fails fast
  // (otherwise the bad value would be forwarded to the worker and
  // re-surfaced as a deferred error inside the job log).
  const scope = validateScopeOption(options.scope, emitJson);
  const base = options.base || null;

  // Background mode: spawn a detached worker that re-enters this subcommand
  // foreground. Mirror the pattern gemini-companion uses for adversarial-review.
  if (options.background) {
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const job = createJob({
      kind: "adversarial-review",
      command: "adversarial-review",
      prompt: "adversarial review",
      workspaceRoot,
      cwd,
    });
    const bgArgs = ["adversarial-review"];
    if (base) bgArgs.push("--base", base);
    bgArgs.push("--scope", scope);
    if (options.model) bgArgs.push("--model", options.model);
    positionals.forEach((p) => bgArgs.push(p));

    const submission = runJobInBackground({
      job, companionScript: SELF, args: bgArgs, workspaceRoot, cwd,
    });
    process.stdout.write(JSON.stringify(submission, null, 2) + "\n");
    process.exit(0);
  }

  const context = collectReviewContext(cwd, { base, scope });

  if (isEmptyContext(context)) {
    process.stdout.write(JSON.stringify({
      ok: true,
      verdict: "no_changes",
      response: "No changes to review.",
      truncated: false,
      truncation_notice: null,
      retry_used: false,
      retry_notice: null,
    }, null, 2) + "\n");
    process.exit(0);
  }

  let truncated = false;
  if (context.content.length > MAX_REVIEW_DIFF_BYTES) {
    context.content = context.content.slice(0, MAX_REVIEW_DIFF_BYTES)
      + "\n\n... [TRUNCATED — diff exceeded review budget] ...";
    truncated = true;
  }

  const focus = positionals.join(" ").trim() || null;
  const schemaPath = path.join(ROOT_DIR, "schemas", "review-output.schema.json");

  let result;
  try {
    result = callKimiAdversarialReview({
      context,
      focus,
      schemaPath,
      model: options.model || null,
      cwd,
      truncated,
    });
  } catch (e) {
    result = {
      ok: false,
      error: `Unexpected error during adversarial review: ${e.message}`,
      truncated,
      retry_used: false,
    };
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");

  if (result.ok && !result.sessionId) {
    process.stderr.write(
      "Warning: session_id could not be captured. --resume will not work for this review.\n"
    );
  }

  process.exit(
    result.ok
      ? KIMI_EXIT.OK
      : (result.transportError?.status ?? 1)
  );
}

const DEFAULT_CONTINUE_PROMPT = "继续上一个任务。Continue the previous task based on our prior exchange.";

async function runTask(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait", "resume-last", "fresh"],
    valueOptions: ["model", "cwd", "resume-session-id"],
    aliasMap: { m: "model" },
  });

  // Mutual-exclusion
  if (options["resume-last"] && options.fresh) {
    const err = "Choose either --resume-last or --fresh, not both.";
    if (options.json) process.stdout.write(JSON.stringify({ ok: false, error: err }, null, 2) + "\n");
    else process.stderr.write("Error: " + err + "\n");
    process.exit(KIMI_EXIT.USAGE_ERROR);
  }

  let prompt = positionals.join(" ").trim();
  if (!prompt && options["resume-last"]) {
    prompt = DEFAULT_CONTINUE_PROMPT;
  }
  if (!prompt) {
    const err = "Provide a prompt or use --resume-last.";
    if (options.json) process.stdout.write(JSON.stringify({ ok: false, error: err }, null, 2) + "\n");
    else process.stderr.write("Error: " + err + "\n");
    process.exit(KIMI_EXIT.USAGE_ERROR);
  }

  // Realpath so spawn cwd and the post-call session-id lookup see the same
  // canonical path form (see resolveRealCwd above). resolveWorkspaceRoot
  // downstream is unaffected — git returns canonical paths regardless.
  const cwd = resolveRealCwd(options.cwd || process.cwd());
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  // Resolve resume sessionId — explicit ID wins (background worker passes it).
  let resumeSessionId = options["resume-session-id"] || null;
  if (!resumeSessionId && options["resume-last"]) {
    const candidate = resolveResumeCandidate(workspaceRoot);
    if (candidate?.available) {
      resumeSessionId = candidate.candidate.kimiSessionId;
    }
  }

  const streamConfig = {
    prompt,
    model: options.model || null,
    cwd,
    resumeSessionId,
  };

  // Background mode — detach + record in job-control state.
  if (options.background) {
    const job = createJob({ kind: "task", command: "task", prompt, workspaceRoot, cwd });
    const submission = runStreamingJobInBackground({
      job,
      companionScript: SELF,
      config: streamConfig,
      workspaceRoot,
      cwd,
    });
    process.stdout.write(JSON.stringify(submission, null, 2) + "\n");
    process.exit(0);
  }

  // Foreground — call streaming but DON'T echo progress to stderr.
  // codex v1-review C-M1: earlier draft wrote each text block to stderr
  // AND then wrote `result.response` to stdout at the end, which showed
  // the same content twice in non-JSON mode. Simpler contract: onEvent is
  // a no-op in companion's foreground path (callers that want live
  // per-event output use --stream via /kimi:ask); task just returns the
  // final aggregated response. Matches /kimi:ask's verbatim-stdout shape.
  const result = await callKimiStreaming({
    ...streamConfig,
    onEvent: () => {},
  });

  // Persist kimiSessionId for future resume — track via a synthetic completed job.
  if (result.ok && result.sessionId) {
    const job = createJob({ kind: "task", command: "task", prompt, workspaceRoot, cwd });
    upsertJob(workspaceRoot, {
      id: job.id,
      status: "completed",
      phase: "done",
      kimiSessionId: result.sessionId,
      pid: null,
    });
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ ...result, resumed: Boolean(resumeSessionId) }, null, 2) + "\n");
  } else {
    if (!result.ok) {
      process.stderr.write(`\nError: ${result.error}\n`);
    } else {
      process.stdout.write(result.response + "\n");
    }
  }

  process.exit(result.ok ? KIMI_EXIT.OK : (result.status ?? 1));
}

function runJobStatus(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "all", "wait"],
  });
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobId = positionals[0];

  if (jobId && options.wait) {
    const final = waitForJob(workspaceRoot, jobId);
    process.stdout.write(JSON.stringify(final, null, 2) + "\n");
    process.exit(final.waitTimedOut ? 1 : 0);
  }

  if (jobId) {
    const single = buildSingleJobSnapshot(workspaceRoot, jobId);
    if (!single) {
      process.stdout.write(JSON.stringify({ ok: false, error: `Job ${jobId} not found` }, null, 2) + "\n");
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(single, null, 2) + "\n");
    process.exit(0);
  }

  const snapshot = buildStatusSnapshot(workspaceRoot, { showAll: options.all });
  process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
  process.exit(0);
}

function runJobResult(rawArgs) {
  const { positionals } = parseArgs(rawArgs, { booleanOptions: ["json"] });
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  // Passing no reference already falls back to the most-recent terminal
  // job (resolveResultJob's documented behavior). Users who forget the
  // jobId just run `/kimi:result` — the latest is returned (gemini
  // v1-review G-M1: this is the already-working escape hatch, no new
  // flag needed).
  const reference = positionals[0] || null;

  const job = resolveResultJob(workspaceRoot, reference);
  if (!job) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: reference ? `No terminal job matches "${reference}"` : "No completed jobs to fetch",
    }, null, 2) + "\n");
    process.exit(1);
  }

  const payload = readStoredJobResult(workspaceRoot, job.id);
  process.stdout.write(JSON.stringify({
    ok: true,
    jobId: job.id,
    status: job.status,
    kimiSessionId: job.kimiSessionId || null,
    result: payload,
  }, null, 2) + "\n");
  process.exit(0);
}

function runJobCancel(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "any-session"],
  });
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const reference = positionals[0] || null;

  // `resolveCancelableJob(workspaceRoot, null)` filters to current-session
  // cancelable jobs by default (intentional safety — no accidentally
  // cancelling someone else's job). `--any-session` bypasses that filter
  // so a user in a new terminal can cancel a job they submitted earlier
  // (gemini v1-review G-H3 / G-M1). Explicit jobId already matches
  // across sessions, so this flag is only useful when the user doesn't
  // remember the id.
  //
  // Phase-4-impl-review C-M1: the `anySession` branch now lives in the
  // library (resolveCancelableJob) so every future caller sees the same
  // semantics without re-implementing the session-filter bypass.
  const job = resolveCancelableJob(workspaceRoot, reference, {
    anySession: Boolean(options["any-session"]),
  });

  if (!job) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: reference
        ? `No cancellable job matches "${reference}"`
        : (options["any-session"]
          ? "No active jobs in any session"
          : "No active jobs for the current session — pass a jobId or --any-session to reach older terminals"),
    }, null, 2) + "\n");
    process.exit(1);
  }

  const r = cancelJob(workspaceRoot, job.id);
  process.stdout.write(JSON.stringify({ ok: r.cancelled, ...r }, null, 2) + "\n");
  process.exit(r.cancelled ? 0 : 1);
}

function runTaskResumeCandidate(rawArgs) {
  const _ = parseArgs(rawArgs, { booleanOptions: ["json"] });
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);

  const candidate = resolveResumeCandidate(workspaceRoot);
  if (!candidate) {
    process.stdout.write(JSON.stringify({ available: false }, null, 2) + "\n");
    process.exit(0);
  }
  process.stdout.write(JSON.stringify(candidate, null, 2) + "\n");
  process.exit(0);
}

// ── Dispatcher ─────────────────────────────────────────────

// Subcommands whose $ARGUMENTS blob should be split into flags/positionals.
// - setup: all-flags contract (every token is "-…"); split when space present
// - ask:   mixed flags+prompt contract; split only when the FIRST token is a
//          KNOWN flag (codex v2-review A3: previous `startsWith("-")` would
//          mis-split a blob like "-v my prompt" where the leading dash is
//          part of the prompt). Allowlist known ask flags + their aliases.
const UNPACK_SAFE_SUBCOMMANDS = new Set([
  "setup", "ask", "review", "adversarial-review", "task",
  "status", "result", "cancel", "task-resume-candidate",
]);

// Matches a known ask flag token. Long form: --json / --stream / --model /
// --resume (with or without = attached). Short form: -m / -r (only — no
// other single-dash form is a valid ask flag).
const ASK_KNOWN_FLAG = /^(?:--(?:json|stream|model|resume)(?:=.*)?|-[mr])$/;
const REVIEW_KNOWN_FLAG = /^(?:--(?:json|model|base|scope)(?:=.*)?|-m)$/;
const ADVERSARIAL_REVIEW_KNOWN_FLAG = /^(?:--(?:json|model|base|scope|background|wait)(?:=.*)?|-m)$/;
const TASK_KNOWN_FLAG = /^(?:--(?:json|background|wait|resume-last|fresh|model|cwd|resume-session-id)(?:=.*)?|-m)$/;

function shouldUnpackBlob(sub, rest) {
  if (rest.length !== 1) return false;
  if (!UNPACK_SAFE_SUBCOMMANDS.has(sub)) return false;
  if (!rest[0].includes(" ")) return false;
  const tokens = splitRawArgumentString(rest[0]);
  if (tokens.length === 0) return false;
  if (sub === "setup") return tokens.every((t) => t.startsWith("-"));
  if (sub === "ask") return ASK_KNOWN_FLAG.test(tokens[0]);
  if (sub === "review") return REVIEW_KNOWN_FLAG.test(tokens[0]) || tokens.every((t) => !t.startsWith("-"));
  if (sub === "adversarial-review") return ADVERSARIAL_REVIEW_KNOWN_FLAG.test(tokens[0]) || tokens.every((t) => !t.startsWith("-"));
  if (sub === "task") return TASK_KNOWN_FLAG.test(tokens[0]) || tokens.every((t) => !t.startsWith("-"));
  // status/result/cancel/task-resume-candidate: all-flags OR [jobId, ...flags]
  if (sub === "status" || sub === "result" || sub === "cancel" || sub === "task-resume-candidate") {
    return true;
  }
  return false;
}

function dispatchWorker(rawArgs) {
  // rawArgs: [jobId, workspaceRoot, ...originalCompanionArgs]
  if (rawArgs.length < 3) {
    process.stderr.write("_worker requires: <jobId> <workspaceRoot> <forwarded-args...>\n");
    process.exit(2);
  }
  const [jobId, workspaceRoot, ...forwarded] = rawArgs;
  runWorker(jobId, workspaceRoot, SELF, forwarded);
  // runWorker persists state directly; exit normally so the detached child cleans up.
  process.exit(0);
}

async function dispatchStreamWorker(rawArgs) {
  // rawArgs: [jobId, workspaceRoot, configFile]
  if (rawArgs.length < 3) {
    process.stderr.write("_stream-worker requires: <jobId> <workspaceRoot> <configFile>\n");
    process.exit(2);
  }
  const [jobId, workspaceRoot, configFile] = rawArgs;
  const fsMod = await import("node:fs");
  let config;
  try {
    config = JSON.parse(fsMod.readFileSync(configFile, "utf8"));
  } catch (e) {
    process.stderr.write(`_stream-worker: cannot load config ${configFile}: ${e.message}\n`);
    try { fsMod.unlinkSync(configFile); } catch { /* ignore */ }
    process.exit(1);
  }
  // try/finally so a thrown runStreamingWorker doesn't leak the tmp config file
  // (codex v1-review C-M2). unlinkSync is itself try-wrapped in case the
  // file was never written or was already swept by the orphan cleanup.
  try {
    await runStreamingWorker(jobId, workspaceRoot, config);
  } finally {
    try { fsMod.unlinkSync(configFile); } catch { /* ignore */ }
  }
  process.exit(0);
}

async function main() {
  const argv = process.argv.slice(2);
  let [sub, ...rest] = argv;

  if (shouldUnpackBlob(sub, rest)) {
    rest = splitRawArgumentString(rest[0]);
  }

  switch (sub) {
    case "setup":
      return runSetup(rest);
    case "ask":
      return runAsk(rest);
    case "review":
      return runReview(rest);
    case "adversarial-review":
      return runAdversarialReview(rest);
    case "task":
      return runTask(rest);
    case "status":
      return runJobStatus(rest);
    case "result":
      return runJobResult(rest);
    case "cancel":
      return runJobCancel(rest);
    case "task-resume-candidate":
      return runTaskResumeCandidate(rest);
    case "_worker":
      return dispatchWorker(rest);
    case "_stream-worker":
      return dispatchStreamWorker(rest);
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
}

main();
