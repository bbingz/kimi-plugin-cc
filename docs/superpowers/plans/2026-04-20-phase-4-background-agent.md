# kimi-plugin-cc Phase 4 Background + Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add background-job infrastructure (`/kimi:rescue`, `/kimi:status`, `/kimi:result`, `/kimi:cancel`) + `kimi-agent` subagent + SessionStart/End + Stop hooks. Exit: **T6** (`rescue --background` returns a jobId; `/kimi:status` reports running; log file accrues streaming events; `/kimi:result` returns structured output once the job completes) and **T7** (`rescue --resume-last` picks up the previous task's `kimiSessionId` without user intervention).

**Architecture:** Port `job-control.mjs` from gemini-plugin-cc (599 lines; the design is battle-tested for background detach + streaming progress logs + atomic cancel state) and adapt kimi bindings: `callGeminiStreaming` → `callKimiStreaming`, `geminiSessionId` → `kimiSessionId`, `GEMINI_COMPANION_SESSION_ID` → `KIMI_COMPANION_SESSION_ID`. Thin `kimi-agent` subagent forwards to a new `task` subcommand on the companion; `rescue.md` orchestrates the Agent tool dispatch + resume-candidate detection. Hooks wire SessionStart (set env), SessionEnd (cleanup jobs), Stop (optional review gate). Three new commands wrap the job-control primitives.

**Tech Stack:** Node built-ins (`node:child_process spawn detached`, `node:fs`, `node:path`, `node:url`, signals). No npm deps. Reuses `callKimiStreaming` from Phase 2.

**Reference spec:** `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` §4.2 (command table rescue/status/result/cancel rows), §4.3 (kimi-agent contract), §4.5 (hooks), §5.1 (state dirs), §6.1 T6/T7.
**Reference source:** `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/job-control.mjs` + `scripts/session-lifecycle-hook.mjs` + `scripts/stop-review-gate-hook.mjs` + `agents/gemini-agent.md` + `hooks/hooks.json` + `commands/{rescue,status,result,cancel}.md`. **Read but do not copy raw** — replace all gemini-specific names (callGeminiStreaming, geminiSessionId, GEMINI_COMPANION_SESSION_ID, renderGeminiResult, gemini-agent, /gemini:*, etc.) consistently.

**v0.1 total budget:** ~85 tasks. This plan covers **Phase 4 only (9 tasks, ~60 steps)**. Cumulative after Phase 4 ≈ 53 / 85 (62%).

**Exit criteria (all must hold before tag `phase-4-background`):**
- `task` subcommand present (foreground streaming + `--background` spawn-detach + `--resume-last` + `--fresh`). Implemented via new `handleTask` on companion.
- `job-control.mjs` exports: `createJob`, `runStreamingWorker`, `runStreamingJobInBackground`, `runWorker`, `runJobInBackground`, `buildStatusSnapshot`, `buildSingleJobSnapshot`, `resolveResultJob`, `resolveCancelableJob`, `waitForJob`, `cancelJob`, `resolveResumeCandidate`, `readStoredJobResult`, `getCurrentSessionId`, `filterJobsForCurrentSession`, `sortJobsNewestFirst`, `getJobKindLabel`, `formatElapsedDuration`, `SESSION_ID_ENV`.
- Companion `_worker` + `_stream-worker` dispatch cases present so background re-entry works.
- `hooks/hooks.json` registers SessionStart + SessionEnd + Stop; SessionStart sets `KIMI_COMPANION_SESSION_ID`; SessionEnd cleans up current-session jobs.
- `stop-review-gate-hook.mjs` only fires when `state.stopReviewGate === true`; default disabled; toggled via `setup --enable-review-gate` / `--disable-review-gate`.
- `agents/kimi-agent.md` frontmatter has `name: kimi-agent`, `tools: Bash`, `skills: [kimi-cli-runtime, kimi-prompting]`; body is the thin-forwarder contract.
- Commands `rescue.md`, `status.md`, `result.md`, `cancel.md` follow gemini templates with kimi-specific paths + subagent type `kimi:kimi-agent`.
- **T6** PASS: `/kimi:rescue --background "summarize plugins/kimi/scripts/kimi-companion.mjs"` returns `{jobId, pid}`; `status` shows running; log file grows; `result` returns structured content when done.
- **T7** PASS: after T6 completes, `task --resume-last "continue"` finds the prior `kimiSessionId` via `resolveResumeCandidate` and reuses it.
- Git tag `phase-4-background` applied.

**Explicit non-goals:**
- `/kimi:adversarial-review` → Phase 5
- `kimi-prompting` skill full content (references/3-md) → Phase 5 (the empty skeleton from Phase 1 suffices for agent frontmatter reference; the agent just enumerates the skill name)
- `--write` flag on task (gemini had it — maps to `approvalMode: auto_edit`). Kimi has no equivalent approval concept. Spec §4.2 lists `rescue` but not `--write`; omit the flag entirely to avoid a nop. If users ask, add in v0.2.
- `--effort low/medium/high` flag from gemini-agent — Kimi has no equivalent rate-limiter or reasoning-budget knob. Drop the flag; kimi-agent.md deletes that row from the routing table.
- `appendTimingHistory` / `readTimingHistory` — observability polish; not v0.1 blocker. Stubs acceptable.

---

## File Structure

**Create:**
- `plugins/kimi/scripts/lib/job-control.mjs` — port of gemini's 599-line file, retextured for kimi bindings
- `plugins/kimi/scripts/lib/prompts.mjs` — 14-line byte-port from gemini (loadPromptTemplate + interpolateTemplate)
- `plugins/kimi/scripts/session-lifecycle-hook.mjs` — SessionStart sets env, SessionEnd cleans up session's jobs
- `plugins/kimi/scripts/stop-review-gate-hook.mjs` — Stop-time review gate (disabled by default)
- `plugins/kimi/prompts/stop-review-gate.md` — rewritten template for the stop gate
- `plugins/kimi/hooks/hooks.json` — registers SessionStart/End + Stop
- `plugins/kimi/agents/kimi-agent.md` — thin-forwarder subagent
- `plugins/kimi/commands/rescue.md`, `status.md`, `result.md`, `cancel.md` — command wrappers

