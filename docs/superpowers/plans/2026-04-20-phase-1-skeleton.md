# kimi-plugin-cc Phase 1 Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal working skeleton of `kimi-plugin-cc` — repo bootstrap, near-copy of generic lib files from `gemini-plugin-cc`, kimi-specific `kimi.mjs` (availability / auth / model / TOML reading — NO streaming yet), a single working `/kimi:setup` command, and initial drafts of all 3 skills. Exit: T1 (setup --json returns full populated JSON) and T8 (fresh-env install flow) pass AND the plugin is installable by Claude Code via `claude plugins add`.

**Architecture:** Node.js ≥ 18, zero npm dependencies. `scripts/kimi-companion.mjs` is the only entry point for commands; `scripts/lib/kimi.mjs` is the only kimi-specific module. All other libs are near-copies of their gemini counterparts, rewritten by hand (P2 principle — no `cp`, no `sed`). Every literal value in this plan is sourced from `doc/probe/probe-results.json` v3; **no placeholders**.

**Tech Stack:** Node.js built-ins only (`node:child_process`, `node:fs`, `node:os`, `node:path`, `node:crypto`, `node:string_decoder`). Kimi CLI ≥ 1.34 (currently 1.36 on dev box).

**Reference spec:** `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` (§2 layout, §3.1/3.5/3.6/3.7 CLI integration, §4.2 setup, §5 state).
**Reference probe data:** `doc/probe/probe-results.json` v3.
**Reference source (read but do not copy mechanically):** `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/`.

**v0.1 total budget estimate:** ~85 tasks / ~300 steps across 5 phases. This plan covers **Phase 1 only (17 tasks, ~75 steps)** after the plan-review integration (1.15 split → 1.15/1.16/1.17; parallelism notice added; export-parity checks added; model preflight added).

**Exit criteria (must all hold before tag `phase-1-skeleton`):**
- Directory tree matches spec §2.2
- `node plugins/kimi/scripts/kimi-companion.mjs setup --json` returns:
  - `installed: true`, `version: "kimi, version X.Y.Z"`
  - `authenticated: true`, `authDetail: "authenticated"`
  - `model: <non-empty string>`
  - `configured_models: [<non-empty array>]`
  - `installers: {shellInstaller, uv, pipx}` (all booleans)
- With `KIMI_CLI_BIN=/nonexistent` override, setup returns `installed: false` and lists available installers — this is T8 pass
- `claude plugins validate ./plugins/kimi` returns success (no schema errors)
- **Manual integration check**: the user installs the plugin via `claude plugins install` flow and runs `/kimi:setup` inside a Claude Code session; the command presents a human-readable block containing at minimum `installed: yes` and `default model: <name>` (the `formatSetupText` human-format path — verifies commands/setup.md → companion → kimi.mjs wiring end-to-end)
- `skills/kimi-cli-runtime/SKILL.md` committed with all probe-derived constants embedded as literal values (no TBD)
- `skills/kimi-prompting/SKILL.md` skeleton committed
- `skills/kimi-result-handling/SKILL.md` early draft committed (content aggregation rules + think-block drop policy)
- Git tag `phase-1-skeleton` applied

**Explicit non-goals (Phase 2+):**
- `callKimi` / `callKimiStreaming` with full stream-json event parsing → Phase 2
- `/kimi:ask`, `/kimi:review`, `/kimi:rescue`, background jobs → Phase 2-4
- Adversarial review → Phase 5
- Engram sidecar, ACP, `-C` continue → v0.2+

---

## File Structure for this Plan

**Create:**
- `.gitignore`, `README.md`, `CLAUDE.md`
- `.claude-plugin/marketplace.json`
- `plugins/kimi/.claude-plugin/plugin.json`
- `plugins/kimi/CHANGELOG.md`
- `plugins/kimi/scripts/lib/args.mjs` — near-copy from gemini
- `plugins/kimi/scripts/lib/process.mjs` — near-copy from gemini
- `plugins/kimi/scripts/lib/render.mjs` — near-copy from gemini
- `plugins/kimi/scripts/lib/git.mjs` — near-copy from gemini
- `plugins/kimi/scripts/lib/state.mjs` — change 2 constants only
- `plugins/kimi/scripts/lib/kimi.mjs` — fully new (minimal for setup)
- `plugins/kimi/scripts/kimi-companion.mjs` — dispatcher + `setup` subcommand
- `plugins/kimi/commands/setup.md`
- `plugins/kimi/skills/kimi-cli-runtime/SKILL.md`
- `plugins/kimi/skills/kimi-prompting/SKILL.md` + `references/.gitkeep`
- `plugins/kimi/skills/kimi-result-handling/SKILL.md`

**Already exists:**
- `CHANGELOG.md`, `doc/probe/*`, `docs/superpowers/specs/*`, `docs/superpowers/plans/*`

---

## Task 1.1: Repo root files

**Files:**
- Create: `.gitignore`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Write .gitignore**

```
node_modules/
*.log
.DS_Store
/tmp/
plugins/kimi/scripts/*.tmp
```

- [ ] **Step 2: Write CLAUDE.md**

```markdown
# kimi-plugin-cc working directory instructions

This repo is a Claude Code plugin that wraps Moonshot Kimi CLI. Structure mirrors `/Users/bing/-Code-/gemini-plugin-cc/` but every file is hand-rewritten (P2).

## Before coding
- Read `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md`
- Read `doc/probe/probe-results.json` for literal values (event keys, exit codes, hash algo, etc.)
- Read recent 5 entries of `CHANGELOG.md`

## Before committing
- Append CHANGELOG entry (status / scope / summary / next)
- Run T-checklist rows your change could affect
- Never sed/cp from gemini — read and rewrite
```

- [ ] **Step 3: Write README.md**

```markdown
# kimi-plugin-cc

Claude Code plugin integrating Moonshot Kimi CLI.

**Status:** v0.1 in development. See `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` for design.

## Prerequisites

- [Claude Code](https://claude.ai/code)
- Kimi CLI ≥ 1.34 (`uv tool install --python 3.13 kimi-cli` or the official shell installer)
- Authenticated Kimi CLI (run `kimi login` once in your terminal)

## Install (development)

```
claude plugins add /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi
```

## Commands (v0.1 incremental)

- `/kimi:setup` — verify Kimi CLI installation, authentication, and configured models
- (more commands arrive in Phase 2+)

## License

MIT
```

