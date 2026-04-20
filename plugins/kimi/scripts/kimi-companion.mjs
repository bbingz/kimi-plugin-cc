#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  getKimiAvailability,
  getKimiAuthStatus,
  readKimiDefaultModel,
  readKimiConfiguredModels,
  callKimi,
  callKimiStreaming,
  callKimiReview,
  KIMI_EXIT,
  MAX_REVIEW_DIFF_BYTES,
} from "./lib/kimi.mjs";
import { binaryAvailable } from "./lib/process.mjs";
import { ensureGitRepository, collectReviewContext } from "./lib/git.mjs";

// Plugin root is two levels above this file (scripts/kimi-companion.mjs →
// plugins/kimi). Used for loading packaged schemas.
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `Usage: kimi-companion <subcommand> [options]

Subcommands:
  setup [--json]                       Check kimi CLI availability, auth, and configured models
  ask [--json] [--stream] [-m <model>] [-r <sessionId>] "<prompt>"
                                       Send a one-shot prompt. --stream emits JSONL events as they arrive.
  review [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [-m <model>] [focus...]
                                       Review current diff. Always emits JSON matching review-output schema.

(More subcommands arrive in Phase 4+.)`;

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
  if (callArgs.resumeSessionId && result.ok && result.sessionId &&
      result.sessionId !== callArgs.resumeSessionId) {
    process.stderr.write(
      `Warning: requested --resume ${callArgs.resumeSessionId} did not match returned session ${result.sessionId}; kimi likely started a fresh session and prior context was not carried over.\n`
    );
  }
  // Propagate kimi's original exit status (codex C4) so callers can distinguish
  // config vs usage vs signal causes. result.status is null on success paths.
  process.exit(result.ok ? KIMI_EXIT.OK : (result.status ?? 1));
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

  const cwd = process.cwd();
  try {
    ensureGitRepository(cwd);
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + "\n");
    process.exit(1);
  }

  const scope = options.scope || "auto";
  const base = options.base || null;
  const context = collectReviewContext(cwd, { base, scope });

  if (!context.content || !context.content.trim()) {
    process.stdout.write(JSON.stringify({
      ok: true,
      verdict: "no_changes",
      response: "No changes to review.",
      truncated: false,
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

  // Non-OK reviews exit 1 so callers (hooks, scripts) can branch on status.
  process.exit(result.ok ? KIMI_EXIT.OK : 1);
}

// ── Dispatcher ─────────────────────────────────────────────

// Subcommands whose $ARGUMENTS blob should be split into flags/positionals.
// - setup: all-flags contract (every token is "-…"); split when space present
// - ask:   mixed flags+prompt contract; split only when the FIRST token is a
//          KNOWN flag (codex v2-review A3: previous `startsWith("-")` would
//          mis-split a blob like "-v my prompt" where the leading dash is
//          part of the prompt). Allowlist known ask flags + their aliases.
const UNPACK_SAFE_SUBCOMMANDS = new Set(["setup", "ask", "review"]);

// Matches a known ask flag token. Long form: --json / --stream / --model /
// --resume (with or without = attached). Short form: -m / -r (only — no
// other single-dash form is a valid ask flag).
const ASK_KNOWN_FLAG = /^(?:--(?:json|stream|model|resume)(?:=.*)?|-[mr])$/;
const REVIEW_KNOWN_FLAG = /^(?:--(?:json|model|base|scope)(?:=.*)?|-m)$/;

function shouldUnpackBlob(sub, rest) {
  if (rest.length !== 1) return false;
  if (!UNPACK_SAFE_SUBCOMMANDS.has(sub)) return false;
  if (!rest[0].includes(" ")) return false;
  const tokens = splitRawArgumentString(rest[0]);
  if (tokens.length === 0) return false;
  if (sub === "setup") return tokens.every((t) => t.startsWith("-"));
  if (sub === "ask") return ASK_KNOWN_FLAG.test(tokens[0]);
  if (sub === "review") return REVIEW_KNOWN_FLAG.test(tokens[0]) || tokens.every((t) => !t.startsWith("-"));
  return false;
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