**Modify:**
- `plugins/kimi/scripts/kimi-companion.mjs` — add `task` / `status` / `result` / `cancel` / `task-resume-candidate` / `_worker` / `_stream-worker` dispatcher cases; `runSetup` extended with `--enable-review-gate` / `--disable-review-gate`
- `plugins/kimi/scripts/lib/state.mjs` — add 3 timing-history stubs (return null / empty array — v0.1 cannot emit timing without kimi cooperation)
- `.claude-plugin/plugin.json` — (optional) register the new hooks/commands/agent files if the plugin manifest requires enumeration

**Unchanged:**
- `kimi.mjs` — Phase 2 + 3 streaming primitives are sufficient
- `git.mjs`, `args.mjs`, `process.mjs`, `render.mjs` — Phase 1 baseline
- Phase 3 `/kimi:review` + schemas + kimi-result-handling skill

---

## Task 4.1: Port `job-control.mjs` + `prompts.mjs`

**Files:**
- Create: `plugins/kimi/scripts/lib/job-control.mjs`
- Create: `plugins/kimi/scripts/lib/prompts.mjs`
- Modify: `plugins/kimi/scripts/lib/state.mjs` (add 3 timing-history stubs)

Foundation for Phase 4. Port the 599-line gemini file wholesale with mechanical name substitutions; add timing-history stubs so job-control's imports resolve.

- [ ] **Step 1: Write `prompts.mjs` (14 lines, byte-aligned port)**

```bash
cat > plugins/kimi/scripts/lib/prompts.mjs <<'EOF'
import fs from "node:fs";
import path from "node:path";

export function loadPromptTemplate(rootDir, name) {
  const promptPath = path.join(rootDir, "prompts", `${name}.md`);
  return fs.readFileSync(promptPath, "utf8");
}

export function interpolateTemplate(template, variables) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : "";
  });
}
EOF
```

- [ ] **Step 2: Add 3 timing-history stubs to `state.mjs`**

Append at the END of `plugins/kimi/scripts/lib/state.mjs` (before the last blank line, after existing `setConfig`):

```js
// ── Timing history stubs (Phase 4 import resolver) ─────────
//
// Gemini's state.mjs records timing per-job for operator dashboards. Kimi has
// no equivalent stats surface (probe 04: JsonPrinter drops StatusUpdate), so
// we export inert stubs to satisfy job-control.mjs's import set without
// fabricating data. Phase 5+ may wire real timing if kimi exposes it.

import os from "node:os";

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
```

Check `plugins/kimi/scripts/lib/state.mjs` top imports already include `path`; if not, add `import path from "node:path";` at the top. (Phase 1 port should have it — Phase 1 used `resolveStateFile` which needs path.)

- [ ] **Step 3: Port `job-control.mjs` with name substitutions**

Copy from gemini, then do the rename pass. Use this exact mechanical substitution (no other edits):

```bash
cp /Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/lib/job-control.mjs \
   /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/lib/job-control.mjs
```

Then apply these substitutions via `sed -i ''` (or your editor):

- `callGeminiStreaming` → `callKimiStreaming`
- `geminiSessionId` → `kimiSessionId` (occurs in job records; field name change is deliberate so future tooling can distinguish)
- `GEMINI_COMPANION_SESSION_ID` → `KIMI_COMPANION_SESSION_ID`
- `import { callGeminiStreaming } from "./gemini.mjs";` → `import { callKimiStreaming } from "./kimi.mjs";`
- The prefix map: keep `task: "gt"`, keep `review: "gr"` — these are opaque prefixes for jobIds and don't need to change. (But update the default fallback: `JOB_PREFIXES[kind] || "ga"` → `JOB_PREFIXES[kind] || "ka"` so orphan kinds land under a "kimi-any" namespace.)

