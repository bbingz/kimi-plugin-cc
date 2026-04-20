#!/usr/bin/env node
import process from "node:process";
import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import {
  getKimiAvailability,
  getKimiAuthStatus,
  readKimiDefaultModel,
  readKimiConfiguredModels,
} from "./lib/kimi.mjs";
import { binaryAvailable } from "./lib/process.mjs";

const USAGE = `Usage: kimi-companion <subcommand> [options]

Subcommands:
  setup [--json]    Check kimi CLI availability, auth, and configured models

(More subcommands arrive in Phase 2+.)`;

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

// ── Dispatcher ─────────────────────────────────────────────

// Phase 1 only needs to unpack $ARGUMENTS for the `setup` subcommand.
// Phase 2+ subcommands (ask / review / rescue) take positional prompts
// that may contain spaces — blindly splitting a single-blob argv would
// break them. Gate the unpack on (a) subcommand being setup AND (b) the
// blob looking like a flag list (every shell token starts with "-").
const UNPACK_SAFE_SUBCOMMANDS = new Set(["setup"]);

function shouldUnpackBlob(sub, rest) {
  if (rest.length !== 1) return false;
  if (!UNPACK_SAFE_SUBCOMMANDS.has(sub)) return false;
  if (!rest[0].includes(" ")) return false;
  const tokens = splitRawArgumentString(rest[0]);
  return tokens.length > 0 && tokens.every((t) => t.startsWith("-"));
}

function main() {
  const argv = process.argv.slice(2);
  let [sub, ...rest] = argv;

  if (shouldUnpackBlob(sub, rest)) {
    rest = splitRawArgumentString(rest[0]);
  }

  switch (sub) {
    case "setup":
      return runSetup(rest);
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