- [ ] **Step 4: Commit**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add .gitignore README.md CLAUDE.md
git commit -m "chore: repo root files"
```

---

## Task 1.2: Marketplace + plugin manifests

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `plugins/kimi/.claude-plugin/plugin.json`
- Create: `plugins/kimi/CHANGELOG.md`

- [ ] **Step 1: Write .claude-plugin/marketplace.json**

```bash
mkdir -p .claude-plugin
```

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "kimi-plugin",
  "version": "0.1.0",
  "description": "Kimi CLI plugin for Claude Code",
  "owner": { "name": "bing" },
  "plugins": [
    {
      "name": "kimi",
      "description": "Use Kimi from Claude Code to review code or delegate tasks.",
      "version": "0.1.0",
      "author": { "name": "bing" },
      "source": "./plugins/kimi",
      "category": "development"
    }
  ]
}
```

- [ ] **Step 2: Write plugins/kimi/.claude-plugin/plugin.json**

```bash
mkdir -p plugins/kimi/.claude-plugin
```

```json
{
  "name": "kimi",
  "version": "0.1.0",
  "description": "Use Kimi from Claude Code to review code or delegate tasks.",
  "author": { "name": "bing" }
}
```

- [ ] **Step 3: Write plugins/kimi/CHANGELOG.md**

```markdown
# kimi plugin CHANGELOG

## 0.1.0 (in progress — Phase 1)

- Phase 1 skeleton:
  - Directory tree
  - Near-copy libs from gemini-plugin-cc (args, process, render, git, state)
  - kimi.mjs (availability, auth, TOML model reader)
  - /kimi:setup command
  - kimi-cli-runtime / kimi-prompting / kimi-result-handling skill drafts
```

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin plugins/kimi/.claude-plugin plugins/kimi/CHANGELOG.md
git commit -m "feat: marketplace and plugin manifests"
```

---

> **Parallelism note (gemini review)**: Tasks 1.3–1.7 (library near-copies) are **mutually independent** — they don't import from each other and each creates a distinct file. A controller using subagent-driven-development can dispatch them in parallel with `dispatching-parallel-agents`. Tasks 1.8+ serialize (they depend on the lib files).

## Task 1.3: Rewrite `args.mjs` from gemini (pure argv parser, no kimi-specifics)

**Files:**
- Create: `plugins/kimi/scripts/lib/args.mjs`

- [ ] **Step 1: Read gemini's args.mjs fully**

Read `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/args.mjs`. The file has two exports:
- `parseArgs(argv, config)` — takes `{valueOptions, booleanOptions, aliasMap}` and returns `{options, positionals}`. Handles `--key=value`, `--key value`, `-k value`, `--` passthrough.
- `splitRawArgumentString(raw)` — shell-style tokenizer respecting single/double quotes and `\` escapes.

Both are zero kimi-specific. Total ~130 lines.

- [ ] **Step 2: Write args.mjs locally**

Rewrite the file at `plugins/kimi/scripts/lib/args.mjs`. You must produce functionally identical behavior. Typing it out (vs `cp`) is the point — it forces comprehension.

- [ ] **Step 3: Syntax check**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node --check plugins/kimi/scripts/lib/args.mjs
```

Expected: no output (parse ok).

- [ ] **Step 4: Smoke test both exports AND export-signature parity with gemini source**

```bash
node -e '
Promise.all([
  import("./plugins/kimi/scripts/lib/args.mjs"),
  import("/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/args.mjs"),
]).then(([kimi, gemini]) => {
  // Export-signature parity (gemini review G1): names must match exactly.
  const kExports = Object.keys(kimi).sort();
  const gExports = Object.keys(gemini).sort();
  console.log("kimi exports:", kExports);
  console.log("gemini exports:", gExports);
  console.assert(JSON.stringify(kExports) === JSON.stringify(gExports),
    "EXPORT MISMATCH: kimi and gemini args.mjs must have identical export names");

  // Functional smoke: parseArgs
  const r = kimi.parseArgs(["--json", "--model", "kimi-k2", "hello", "-v"], {
    valueOptions: ["model"],
    booleanOptions: ["json", "v"],
  });
  console.log("parseArgs:", JSON.stringify(r));
  console.assert(r.options.json === true, "json flag");
  console.assert(r.options.model === "kimi-k2", "model value");
  console.assert(r.positionals.includes("hello"), "positional");

  // Functional smoke: splitRawArgumentString
  const toks = kimi.splitRawArgumentString(`--model "kimi-k2" hello "a b c"`);
  console.log("split:", JSON.stringify(toks));
  console.assert(toks.length === 4, "4 tokens");
  console.assert(toks[3] === "a b c", "quoted arg kept");
});
'
```

Expected: both export lists identical; all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/args.mjs
git commit -m "feat(lib): args.mjs (rewritten from gemini)"
```

---

## Task 1.4: Rewrite `process.mjs` from gemini

**Files:**
- Create: `plugins/kimi/scripts/lib/process.mjs`

- [ ] **Step 1: Read gemini's process.mjs fully**

Source: `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/process.mjs`. Four exports:
- `runCommand(command, args, {cwd, env, encoding, input, timeout, stdio})` — wrapper around `spawnSync`, returns `{command, args, status, signal, stdout, stderr, error}`.
- `runCommandChecked` — same but throws on non-zero.
- `binaryAvailable(command, versionArgs, options)` — returns `{available, detail}`.
- `formatCommandFailure(result)` — formats for error messages.

Zero kimi-specific. ~74 lines.

- [ ] **Step 2: Write process.mjs locally**

- [ ] **Step 3: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/process.mjs
```

- [ ] **Step 4: Smoke test AND export-signature parity**

```bash
node -e '
Promise.all([
  import("./plugins/kimi/scripts/lib/process.mjs"),
  import("/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/process.mjs"),
]).then(([kimi, gemini]) => {
  const kExports = Object.keys(kimi).sort();
  const gExports = Object.keys(gemini).sort();
  console.assert(JSON.stringify(kExports) === JSON.stringify(gExports),
    "EXPORT MISMATCH process.mjs: " + kExports + " vs " + gExports);

  const a = kimi.binaryAvailable("node", ["-v"]);
  console.log("node availability:", a);
  console.assert(a.available === true, "node should be available");

  const r = kimi.runCommand("printf", ["hi"]);
  console.log("run:", r.status, r.stdout);
  console.assert(r.status === 0 && r.stdout === "hi", "basic exec");
});
'
```