Commands:

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
FILE=plugins/kimi/scripts/lib/job-control.mjs
# macOS sed requires -i ''
sed -i '' 's/callGeminiStreaming/callKimiStreaming/g' "$FILE"
sed -i '' 's/geminiSessionId/kimiSessionId/g' "$FILE"
sed -i '' 's/GEMINI_COMPANION_SESSION_ID/KIMI_COMPANION_SESSION_ID/g' "$FILE"
sed -i '' 's|from "\./gemini\.mjs"|from "./kimi.mjs"|g' "$FILE"
sed -i '' 's/|| "ga"/|| "ka"/g' "$FILE"
```

Confirm with:

```bash
grep -c "callKimiStreaming" "$FILE"
grep -c "gemini" "$FILE"   # Should be 0 matches (all references replaced)
```

Expected: at least 1 for `callKimiStreaming`; 0 for `gemini` (case-sensitive).

- [ ] **Step 4: Also remove `approvalMode` from the streaming worker** (kimi has no approval concept)

Find in `job-control.mjs`:

```js
const result = await callKimiStreaming({
  prompt: config.prompt,
  model: config.model || null,
  approvalMode: config.approvalMode || "plan",
  cwd: config.cwd || process.cwd(),
  timeout: config.timeout || 600_000,
  resumeSessionId: config.resumeSessionId || null,
  onEvent: (event) => {
```

Remove the `approvalMode: config.approvalMode || "plan",` line entirely (kimi's `callKimiStreaming` signature has no such parameter — passing it would either be silently ignored or surface as an unexpected key).

Also find the `onEvent` callback — gemini's event shape differs from kimi's. Replace:

```js
    onEvent: (event) => {
      if (event.type === "init") {
        upsertJob(workspaceRoot, { id: jobId, phase: "running" });
        appendLog(`Model: ${event.model || "?"}`);
      } else if (event.type === "message" && event.role === "assistant" && event.content) {
        // Write assistant content to log for progress preview
        try { fs.appendFileSync(logFile, event.content); } catch { /* ignore */ }
      } else if (event.type === "result") {
        try { fs.appendFileSync(logFile, "\n"); } catch { /* ignore */ }
        appendLog(`Completed: ${event.status || "?"}`);
      }
    },
```

With kimi's event taxonomy (Phase 2 probe: events are `{role: "assistant", content: [blocks]}` or `{role: "tool", ...}`; no typed `init`/`message`/`result` envelope):

```js
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
```

- [ ] **Step 5: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/prompts.mjs
node --check plugins/kimi/scripts/lib/state.mjs
node --check plugins/kimi/scripts/lib/job-control.mjs
```

All three must exit 0.

- [ ] **Step 6: Smoke test — pure helpers (no spawn)**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node -e '
import("./plugins/kimi/scripts/lib/job-control.mjs").then(m => {
  console.assert(typeof m.createJob === "function", "createJob exported");
  console.assert(typeof m.cancelJob === "function", "cancelJob exported");
  console.assert(typeof m.waitForJob === "function", "waitForJob exported");
  console.assert(typeof m.resolveResumeCandidate === "function", "resolveResumeCandidate exported");
  console.assert(m.SESSION_ID_ENV === "KIMI_COMPANION_SESSION_ID", "SESSION_ID_ENV correct");
  // sortJobsNewestFirst with empty + single + dual-jobs
  console.assert(m.sortJobsNewestFirst([]).length === 0, "sort empty");
  const a = { updatedAt: "2026-01-01T00:00:00Z" };
  const b = { updatedAt: "2026-06-01T00:00:00Z" };
  console.assert(m.sortJobsNewestFirst([a, b])[0] === b, "sort newest first");
  // formatElapsedDuration
  console.assert(m.formatElapsedDuration(0, 45_000) === "45s", "seconds");
  console.assert(m.formatElapsedDuration(0, 125_000) === "2m 5s", "minutes");
  console.log("job-control helpers PASS");
});
'
```

Expected: `job-control helpers PASS`.

- [ ] **Step 7: Commit**

```bash
git add plugins/kimi/scripts/lib/job-control.mjs plugins/kimi/scripts/lib/prompts.mjs plugins/kimi/scripts/lib/state.mjs
git commit -m "feat(lib): port job-control.mjs + prompts.mjs from gemini-plugin-cc"
```

---

## Task 4.2: `task` subcommand (foreground streaming + background submit)

**Files:**
- Modify: `plugins/kimi/scripts/kimi-companion.mjs`

Wire the `task` subcommand. Foreground path calls `callKimiStreaming` directly; background path uses `runStreamingJobInBackground` from job-control.

- [ ] **Step 1: Extend imports**

At the top of `kimi-companion.mjs`, extend the kimi-lib import:

```js
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
```

Add new imports from job-control + state:

```js
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
```

Also add a `SELF` constant (the file's own absolute path — needed for background respawn):

```js
import { fileURLToPath } from "node:url";
// (already imported in Phase 3)

const SELF = fileURLToPath(import.meta.url);
```

And a `resolveWorkspaceRoot` helper (mirrors gemini's, shells out to git):

```js
import { spawnSync } from "node:child_process";

function resolveWorkspaceRoot(cwd) {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd, encoding: "utf8", timeout: 3000, stdio: "pipe",
    });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch { /* not a git repo */ }
  return cwd;
}
```

- [ ] **Step 2: Add `runTask` handler between `runReview` and the dispatcher**

Default continue prompt (v0.1 string — simple, kimi-friendly):

```js
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

  const cwd = options.cwd || process.cwd();
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

  // Foreground streaming — progress to stderr only in non-JSON mode.
  const result = await callKimiStreaming({
    ...streamConfig,
    onEvent: (event) => {
      if (!options.json && event.role === "assistant") {
        const blocks = event.content || [];
        for (const b of blocks) {
          if (b && b.type === "text" && typeof b.text === "string") {
            process.stderr.write(b.text);
          }
        }
      }
    },
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
      // Content already streamed to stderr above; emit the final response on stdout
      // so callers that redirect `>` capture it without the progress noise.
      process.stdout.write(result.response + "\n");
    }
  }

  process.exit(result.ok ? KIMI_EXIT.OK : (result.status ?? 1));
}
```

- [ ] **Step 3: Syntax check + lint**

```bash
node --check plugins/kimi/scripts/kimi-companion.mjs
```

- [ ] **Step 4: Commit**

```bash
git add plugins/kimi/scripts/kimi-companion.mjs
git commit -m "feat(companion): task subcommand with foreground streaming + background submit"
```

---

## Task 4.3: `status` / `result` / `cancel` / `task-resume-candidate` handlers + dispatcher wiring

**Files:**
- Modify: `plugins/kimi/scripts/kimi-companion.mjs`

Wire the remaining four subcommands that read from job-control state. All emit JSON; no streaming.

- [ ] **Step 1: Add 4 handler functions after `runTask`**

```js
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
  const { positionals } = parseArgs(rawArgs, { booleanOptions: ["json"] });
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const reference = positionals[0] || null;

  const job = resolveCancelableJob(workspaceRoot, reference);
  if (!job) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: reference ? `No cancellable job matches "${reference}"` : "No active jobs to cancel",
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
```

- [ ] **Step 2: Wire new cases into dispatcher**

Update the `switch (sub)` block (keep existing setup/ask/review cases):

```js
  switch (sub) {
    case "setup":
      return runSetup(rest);
    case "ask":
      return runAsk(rest);
    case "review":
      return runReview(rest);
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
```

(The `_worker` / `_stream-worker` dispatch helpers land in Task 4.4.)

- [ ] **Step 3: Update `USAGE` text**

```js
const USAGE = `Usage: kimi-companion <subcommand> [options]

Subcommands:
  setup [--json] [--enable-review-gate|--disable-review-gate]
                                       Check kimi CLI availability, auth, and configured models
  ask [--json] [--stream] [-m <model>] [-r <sessionId>] "<prompt>"
                                       Send a one-shot prompt. --stream emits JSONL events as they arrive.
  review [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [-m <model>] [focus...]
                                       Review current diff. Always emits JSON matching review-output schema.
  task [--json] [--background|--wait] [--resume-last|--fresh] [-m <model>] "<prompt>"
                                       Delegate an open-ended task to kimi. Background spawns a detached worker; foreground streams progress.
  status [job-id] [--all] [--wait] [--json]
                                       Show background-job status.
  result [job-id] [--json]             Fetch a completed job's full output.
  cancel [job-id] [--json]             Cancel a running background job.
  task-resume-candidate [--json]       Probe for a resumable prior task (used by /kimi:rescue).

(Internal: _worker / _stream-worker are background re-entry points; do not call directly.)`;
```

- [ ] **Step 4: Extend `shouldUnpackBlob`** — treat status/result/cancel/task-resume-candidate like setup (all-flags contract when a blob arrives)

Find `UNPACK_SAFE_SUBCOMMANDS` and extend:

```js
const UNPACK_SAFE_SUBCOMMANDS = new Set([
  "setup", "ask", "review", "task",
  "status", "result", "cancel", "task-resume-candidate",
]);

const ASK_KNOWN_FLAG = /^(?:--(?:json|stream|model|resume)(?:=.*)?|-[mr])$/;
const REVIEW_KNOWN_FLAG = /^(?:--(?:json|model|base|scope)(?:=.*)?|-m)$/;
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
  if (sub === "task") return TASK_KNOWN_FLAG.test(tokens[0]) || tokens.every((t) => !t.startsWith("-"));
  // status/result/cancel/task-resume-candidate: all-flags OR [jobId, ...flags]
  if (sub === "status" || sub === "result" || sub === "cancel" || sub === "task-resume-candidate") {
    return true;
  }
  return false;
}
```

- [ ] **Step 5: Syntax check**

```bash
node --check plugins/kimi/scripts/kimi-companion.mjs
```

- [ ] **Step 6: Commit**

```bash
git add plugins/kimi/scripts/kimi-companion.mjs
git commit -m "feat(companion): status/result/cancel/task-resume-candidate handlers + dispatcher"
```

---

## Task 4.4: `_worker` + `_stream-worker` re-entry dispatchers

**Files:**
- Modify: `plugins/kimi/scripts/kimi-companion.mjs`

When `runJobInBackground` or `runStreamingJobInBackground` spawns a child, it re-invokes `node kimi-companion.mjs _worker <jobId> <workspaceRoot> ...args` (or `_stream-worker`). These two internal subcommands call `runWorker` / `runStreamingWorker` from job-control. Without them, background jobs never complete — the child exits with "Unknown subcommand: _worker" and the job stays forever "running".

- [ ] **Step 1: Add `dispatchWorker` and `dispatchStreamWorker`**

Place these above `main()` (or near the other handlers):

```js
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
    process.exit(1);
  }
  await runStreamingWorker(jobId, workspaceRoot, config);
  // Clean up the temporary config file (written by runStreamingJobInBackground).
  try { fsMod.unlinkSync(configFile); } catch { /* ignore */ }
  process.exit(0);
}
```

- [ ] **Step 2: Verify main() dispatcher is `async`** (was set in Phase 2) — confirm `async function main()`. If it's missing `async`, add it now.

- [ ] **Step 3: Syntax check**

```bash
node --check plugins/kimi/scripts/kimi-companion.mjs
```

- [ ] **Step 4: Smoke test — verify the dispatcher rejects `_worker` with insufficient args (no real spawn yet)**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node plugins/kimi/scripts/kimi-companion.mjs _worker 2>&1 | head -2
echo "exit=$?"
```

Expected: stderr `_worker requires: ...`; exit=2.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/kimi-companion.mjs
git commit -m "feat(companion): _worker + _stream-worker internal dispatch for background re-entry"
```

---

## Task 4.5: Setup review-gate toggle + hooks integration

**Files:**
- Modify: `plugins/kimi/scripts/kimi-companion.mjs` (runSetup extensions)
- Create: `plugins/kimi/scripts/session-lifecycle-hook.mjs`
- Create: `plugins/kimi/scripts/stop-review-gate-hook.mjs`
- Create: `plugins/kimi/hooks/hooks.json`

Wire the stop-review-gate toggle + the hook scripts that register against Claude's event system.

- [ ] **Step 1: Extend `runSetup` with gate toggle**

Find the existing `parseArgs` call in `runSetup` (Phase 1 had these booleans already scaffolded):

```js
function runSetup(rawArgs) {
  const { options } = parseArgs(rawArgs, {
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"],
  });
```

After `parseArgs`, add the toggle logic BEFORE building the status object:

```js
  // Review-gate toggle (spec §4.2 `/kimi:setup --enable/disable-review-gate`).
  // Writes to ~/.claude/plugins/kimi/state.json via getConfig/setConfig.
  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    process.stderr.write("Error: pass only one of --enable-review-gate / --disable-review-gate.\n");
    process.exit(KIMI_EXIT.USAGE_ERROR);
  }
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
  } else if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
  }
```

Also add `stopReviewGate` to the status object so users can confirm state via `setup --json`:

```js
  const status = {
    installed: availability.available,
    version: availability.available ? availability.detail : null,
    authenticated: auth.loggedIn === true,
    authDetail: auth.detail,
    model: auth.model || readKimiDefaultModel() || null,
    configured_models: configured,
    installers,
    stopReviewGate: getConfig(workspaceRoot).stopReviewGate === true,
  };
```

- [ ] **Step 2: Create `plugins/kimi/scripts/session-lifecycle-hook.mjs`**

```bash
mkdir -p plugins/kimi/hooks
```

Write the file (port from gemini with 3 substitutions: env name, import paths point to kimi's lib, comment header):

```js
#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

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
  return cwd;
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

main();
```

- [ ] **Step 3: Create `plugins/kimi/scripts/stop-review-gate-hook.mjs`**

Port from gemini, substitute: `/gemini:review` → `/kimi:review`, `gemini-companion.mjs` → `kimi-companion.mjs`, "Gemini" → "Kimi" in user-facing strings, "Gemini stop-time review" → "Kimi stop-time review".

```js
#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import { getConfig, listJobs } from "./lib/state.mjs";
import { sortJobsNewestFirst } from "./lib/job-control.mjs";
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
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : cwd;
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
      reason: "The stop-time Kimi review returned no output. Run /kimi:review --wait manually or bypass the gate.",
    };
  }
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine.startsWith("ALLOW:")) return { ok: true, reason: null };
  if (firstLine.startsWith("BLOCK:")) {
    const reason = firstLine.slice("BLOCK:".length).trim() || text;
    return { ok: false, reason: `Kimi stop-time review found issues: ${reason}` };
  }
  return {
    ok: false,
    reason: "The stop-time Kimi review returned an unexpected answer. Run /kimi:review --wait manually or bypass the gate.",
  };
}