Expected: export lists match; assertions pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/process.mjs
git commit -m "feat(lib): process.mjs (rewritten from gemini)"
```

---

## Task 1.5: Rewrite `render.mjs` from gemini

**Files:**
- Create: `plugins/kimi/scripts/lib/render.mjs`

- [ ] **Step 1: Read gemini's render.mjs fully**

Source: `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/render.mjs`. Responsible for formatting console output (stats blocks, findings, streaming progress, etc.).

**kimi-specific tweaks while reading (probe-informed):**
- Any `"Gemini"` user-visible banner → `"Kimi"`
- Any `"gemini"` in user-visible text → `"kimi"`
- **Remove** stats/token rendering paths. Per spec §3.3.4 and probe-results.json, kimi doesn't emit stats events; v0.1 deliberately does NOT render stats (no null-safe fallback — just omit). If render.mjs has a function like `formatStats(stats)`, keep the function but make the caller skip calling it when stats is null/undefined; OR delete the function entirely if it's the only caller. Choose based on what you see when reading.
- Function / variable names: unchanged.

- [ ] **Step 2: Write render.mjs locally**

- [ ] **Step 3: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/render.mjs
```

- [ ] **Step 4: Smoke test AND export-signature parity**

Render.mjs diverges from gemini on one dimension: the stats-render path is intentionally removed (see spec §3.3.4). So export parity allows a **subset** relationship (kimi ⊆ gemini), not exact match. Verify that kimi's exports are a subset of gemini's, and any missing export is intentional (documented in the commit message).

```bash
node -e '
Promise.all([
  import("./plugins/kimi/scripts/lib/render.mjs"),
  import("/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/render.mjs"),
]).then(([kimi, gemini]) => {
  const kExports = new Set(Object.keys(kimi));
  const gExports = new Set(Object.keys(gemini));
  console.log("kimi exports:", [...kExports].sort());
  console.log("gemini exports:", [...gExports].sort());
  const extra = [...kExports].filter(x => !gExports.has(x));
  const missing = [...gExports].filter(x => !kExports.has(x));
  console.log("kimi adds:", extra, " kimi removes:", missing);
  console.assert(extra.length === 0, "kimi must not add exports to render.mjs");
  // `missing` is allowed (stats path intentionally removed), but log for audit.
});
'
```

Then verify no user-visible "Gemini" literals remain:

```bash
grep -n -i "gemini" plugins/kimi/scripts/lib/render.mjs || echo "no gemini refs — good"
```

Expected: no matches (or only in comments that are intentional — which we don't want; commit message should document any comment references).

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/render.mjs
git commit -m "feat(lib): render.mjs (rewritten from gemini; stats rendering removed)"
```

---

## Task 1.6: Rewrite `git.mjs` from gemini

**Files:**
- Create: `plugins/kimi/scripts/lib/git.mjs`

- [ ] **Step 1: Read gemini's git.mjs fully**

Source: `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/git.mjs`. Collects diffs per scope (`auto` / `working-tree` / `branch`). Pure git wrapper, zero llm-specifics.

- [ ] **Step 2: Write git.mjs locally**

Byte-for-byte equivalent is fine here (the file has no Gemini literals).

- [ ] **Step 3: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/git.mjs
```

- [ ] **Step 4: Smoke test AND export-signature parity**

```bash
node -e '
Promise.all([
  import("./plugins/kimi/scripts/lib/git.mjs"),
  import("/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/git.mjs"),
]).then(([kimi, gemini]) => {
  const kExports = Object.keys(kimi).sort();
  const gExports = Object.keys(gemini).sort();
  console.log("exports:", kExports);
  console.assert(JSON.stringify(kExports) === JSON.stringify(gExports),
    "EXPORT MISMATCH git.mjs: " + kExports + " vs " + gExports);
});
'
```

Expected: exports identical. Also exercise the diff collector against this repo (it should return empty diff since everything is committed) to confirm it runs.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/git.mjs
git commit -m "feat(lib): git.mjs (rewritten from gemini)"
```

---

## Task 1.7: Rewrite `state.mjs` with kimi paths

**Files:**
- Create: `plugins/kimi/scripts/lib/state.mjs`

- [ ] **Step 1: Read gemini's state.mjs fully**

Source: `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/state.mjs` (239 lines). Handles workspace-scoped state dir, jobs dir, lockfile-protected updates, job pruning (MAX_JOBS=50), stale-lock cleanup (30s).

**Exhaustive change list (codex review):**
- Line 10: `FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "gemini-companion")` → change `"gemini-companion"` to `"kimi-companion"`.
- Line 183: `export function generateJobId(prefix = "gj")` → change default prefix `"gj"` to `"kj"`.
- Keep `MAX_JOBS = 50` and the 30s stale-lock timeout as-is for v0.1 (codex flagged these as "implicit defaults to be aware of"; no evidence they need tuning for kimi yet).
- Everything else unchanged, including env var name `CLAUDE_PLUGIN_DATA` (Claude-injected, not gemini-specific).

- [ ] **Step 2: Write state.mjs locally**

- [ ] **Step 3: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/state.mjs
```

- [ ] **Step 4: Smoke test AND export-signature parity**

```bash
node -e '
Promise.all([
  import("./plugins/kimi/scripts/lib/state.mjs"),
  import("/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/state.mjs"),
]).then(([kimi, gemini]) => {
  const kExports = Object.keys(kimi).sort();
  const gExports = Object.keys(gemini).sort();
  console.assert(JSON.stringify(kExports) === JSON.stringify(gExports),
    "EXPORT MISMATCH state.mjs: " + kExports + " vs " + gExports);

  const id = kimi.generateJobId();
  console.log("job id:", id);
  console.assert(id.startsWith("kj-"), "prefix must be kj-");

  const dir = kimi.resolveStateDir("/tmp/kimi-plugin-test");
  console.log("state dir:", dir);
  console.assert(dir.includes("kimi-companion"), "fallback dir should contain kimi-companion");
  console.assert(!dir.includes("gemini"), "no gemini leak");
});
'
```

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/state.mjs
git commit -m "feat(lib): state.mjs with kimi-companion fallback dir and kj- job prefix"
```

---

## Task 1.8: kimi.mjs — TOML scanner + availability + model readers

**Files:**
- Create: `plugins/kimi/scripts/lib/kimi.mjs`

- [ ] **Step 1: Write kimi.mjs with imports, TOML helper, availability, and model readers**

```js
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