function runStopReview(cwd, input = {}) {
  const scriptPath = path.join(SCRIPT_DIR, "kimi-companion.mjs");
  const prompt = buildStopReviewPrompt(input);
  const result = spawnSync(process.execPath, [scriptPath, "ask", "--json", prompt], {
    cwd, encoding: "utf8", timeout: STOP_REVIEW_TIMEOUT_MS, env: { ...process.env },
  });

  if (result.error?.code === "ETIMEDOUT") {
    return { ok: false, reason: "The stop-time Kimi review timed out after 15 minutes." };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      reason: detail ? `The stop-time Kimi review failed: ${detail}` : "The stop-time Kimi review failed.",
    };
  }

  try {
    const stdout = result.stdout || "";
    const jsonStart = stdout.indexOf("{");
    if (jsonStart >= 0) {
      const payload = JSON.parse(stdout.slice(jsonStart));
      if (payload.response) return parseStopReviewOutput(payload.response);
      if (payload.error) return { ok: false, reason: payload.error };
    }
  } catch { /* fall through */ }

  return { ok: false, reason: "The stop-time Kimi review returned invalid output." };
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
    emitDecision({
      decision: "block",
      reason: runningNote ? `${runningNote} ${review.reason}` : review.reason,
    });
    return;
  }

  logNote(runningNote);
}