// Reads the TOML text and returns the model names declared as
// `[models.<name>]` sections. Handles both bare keys (`[models.foo]`)
// and quoted keys with slashes (`[models."vendor/model"]`). Quotes are
// stripped on return so callers can match against kimi's own -m flag.
export function readTomlModelSectionNames(text) {
  const lines = text.split(/\r?\n/);
  const names = [];
  // Bare key:    [models.some_name]
  // Quoted key:  [models."vendor/model"] or [models.'vendor/model']
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

// ── Placeholder for the auth function written in Task 1.9 ──
export function getKimiAuthStatus(_cwd) {
  throw new Error("getKimiAuthStatus not implemented yet (Task 1.9)");
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
```

- [ ] **Step 2: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/kimi.mjs
```

- [ ] **Step 3: Smoke test TOML helpers, availability, AND exported constants**

Includes the **constant assertion** (gemini review G2): SESSION_ID_STDERR_REGEX must extract a UUID from a hardcoded stderr sample.

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(m => {
  // ── TOML helpers ──
  const sample = `
# a comment
default_model = "kimi-k2-latest"
other = "ignored"

[models.kimi-k2-latest]
model = "moonshot-v1-128k"

[models.kimi-long]
model = "moonshot-v1-auto"

[models."kimi-code/kimi-for-coding"]
model = "moonshot-code"

[agent]
max_steps = 10
`;

  const def = m.readTomlTopLevelKey(sample, "default_model");
  console.log("default_model:", def);
  console.assert(def === "kimi-k2-latest", "default_model");

  const names = m.readTomlModelSectionNames(sample);
  console.log("model names:", names);
  console.assert(names.includes("kimi-k2-latest"), "bare name");
  console.assert(names.includes("kimi-long"), "bare name 2");
  console.assert(names.includes("kimi-code/kimi-for-coding"), "quoted name with slash must be stripped of quotes");

  // ── Exported constants assertion (gemini G2) ──
  console.assert(m.PING_MAX_STEPS === 1, "PING_MAX_STEPS literal from probe 04");
  console.assert(m.LARGE_PROMPT_THRESHOLD_BYTES === 100000, "LARGE_PROMPT_THRESHOLD_BYTES from probe 03");
  console.assert(m.PARENT_SESSION_ENV === "KIMI_COMPANION_SESSION_ID", "env name");
  // Regex test — it must extract UUID from the exact stderr shape probe 01 observed:
  const stderrSample = "\nTo resume this session: kimi -r 22c1cc04-fc62-4cf4-98e0-ad42b47042bd\n";
  const match = stderrSample.match(m.SESSION_ID_STDERR_REGEX);
  console.log("regex match:", match && match[1]);
  console.assert(match && match[1] === "22c1cc04-fc62-4cf4-98e0-ad42b47042bd",
    "SESSION_ID_STDERR_REGEX must extract the UUID from probe 01 stderr shape");

  // ── Real machine check ──
  console.log("availability:", m.getKimiAvailability());
  console.log("real default_model:", m.readKimiDefaultModel());
  const realModels = m.readKimiConfiguredModels();
  console.log("real configured_models:", realModels);
  console.assert(Array.isArray(realModels) && realModels.length > 0,
    "machine has at least one [models.*] section");
});
'
```

Expected: all 9 assertions pass; `kimi-code/kimi-for-coding` extraction works (codex C2); constant literals correct (gemini G2).

- [ ] **Step 4: Commit**

```bash
git add plugins/kimi/scripts/lib/kimi.mjs
git commit -m "feat(kimi): toml scanner, availability, model readers"
```

---

## Task 1.9: kimi.mjs — auth status via ping-call

**Files:**
- Modify: `plugins/kimi/scripts/lib/kimi.mjs`

- [ ] **Step 1: Replace the placeholder `getKimiAuthStatus` with a real implementation**

In `kimi.mjs`, delete the line
```js
export function getKimiAuthStatus(_cwd) {
  throw new Error("getKimiAuthStatus not implemented yet (Task 1.9)");
}
```

and add the real implementation (before the final `export { ... }` block):

```js
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
// for at least one assistant event with a non-empty text block.
// See doc/probe/probe-results.json v3 → stream_json for field semantics.
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

  // ── Model preflight (codex review C3) ──
  // Before spending a live session on the ping, verify the default model
  // is actually declared in ~/.kimi/config.toml [models.*]. Otherwise kimi
  // builds a session, then fails with "LLM not set" (exit 1) and we'd
  // mis-report that as "not authenticated." Distinguish the two states.
  const defaultModel = readKimiDefaultModel();
  const configured = readKimiConfiguredModels();
  if (defaultModel && !configured.includes(defaultModel)) {
    return {
      loggedIn: null, // neither yes nor no — upstream concern unrelated to auth
      detail: `default model '${defaultModel}' is not declared in ~/.kimi/config.toml [models.*]`,
      model: defaultModel,
      modelConfigured: false,
    };
  }
  if (configured.length === 0) {
    return {
      loggedIn: null,
      detail: "no [models.*] sections in ~/.kimi/config.toml",
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
```

- [ ] **Step 2: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/kimi.mjs
```

- [ ] **Step 3: Smoke test on this authenticated machine**

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(m => {
  const r = m.getKimiAuthStatus(process.cwd());
  console.log(r);
  console.assert(r.loggedIn === true, "must be authenticated — implies default model is in configured list");
  console.assert(r.detail === "authenticated", "detail");
  console.assert(typeof r.model === "string" && r.model.length > 0, "model present");
  console.assert(r.modelConfigured === true, "modelConfigured flag set");
});
'
```

Expected: `{ loggedIn: true, detail: "authenticated", model: "<something>", modelConfigured: true }`.

If `loggedIn: null` with a `modelConfigured: false` detail, the host machine's `~/.kimi/config.toml` has a `default_model` whose `[models.<name>]` section doesn't exist. Fix the config, then re-run.

- [ ] **Step 4: Simulate non-auth path with KIMI_CLI_BIN override**

```bash
KIMI_CLI_BIN=/nonexistent/kimi node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(m => {
  const r = m.getKimiAuthStatus(process.cwd());
  console.log("broken binary:", r);
  console.assert(r.loggedIn === false, "should be false with bad binary");
});
'
```

Expected: `loggedIn: false`, detail mentions ENOENT or similar.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/kimi.mjs
git commit -m "feat(kimi): auth status via ping-call with assistant-text-block check"
```

---

## Task 1.10: kimi-companion.mjs dispatcher with `setup` subcommand

**Files:**
- Create: `plugins/kimi/scripts/kimi-companion.mjs`

- [ ] **Step 1: Write the dispatcher**

```js
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
    authenticated: auth.loggedIn,
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

// Phase 1 only needs to unpack $ARGUMENTS for the `setup` subcommand. Phase 2+
// subcommands (ask / review / rescue) take a positional prompt that may
// contain spaces — blindly splitting a single-blob argv would break them.
// So we gate the unpack on (a) the subcommand being setup AND (b) the blob
// looking like a flag list (every shell token starts with "-").
const UNPACK_SAFE_SUBCOMMANDS = new Set(["setup"]);

function shouldUnpackBlob(sub, rest) {
  if (rest.length !== 1) return false;
  if (!UNPACK_SAFE_SUBCOMMANDS.has(sub)) return false;
  if (!rest[0].includes(" ")) return false;
  // Additional guard: the blob must look like flags, not a prompt. Tokenize
  // first and verify every token starts with "-".
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
```

- [ ] **Step 2: Syntax check**

```bash
node --check plugins/kimi/scripts/kimi-companion.mjs
```

- [ ] **Step 3: Smoke test — setup --json on this machine**

```bash
node plugins/kimi/scripts/kimi-companion.mjs setup --json
```

Expected: JSON with `installed: true`, `version: "kimi, version X.Y.Z"`, `authenticated: true`, `authDetail: "authenticated"`, `model: "<some-name>"`, `configured_models: [...]` (non-empty array), `installers: {shellInstaller, uv, pipx}`.

- [ ] **Step 4: Smoke test — setup --json with broken binary**

```bash
KIMI_CLI_BIN=/nonexistent node plugins/kimi/scripts/kimi-companion.mjs setup --json
```

Expected: JSON with `installed: false`, `version: null`, `authenticated: false`, `installers` still populated.

- [ ] **Step 5: Smoke test — dispatcher arg unpacking**

Test the $ARGUMENTS-as-single-string path:

```bash
node plugins/kimi/scripts/kimi-companion.mjs setup "--json --enable-review-gate"
```

Expected: the blob is split correctly; JSON is emitted (both flags recognized).

- [ ] **Step 6: Commit**

```bash
git add plugins/kimi/scripts/kimi-companion.mjs
git commit -m "feat(companion): dispatcher with setup subcommand"
```

---

## Task 1.11: `/kimi:setup` command markdown

**Files:**
- Create: `plugins/kimi/commands/setup.md`

- [ ] **Step 1: Write the command**

```bash
mkdir -p plugins/kimi/commands
```

````markdown
---
description: Check whether the local Kimi CLI is ready, authenticated, and has configured models
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(uv:*), Bash(pipx:*), Bash(sh:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" setup --json "$ARGUMENTS"
```

Interpret the JSON result:

### Not installed (`installed: false`)

Check which installers are available in `installers.*`. Build the AskUserQuestion option list **dynamically**, only including options whose installer is detected. Always include `Skip for now`.

Possible options (include only if the installer is present):
- `Install via shell script (Recommended, official)` → runs `curl -LsSf https://cdn.kimi.com/binaries/kimi-cli/install.sh | bash` (URL verified by codex; previous plan's `kimi.moonshot.cn/cli/install.sh` was wrong)
- `Install via uv` → runs `uv tool install --python 3.13 kimi-cli`. If the install reports `error: unexpected argument '--python'`, the user's uv is too old; fall back to `uv tool install kimi-cli` and warn them about potential Python version mismatch.
- `Install via pipx (unverified)` → runs `pipx install kimi-cli`
- `Skip for now`

**Edge case: 0 installers detected.** If `shellInstaller`, `uv`, and `pipx` are all false, do NOT use AskUserQuestion (it requires ≥2 options). Instead, print: "No installer detected. Install one of: curl (for the official shell script), uv, or pipx. Then re-run `/kimi:setup`."

After successful install, re-run the setup subcommand. If it still reports `installed: false`, check whether `~/.local/bin/kimi` exists on disk — if yes, tell the user: "kimi is installed at `~/.local/bin/kimi` but not on your PATH. Add `~/.local/bin` to PATH (e.g. in your shell rc file) and reopen your shell, then re-run `/kimi:setup`."

### Installed but not authenticated (`installed: true, authenticated: false`)

Do NOT attempt to run `kimi login` from a tool call — it's interactive. Tell the user verbatim: "Run `! kimi login` in your terminal to authenticate, then re-run `/kimi:setup`."

### All good (`installed: true, authenticated: true`)

Print the full status JSON block to the user so they can see `version`, `model`, `configured_models`, etc. If the user passed `--enable-review-gate` or `--disable-review-gate`, acknowledge — the review-gate state toggle is implemented in Phase 4; for now tell them: "review-gate toggle arrives in Phase 4; your setting is recorded but has no effect yet."

### Output rules

- Present the setup output faithfully; do not paraphrase the JSON fields.
- Do not auto-suggest any installs when already installed and authenticated.
- Do not fetch or analyze anything external beyond what the companion returns.
````

- [ ] **Step 2: Sanity-check frontmatter**

```bash
head -6 plugins/kimi/commands/setup.md
```

Expected: yaml-like frontmatter with `description`, `argument-hint`, `allowed-tools` all present.

- [ ] **Step 3: Commit**

```bash
git add plugins/kimi/commands/setup.md
git commit -m "feat(command): /kimi:setup"
```

---

## Task 1.12: `kimi-cli-runtime` skill with probe-derived literals

**Files:**
- Create: `plugins/kimi/skills/kimi-cli-runtime/SKILL.md`

- [ ] **Step 1: Write the skill with literal values from probe-results.json v3**

```bash
mkdir -p plugins/kimi/skills/kimi-cli-runtime
```

```markdown
---
name: kimi-cli-runtime
description: Internal helper contract for calling the kimi-companion runtime from Claude Code
---

# kimi-cli-runtime

Internal contract for code invoking `scripts/kimi-companion.mjs`. Not user-facing. Claude uses this skill implicitly when dispatched via `/kimi:*` commands or the `kimi-agent` subagent.

## Runtime requirements

- `kimi` CLI ≥ 1.34 on PATH (dev box has 1.36.0)
- `~/.kimi/credentials/` non-empty (user ran `kimi login` interactively)
- Node.js ≥ 18
- Zero npm dependencies — plugin uses only Node built-ins

## Companion script subcommands

| Subcommand | Purpose | JSON shape |
|---|---|---|
| `setup --json` | Check install + auth + models | `{installed, version, authenticated, authDetail, model, configured_models[], installers}` |
| `ask [options] "<prompt>"` | (Phase 2) One-shot query | streaming events then `{response, sessionId}` |
| `review [options]` | (Phase 3) Review current diff | `{verdict, summary, findings[], next_steps[]}` |
| `task [options] "<prompt>"` | (Phase 4) Background job | `{jobId, status}` |
| `status` / `result <jobId>` / `cancel <jobId>` | (Phase 4) Job lifecycle | per gemini plugin parity |
| `task-resume-candidate --json` | (Phase 4) Resumable session | `{available, sessionId, cwd}` |

## Kimi CLI invocation facts (from doc/probe/probe-results.json v3)

These constants are the direct result of Phase 0 probes + codex source-read. Do NOT re-derive or re-probe.

- **Version flag**: `kimi -V` (**uppercase**). `-v` means verbose.
- **Headless format**: `kimi -p "<prompt>" --print --output-format stream-json` emits **per-message JSONL** (not per-token streaming).
- **Event shape**:
  - Top-level keys: `role`, `content`
  - `role` ∈ `{"assistant", "tool"}` (maybe more)
  - `content` is a **list of blocks**, each block has `type`: `"text"`, `"think"`, `"image_url"`, `"audio_url"`, `"video_url"` (source-defined set; probe observed only text + think)
  - **NO top-level `type` field** as event tag
- **Multi-line per run**: a single kimi invocation CAN emit multiple JSONL lines (each tool_result is a separate `role:"tool"` event; each assistant turn another line). The parser MUST handle multi-line accumulation.
- **Session ID**: NOT in stdout JSON. Only in stderr via regex `/kimi -r ([0-9a-f-]{36})/`. Source-verified unconditional emission (not gated by `--quiet`).
- **Session ID fallback**: `~/.kimi/kimi.json.work_dirs[].last_session_id` where `path` matches the passed `-w` exactly. Updated synchronously in `--print` mode.
- **Path storage**: **verbatim** (not symlink-resolved). Always pass `-w fs.realpathSync(cwd)` and compare against `work_dirs[i].path` with the same form.
- **Hash algorithm** for `~/.kimi/sessions/<hash>/`: md5 of path string.
- **Default model**: TOML scalar `default_model` at the top level of `~/.kimi/config.toml`.
- **Configured models**: TOML sections `[models.<name>]` (one per name).
- **Large prompts**: pipe via stdin with `-p ""` when `prompt.length >= 100000` bytes.
- **Auth ping**: `--max-steps-per-turn 1` is 3/3 reliable; use 30s timeout.
- **Model preflight**: validate `-m <name>` exists in `configured_models` BEFORE calling kimi to avoid wasted sessions (exit 1 + "LLM not set" path).
- **Stats / token usage**: NOT surfaced in stream-json. kimi emits `StatusUpdate` internally but `JsonPrinter` drops it. v0.1 cannot expose token stats.

## Exit code map

| exit | Meaning | User-facing message |
|---|---|---|
| 0 | Success | (parse JSONL, render response) |
| 1 | `LLMNotSet` (unknown model name) | "Model `<X>` not configured in ~/.kimi/config.toml" |
| 2 | Click usage error (bad `-w`, bad flag) | Show stderr error box verbatim |
| 130 | SIGINT | "Cancelled by user" |
| 143 | SIGTERM | "Request was interrupted" |
| other | Internal | Show exit code + stderr first 200 chars |

## Assistant text extraction contract (for Phase 2+)

Given an assistant event `{role: "assistant", content: [...]}`:

```js
const text = (event.content || [])
  .filter(b => b && b.type === "text" && typeof b.text === "string")
  .map(b => b.text)
  .join("");
```

- Drop `type === "think"` blocks by default (reasoning channel; surface only with an explicit flag).
- Skip unknown block types without erroring; preserve the raw block for debug logs.
- `event.tool_calls` is at the top level, parallel to content — preserve for job tracking in `/kimi:rescue`; ignore for `/kimi:ask`.

## Do NOT

- Do NOT pass `--approval-mode` (kimi does not accept it).
- Do NOT write to `~/.kimi/`.
- Do NOT parse the kimi TUI — always go through `--print`.
- Do NOT assume stats are available in v0.1.
- Do NOT use `kimi -C` (continue-last) — session continuity must be explicit via `-r <sessionId>`.
```

- [ ] **Step 2: Verify frontmatter**

```bash
head -4 plugins/kimi/skills/kimi-cli-runtime/SKILL.md
```

- [ ] **Step 3: Cross-check — no placeholders**

```bash
grep -nE "<TBD>|<PING_|<EVENT_|<SESSION_|<PLACEHOLDER" plugins/kimi/skills/kimi-cli-runtime/SKILL.md && echo "FAIL: placeholders found" || echo "no placeholders"
```

Expected: `no placeholders`.

- [ ] **Step 4: Commit**

```bash
git add plugins/kimi/skills/kimi-cli-runtime/SKILL.md
git commit -m "feat(skill): kimi-cli-runtime with probe-derived literals"
```

---

## Task 1.13: `kimi-prompting` skill skeleton

**Files:**
- Create: `plugins/kimi/skills/kimi-prompting/SKILL.md`
- Create: `plugins/kimi/skills/kimi-prompting/references/.gitkeep`

- [ ] **Step 1: Write skeleton**

```bash
mkdir -p plugins/kimi/skills/kimi-prompting/references
touch plugins/kimi/skills/kimi-prompting/references/.gitkeep
```

```markdown
---
name: kimi-prompting
description: Internal guidance for composing Kimi CLI prompts for coding, review, diagnosis, and research tasks
---

# kimi-prompting (Phase 1 skeleton)

Fully populated in Phase 5 once real prompts have been tested across `/kimi:ask`, `/kimi:review`, `/kimi:rescue`. Phase 1 provides the bones.

## Scope

Guidance for Claude when composing a prompt to send to Kimi via `kimi-companion.mjs`. Not user-facing.

## Universal rules (v0.1)

1. **Output contract first.** State the expected output format in the first paragraph of any task prompt. For JSON responses, explicitly say: "Return ONLY a JSON object matching this schema. No prose before or after. No markdown code fence."
2. **Context in a labeled block.** When passing code / diff / docs, wrap in a clearly labeled heading (`### Diff to review` / `### Files under investigation`).
3. **Language parity.** Kimi's Chinese-language reasoning is strong. If the user prompt is Chinese, keep the system / instruction text in Chinese. Do not force English.
4. **Small `--max-steps-per-turn` on simple Q&A.** For `/kimi:ask`, set a small N (3 is a sensible default). For `/kimi:rescue --write`, allow larger N.
5. **No tool-call expectation.** Do not write prompts that assume tool use unless the command is `/kimi:rescue --write`. `/kimi:ask` should bias toward single-turn answers.

## Placeholder references (filled in Phase 5)

- `references/kimi-prompt-recipes.md` — recipes for common tasks (review / refactor / explain / doc-summarize)
- `references/kimi-prompt-antipatterns.md` — patterns that empirically fail on Kimi (populated from real failures during Phases 2-4)
- `references/prompt-blocks.md` — reusable blocks (task framing, output contracts, `--thinking` triggers)
```

- [ ] **Step 2: Commit**

```bash
git add plugins/kimi/skills/kimi-prompting/
git commit -m "feat(skill): kimi-prompting skeleton (full content in Phase 5)"
```

---

## Task 1.14: `kimi-result-handling` skill early draft

**Files:**
- Create: `plugins/kimi/skills/kimi-result-handling/SKILL.md`

- [ ] **Step 1: Write early draft with content aggregation rules**

Gemini review [P1.7] requested this skill be drafted in Phase 1 (not Phase 5) because it encodes the content-block aggregation contract — without it, Phase 2's `/kimi:ask` implementation has no guardrails.

```bash
mkdir -p plugins/kimi/skills/kimi-result-handling
```

```markdown
---
name: kimi-result-handling
description: Internal guidance for presenting Kimi output back to the user
---

# kimi-result-handling (Phase 1 early draft)

How Claude should render and reason about kimi's output after receiving it from `kimi-companion.mjs`. Applies to all `/kimi:*` commands.

## The invariant

The companion has already aggregated content blocks into a final `response` string per the rules in `kimi-cli-runtime`. This skill is about what to do with that string.

## Presentation rules

1. **Quote kimi verbatim.** When showing a kimi response to the user, do not paraphrase or compress it. Kimi's output language (Chinese is common) must be preserved — do NOT translate unless the user asked.
2. **Flag disagreements.** If your own analysis differs from kimi's, say so explicitly: "Note: Claude disagrees on X because Y." Don't hide disagreement to appear consistent.
3. **Never auto-execute.** Kimi may suggest commands, code changes, or file edits. Do NOT apply them silently. Ask which items to act on.
4. **Respect the channel.** For `/kimi:review`, the structured JSON is the primary payload; prose is commentary. For `/kimi:ask`, the string is the primary payload.

## Think blocks

Per `kimi-cli-runtime`, the default companion drops `type: "think"` blocks. If a future version surfaces them (e.g. via `--show-thinking`), render them in a `<details>` / collapsed block — never inline with the main answer. Think content is reasoning, not conclusions.

## Unknown block types

If the companion ever surfaces a raw block with an unfamiliar `type` (e.g. `image_url`), do not guess its meaning. Tell the user: "Kimi returned a `<type>` block that this plugin version does not render. Raw contents: ..."

## Token usage / stats

v0.1 cannot obtain token counts (kimi drops `StatusUpdate` in JsonPrinter). Do NOT claim the response "cost X tokens" or estimate context window usage — you don't have that data.

## Error output

If the companion returns an error status (non-zero exit), show it directly with context. Do NOT try to re-run. Use the exit-code map in `kimi-cli-runtime` to interpret the cause and choose the right user-facing message.

## What to expand in Phase 5

- Chinese-vs-English rendering nuances observed across `/kimi:ask` usage
- Review findings render order (severity-first, stable sort)
- Diff-aware presentation for `/kimi:review`
- Concrete examples of disagreement-flagging phrasing
```

- [ ] **Step 2: Commit**

```bash
git add plugins/kimi/skills/kimi-result-handling/
git commit -m "feat(skill): kimi-result-handling early draft (content rules up front)"
```

---

## Task 1.15: T1 + T8 — CLI-level acceptance (automatable)

Split from the original combined task (gemini review G3) so CLI-level failures are isolated from Claude Code integration failures.

**Files:** (no files changed — validation only)

- [ ] **Step 1: T1 — companion setup --json on this authenticated machine**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node plugins/kimi/scripts/kimi-companion.mjs setup --json | tee /tmp/t1.json
```

Verify all fields populated AND meaningful:

```bash
python3 - <<'PY'
import json
d = json.load(open("/tmp/t1.json"))
assert d["installed"] is True
assert isinstance(d["version"], str) and d["version"].startswith("kimi")
assert d["authenticated"] is True
assert d["authDetail"] == "authenticated"
assert isinstance(d["model"], str) and len(d["model"]) > 0
assert isinstance(d["configured_models"], list) and len(d["configured_models"]) > 0
for k in ("shellInstaller", "uv", "pipx"):
    assert k in d["installers"] and isinstance(d["installers"][k], bool)
print("T1 PASS")
PY
```

Expected: `T1 PASS`.

- [ ] **Step 2: T8 — fresh-env setup (broken binary)**

```bash
KIMI_CLI_BIN=/nonexistent/kimi node plugins/kimi/scripts/kimi-companion.mjs setup --json | tee /tmp/t8.json
```

```bash
python3 - <<'PY'
import json
d = json.load(open("/tmp/t8.json"))
assert d["installed"] is False
assert d["version"] is None
assert d["authenticated"] is False
for k in ("shellInstaller", "uv", "pipx"):
    assert k in d["installers"] and isinstance(d["installers"][k], bool)
print("T8 PASS")
PY
```

Expected: `T8 PASS`.

- [ ] **Step 3: Human-format path smoke test**

Text path must be readable (gemini review G6 — user-visible exit criteria):

```bash
node plugins/kimi/scripts/kimi-companion.mjs setup
```

Expected: three lines starting with `installed: yes`, `authenticated: yes`, `default model: <name>`, optionally followed by `configured: <list>`. If it's just a wall of JSON, Task 1.10 formatSetupText is wired wrong.

- [ ] **Step 4: No commit needed** (this task runs validation; no files changed).

---

## Task 1.16: Claude Code integration (MANUAL — runs outside subagent)

**This task must be executed by the human operator (or the main Claude Code session), not a subagent.** A subagent can't spawn a nested Claude Code session; `claude plugins` subcommands require user interaction with the real CLI; slash-command dispatch inside Claude Code is not scriptable from argv.

**Files:** (no files changed)

- [ ] **Step 1: Validate the plugin manifest**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
claude plugins validate ./plugins/kimi
```

Expected: reports success. If manifest errors show up, fix `plugin.json` / `marketplace.json` and re-run.

- [ ] **Step 2: Install / enable the plugin**

Run `claude plugins install` following its prompts to add the plugin from this local path. (Exact incantation depends on Claude CLI version — see `claude plugins install --help`.) If the install flow requires a marketplace, register the local `.claude-plugin/marketplace.json` per `claude plugins marketplace --help`.

- [ ] **Step 3: Invoke `/kimi:setup` inside a Claude Code session**

Open a real Claude Code session in this repo. Type:

```
/kimi:setup
```

Verify:
- Command is found (not treated as a typo)
- Claude runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" setup --json`
- Output presented to user contains `installed: yes` and `default model: <name>` (per commands/setup.md rules)
- No install-flow prompt appears (since kimi is already installed + authenticated on this machine)

If any functional failure occurs, go back and fix the root cause in whichever file (command.md / companion.mjs / plugin.json). Cosmetic issues (phrasing, formatting) are logged in CHANGELOG as known issues but do not block.

- [ ] **Step 4: Record the manual verification result**

After a successful Step 3, proceed to Task 1.17.

---

## Task 1.17: Phase 1 CHANGELOG + tag

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Append CHANGELOG entry**

Append to `CHANGELOG.md` at the top (below the existing header):

```markdown
## 2026-04-20 [Claude Opus 4.7 — Phase 1 skeleton]

- **status**: done
- **scope**: plugins/kimi/* (new), .claude-plugin/marketplace.json (new)
- **summary**: Phase 1 skeleton complete. Plugin is installable and `/kimi:setup` works end-to-end.
  - 14 files created across plugins/kimi/{scripts,commands,skills,.claude-plugin}/ + repo root marketplace / .gitignore / README / CLAUDE.md.
  - Lib files (args, process, render, git, state) hand-rewritten from gemini-plugin-cc counterparts (P2 principle; no sed/cp). Export-signature parity asserted via deepEqual Object.keys in each smoke test.
  - kimi.mjs exports: TOML top-level key scanner, [models.*] section scanner (handles quoted slash-containing keys), getKimiAvailability, getKimiAuthStatus (with model preflight), readKimiDefaultModel, readKimiConfiguredModels, plus constants (PING_MAX_STEPS=1, SESSION_ID_STDERR_REGEX, LARGE_PROMPT_THRESHOLD_BYTES=100000, PARENT_SESSION_ENV).
  - kimi-companion.mjs dispatcher with setup subcommand; arg-unpack heuristic gated on {setup subcommand + all-flags blob} to avoid Phase 2 prompt collisions.
  - /kimi:setup command supports dynamic AskUserQuestion option filtering (0-installer fallback prints manual guidance). Official install URL: https://cdn.kimi.com/binaries/kimi-cli/install.sh.
  - 3 skill drafts: kimi-cli-runtime (literal values from probe-results.json v3), kimi-prompting skeleton, kimi-result-handling early draft (content aggregation rules + think drop + stats-unavailable guidance).
  - T1 PASS (setup --json returns all populated fields), T8 PASS (fresh-env shows installers detection), integration PASS (`claude plugins validate` clean; `/kimi:setup` verified manually in a real Claude Code session).
- **next**: author docs/superpowers/plans/YYYY-MM-DD-phase-2-ask-streaming.md. Phase 2 implements callKimi + callKimiStreaming with multi-line JSONL parsing and content-block text aggregation per kimi-cli-runtime contract.
```

- [ ] **Step 2: Commit and tag**

```bash
git add CHANGELOG.md
git commit -m "chore: Phase 1 skeleton complete; T1 T8 integration pass"
git tag -a phase-1-skeleton -m "Phase 1 skeleton complete; /kimi:setup works end-to-end"
git log --oneline | head -20
git tag
```

Expected: `phase-1-skeleton` in the tag list.

---

## Self-Review

**Spec coverage (Phase 1 slice of the full v0.1 spec):**
- §2.2 directory tree → Tasks 1.1, 1.2, and lib tasks ✅
- §3.1 CLI invocation constants → Task 1.8 kimi.mjs constants ✅
- §3.4 session_id (deferred constants `SESSION_ID_STDERR_REGEX` only; full parsing in Phase 2) ✅
- §3.5 exit-code → UX mapping (constants only; full routing in Phase 2) ✅
- §3.6 default model reader → Task 1.8 ✅
- §3.7 auth check with ping + max-steps-per-turn 1 + model preflight → Task 1.9 ✅
- §4.2 /kimi:setup with install path + PATH re-probe + model preflight + 0-installer fallback → Tasks 1.10, 1.11 ✅
- §5.1 state dir (kimi-companion fallback) → Task 1.7 ✅
- Phase 2+ items explicitly out of scope ✅

**Placeholder scan:** Every constant is a literal value from `probe-results.json` v3 or verbatim from a spec section. Task 1.12 Step 3 explicitly greps for placeholder patterns. No `<TBD>`, no `<X>` left in code. ✅

**Exported-constant coverage (gemini review G2):** Task 1.8 Step 3 asserts `PING_MAX_STEPS === 1`, `LARGE_PROMPT_THRESHOLD_BYTES === 100000`, `PARENT_SESSION_ENV === "KIMI_COMPANION_SESSION_ID"`, and `SESSION_ID_STDERR_REGEX` extracts UUID from a hardcoded stderr sample. Any regex drift will fail the assertion before Phase 2 runs. ✅

**Export-signature parity (gemini review G1):** Tasks 1.3-1.7 smoke tests each do `Object.keys(kimi).sort() === Object.keys(gemini).sort()` (render.mjs permits strict subset; it intentionally drops stats). ✅

**Type / signature consistency:**
- `getKimiAvailability`, `getKimiAuthStatus`, `readKimiDefaultModel`, `readKimiConfiguredModels`, `readTomlTopLevelKey`, `readTomlModelSectionNames` appear consistently across Tasks 1.8, 1.9, 1.10.
- `KIMI_BIN`, `PING_MAX_STEPS`, `SESSION_ID_STDERR_REGEX`, `LARGE_PROMPT_THRESHOLD_BYTES`, `PARENT_SESSION_ENV` constants exported from kimi.mjs for Phase 2 consumption.
- `hasAssistantTextBlock` is internal (not exported); Phase 2 will re-implement broader event-parsing logic.

**Cross-platform:** All shell commands in the plan use `$PWD` / `git rev-parse --show-toplevel` / python3 for hashing. No macOS-only `md5`, no hardcoded personal paths except the one legitimate root reference to `/Users/bing/-Code-/kimi-plugin-cc/`. **Scope: macOS + Linux only**; Windows is not targeted for v0.1.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-20-phase-1-skeleton.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — one fresh subagent per task (haiku for mechanical lib rewrites; sonnet for kimi.mjs and setup command). Review between each.

**2. Inline Execution** — execute tasks in this session with executing-plans. Slower but lets you see smoke-test output immediately.

**Which approach?**

---

## Follow-up plans (written after `phase-1-skeleton` tag)

- `2026-XX-XX-phase-2-ask-streaming.md` — `callKimi` + `callKimiStreaming` (multi-line JSONL parse, content-block aggregation) + `/kimi:ask` + result-handling skill polish
- `2026-XX-XX-phase-3-review-retry.md` — `/kimi:review` + schema + 1-shot JSON-parse retry
- `2026-XX-XX-phase-4-background-agent.md` — `/kimi:rescue` + kimi-agent + status/result/cancel + hooks
- `2026-XX-XX-phase-5-adversarial-polish.md` — `/kimi:adversarial-review` + skill finalize + lessons.md final