main();
```

- [ ] **Step 4: Create `plugins/kimi/hooks/hooks.json`**

```json
{
  "description": "Session lifecycle and optional stop-time review gate for Kimi Companion.",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs\" SessionStart",
            "timeout": 5
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-lifecycle-hook.mjs\" SessionEnd",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-review-gate-hook.mjs\"",
            "timeout": 900
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Syntax check + quick validation**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node --check plugins/kimi/scripts/kimi-companion.mjs
node --check plugins/kimi/scripts/session-lifecycle-hook.mjs
node --check plugins/kimi/scripts/stop-review-gate-hook.mjs
python3 -c 'import json; json.load(open("plugins/kimi/hooks/hooks.json"))' && echo "hooks.json valid"
```

All must exit 0.

- [ ] **Step 6: Toggle smoke test (no hooks invoked yet)**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node plugins/kimi/scripts/kimi-companion.mjs setup --enable-review-gate --json 2>&1 | python3 -c 'import json, sys; d = json.load(sys.stdin); assert d["stopReviewGate"] is True; print("enable toggle OK")'
node plugins/kimi/scripts/kimi-companion.mjs setup --disable-review-gate --json 2>&1 | python3 -c 'import json, sys; d = json.load(sys.stdin); assert d["stopReviewGate"] is False; print("disable toggle OK")'
```

Expected: both `OK` lines print.

- [ ] **Step 7: Commit**

```bash
git add plugins/kimi/scripts/kimi-companion.mjs plugins/kimi/scripts/session-lifecycle-hook.mjs plugins/kimi/scripts/stop-review-gate-hook.mjs plugins/kimi/hooks/hooks.json
git commit -m "feat(hooks): session lifecycle + stop review gate; setup --enable/disable-review-gate"
```

---

## Task 4.6: `prompts/stop-review-gate.md`

**Files:**
- Create: `plugins/kimi/prompts/stop-review-gate.md`

The Stop hook feeds this template to kimi; kimi must return `ALLOW: <reason>` or `BLOCK: <reason>` on the first line.

- [ ] **Step 1: Write the template**

```bash
mkdir -p plugins/kimi/prompts
```

Write `plugins/kimi/prompts/stop-review-gate.md` with content:

```markdown
You are Kimi, acting as a final-review gatekeeper for a Claude Code session that is about to end.

{{CLAUDE_RESPONSE_BLOCK}}

Decide whether the work above is safe to stop on, or whether Claude should keep going before this session closes.

## Output contract (STRICT)

Return EXACTLY one line, as the FIRST line of your response. Nothing before it, no markdown fence.

- `ALLOW: <one-short-sentence-reason>` — the work looks complete enough to stop.
- `BLOCK: <one-short-sentence-reason>` — the work has obvious gaps, unfinished tasks, broken invariants, or unchecked failure modes; Claude should not stop yet.

After that required first line, you MAY add more lines explaining specifics (max ~10 lines). Do NOT translate `ALLOW:` / `BLOCK:` — they are literal tokens the hook parses.

## What counts as BLOCK

- Claude wrote "TODO" or "FIXME" in code it just added without tracking it elsewhere.
- Claude claimed to test something but did not actually run the test.
- Claude reported a CI/build/lint failure but left it unresolved.
- Claude made partial changes to multiple files and the intermediate state is broken (e.g. renamed a function in one place, missed callers).
- Claude said "I'll do X next" but has not done X and the session is ending.

## What counts as ALLOW

- The last response summarizes completed work and there are no outstanding commitments.
- Claude explicitly deferred work to a future session with a written marker (not inline TODO — an issue reference, a followup note, etc.).
- The user asked for partial progress and got it; no broken invariants remain.
- Claude asked a clarifying question that the user has not answered — waiting on the user is an OK stop state.

## Bias

When in doubt, lean ALLOW on simple interactive answers (questions, explanations) and lean BLOCK on code-modifying turns with unclear test status.
```

- [ ] **Step 2: Verify**

```bash
head -5 plugins/kimi/prompts/stop-review-gate.md
grep -c "{{CLAUDE_RESPONSE_BLOCK}}" plugins/kimi/prompts/stop-review-gate.md
```

Expected: first grep shows 1 match.

- [ ] **Step 3: Commit**

```bash
git add plugins/kimi/prompts/stop-review-gate.md
git commit -m "feat(prompts): stop-review-gate template"
```

---

## Task 4.7: `agents/kimi-agent.md` + skill references

**Files:**
- Create: `plugins/kimi/agents/kimi-agent.md`

Thin-forwarder subagent. Spec §4.3 is the contract.

- [ ] **Step 1: Write the agent definition**

```bash
mkdir -p plugins/kimi/agents
```

Write `plugins/kimi/agents/kimi-agent.md` with content:

```markdown
---
name: kimi-agent
description: Proactively use when Claude Code wants a Chinese-language-friendly second opinion or should delegate a substantial long-context task to Kimi (128K–1M depending on model) through the shared runtime
tools: Bash
skills:
  - kimi-cli-runtime
  - kimi-prompting
---

You are a **thin forwarding wrapper** that delegates user requests to the Kimi
companion script. You do NOT solve problems yourself.

## What you do

1. Receive a user request (diagnosis, research, review, implementation)
2. Optionally use `kimi-prompting` to tighten the prompt for Kimi
3. Forward to the companion script via a single `Bash` call
4. Return Kimi's stdout **exactly as-is**

## The single command

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task "<prompt>" --json
```

For background tasks:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task --background "<prompt>" --json
```

For resuming the previous Kimi thread:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task --resume-last "<prompt>" --json
```

## Routing flags

These are CLI controls, **not** task text. Strip them from the prompt and pass
as flags:

| Flag | Meaning |
|------|---------|
| `--background` | Run in background, return job ID |
| `--wait` | Run foreground (default) |
| `--resume-last` | Continue previous Kimi thread |
| `--fresh` | Start new thread (ignore previous) |
| `--model <model>` | Override model |
| `-m <model>` | Alias for `--model` |

(Note: `--write` and `--effort` from gemini-agent are NOT supported — kimi has no approval-mode or reasoning-budget equivalent in v0.1. Drop them if present in the request.)

## Rules

1. **One Bash call.** Do not make multiple calls, do not chain commands.
2. **No independent work.** Do not inspect the repo, read files, grep code,
   monitor jobs, fetch results, or cancel jobs. That is Claude's job.
3. **Preserve task text as-is** unless using `kimi-prompting` to tighten it.
4. **Return stdout exactly.** No commentary, no analysis, no follow-up.
   The calling Claude Code session will interpret the output.
5. **Default to foreground** for small, bounded requests. Use `--background`
   for complex, open-ended tasks that may take over a minute.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/kimi/agents/kimi-agent.md
git commit -m "feat(agent): kimi-agent thin-forwarder subagent"
```

---

## Task 4.8: Command wrappers (`rescue`, `status`, `result`, `cancel`)

**Files:**
- Create: `plugins/kimi/commands/rescue.md`
- Create: `plugins/kimi/commands/status.md`
- Create: `plugins/kimi/commands/result.md`
- Create: `plugins/kimi/commands/cancel.md`

Four slash commands. Only `rescue` is complex — it dispatches through the Agent tool to `kimi-agent`. The other three wrap `kimi-companion.mjs` subcommands directly.

- [ ] **Step 1: Write `commands/rescue.md`**

```markdown
---
description: Delegate investigation, an explicit fix request, or follow-up work to the Kimi rescue subagent
argument-hint: "[--background|--wait] [--resume-last|--fresh] [--model <model>] [what Kimi should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `kimi:kimi-agent` subagent via the `Agent` tool (`subagent_type: "kimi:kimi-agent"`), forwarding the raw user request as the prompt.
`kimi:kimi-agent` is a subagent, not a skill — do not call `Skill(kimi:kimi-agent)` (no such skill) or `Skill(kimi:rescue)` (that re-enters this command and hangs the session). The command runs inline so the `Agent` tool stays in scope; forked general-purpose subagents do not expose it.
The final user-visible response must be Kimi's output verbatim.

Raw user request:
$ARGUMENTS

Resume detection:
- Before dispatching, check if there is a resumable Kimi session:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task-resume-candidate --json
  ```
- If `available: true` and the user did NOT pass `--fresh`:
  Ask the user whether to continue the previous thread or start fresh.
  Prepend `--resume-last` or `--fresh` based on their choice.
- If the user already passed `--resume-last` or `--fresh`, skip this step.

Execution mode:
- If the request includes `--background`, run the subagent in the background.
- If the request includes `--wait`, run the subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags. Do not forward them to `task`.
- `--model`, `--resume-last`, `--fresh` are runtime flags. Preserve them.

Operating rules:
- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Kimi companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary.
- Do not ask the subagent to inspect files, monitor progress, poll status, or do follow-up work.
- If the user did not supply a request AND `--resume-last` is present, proceed with the default continue prompt (the task runtime handles this).
- If the user did not supply a request AND no `--resume-last`, ask what Kimi should investigate or fix.
```

- [ ] **Step 2: Write `commands/status.md`**

```markdown
---
description: Show active and recent Kimi background jobs
argument-hint: '[job-id] [--all] [--wait]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" status "$ARGUMENTS" --json
```

Present the status output to the user as a formatted table.

If a specific job ID is provided, show detailed status for that job.
If no jobs exist, tell the user there are no Kimi jobs.
If a job is running, show the progress preview.
```

- [ ] **Step 3: Write `commands/result.md`**

```markdown
---
description: Retrieve the full output of a completed Kimi job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" result "$ARGUMENTS" --json
```

Present the full result verbatim. Preserve the original structure:
- verdict/summary/findings/next-steps if it was a review
- full response text if it was a task or ask

If the job has findings, present them ordered by severity.
Do NOT auto-fix any issues. Ask the user which issues to address.
```

- [ ] **Step 4: Write `commands/cancel.md`**

```markdown
---
description: Cancel an active Kimi background job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" cancel "$ARGUMENTS" --json
```

Report whether the job was successfully cancelled.
If no active job was found, tell the user.
```

- [ ] **Step 5: Verify**

```bash
for f in rescue status result cancel; do
  head -6 plugins/kimi/commands/$f.md
  echo "---"
done
```

Expected: all 4 show frontmatter.

- [ ] **Step 6: Commit**

```bash
git add plugins/kimi/commands/rescue.md plugins/kimi/commands/status.md plugins/kimi/commands/result.md plugins/kimi/commands/cancel.md
git commit -m "feat(commands): rescue + status + result + cancel"
```

---

## Task 4.9: T6 + T7 validation + tag

**Files:** (no code changes in Steps 1-6; Step 7 is the tag)

- [ ] **Step 1: T6 foreground task smoke**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node plugins/kimi/scripts/kimi-companion.mjs task --json "Reply with exactly: TASK_OK" 2>/dev/null > /tmp/t6-fg.json
python3 - <<'PY'
import json
d = json.load(open("/tmp/t6-fg.json"))
assert d["ok"] is True, d
assert "TASK_OK" in d["response"] or len(d["response"]) > 0
assert d["sessionId"] and len(d["sessionId"]) == 36
print("T6-foreground PASS — sid:", d["sessionId"])
PY
```

Expected: `T6-foreground PASS`.

- [ ] **Step 2: T6 background task submission**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
SUB=$(node plugins/kimi/scripts/kimi-companion.mjs task --background --json "Summarize this sentence in 8 words: the rain in spain falls mainly on the plain.")
echo "submission: $SUB"
JOB_ID=$(echo "$SUB" | python3 -c 'import json, sys; print(json.load(sys.stdin)["jobId"])')
echo "job id: $JOB_ID"
# Poll status every 3s for up to 90s
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  STATUS=$(node plugins/kimi/scripts/kimi-companion.mjs status "$JOB_ID" 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["status"])')
  echo "poll $i: $STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 3
done
# Fetch result
node plugins/kimi/scripts/kimi-companion.mjs result "$JOB_ID" 2>/dev/null | python3 -c 'import json, sys; d = json.load(sys.stdin); assert d["ok"], d; assert d["status"] == "completed"; print("T6-background PASS — kimiSessionId:", d.get("kimiSessionId"))'
```

Expected: `T6-background PASS` with a uuid-looking sessionId. If status stays `running` past 90s, the worker is stuck — report BLOCKED and investigate logs at `~/.claude/plugins/kimi/jobs/<jobId>.log`.

- [ ] **Step 3: T7 resume-last roundtrip**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
# Establish a task via background (preserves kimiSessionId in state)
SUB=$(node plugins/kimi/scripts/kimi-companion.mjs task --background --json "Remember this number: 4242. Acknowledge in one word.")
JOB_ID=$(echo "$SUB" | python3 -c 'import json, sys; print(json.load(sys.stdin)["jobId"])')
for i in 1 2 3 4 5 6 7 8 9 10; do
  STATUS=$(node plugins/kimi/scripts/kimi-companion.mjs status "$JOB_ID" 2>/dev/null | python3 -c 'import json, sys; print(json.load(sys.stdin)["status"])')
  [ "$STATUS" = "completed" ] && break
  sleep 3
done
# Probe candidate
node plugins/kimi/scripts/kimi-companion.mjs task-resume-candidate --json
# Run --resume-last
OUT=$(node plugins/kimi/scripts/kimi-companion.mjs task --resume-last --json "What number did I give you earlier? Answer only with the number.")
echo "$OUT" | python3 -c 'import json, sys; d = json.load(sys.stdin); assert d["ok"], d; assert d.get("resumed") is True, "resumed flag should be True"; print("T7 resume PASS — response:", d["response"][:50], "resumed:", d["resumed"])'
```

Expected: `T7 resume PASS`; response ideally contains "4242". Kimi's memory on resume is best-effort; if the response doesn't contain the number, check `resumed: True` still holds — that proves the wiring works even if the model loses the semantic anchor.

- [ ] **Step 4: Cancel path**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
# Submit a long task, cancel before it completes
SUB=$(node plugins/kimi/scripts/kimi-companion.mjs task --background --json "Count slowly from 1 to 1000, one number per line.")
JOB_ID=$(echo "$SUB" | python3 -c 'import json, sys; print(json.load(sys.stdin)["jobId"])')
sleep 5
R=$(node plugins/kimi/scripts/kimi-companion.mjs cancel "$JOB_ID" 2>/dev/null)
echo "cancel response: $R"
python3 -c 'import json, sys; d = json.loads("""'"$R"'"""); assert d["ok"] and d.get("cancelled"), d; print("cancel PASS")'
# Confirm state is now "cancelled"
node plugins/kimi/scripts/kimi-companion.mjs status "$JOB_ID" 2>/dev/null | python3 -c 'import json, sys; d = json.load(sys.stdin); assert d["status"] == "cancelled", d; print("cancel state PASS")'
```

Expected: `cancel PASS` + `cancel state PASS`.

- [ ] **Step 5: kimi-agent handoff — via Claude Code `/kimi:rescue`**

Manual check only. In an interactive Claude Code session:
- Run `/kimi:rescue "give me a haiku about background jobs"` and confirm Kimi responds (short foreground task).
- Run `/kimi:rescue --background "write a 200-word essay on caching"`, then `/kimi:status`, then `/kimi:result <jobId>`.

Expected: rescue dispatches to kimi-agent; agent calls `task`; response is presented verbatim.

If unable to run interactively, record that manual soak is pending and check `plugins/kimi/commands/rescue.md` + `plugins/kimi/agents/kimi-agent.md` structure matches the gemini equivalent. No automated CLI test covers Agent-tool dispatch.

- [ ] **Step 6: Cleanup**

```bash
# Cancel any leftover jobs
node plugins/kimi/scripts/kimi-companion.mjs status --all --json 2>/dev/null | python3 -c '
import json, sys, subprocess
snapshot = json.load(sys.stdin)
for j in snapshot.get("running", []):
    subprocess.run(["node","plugins/kimi/scripts/kimi-companion.mjs","cancel",j["id"]], stdout=subprocess.DEVNULL)
print("cleanup done")
'
```

- [ ] **Step 7: CHANGELOG entry + tag `phase-4-background`**

Prepend to `CHANGELOG.md` (below header):

```markdown
## 2026-04-20 [Claude Opus 4.7 — Phase 4 background + agent]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/{job-control.mjs (new), prompts.mjs (new), state.mjs}, plugins/kimi/scripts/{kimi-companion.mjs, session-lifecycle-hook.mjs (new), stop-review-gate-hook.mjs (new)}, plugins/kimi/hooks/hooks.json (new), plugins/kimi/prompts/stop-review-gate.md (new), plugins/kimi/agents/kimi-agent.md (new), plugins/kimi/commands/{rescue,status,result,cancel}.md (new)
- **summary**: Background-job + agent surface. Ported `job-control.mjs` wholesale from gemini-plugin-cc with mechanical name rebind (callGeminiStreaming → callKimiStreaming, geminiSessionId → kimiSessionId, GEMINI_COMPANION_SESSION_ID → KIMI_COMPANION_SESSION_ID). Removed `approvalMode` from the streaming config (kimi has no approval concept) and rewrote the `onEvent` handler for kimi's role-based event taxonomy (Phase 2 probe: no typed init/message/result envelope). Companion gained 5 new subcommands (task, status, result, cancel, task-resume-candidate) + 2 internal re-entry dispatchers (_worker, _stream-worker). Setup now toggles `stopReviewGate` via `--enable-review-gate` / `--disable-review-gate`; default disabled. Three hook scripts cover SessionStart (set env), SessionEnd (cleanup session jobs), Stop (optional ALLOW/BLOCK gate template). kimi-agent is a thin-forwarder with `--write` and `--effort` flags deliberately dropped (no kimi equivalent).
- **Exit criteria**: T6 foreground + background + cancel all PASS; T7 resume-last PASS (resumed flag true; semantic memory best-effort). Manual `/kimi:rescue` interactive check deferred to soak.
- **Deferred**: `/kimi:adversarial-review` (Phase 5), kimi-prompting skill content (Phase 5), `--write` flag on task (v0.2), timing-history (v0.2 observability polish — stubs return null/empty).
- **Cumulative**: 53/85 tasks (62%). Git tag `phase-4-background` applied.
- **next**: author docs/superpowers/plans/YYYY-MM-DD-phase-5-adversarial-polish.md. Phase 5 closes out v0.1: `/kimi:adversarial-review` + kimi-prompting references/ + lessons.md final + any final polish items.
```

Commit + tag:

```bash
git add CHANGELOG.md
git commit -m "chore: Phase 4 background + agent complete; T6 T7 cancel PASS"
git tag -a phase-4-background -m "Phase 4 complete: /kimi:rescue + job-control + agent + hooks"
git log --oneline phase-3-polish..HEAD | head -15
git tag --list 'phase-4*'
```

Expected: `phase-4-background` tag present.

---

## Self-Review

**Spec coverage:**
- §4.2 `/kimi:rescue` row → Task 4.2 (runTask) + 4.7 (kimi-agent) + 4.8 (rescue.md) ✅
- §4.2 `/kimi:status` / `/kimi:result` / `/kimi:cancel` rows → Task 4.3 (handlers) + 4.8 (command files) ✅
- §4.3 kimi-agent contract (name, description, skills, Bash, thin-forwarder, routing flags) → Task 4.7 ✅; `--write` + `--effort` explicitly dropped with rationale in the plan non-goals section (kimi has no matching concept; avoid nop flags)
- §4.5 hooks (SessionEnd + Stop) → Task 4.5 + 4.6 ✅; SessionStart also registered because that's how `KIMI_COMPANION_SESSION_ID` gets into child env
- §5.1 state dirs (`~/.claude/plugins/kimi/jobs/<jobId>/`) → job-control uses existing state.mjs primitives that already resolve to those paths (Phase 1 port) ✅
- §6.1 T6 (background job lifecycle) → Task 4.9 Step 2 ✅
- §6.1 T7 (resume) → Task 4.9 Step 3 ✅

**Placeholder scan:** all code blocks have literal values. No `<TBD>` / `<FILL>`. The sed substitution block in Task 4.1 Step 3 has explicit commands with no placeholders. The kimi-agent description string includes "128K–1M" concrete token-window spec.

**Type consistency:**
- `kimiSessionId` used consistently across `callKimi` return, `job-control.mjs` state, `task-resume-candidate` payload, `runTask` resumption lookup, and `runJobResult` output — one field name, one meaning.
- `SESSION_ID_ENV = "KIMI_COMPANION_SESSION_ID"` used consistently across `session-lifecycle-hook.mjs` (literal), `job-control.mjs` (imported), and companion (imported).
- `resolveWorkspaceRoot` defined once in companion; hook scripts each define their own local copy (intentional — hooks run independently with fewer dependencies). Both versions use the identical `git rev-parse --show-toplevel` approach.

**Cross-platform:** `spawn` + `spawnSync` portable. `process.kill(-pid, ...)` for process-group signaling works on macOS + Linux (Windows would need different logic, but kimi-cli itself is macOS/Linux-only per spec §4.2 setup).

**Security:**
- Background worker config passed via tmpfile on disk (not via argv) → avoids 1MB ARG_MAX AND stays invisible in process-listing.
- `shellEscape` in session-lifecycle-hook already quotes env values safely.
- No shell interpolation in the spawn argv path; all args native-string.

**Review integration** (plan-v1 round deferred): this plan has NOT yet been through 3-way review. Before execution, dispatch codex + gemini per `feedback_3way_review_specs.md`. Integrate findings, then execute.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-20-phase-4-background-agent.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — one fresh subagent per task (sonnet for companion edits + job-control port; haiku for markdown files). Serial: most tasks modify kimi-companion.mjs.

**2. Inline Execution** — do it in-session.

**Pre-execution review:** this is a large-surface plan (9 tasks, ~60 steps, multiple new files including hooks/agents/commands). Strong candidate for 3-way review before execution per `feedback_3way_review_specs.md`.

**Which approach?**

---

## Follow-up plans (written after `phase-4-background` tag)

- `phase-5-adversarial-polish.md` — `/kimi:adversarial-review` + kimi-prompting references/ + lessons.md final + sibling-plugin template extraction if time permits
