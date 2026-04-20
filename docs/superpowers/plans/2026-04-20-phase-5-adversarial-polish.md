# kimi-plugin-cc Phase 5 Adversarial + Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close v0.1 by adding `/kimi:adversarial-review`, extracting the review parse/validate/retry pipeline into a shared `scripts/lib/review.mjs` for sibling plugins, finalizing the `kimi-prompting` skill references (3 files), and writing `lessons.md` at repo root. Exit: **T9** PASS (`/kimi:review` and `/kimi:adversarial-review` both produce valid schema JSON on the same sample diff, with adversarial surfacing more skeptical framing).

**Architecture:** The review pipeline already has clean layering (buildPrompt → callLLM → extract → validate → retry-once), we just haven't named the seam. Phase 5 promotes that seam: `review.mjs` owns the provider-agnostic primitives (`extractReviewJson`, `validateReviewOutput`, `reviewError`, `runReviewPipeline`, + constants `MAX_REVIEW_DIFF_BYTES`, `TRUNCATION_NOTICE`, `RETRY_NOTICE`), and `kimi.mjs` shrinks to kimi-specific prompt builders (`buildReviewPrompt`, `buildAdversarialPrompt`) plus thin wrappers (`callKimiReview`, `callKimiAdversarialReview`) that inject `callKimi` + the right prompt builder into `runReviewPipeline`. The adversarial variant uses the same output schema + the same orchestrator; only the system-prompt text differs.

**Tech Stack:** Node built-ins (`node:fs`, `node:path`, `node:url`). No npm deps. Reuses `callKimi` from Phase 2 and `loadPromptTemplate` / `interpolateTemplate` from Phase 4's `prompts.mjs`.

**Reference spec:** `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` §4.2 (adversarial-review row + "prompts/adversarial-review.md 重写"), §4.4 (`kimi-prompting` references/3-md), §6.1 T9, §6.2 `lessons.md` skeleton (sections A–H).
**Reference source:** `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/commands/adversarial-review.md`, `prompts/adversarial-review.md`, `skills/gemini-prompting/` (SKILL.md + references/3-md). **Read but do not copy raw** — kimi-specific JSON-compliance framing and Chinese-language considerations go into the rewrites.

**v0.1 total budget:** ~85 tasks. This plan covers **Phase 5 only (10 tasks, ~80 steps)**. Cumulative after Phase 5 ≈ 63 / 85 (74%); the residual ~22 tasks are deferred-polish items (codex M1 cwd realpath / codex L1 shape unification / gemini G-C2 E2BIG / gemini G-M1/M2) tracked as v0.2 backlog, not v0.1 blockers.

**Exit criteria (all must hold before tag `phase-5-final`):**
- `plugins/kimi/scripts/lib/review.mjs` exists and exports `MAX_REVIEW_DIFF_BYTES`, `TRUNCATION_NOTICE`, `RETRY_NOTICE`, `extractReviewJson`, `validateReviewOutput`, `reviewError`, `runReviewPipeline`. The exports are provider-agnostic (no reference to `kimi` / `callKimi` / kimi-specific wording).
- `plugins/kimi/scripts/lib/kimi.mjs` re-exports the three constants for back-compat (so `kimi-companion.mjs` imports don't change immediately), owns only `buildReviewPrompt`, `buildAdversarialPrompt`, `callKimiReview`, `callKimiAdversarialReview`, and imports the rest from `review.mjs`.
- `docs/superpowers/templates/phase-1-template.md` exists, derived from Phase 1 plan Task 1.1–1.6 (repo init + 5 near-copy libs), **parameterized over `<llm>`** so minimax/qwen/doubao plugins can generate their own Phase-1 plan from it without rewriting mechanical scaffold. Closes spec §6.2 "模板沉淀" commitment.
- `plugins/kimi/prompts/adversarial-review.md` exists with placeholders `{{TARGET_LABEL}}`, `{{USER_FOCUS}}`, `{{REVIEW_INPUT}}`, `{{REVIEW_SCHEMA}}`; body enforces kimi-strict JSON output rules (mirrors `buildReviewPrompt` strict-rules block).
- `plugins/kimi/commands/adversarial-review.md` exists; companion `adversarial-review` subcommand handles `--base`, `--scope`, `--model`, `--wait`, `--background`, `--json`, focus positionals; always emits JSON; background mode spawns a detached worker using `runJobInBackground` with `kind: "adversarial-review"`.
- `plugins/kimi/skills/kimi-prompting/references/kimi-prompt-recipes.md`, `kimi-prompt-antipatterns.md`, `prompt-blocks.md` exist with real content (no "placeholder"); `SKILL.md` removes the "Phase 1 skeleton" / "filled in Phase 5" language and links the references.
- `lessons.md` at the repo root exists with sections A–H populated from real Phase 0–4 experience (see spec §6.2 template).
- **T9** PASS: on a sample 3–10 line buggy diff, both `node scripts/kimi-companion.mjs review` and `adversarial-review` return `{ok:true, verdict:"needs-attention", findings:[…non-empty], ...}`; adversarial findings show skeptical/breakage framing per the prompt.
- Git tag `phase-5-final` applied after the final CHANGELOG entry. Optional 3-way review of the plan + impl before tag, per `feedback_3way_review_specs.md`.

**Explicit non-goals (v0.2+):**
- `scripts/lib/job-control.mjs` adapter extraction (gemini G-C2) — mechanical rename is enough for the first sibling; full abstraction happens when the second plugin (minimax) materializes.
- Adaptive multi-retry / JSON repair heuristics — v0.1 still does exactly 1 retry.
- Thinking-block rendering for adversarial (`<details>` collapsed). v0.2.
- Deferred cleanups from prior phases (codex M1 cwd realpath / codex L1 shape unification / gemini G-C2 E2BIG >1MB / gemini G-M1 thinkBlocks phrasing / gemini G-M2). Tracked in `project_current_progress.md` as v0.2 backlog.

---

## File Structure

**Create:**
- `plugins/kimi/scripts/lib/review.mjs` — provider-agnostic review primitives (~200 lines)
- `plugins/kimi/prompts/adversarial-review.md` — kimi-specific adversarial red-team template
- `plugins/kimi/commands/adversarial-review.md` — slash-command wrapper
- `plugins/kimi/skills/kimi-prompting/references/kimi-prompt-recipes.md` — recipes for ask / review / rescue / adversarial
- `plugins/kimi/skills/kimi-prompting/references/kimi-prompt-antipatterns.md` — failures observed during Phase 2–4
- `plugins/kimi/skills/kimi-prompting/references/prompt-blocks.md` — reusable XML-tagged blocks
- `lessons.md` (repo root) — migration lessons per spec §6.2
- `docs/superpowers/templates/phase-1-template.md` — parameterized Phase-1 starter for minimax/qwen/doubao plugins, per spec §6.2 "模板沉淀"

**Modify:**
- `plugins/kimi/scripts/lib/kimi.mjs` — delete `extractReviewJson` / `validateReviewOutput` / `reviewError` / `MAX_REVIEW_DIFF_BYTES` / `TRUNCATION_NOTICE` / `RETRY_NOTICE` bodies (now live in review.mjs); re-export the constants; add `buildAdversarialPrompt` + `callKimiAdversarialReview`; thin `callKimiReview` into a `runReviewPipeline` invocation; remove the Phase-3 TODO comment at line 944 (it's done).
- `plugins/kimi/scripts/kimi-companion.mjs` — add `runAdversarialReview` handler + dispatcher case `"adversarial-review"`; extend `USAGE` banner; extend `shouldUnpackBlob` allowlist if needed.
- `plugins/kimi/skills/kimi-prompting/SKILL.md` — drop "Phase 1 skeleton" / "Fully populated in Phase 5" language; add links to the 3 references.

**Unchanged:**
- `plugins/kimi/schemas/review-output.schema.json` — same schema serves both commands.
- `plugins/kimi/scripts/lib/{git,prompts,job-control,process,args,render,state}.mjs` — untouched.
- `plugins/kimi/commands/{ask,review,rescue,setup,status,result,cancel}.md` — untouched.
- `plugins/kimi/agents/kimi-agent.md` — untouched (adversarial-review is a direct slash command, not routed through the agent).

---

## Task 5.1: Create `scripts/lib/review.mjs` with extract/validate/reviewError + constants

**Files:**
- Create: `plugins/kimi/scripts/lib/review.mjs`

First move of the refactor: extract the pure (no-LLM-call) primitives out of `kimi.mjs`. These are provider-agnostic — they only deal with JSON text and the schema-validated data shape. Leaving the pipeline orchestrator (`runReviewPipeline`) for Task 5.2 keeps diffs reviewable.

- [ ] **Step 1: Write `review.mjs` with constants + extract/validate/reviewError**

Create `plugins/kimi/scripts/lib/review.mjs`:

```js
// Provider-agnostic review primitives. Sibling plugins (minimax / qwen /
// doubao) will import the same module; only the prompt builder and LLM call
// are provider-specific. See kimi-plugin-cc design spec §4.2.

// ── Constants ─────────────────────────────────────────────
//
// Diff budget for any review pipeline. Kimi's probe-03 stdin headroom is
// ~200 KB; leaving ~50 KB margin for the schema block + summary + focus line
// keeps total prompt under the safe ceiling. Sibling plugins can override
// by passing a different `maxDiffBytes` into runReviewPipeline later; for
// now v0.1 callers use this constant directly.
export const MAX_REVIEW_DIFF_BYTES = 150_000;

// Render-layer notices (gemini Phase-3-review G-H2, G-H3). Load-bearing
// UX strings live in code + get piped into JSON fields the command file
// renders verbatim. Markdown-rule rendering is unreliable on long outputs
// (Claude drops the warning when the findings list is 15+ items).
export const TRUNCATION_NOTICE =
  "⚠️ Diff exceeded the review budget; only the first 150 KB was reviewed. Findings below are INCOMPLETE. Consider narrowing scope (--scope staged) or running per-path.";
// Provider-neutral wording (codex Phase-5-plan C2): originally "Kimi's first
// response..." but review.mjs is shared with sibling plugins — leaking the
// Kimi brand into minimax/qwen/doubao output would violate the "no
// provider-specific wording" invariant stated in plan:16.
export const RETRY_NOTICE =
  "(The first response was malformed; the retry succeeded.)";

// ── JSON extraction ───────────────────────────────────────
//
// Handles 3 dirty modes observed from LLMs: (a) bare JSON, (b) ```json ... ```
// markdown fence, (c) prose preamble then JSON. Walks balanced braces so
// trailing prose after valid JSON is tolerated; rejects multiple top-level
// JSON values (codex Phase-3-review C-M1).
export function extractReviewJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "empty response", parseError: null, rawText: text };
  }

  let candidate = text.trim();
  const fenceMatch = candidate.match(/^\`\`\`(?:json)?\s*\n([\s\S]*?)\n\`\`\`\s*$/);
  if (fenceMatch) candidate = fenceMatch[1].trim();

  const firstBrace = candidate.indexOf("{");
  if (firstBrace === -1) {
    return { ok: false, error: "no JSON object found in response", parseError: null, rawText: text };
  }
  candidate = candidate.slice(firstBrace);

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) {
    return { ok: false, error: "unterminated JSON object", parseError: null, rawText: text };
  }
  const jsonStr = candidate.slice(0, end + 1);

  const trailing = candidate.slice(end + 1).trim();
  if (trailing.startsWith("{") || trailing.startsWith("[")) {
    return { ok: false, error: "response contains multiple top-level JSON values", parseError: null, rawText: text };
  }

  try {
    const data = JSON.parse(jsonStr);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: "JSON parse failed", parseError: e.message, rawText: text };
  }
}

// ── Schema validation ─────────────────────────────────────
//
// Hand-written validator for review-output.schema.json. Checks:
//   (1) required top-level keys
//   (2) verdict enum (approve | needs-attention) — NOT "no_changes"
//       (companion-side fast path for empty diffs, not a valid LLM verdict)
//   (3) per-finding required fields (codex Phase-3-review C-H1 fix)
//   (4) severity enum + numeric bounds on confidence/line_start/line_end
// Zero-deps rule: not a full JSON Schema implementation; only the rules
// T5/T9 and the command-file contract actually care about.
export function validateReviewOutput(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["payload is not an object"] };
  }
  for (const k of ["verdict", "summary", "findings", "next_steps"]) {
    if (!(k in data)) errors.push(`missing top-level field: ${k}`);
  }
  if ("verdict" in data && !["approve", "needs-attention"].includes(data.verdict)) {
    errors.push(`verdict must be "approve" or "needs-attention" (no_changes is a companion-side shape, not a valid LLM verdict), got ${JSON.stringify(data.verdict)}`);
  }
  if ("summary" in data && (typeof data.summary !== "string" || data.summary.length === 0)) {
    errors.push("summary must be a non-empty string");
  }
  if ("findings" in data) {
    if (!Array.isArray(data.findings)) {
      errors.push("findings must be an array");
    } else {
      const requiredFindingKeys = [
        "severity", "title", "body", "file",
        "line_start", "line_end", "confidence", "recommendation",
      ];
      data.findings.forEach((f, i) => {
        if (!f || typeof f !== "object" || Array.isArray(f)) {
          errors.push(`findings[${i}] is not an object`);
          return;
        }
        for (const k of requiredFindingKeys) {
          if (!(k in f)) errors.push(`findings[${i}] missing required field: ${k}`);
        }
        if ("severity" in f && !["critical", "high", "medium", "low"].includes(f.severity)) {
          errors.push(`findings[${i}].severity must be critical|high|medium|low (NOT translated to Chinese), got ${JSON.stringify(f.severity)}`);
        }
        if ("title" in f && (typeof f.title !== "string" || f.title.length === 0)) {
          errors.push(`findings[${i}].title must be a non-empty string`);
        }
        if ("body" in f && (typeof f.body !== "string" || f.body.length === 0)) {
          errors.push(`findings[${i}].body must be a non-empty string`);
        }
        if ("confidence" in f && (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1)) {
          errors.push(`findings[${i}].confidence must be number in [0,1], got ${JSON.stringify(f.confidence)}`);
        }
        for (const k of ["line_start", "line_end"]) {
          if (k in f && (!Number.isInteger(f[k]) || f[k] < 1)) {
            errors.push(`findings[${i}].${k} must be integer >= 1, got ${JSON.stringify(f[k])}`);
          }
        }
      });
    }
  }
  if ("next_steps" in data && !Array.isArray(data.next_steps)) {
    errors.push("next_steps must be an array");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── Unified review-error shape ────────────────────────────
//
// All non-ok returns from runReviewPipeline go through this helper so
// render-layer consumers (review.md / adversarial-review.md) see a
// consistent { ok:false, error, rawText?, parseError?, firstRawText?,
// transportError?, truncated, truncation_notice, retry_used, retry_notice,
// sessionId? } shape — never a raw errorResult spread that leaks callLLM
// transport fields (status/partialResponse/events).
export function reviewError({
  error, rawText = null, parseError = null, firstRawText = null,
  transportError = null, truncated, retry_used, sessionId = null,
}) {
  return {
    ok: false,
    error,
    rawText,
    parseError,
    firstRawText,
    transportError,
    truncated,
    truncation_notice: truncated ? TRUNCATION_NOTICE : null,
    retry_used,
    retry_notice: retry_used ? RETRY_NOTICE : null,
    sessionId,
  };
}
```

- [ ] **Step 2: Verify review.mjs parses + exports cleanly**

Run:

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node --input-type=module -e "
  import('./plugins/kimi/scripts/lib/review.mjs').then(m => {
    const needed = ['MAX_REVIEW_DIFF_BYTES','TRUNCATION_NOTICE','RETRY_NOTICE','extractReviewJson','validateReviewOutput','reviewError'];
    for (const k of needed) {
      if (!(k in m)) { console.error('MISSING:', k); process.exit(1); }
    }
    console.log('exports ok');
  });
"
```

Expected: `exports ok`.

- [ ] **Step 3: Rewrite extract/validate/reviewError bodies in kimi.mjs to re-export from review.mjs**

Open `plugins/kimi/scripts/lib/kimi.mjs`. Near the top (after the `import { runCommand, binaryAvailable } from "./process.mjs";` line around line 6), add:

```js
import {
  MAX_REVIEW_DIFF_BYTES as REVIEW_MAX_DIFF,
  TRUNCATION_NOTICE as REVIEW_TRUNCATION_NOTICE,
  RETRY_NOTICE as REVIEW_RETRY_NOTICE,
  extractReviewJson as extractReviewJsonImpl,
  validateReviewOutput as validateReviewOutputImpl,
  reviewError as reviewErrorImpl,
} from "./review.mjs";
```

Then replace the bodies of the existing definitions with re-exports. Find line 22 (`export const MAX_REVIEW_DIFF_BYTES = 150_000;`) and replace the constants block (lines 22–34) with:

```js
// Re-export review primitives (moved to review.mjs in Phase 5 for sibling
// plugin reuse). Keeping the re-export preserves kimi-companion.mjs's
// existing `import { MAX_REVIEW_DIFF_BYTES } from "./kimi.mjs"` line.
export const MAX_REVIEW_DIFF_BYTES = REVIEW_MAX_DIFF;
export const TRUNCATION_NOTICE = REVIEW_TRUNCATION_NOTICE;
export const RETRY_NOTICE = REVIEW_RETRY_NOTICE;
```

Find `export function extractReviewJson(text) {` (around line 670) and replace that function body plus the one that follows (`export function validateReviewOutput(data)` around line 735) plus the `function reviewError(...)` (around line 799) with single-line re-exports. The three becomes:

```js
export const extractReviewJson = extractReviewJsonImpl;
export const validateReviewOutput = validateReviewOutputImpl;
// reviewError is internal (was `function reviewError`, not exported); callKimiReview
// uses it directly. Re-bind to the imported impl so the function-scope name still works:
const reviewError = reviewErrorImpl;
```

Delete the original function bodies (including their JSDoc comments) since they now live in review.mjs. The in-file docblock that explains what they do should get a 1-line "moved to review.mjs" replacement instead of being dropped — keep the seam visible:

```js
// ── Review primitives (moved to review.mjs in Phase 5) ────
// extractReviewJson, validateReviewOutput, reviewError now live in
// plugins/kimi/scripts/lib/review.mjs so minimax / qwen / doubao plugins
// can share them without copy-paste. Re-exported above for back-compat.
```

- [ ] **Step 4: Remove the Phase-3 TODO comment at kimi.mjs line 944**

Find the block starting `// TODO(Phase 5): extract buildReviewPrompt / extractReviewJson /`. The extraction is now done (except `buildReviewPrompt`, which stays — kimi-specific). Replace the TODO block with a shorter status note:

```js
// Phase 5 extraction done: extractReviewJson / validateReviewOutput /
// reviewError / MAX_REVIEW_DIFF_BYTES / TRUNCATION_NOTICE / RETRY_NOTICE
// all live in ./review.mjs. buildReviewPrompt stays here because its text
// is kimi-specific (the "好的，这是 JSON：" prose warning + the "严重/高/中/低"
// severity-translation guard). buildAdversarialPrompt (Task 5.4) is the
// same story.
```

- [ ] **Step 5: Run T5 to verify /kimi:review still works after extraction**

Set up a tiny test diff:

```bash
cd /tmp
rm -rf kimi-t5-test
mkdir kimi-t5-test && cd kimi-t5-test
git init --quiet
git commit --allow-empty -q -m "init"
printf 'def divide(a, b):\n    return a / b\n' > calc.py
git add calc.py
git commit -q -m "add calc"
printf 'def divide(a, b):\n    return a / b\n\ndef unsafe(n):\n    return eval(n)  # accepts user input\n' > calc.py
```

Then run:

```bash
cd /tmp/kimi-t5-test
node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs review
```

Expected:
- Exit 0
- Stdout is valid JSON starting with `{`
- `ok: true`
- `verdict: "needs-attention"` (the `eval` line should trigger findings)
- `findings` is a non-empty array with at least one entry; the entry has all 8 required fields (`severity`, `title`, `body`, `file`, `line_start`, `line_end`, `confidence`, `recommendation`)
- `truncation_notice: null` (diff is small)
- `retry_notice: null` (normally first shot succeeds on a tiny diff)

Verify JSON shape with:

```bash
cd /tmp/kimi-t5-test
node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs review 2>/dev/null | node -e '
  const d = JSON.parse(require("fs").readFileSync(0,"utf8"));
  if (!d.ok) { console.error("FAIL: ok=false:", d.error); process.exit(1); }
  if (d.verdict !== "needs-attention") console.warn("note: verdict =", d.verdict);
  if (!Array.isArray(d.findings)) { console.error("FAIL: findings not array"); process.exit(1); }
  console.log("PASS: verdict="+d.verdict+", findings="+d.findings.length);
'
```

Expected: `PASS: verdict=needs-attention, findings=N` (N≥1).

If FAIL: the import wiring in Step 3 is wrong. Check that `review.mjs` is syntactically valid (`node --check plugins/kimi/scripts/lib/review.mjs`) and that `kimi.mjs` re-exports compile (`node --check plugins/kimi/scripts/lib/kimi.mjs`).

- [ ] **Step 6: Commit Task 5.1**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add plugins/kimi/scripts/lib/review.mjs plugins/kimi/scripts/lib/kimi.mjs
git commit -q -m "refactor(review): extract extract/validate/reviewError + constants to review.mjs"
```

---

## Task 5.2: Extract `runReviewPipeline` orchestrator into `review.mjs`

**Files:**
- Modify: `plugins/kimi/scripts/lib/review.mjs` (add `runReviewPipeline`)
- Modify: `plugins/kimi/scripts/lib/kimi.mjs` (thin `callKimiReview` into `runReviewPipeline`)

The orchestrator is also provider-agnostic: it's "build-prompt → call-LLM → extract → validate → retry-once". Parameterize on `buildPrompt` (returns a string) and `callLLM` (returns `{ ok, response, sessionId, status?, partialResponse? }`). Kimi's `buildReviewPrompt` already has the exact right signature `({ context, focus, schemaPath, retryHint })`.

- [ ] **Step 1: Append `runReviewPipeline` to `review.mjs`**

Append at the end of `plugins/kimi/scripts/lib/review.mjs`:

```js
// ── Pipeline orchestrator ──────────────────────────────────
//
// Drives the build → call → extract → validate → retry-once loop. Provider
// injects:
//   buildPrompt({ context, focus, schemaPath, retryHint }) → string
//   callLLM({ prompt, model, cwd, timeout, resumeSessionId })
//     → { ok, response, sessionId?, status?, partialResponse?, error? }
// This is exactly the signature of kimi.mjs buildReviewPrompt + callKimi;
// sibling plugins provide their own pair. The pipeline never imports a
// provider module — all binding happens at the call site.
//
// Returns success-shape: { ok:true, ...parsedReview, truncated, truncation_notice,
// retry_used, retry_notice, sessionId }, or reviewError-shape on failure.
//
// `retryWarning` defaults to a neutral string so sibling plugins that inherit
// this module get the same observability breadcrumb; callers can override
// (or pass null to suppress) if they need a provider-specific label.
export function runReviewPipeline({
  buildPrompt, callLLM,
  context, focus = null, schemaPath,
  model = null, cwd = process.cwd(), timeout,
  truncated = false,
  retryWarning = "Warning: review response failed parse/validation; retrying once with error hint...\n",
} = {}) {
  let firstPrompt;
  try {
    firstPrompt = buildPrompt({ context, focus, schemaPath });
  } catch (e) {
    return reviewError({
      error: `Failed to build review prompt: ${e.message}`,
      truncated,
      retry_used: false,
    });
  }

  const firstResult = callLLM({ prompt: firstPrompt, model, cwd, timeout });
  if (!firstResult || !firstResult.ok) {
    return reviewError({
      error: (firstResult && firstResult.error) || "LLM call failed",
      transportError: {
        status: (firstResult && firstResult.status) ?? null,
        partialResponse: (firstResult && firstResult.partialResponse) ?? null,
      },
      truncated,
      retry_used: false,
      sessionId: (firstResult && firstResult.sessionId) ?? null,
    });
  }

  const firstExtracted = extractReviewJson(firstResult.response);
  let firstValidation = null;
  if (firstExtracted.ok) {
    firstValidation = validateReviewOutput(firstExtracted.data);
    if (firstValidation.ok) {
      return {
        ok: true,
        ...firstExtracted.data,
        truncated,
        truncation_notice: truncated ? TRUNCATION_NOTICE : null,
        retry_used: false,
        retry_notice: null,
        sessionId: firstResult.sessionId,
      };
    }
  }

  if (retryWarning) process.stderr.write(retryWarning);

  const retryHint = firstExtracted.ok
    ? `schema validation errors: ${firstValidation.errors.slice(0, 3).join("; ")}`
    : `parse failure (${firstExtracted.error}${firstExtracted.parseError ? ": " + firstExtracted.parseError : ""})`;

  let retryPrompt;
  try {
    retryPrompt = buildPrompt({ context, focus, schemaPath, retryHint });
  } catch (e) {
    return reviewError({
      error: `Failed to rebuild review prompt for retry: ${e.message}`,
      firstRawText: firstResult.response,
      truncated,
      retry_used: true,
      sessionId: firstResult.sessionId ?? null,
    });
  }
  const retryResult = callLLM({
    prompt: retryPrompt,
    model, cwd, timeout,
    resumeSessionId: firstResult.sessionId || null,
  });
  if (!retryResult || !retryResult.ok) {
    return reviewError({
      error: `Retry LLM call failed: ${(retryResult && retryResult.error) || "unknown"}`,
      transportError: {
        status: (retryResult && retryResult.status) ?? null,
        partialResponse: (retryResult && retryResult.partialResponse) ?? null,
      },
      firstRawText: firstResult.response,
      truncated,
      retry_used: true,
      sessionId: (retryResult && retryResult.sessionId) ?? null,
    });
  }

  const retryExtracted = extractReviewJson(retryResult.response);
  if (!retryExtracted.ok) {
    return reviewError({
      error: `Review failed after 1 retry: ${retryExtracted.error}`,
      parseError: retryExtracted.parseError,
      rawText: retryResult.response,
      firstRawText: firstResult.response,
      truncated,
      retry_used: true,
      sessionId: retryResult.sessionId ?? null,
    });
  }
  const retryValidation = validateReviewOutput(retryExtracted.data);
  if (!retryValidation.ok) {
    return reviewError({
      error: `Review failed schema validation after 1 retry: ${retryValidation.errors.join("; ")}`,
      rawText: retryResult.response,
      firstRawText: firstResult.response,
      truncated,
      retry_used: true,
      sessionId: retryResult.sessionId ?? null,
    });
  }

  return {
    ok: true,
    ...retryExtracted.data,
    truncated,
    truncation_notice: truncated ? TRUNCATION_NOTICE : null,
    retry_used: true,
    retry_notice: RETRY_NOTICE,
    sessionId: retryResult.sessionId,
  };
}
```

- [ ] **Step 2: Replace `callKimiReview` body in kimi.mjs with a thin wrapper**

Open `plugins/kimi/scripts/lib/kimi.mjs`. Find the current `export function callKimiReview({ context, focus, schemaPath, model, cwd, timeout, truncated = false }) {` body (around line 825–942) and replace the entire body (everything from the opening `{` through the closing `}` just before the TODO comment) with this:

```js
export function callKimiReview({ context, focus, schemaPath, model, cwd, timeout, truncated = false }) {
  return runReviewPipeline({
    buildPrompt: buildReviewPrompt,
    callLLM: callKimi,
    context, focus, schemaPath, model, cwd, timeout, truncated,
    retryWarning: "Warning: kimi review response failed parse/validation; retrying once with error hint...\n",
  });
}
```

Also add to the top-of-file imports (after the review.mjs import block from Task 5.1):

```js
import { runReviewPipeline } from "./review.mjs";
```

- [ ] **Step 3: Re-run T5 to verify behavior is preserved**

```bash
cd /tmp/kimi-t5-test
node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs review 2>/dev/null | node -e '
  const d = JSON.parse(require("fs").readFileSync(0,"utf8"));
  if (!d.ok) { console.error("FAIL: ok=false:", d.error); process.exit(1); }
  console.log("PASS: verdict="+d.verdict+", findings="+d.findings.length+", retry_used="+d.retry_used);
'
```

Expected: `PASS: verdict=needs-attention, findings=N, retry_used=false` (or `retry_used=true` if kimi happened to fail the first shot — still a pass).

Also verify the retry path still runs by tweaking the schema path to a bogus file temporarily and running:

```bash
# confirm the "build prompt fails" path goes through reviewError and exit 1
cd /tmp/kimi-t5-test
TMP_KIMI=/tmp/kimi-bad-schema node -e '
  process.env.TMP_KIMI;  // placeholder
  // Call callKimiReview with a bad schemaPath via a private eval
' 2>&1 || true
```

Actually the cleanest verification: grep the stderr breadcrumb is preserved when retry fires on pathological input. That's covered by T9 in Task 5.6. For now only T5 PASS is required.

- [ ] **Step 4: Commit Task 5.2**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add plugins/kimi/scripts/lib/review.mjs plugins/kimi/scripts/lib/kimi.mjs
git commit -q -m "refactor(review): extract runReviewPipeline orchestrator to review.mjs"
```

---

## Task 5.3: Write `prompts/adversarial-review.md` template

**Files:**
- Create: `plugins/kimi/prompts/adversarial-review.md`

Red-team prompt. Mirror gemini's adversarial-review.md structure (XML-tagged sections) but add kimi-specific JSON-output strict rules (the "好的，这是 JSON：" / markdown-fence / severity-translation guards from `buildReviewPrompt`). The prompt uses Mustache-style `{{VAR}}` placeholders consumed by `interpolateTemplate` (prompts.mjs).

- [ ] **Step 1: Write the template**

Create `plugins/kimi/prompts/adversarial-review.md`:

```markdown
<role>
You are Kimi performing an adversarial software review.
Your job is to break confidence in the change, not to validate it.
</role>

<task>
Review the provided repository context as if you are trying to find the strongest reasons this change should not ship yet.
Target: {{TARGET_LABEL}}
User focus: {{USER_FOCUS}}
</task>

<operating_stance>
Default to skepticism.
Assume the change can fail in subtle, high-cost, or user-visible ways until the evidence says otherwise.
Do not give credit for good intent, partial fixes, or likely follow-up work.
If something only works on the happy path, treat that as a real weakness.
</operating_stance>

<attack_surface>
Prioritize the kinds of failures that are expensive, dangerous, or hard to detect:
- auth, permissions, tenant isolation, and trust boundaries
- data loss, corruption, duplication, and irreversible state changes
- rollback safety, retries, partial failure, and idempotency gaps
- race conditions, ordering assumptions, stale state, and re-entrancy
- empty-state, null, timeout, and degraded dependency behavior
- version skew, schema drift, migration hazards, and compatibility regressions
- observability gaps that would hide failure or make recovery harder
</attack_surface>

<review_method>
Actively try to disprove the change.
Look for violated invariants, missing guards, unhandled failure paths, and assumptions that stop being true under stress.
Trace how bad inputs, retries, concurrent actions, or partially completed operations move through the code.
If the user supplied a focus area, weight it heavily, but still report any other material issue you can defend.
</review_method>

<finding_bar>
Report only material findings.
Do not include style feedback, naming feedback, low-value cleanup, or speculative concerns without evidence.
A finding should answer:
1. What can go wrong?
2. Why is this code path vulnerable?
3. What is the likely impact?
4. What concrete change would reduce the risk?
</finding_bar>

<output_contract>
You MUST respond with a single JSON object matching this schema:

```json
{{REVIEW_SCHEMA}}
```

STRICT OUTPUT RULES (kimi-plugin-cc §4.2):
- Return ONLY the JSON object.
- No markdown code fence around it (no ```json ... ```).
- No prose before (no "好的" / "Here is" / "This review").
- No prose after (no "让我知道" / "Let me know").
- `severity` MUST be one of the EXACT English strings: critical, high, medium, low. Do NOT translate these to Chinese (严重/高/中/低 FAIL schema validation).
- `verdict` MUST be: approve or needs-attention (never "no_changes" — that is a companion-only fast-path for empty diffs).
- For each finding you DO include, fill ALL required fields: severity, title, body, file, line_start, line_end, confidence, recommendation. Empty findings array is fine if nothing survives the bar; partially-filled findings are rejected.
- Do NOT fabricate line numbers. If you are unsure of exact lines, omit the entire finding.

ADVERSARIAL STANCE RULES:
- Do NOT use balanced phrasing ("一方面...另一方面" / "on one hand... on the other hand").
- Do NOT list pros and cons. Your job is to enumerate risks, not weigh them against benefits.
- Do NOT soften findings with hedges like "可能" / "可能存在" / "perhaps" / "might" unless the finding is genuinely a hypothesis — in which case drop it (finding_bar §4 rules it out).
- Reject dialectical summaries. Write the `summary` like a terse ship/no-ship assessment: "Do not ship" / "Blocks release" / "High-risk regression" are valid openings; "This change introduces both improvements and concerns" is not.
</output_contract>

<grounding_rules>
Be aggressive, but stay grounded.
Every finding must be defensible from the provided repository context.
Do not invent files, lines, code paths, or runtime behavior you cannot support.
If a conclusion depends on an inference, state that explicitly and keep the confidence honest.
</grounding_rules>

<repository_context>
{{REVIEW_INPUT}}
</repository_context>
```

- [ ] **Step 2: Verify the template has the 4 expected placeholders and no stray ones**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
grep -oE '\{\{[A-Z_]+\}\}' plugins/kimi/prompts/adversarial-review.md | sort -u
```

Expected (exactly these 4 lines, in this alphabetical order):

```
{{REVIEW_INPUT}}
{{REVIEW_SCHEMA}}
{{TARGET_LABEL}}
{{USER_FOCUS}}
```

If anything else shows up, fix a typo.

- [ ] **Step 3: Commit Task 5.3**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add plugins/kimi/prompts/adversarial-review.md
git commit -q -m "feat(prompts): adversarial-review template with kimi-strict JSON rules"
```

---

## Task 5.4: Add `buildAdversarialPrompt` + `callKimiAdversarialReview` to kimi.mjs

**Files:**
- Modify: `plugins/kimi/scripts/lib/kimi.mjs` (add 2 functions; extend exports)

`buildAdversarialPrompt` loads the template from `prompts/adversarial-review.md`, interpolates the 4 variables, and optionally appends a retry hint (same shape as `buildReviewPrompt`'s `retryHint` branch). The wrapper `callKimiAdversarialReview` just swaps `buildPrompt` in the `runReviewPipeline` call.

- [ ] **Step 1: Add `buildAdversarialPrompt` above `callKimiReview`**

Open `plugins/kimi/scripts/lib/kimi.mjs`. Add these imports to the top (after the existing `import { spawn } from "node:child_process";` block if not already present):

```js
import { fileURLToPath } from "node:url";
import { loadPromptTemplate, interpolateTemplate } from "./prompts.mjs";
```

Near the top of the file (after the `LARGE_PROMPT_THRESHOLD_BYTES` constant), add:

```js
// Plugin root (plugins/kimi/) — used to resolve prompts/adversarial-review.md
// during buildAdversarialPrompt. This file sits at plugins/kimi/scripts/lib/kimi.mjs,
// so climbing two levels lands on plugins/kimi/.
const KIMI_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
```

Then, just above the existing `export function buildReviewPrompt(...)` (around line 630), insert:

```js
// ── Adversarial review prompt ──────────────────────────────
//
// Loads prompts/adversarial-review.md (Task 5.3) and interpolates
// TARGET_LABEL / USER_FOCUS / REVIEW_INPUT / REVIEW_SCHEMA. Same retry-hint
// semantics as buildReviewPrompt: a terse error nudge appended at the end
// so kimi corrects in place. TARGET_LABEL derives from the git context
// (branch vs. working-tree); caller fills it in.
export function buildAdversarialPrompt({ context, focus, schemaPath, retryHint = null }) {
  const schema = fs.readFileSync(schemaPath, "utf8").trim();
  const template = loadPromptTemplate(KIMI_PLUGIN_ROOT, "adversarial-review");
  const base = interpolateTemplate(template, {
    TARGET_LABEL: context.summary || "working tree changes",
    USER_FOCUS: focus || "No extra focus provided.",
    REVIEW_INPUT: context.content,
    REVIEW_SCHEMA: schema,
  });
  if (!retryHint) return base;
  // Retry hint lives outside the XML tags — the template is a fixed artifact,
  // and kimi's correction attention is on the final paragraph regardless.
  return `${base}

[IMPORTANT] Your previous response failed JSON parsing or schema validation. The error was: ${retryHint}
Return ONLY the JSON object — no prose, no markdown fence, no commentary before or after. Use the EXACT English severity strings (critical/high/medium/low).`;
}
```

- [ ] **Step 2: Add `callKimiAdversarialReview` just after `callKimiReview`**

After the `callKimiReview` function (now the thin wrapper from Task 5.2), insert:

```js
// Adversarial-review entry point. Same pipeline as callKimiReview, different
// prompt builder. Schema output shape is identical (review-output.schema.json);
// only the prose stance differs (red-team vs balanced).
export function callKimiAdversarialReview({ context, focus, schemaPath, model, cwd, timeout, truncated = false }) {
  return runReviewPipeline({
    buildPrompt: buildAdversarialPrompt,
    callLLM: callKimi,
    context, focus, schemaPath, model, cwd, timeout, truncated,
    retryWarning: "Warning: kimi adversarial-review response failed parse/validation; retrying once with error hint...\n",
  });
}
```

- [ ] **Step 3: Extend the bottom-of-file export block**

Find the `export {` block at the bottom of `kimi.mjs` (around line 955). Add `buildAdversarialPrompt` and `callKimiAdversarialReview` as named re-exports if they're re-exported here (they may already be `export function`-declared above, in which case no block change is needed). Confirm with:

```bash
grep -nE "^export (function|const) (buildAdversarialPrompt|callKimiAdversarialReview)" plugins/kimi/scripts/lib/kimi.mjs
```

Expected: 2 lines. If only the top-level `export function` declarations are present (they should be from Steps 1–2), you're done.

- [ ] **Step 4: Syntax check**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node --check plugins/kimi/scripts/lib/kimi.mjs
node --check plugins/kimi/scripts/lib/review.mjs
```

Expected: both silent (no output = OK).

- [ ] **Step 5: Commit Task 5.4**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add plugins/kimi/scripts/lib/kimi.mjs
git commit -q -m "feat(kimi): buildAdversarialPrompt + callKimiAdversarialReview"
```

---

## Task 5.5: Add `runAdversarialReview` handler + `commands/adversarial-review.md` + dispatcher

**Files:**
- Modify: `plugins/kimi/scripts/kimi-companion.mjs` (handler + dispatcher case + USAGE)
- Create: `plugins/kimi/commands/adversarial-review.md`

Companion handler mirrors `runReview` structure (argparse → git repo check → context collection → empty-diff fast path → size-truncation → pipeline call → JSON emit → exit status). Background mode wraps via `runJobInBackground` (same reusable path as `handleAdversarialReview` in gemini-companion.mjs).

- [ ] **Step 1: Add `callKimiAdversarialReview` to the companion import list**

Open `plugins/kimi/scripts/kimi-companion.mjs`. Find the import block starting `import { getKimiAvailability,` (around line 7). Add `callKimiAdversarialReview` to the list:

```js
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
```

- [ ] **Step 2: Add the `runAdversarialReview` handler**

Find `runReview` (around line 304) and read through the end of its body so you know the shape. Then, just after `runReview`'s closing `}` and before `const DEFAULT_CONTINUE_PROMPT`, insert:

```js
async function runAdversarialReview(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    booleanOptions: ["json", "background", "wait"],
    valueOptions: ["base", "scope", "model", "cwd"],
    aliasMap: { m: "model" },
  });

  // Adversarial-review ALWAYS emits JSON (same contract as /kimi:review).
  const emitJson = true;

  const cwd = options.cwd || process.cwd();
  try {
    ensureGitRepository(cwd);
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }, null, 2) + "\n");
    process.exit(1);
  }

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
    if (options.base) bgArgs.push("--base", options.base);
    if (options.scope) bgArgs.push("--scope", options.scope);
    if (options.model) bgArgs.push("--model", options.model);
    positionals.forEach((p) => bgArgs.push(p));

    const submission = runJobInBackground({
      job, companionScript: SELF, args: bgArgs, workspaceRoot, cwd,
    });
    process.stdout.write(JSON.stringify(submission, null, 2) + "\n");
    process.exit(0);
  }

  const scope = options.scope || "auto";
  const base = options.base || null;
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
```

Suppress the `emitJson`-unused-warning by not relying on a bare `const` — it's the same pattern `runReview` uses, kept for symmetry (an obvious local knob if v0.2 ever splits render modes).

- [ ] **Step 3: Add dispatcher case**

Find the `switch (sub) {` block near `main()` (around line 697). Add a new case immediately after `case "review":`:

```js
    case "review":
      return runReview(rest);
    case "adversarial-review":
      return runAdversarialReview(rest);
    case "task":
      return runTask(rest);
```

- [ ] **Step 4: Extend the `USAGE` banner**

Find the `const USAGE = \`Usage: kimi-companion...\`` block (starts around line 57). Add a line for the new subcommand under the existing review line:

```
  review [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [-m <model>] [focus...]
                                       Review current diff. Always emits JSON matching review-output schema.
  adversarial-review [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [-m <model>] [--background|--wait] [focus...]
                                       Adversarial (red-team) review on current diff. Same schema; same JSON envelope.
```

- [ ] **Step 5: Write `commands/adversarial-review.md`**

Create `plugins/kimi/commands/adversarial-review.md`:

```markdown
---
description: Run an adversarial Kimi review that challenges the implementation
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|staged|unstaged|branch] [--model <model>] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run:

```bash
KIMI_COMPANION_CALLER=claude node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" adversarial-review "$ARGUMENTS"
```

The companion always emits JSON to stdout matching `plugins/kimi/schemas/review-output.schema.json`. Parse it and present to the user.

This command is review-only: do NOT apply patches or suggest you are about to make changes. Your only job is to run the command and render Kimi's output.

**Top-level fields (same shape as /kimi:review):**
- `ok`: true / false
- `verdict`: `"approve"` | `"needs-attention"` | `"no_changes"` — `"no_changes"` is companion-only on empty diffs.
- `summary`: one-paragraph ship/no-ship assessment (adversarial framing — terse, skeptical)
- `findings`: array of finding objects
- `next_steps`: array of recommended actions
- `truncated`: whether the diff was cut off
- `truncation_notice`: prefilled warning string when `truncated: true`, otherwise `null` — render VERBATIM at the very top of the output
- `retry_used`: whether the first response required a retry
- `retry_notice`: prefilled discreet footnote when `retry_used: true`, otherwise `null` — render VERBATIM at the very END of the output

**If `verdict === "no_changes"`**: tell the user "No changes to review." and stop.

**If `ok === false`**: show `error`, `rawText` (if present, clipped to 500 chars), and note whether a retry was used. Do NOT auto-retry — the companion already tried once. Suggest running `/kimi:adversarial-review --scope staged` or reducing diff size.

**If `ok === true` and `findings` is non-empty:**
1. **If `truncation_notice` is non-null, render it VERBATIM at the very TOP before any verdict, summary, or findings.** Do NOT rewrite. (Phase-3-review G-H2.)
2. Present the `verdict` and `summary` prominently — the adversarial summary is a deliberate ship/no-ship assessment; do not soften it.
3. Sort findings by severity (`critical > high > medium > low`), then by `file` (alphabetical), then by `line_start` (ascending).
4. For each finding, show: severity badge, title, `file:line_start` (or range), body verbatim, recommendation.
5. List `next_steps`.
6. **If `retry_notice` is non-null, render it VERBATIM at the very END after `next_steps`.** Do NOT paraphrase. (Phase-3-review G-H3.)
7. If `/kimi:review` already ran earlier in this conversation, compare findings: both-found (high agreement = real), only-adversarial (potential over-skepticism — still show), only-/kimi:review (potential under-skepticism — also show).

**Execution mode:**
- If `$ARGUMENTS` contains `--wait`, foreground.
- If `$ARGUMENTS` contains `--background`, background.
- Otherwise: estimate size (`git status --short` for working-tree; `git diff --shortstat <base>...HEAD` for branch scope). Recommend background for anything beyond 1–2 files; otherwise foreground. Use `AskUserQuestion` exactly once with the recommended option first.

Background flow returns a `{jobId, pid}` submission. After launching: "Kimi adversarial review started in the background. Check `/kimi:status` for progress."

**Do NOT auto-fix any issues.** Ask the user which items to address. One question at a time if multiple clusters.

### Options

- `--base <ref>` — base ref for `branch` scope (defaults to auto-detected main/master)
- `--scope <...>` — `auto` (default), `staged`, `unstaged`, `working-tree`, `branch`
- `--model <name>` — override default model (see `/kimi:setup`)
- `[focus ...]` — optional focus keywords appended to the prompt (e.g. `auth middleware`)
- `--wait` / `--background` — execution mode override (default: size-based recommendation)
```

- [ ] **Step 6: Extend `shouldUnpackBlob` to accept the new subcommand**

**Mandatory fix (codex Phase-5-plan C1):** Claude Code's `$ARGUMENTS` substitution produces a single quoted blob when the user types `/kimi:adversarial-review --base main auth middleware`. Without extending `UNPACK_SAFE_SUBCOMMANDS` and the per-sub switch in `shouldUnpackBlob`, the companion sees `rest = ["--base main auth middleware"]` as a single positional — `--base` silently becomes part of the `focus` text and `options.base` stays null. Same pattern review/ask/task already handle.

Open `plugins/kimi/scripts/kimi-companion.mjs`. Find `const UNPACK_SAFE_SUBCOMMANDS = new Set([` (around line 621) and add `"adversarial-review"` to the set:

```js
const UNPACK_SAFE_SUBCOMMANDS = new Set([
  "setup", "ask", "review", "adversarial-review", "task",
  "status", "result", "cancel", "task-resume-candidate",
]);
```

Below the existing flag regexes (around line 631), add a new one for adversarial-review. Its flags are the review set plus `--background|--wait`:

```js
const ADVERSARIAL_REVIEW_KNOWN_FLAG = /^(?:--(?:json|model|base|scope|background|wait)(?:=.*)?|-m)$/;
```

Inside `shouldUnpackBlob` (around line 641), add a branch for adversarial-review right after the `review` branch:

```js
  if (sub === "review") return REVIEW_KNOWN_FLAG.test(tokens[0]) || tokens.every((t) => !t.startsWith("-"));
  if (sub === "adversarial-review") return ADVERSARIAL_REVIEW_KNOWN_FLAG.test(tokens[0]) || tokens.every((t) => !t.startsWith("-"));
  if (sub === "task") return TASK_KNOWN_FLAG.test(tokens[0]) || tokens.every((t) => !t.startsWith("-"));
```

Verify with a grep round-trip:

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
grep -n "adversarial-review" plugins/kimi/scripts/kimi-companion.mjs
```

Expected: 4 lines minimum — the `UNPACK_SAFE_SUBCOMMANDS` entry, the flag regex, the `shouldUnpackBlob` branch, the dispatcher `case`, and the usage line from Step 4.

- [ ] **Step 7: Syntax check**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node --check plugins/kimi/scripts/kimi-companion.mjs
```

Expected: silent.

- [ ] **Step 8: Commit Task 5.5**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add plugins/kimi/commands/adversarial-review.md plugins/kimi/scripts/kimi-companion.mjs
git commit -q -m "feat(commands): /kimi:adversarial-review + companion handler"
```

---

## Task 5.6: T9 live test — both /kimi:review and /kimi:adversarial-review on sample diff

**Files:** none created/modified; validation only.

Close the loop on adversarial-review by running both commands against the same deliberately-buggy diff and comparing outputs.

- [ ] **Step 1: Create the sample diff**

```bash
cd /tmp
rm -rf kimi-t9-test
mkdir kimi-t9-test && cd kimi-t9-test
git init --quiet
git commit --allow-empty -q -m "init"
cat > server.py <<'EOF'
def login(username, password):
    return True
EOF
git add server.py
git commit -q -m "add login stub"

# Now the "buggy" change — auth bypass + SQL injection vector
cat > server.py <<'EOF'
import sqlite3

def login(username, password):
    # accept any non-empty credentials
    if username and password:
        return True
    return False

def search_users(query):
    db = sqlite3.connect("users.db")
    cur = db.cursor()
    cur.execute(f"SELECT * FROM users WHERE name LIKE '%{query}%'")
    return cur.fetchall()
EOF
```

Unstaged modification — both scopes will cover it.

- [ ] **Step 2: Run /kimi:review**

```bash
cd /tmp/kimi-t9-test
node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs review > review.json 2> review.stderr
echo "exit: $?"
cat review.stderr
```

Expected:
- `exit: 0`
- Possibly a stderr breadcrumb `Warning: kimi review response failed parse/validation; retrying once...` (acceptable — adversarial-aware kimi builds should still converge)
- `review.json` is valid JSON: `ok:true`, `verdict:"needs-attention"`, `findings` non-empty, each finding has all 8 required keys.

Parse-check:

```bash
node -e '
  const d = JSON.parse(require("fs").readFileSync("/tmp/kimi-t9-test/review.json","utf8"));
  if (!d.ok) { console.error("FAIL: ok=false:", d.error); process.exit(1); }
  const rk = ["severity","title","body","file","line_start","line_end","confidence","recommendation"];
  for (const f of d.findings) {
    for (const k of rk) if (!(k in f)) { console.error("FAIL: missing", k, "in", f); process.exit(1); }
  }
  console.log("review PASS: verdict="+d.verdict+", findings="+d.findings.length+", retry="+d.retry_used);
'
```

Expected: `review PASS: verdict=needs-attention, findings=N`.

- [ ] **Step 3: Run /kimi:adversarial-review**

```bash
cd /tmp/kimi-t9-test
node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs adversarial-review > adversarial.json 2> adversarial.stderr
echo "exit: $?"
cat adversarial.stderr
```

Expected: same shape as review.json (`ok:true`, `verdict:"needs-attention"`, `findings` non-empty).

Parse-check:

```bash
node -e '
  const d = JSON.parse(require("fs").readFileSync("/tmp/kimi-t9-test/adversarial.json","utf8"));
  if (!d.ok) { console.error("FAIL: ok=false:", d.error); process.exit(1); }
  const rk = ["severity","title","body","file","line_start","line_end","confidence","recommendation"];
  for (const f of d.findings) {
    for (const k of rk) if (!(k in f)) { console.error("FAIL: missing", k, "in", f); process.exit(1); }
  }
  console.log("adversarial PASS: verdict="+d.verdict+", findings="+d.findings.length+", retry="+d.retry_used);
'
```

Expected: `adversarial PASS: verdict=needs-attention, findings=N`.

- [ ] **Step 4: Programmatic tone gate (gemini Phase-5-plan G4)**

"Eyeball the tone" is not an acceptance criterion a subagent can pass/fail deterministically. Use a regex gate over the `summary` field instead. The adversarial summary must contain at least one red-team signal; the balanced review summary is unconstrained (both ship/no-ship and neutral framings are legitimate there).

```bash
cd /tmp/kimi-t9-test
node -e '
  const adv = JSON.parse(require("fs").readFileSync("adversarial.json","utf8"));
  const bal = JSON.parse(require("fs").readFileSync("review.json","utf8"));
  const RED = /(do not ship|blocks? (release|merge|deployment)|unacceptable|must fix|high[- ]risk|severe|critical risk|should not merge|not safe to ship|reject|blocker|unsafe)/i;
  const DIALECTICAL = /(一方面[\s\S]*另一方面|on (the )?one hand[\s\S]*on (the )?other hand|pros and cons|both improvements and)/i;
  if (!RED.test(adv.summary)) {
    console.error("FAIL: adversarial summary lacks red-team signal. summary=");
    console.error(adv.summary);
    process.exit(1);
  }
  if (DIALECTICAL.test(adv.summary)) {
    console.error("FAIL: adversarial summary reads as balanced/dialectical. summary=");
    console.error(adv.summary);
    process.exit(1);
  }
  console.log("adversarial tone PASS: matched red-team signal");
  console.log("  adv summary: " + adv.summary.slice(0, 200));
  console.log("  bal summary: " + bal.summary.slice(0, 200));
'
```

Expected: `adversarial tone PASS: matched red-team signal` followed by the two summaries.

**If FAIL:**
- Re-read `plugins/kimi/prompts/adversarial-review.md` §operating_stance + §ADVERSARIAL_STANCE_RULES block. The stance rules added in Task 5.3 are the load-bearing anti-dialectical guards; if they've been edited away or softened, restore them.
- Up to 2 more runs allowed to rule out model-nondeterminism. If 2 of 3 fail, treat as prompt-tuning incomplete and escalate (do not mask by relaxing the regex).

- [ ] **Step 5: Verify empty-diff fast path still works**

```bash
cd /tmp/kimi-t9-test
git add . && git commit -q -m "accept diff"
node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs adversarial-review | node -e '
  const d = JSON.parse(require("fs").readFileSync(0,"utf8"));
  if (d.verdict === "no_changes" && d.ok) console.log("empty-diff PASS");
  else { console.error("FAIL:", d); process.exit(1); }
'
```

Expected: `empty-diff PASS`.

- [ ] **Step 6: Commit Task 5.6 (no code changes; marker commit optional)**

Task 5.6 is validation only. Skip the commit unless debug logs or ad-hoc fixes surfaced during testing — those ride on a separate commit before moving to Task 5.7.

---

## Task 5.7: Finalize `kimi-prompting` skill — 3 references + SKILL.md

**Files:**
- Create: `plugins/kimi/skills/kimi-prompting/references/kimi-prompt-recipes.md`
- Create: `plugins/kimi/skills/kimi-prompting/references/kimi-prompt-antipatterns.md`
- Create: `plugins/kimi/skills/kimi-prompting/references/prompt-blocks.md`
- Modify: `plugins/kimi/skills/kimi-prompting/SKILL.md` (drop "skeleton" language, link references)

Replace the Phase-1 placeholders with real content grounded in Phase 2–4 observations (Chinese severity leak, markdown-fence prose, session-resume hints).

- [ ] **Step 1: Write `kimi-prompt-recipes.md`**

Create `plugins/kimi/skills/kimi-prompting/references/kimi-prompt-recipes.md`:

```markdown
# Kimi Prompt Recipes

Starting templates for Kimi task prompts, grounded in Phase 2–4 observations
with `kimi -p "…" --print --output-format stream-json`. Copy the smallest
recipe that fits; trim anything unused.

## Ask (one-shot Q&A)

Default for `/kimi:ask`. Single-turn bias, no tool-use expectation.

```xml
<task>
Answer the following question using only the information provided.
Be concrete; do not hedge unless uncertainty is material.
</task>

<compact_output_contract>
Return a direct answer in under 6 sentences.
If the question admits multiple valid answers, list them numbered; otherwise give one.
Do not prefix the answer with "好的" / "Here's the answer" / "Sure".
</compact_output_contract>

<question>
[user's literal prompt goes here]
</question>
```

## Review (balanced diff review)

Used by `buildReviewPrompt` in `kimi.mjs`. The strict-output rules block is
load-bearing — see `kimi-prompt-antipatterns.md` for why each line exists.

```xml
<task>
You are reviewing code changes. Return your review as a single JSON object
matching the schema below.
</task>

<output_contract>
Return ONLY the JSON object. No markdown code fence. No prose before or after.
severity MUST be critical|high|medium|low — do NOT translate to Chinese.
verdict MUST be approve or needs-attention.
Fill ALL required fields per finding, or omit the finding entirely.
</output_contract>

<schema>
{{REVIEW_SCHEMA}}
</schema>

<repository_context>
{{REVIEW_INPUT}}
</repository_context>
```

## Adversarial Review (red-team)

Used by `buildAdversarialPrompt` via `prompts/adversarial-review.md`. Reuses
the balanced review's schema but flips the operating stance.

```xml
<role>
You are performing an adversarial software review.
Your job is to break confidence in the change, not to validate it.
</role>

<operating_stance>
Default to skepticism. Do not give credit for good intent or likely follow-up work.
If something only works on the happy path, treat that as a real weakness.
</operating_stance>

<attack_surface>
Prioritize: auth/trust boundaries, data loss, rollback safety, race conditions,
empty-state/null/timeout, schema drift, observability gaps.
</attack_surface>

<output_contract>
[same strict JSON rules as Review recipe]
</output_contract>
```

## Rescue (multi-step delegated task)

Used by `/kimi:rescue` → `kimi-agent` → companion `task` subcommand. Kimi
can tool-loop here; allow a larger `--max-steps-per-turn` than Ask.

```xml
<task>
Complete the following task in the current repository. Work step by step.
Stop only when the task is fully resolved or a blocking unknown is reached.
</task>

<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check for follow-on fixes, edge cases, or cleanup before declaring done.
</completeness_contract>

<verification_loop>
Before finalizing, verify the result against the task requirements and the
changed files or tool outputs.
If a check fails, revise the answer instead of reporting the first draft.
</verification_loop>

<action_safety>
Keep changes tightly scoped.
Call out risky or irreversible actions before taking them.
</action_safety>

<user_task>
[user's literal prompt goes here]
</user_task>
```

## Long-document summarization

Kimi's larger-context models (Moonshot v1-128k / v1-1m) accept long inputs
well. State the summary shape explicitly — kimi defaults to discursive prose.

```xml
<task>
Summarize the provided document(s) focused on: {{FOCUS}}.
Keep the summary faithful to source; do not extrapolate.
</task>

<compact_output_contract>
Return:
1. key points (bulleted, ≤ 10 items)
2. notable tensions or open questions (bulleted, ≤ 5 items)
3. one-sentence overall takeaway
Do not prefix with "好的" / "Here's the summary".
</compact_output_contract>

<document>
{{DOCUMENT_TEXT}}
</document>
```
```

- [ ] **Step 2: Write `kimi-prompt-antipatterns.md`**

Create `plugins/kimi/skills/kimi-prompting/references/kimi-prompt-antipatterns.md`:

```markdown
# Kimi Prompt Anti-Patterns

Patterns observed to fail empirically during `kimi-plugin-cc` Phase 2–4.
Each entry documents: observed failure → why it happened → what to do instead.

## 1. "Please return JSON." without strict rules

**Observed:** During Phase 3 T5 dry runs, kimi wrapped its JSON output in a
markdown fence roughly 1 run in 4, and prefixed with `好的，这是 JSON：`
roughly 1 run in 6. Both forms break `JSON.parse` on the raw response.

**Fix:** Explicit strict-output rules (`kimi-prompt-recipes.md` Review
section). Include: "No markdown code fence. No prose before. No prose after."
Restate these as negative examples — kimi treats positive-only instructions
as soft. See `buildReviewPrompt` in `plugins/kimi/scripts/lib/kimi.mjs`.

## 2. "severity must be critical/high/medium/low"

**Observed:** Phase 3 validation surfaced `"严重"` / `"高"` / `"中"` / `"低"`
in kimi output when the prompt didn't block translation. Kimi's Chinese
prior over-translates even enum values.

**Fix:** Say "the EXACT English strings" and list them verbatim. Add a
schema-validator guard that rejects translated values so parse-layer errors
fire before the render layer sees them (we do this in `validateReviewOutput`).

## 3. Expecting session-resume to carry arbitrary state

**Observed:** Kimi's `--resume <id>` reattaches to a session but behavior
varies by model and context-window settings. In Phase 2 T7 we observed kimi
genuinely recall a short string ("4242") across resume; in Phase 4 multi-turn
rescue tests it sometimes forgot intermediate tool calls.

**Fix:** Do not assume prior-turn tool outputs survive. If a later turn
needs a fact from an earlier turn, restate it explicitly in the new prompt.
Use resume only for "keep the same model personality" — not "remember
everything".

## 4. Tool-use expectations in simple Q&A

**Observed:** Without `--max-steps-per-turn`, a simple `/kimi:ask "what time
is it?"` burned 6 steps before giving up (kimi tried to invoke a shell tool
to check, then filesystem, then web fetch).

**Fix:** `/kimi:ask` pins `PING_MAX_STEPS = 1` at the probe level and avoids
tool-capable system text in the prompt. Use tool-heavy prompts only for
`/kimi:rescue --write` (which allows a higher step budget).

## 5. Chinese prompt + English enforcement language

**Observed:** Phase 4 `/kimi:rescue` tests showed kimi switching output
language unpredictably when the body was Chinese but the output contract
was English. Output sometimes came back in Chinese, sometimes English,
sometimes mixed.

**Fix:** Match the meta-language to the body language. If the user's prompt
is Chinese, write the `<output_contract>` in Chinese too. The content of
the contract (strict JSON rules, schema, enum lists) can stay English
since JSON keywords are language-neutral.

## 6. Asking Kimi to "think harder" without a thinking block

**Observed:** Prompts like "think carefully" or "reason step by step" in
plain text produced marginal quality gains — kimi emitted the reasoning
as `content[].type === "think"` blocks and then a terse answer. The
`think` blocks are dropped by default in `extractAssistantText`
(`kimi-result-handling` skill), so the extra reasoning went unused on the
render side.

**Fix:** Either render the `think` blocks explicitly (planned v0.2
`--show-thinking` flag), or drop the "think step by step" cue if the
answer is what you want. Do not conflate "kimi thought about it" with
"kimi communicated its reasoning".

## 7. Large prompt via `-p "$(cat file)"` on kimi 1.36

**Observed:** kimi 1.36 rejects `-p ""` with a usage error box; large
prompt delivery via stdin uses `--input-format text` + piped input, NOT
`-p ""`.

**Fix:** Use `callKimi`'s built-in large-prompt branch (`LARGE_PROMPT_
THRESHOLD_BYTES = 100_000`) which routes to stdin automatically. Never
hand-construct `kimi -p ""` in a prompt template or shell recipe.

## 8. Hallucinating `"no_changes"` as a valid verdict

**Observed during plan review:** Without an explicit ban, LLMs
(including kimi) may emit `{"verdict": "no_changes", ...}` when they
interpret a small-but-non-empty diff as "nothing material to say". The
companion-side fast path for an empty diff ALSO uses `verdict:
"no_changes"` — but it's emitted by the companion (`runReview`
/`runAdversarialReview`), not by the LLM. When the LLM produces this
verdict, `validateReviewOutput` rightly rejects it and the review
appears to fail schema validation.

**Fix:** Every review prompt must say: `verdict MUST be: approve or
needs-attention (never "no_changes" — that is a companion-only fast
path for empty diffs).` Both `buildReviewPrompt` and
`buildAdversarialPrompt` include this line; `validateReviewOutput`
enforces the enum. Do not relax the schema to accept `"no_changes"`
from the LLM — the split contract is intentional.
```

- [ ] **Step 3: Write `prompt-blocks.md`**

Create `plugins/kimi/skills/kimi-prompting/references/prompt-blocks.md`:

```markdown
# Prompt Blocks

Reusable XML-tagged blocks for composing Kimi prompts. Mix and match; wrap
each block in the tag shown in its heading.

## Core Wrapper

### `task`

Use in nearly every prompt.

```xml
<task>
Describe the concrete job, the relevant repository or failure context, and the
expected end state.
</task>
```

## Output and Format

### `output_contract`

Use when the response shape is schema-bound (review / adversarial-review).
Kimi's JSON compliance is empirically uneven — every negative rule here
addresses a real failure observed in Phase 3 T5 dry runs.

```xml
<output_contract>
Return ONLY the JSON object matching the schema below.
No markdown code fence around the object (no ```json … ```).
No prose before (no "好的" / "Here is" / "This review").
No prose after (no "让我知道" / "Let me know").
Use EXACT English severity strings: critical, high, medium, low.
Do NOT translate severity to Chinese.
</output_contract>
```

### `compact_output_contract`

Use when you want concise prose instead of a schema.

```xml
<compact_output_contract>
Keep the answer compact and structured.
Put the highest-value finding or decision first.
No long scene-setting or repeated recap.
</compact_output_contract>
```

## Follow-through and Completion

### `completeness_contract`

Use for `/kimi:rescue` / multi-step work.

```xml
<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check for follow-on fixes, edge cases, or cleanup before declaring done.
</completeness_contract>
```

### `verification_loop`

Use when correctness matters.

```xml
<verification_loop>
Before finalizing, verify the result against the task requirements and the
changed files or tool outputs.
If a check fails, revise the answer instead of reporting the first draft.
</verification_loop>
```

## Grounding and Safety

### `grounding_rules`

Use for review, research, or root-cause analysis.

```xml
<grounding_rules>
Ground every claim in the provided context or your tool outputs.
Do not present inferences as facts.
If a point is a hypothesis, label it clearly.
</grounding_rules>
```

### `action_safety`

Use for write-capable tasks (`/kimi:rescue`).

```xml
<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless required for correctness.
Call out risky or irreversible actions before taking them.
</action_safety>
```

## Task-Specific Blocks

### `attack_surface`

Use in adversarial review.

```xml
<attack_surface>
Prioritize failures that are expensive, dangerous, or hard to detect:
- auth, permissions, tenant isolation, and trust boundaries
- data loss, corruption, duplication, and irreversible state changes
- rollback safety, retries, partial failure, and idempotency gaps
- race conditions, ordering assumptions, stale state, and re-entrancy
- empty-state, null, timeout, and degraded dependency behavior
- version skew, schema drift, migration hazards, and compatibility regressions
- observability gaps that would hide failure or make recovery harder
</attack_surface>
```

### `finding_bar`

Use in any review.

```xml
<finding_bar>
Report only material findings.
Do not include style feedback, naming feedback, low-value cleanup, or
speculative concerns without evidence.
A finding should answer:
1. What can go wrong?
2. Why is this code path vulnerable?
3. What is the likely impact?
4. What concrete change would reduce the risk?
</finding_bar>
```

### `research_mode`

Use for exploration, comparisons, or recommendations.

```xml
<research_mode>
Separate observed facts, reasoned inferences, and open questions.
Prefer breadth first, then go deeper only where the evidence changes the
recommendation.
</research_mode>
```
```

- [ ] **Step 4: Update `SKILL.md` to drop skeleton language and link references**

Replace the entire `plugins/kimi/skills/kimi-prompting/SKILL.md` file with:

```markdown
---
name: kimi-prompting
description: Internal guidance for composing Kimi CLI prompts for coding, review, diagnosis, and research tasks
---

# kimi-prompting

Internal skill consumed by `kimi-agent` and by the command files before
dispatching to `kimi-companion.mjs`. Not user-invocable.

## Scope

Guidance for Claude when composing a prompt to send to Kimi. Covers task
framing, output contracts, and the empirically-calibrated strict rules
that keep kimi's JSON output parseable.

## Universal rules

1. **Output contract first.** State the expected output format in the first
   paragraph of any task prompt. For JSON responses, explicitly say:
   "Return ONLY a JSON object matching this schema. No prose before or after.
   No markdown code fence." — positive-only instructions are treated as soft
   by kimi; include negative forms.
2. **Context in a labeled block.** When passing code / diff / docs, wrap in
   a clearly labeled XML-tagged section (`<repository_context>` /
   `<document>` / `<diff>`).
3. **Language parity.** Kimi's Chinese-language reasoning is strong. If the
   user prompt is Chinese, keep the meta-language (task framing, contracts)
   in Chinese too. JSON keyword enforcement stays English.
4. **Small `--max-steps-per-turn` on simple Q&A.** For `/kimi:ask`, a small
   N (1–3) prevents runaway tool-use loops. For `/kimi:rescue`, allow larger.
5. **No tool-call expectation in Ask.** Bias toward single-turn answers.

## References

- [Recipes](references/kimi-prompt-recipes.md) — starting templates for ask / review / adversarial-review / rescue / summarization
- [Anti-patterns](references/kimi-prompt-antipatterns.md) — observed failure modes from Phase 2–4 and the fixes that worked
- [Prompt blocks](references/prompt-blocks.md) — reusable XML-tagged blocks (task / output_contract / completeness_contract / grounding_rules / attack_surface / …)

## When to invoke this skill

Any time Claude constructs a new prompt string to pass to Kimi through
`kimi-companion.mjs` (whether via `/kimi:ask`, `/kimi:rescue`, or inside
the `kimi-agent` subagent). Especially needed when the prompt is user-
generated raw text rather than one of the packaged templates in
`plugins/kimi/prompts/`.
```

- [ ] **Step 5: Sanity check all 4 files parse as valid markdown (no broken frontmatter)**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
for f in plugins/kimi/skills/kimi-prompting/SKILL.md plugins/kimi/skills/kimi-prompting/references/*.md; do
  echo "=== $f ==="
  head -3 "$f"
  echo
done
```

Expected: `SKILL.md` first 3 lines are `---`, `name: kimi-prompting`, `description: …`. Reference files start with `# Title`. No blank-first-line files.

- [ ] **Step 6: Commit Task 5.7**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add plugins/kimi/skills/kimi-prompting/
git commit -q -m "feat(skill): kimi-prompting references (recipes + antipatterns + blocks) + SKILL.md finalized"
```

---

## Task 5.8: Write `lessons.md` at repo root

**Files:**
- Create: `/Users/bing/-Code-/kimi-plugin-cc/lessons.md`

This file is load-bearing for the next sibling plugin (minimax-plugin-cc). Sections A–H per spec §6.2. Fill with real content from Phase 0–4.

- [ ] **Step 1: Write `lessons.md`**

Create `lessons.md` at the repo root (`/Users/bing/-Code-/kimi-plugin-cc/lessons.md`):

```markdown
# Lessons: gemini-plugin-cc → kimi-plugin-cc manual migration

Captured during v0.1 build (2026-04-20 through phase-5-final).

This file is load-bearing for the next sibling plugin in the series
(`minimax-plugin-cc` / `qwen-plugin-cc` / `doubao-plugin-cc`). Read it
before writing any phase-0 probe — most of these lessons generalize.

## A. Naming substitution rules (mechanical)

When porting from the template source plugin, apply these rules globally:

| template source | target plugin |
|---|---|
| `gemini` / `Gemini` | `<llm>` / `<Llm>` |
| `~/.gemini/` | `~/.<llm>/` |
| `GEMINI_COMPANION_SESSION_ID` | `<LLM>_COMPANION_SESSION_ID` |
| `gemini-companion.mjs` | `<llm>-companion.mjs` |
| `gemini-agent` | `<llm>-agent` |
| `/gemini:*` | `/<llm>:*` |
| `~/.claude/plugins/gemini/` | `~/.claude/plugins/<llm>/` |
| `callGemini` / `callGeminiStreaming` | `call<Llm>` / `call<Llm>Streaming` |
| `geminiSessionId` | `<llm>SessionId` |

Rule: if you can `sed` it safely (no false positives), do. But re-read the
file after. In Phase 4 we almost missed `|| "ga"` → `|| "ka"` because the
rename wasn't obvious.

## B. Must-rewrite-from-scratch (do not copy)

These 9 files encode provider-specific behavior. Copying them is worse
than starting blank because the copy masks real differences.

1. `scripts/lib/<llm>.mjs` — CLI spawn + parsing + session-ID extraction + model config + errors
2. `commands/setup.md` — install path (npm / pipx / uv / shell), auth probe
3. `commands/review.md` — render rules + truncation/retry-notice handling
4. `prompts/stop-review-gate.md` — ALLOW/BLOCK sentinel expectations
5. `prompts/adversarial-review.md` — attack-surface list varies by model strengths
6. `skills/<llm>-prompting/` — entire directory (recipes, antipatterns, blocks)
7. `skills/<llm>-cli-runtime/SKILL.md` — exit-code table, event taxonomy, constants
8. `skills/<llm>-result-handling/SKILL.md` — render policy (think blocks / Chinese prose / divergence markers)
9. `agents/<llm>-agent.md` — routing flags, tool allowlist, context window size

## C. Almost-pure-copy (≤ 10% changes)

These 8 files are infrastructure that ported mechanically. Still read them
once, still apply naming substitutions, but no substantive rewrite needed.

1. `scripts/lib/args.mjs` — argparse
2. `scripts/lib/git.mjs` — diff/scope collection (Phase 3 added `isEmptyContext` helper)
3. `scripts/lib/process.mjs` — spawn helpers with signal handling
4. `scripts/lib/render.mjs` — text output formatting
5. `scripts/lib/state.mjs` — per-workspace JSON state (path constant changes)
6. `scripts/lib/prompts.mjs` — template loader (14 lines, byte-identical)
7. `scripts/lib/job-control.mjs` — background-job machinery (replace `callGeminiStreaming` binding + rewrite the `onEvent` callback for the new event taxonomy; otherwise identical)
8. `scripts/lib/review.mjs` *(new in Phase 5)* — review parse/validate/retry orchestrator. Fully provider-agnostic; minimax-plugin-cc can import verbatim.
9. `schemas/review-output.schema.json` — output contract; update the
   `verdict` enum and severity enum only if the new LLM emits different categories.

## D. Real pits (appended live across Phase 0–4)

### Pit 1: `kimi -V` is uppercase; `-v` is verbose

Lowercase `-v` silently enables verbose mode on live calls. Use `-V` for
version probe. The CLI's own docs used `-V` but one example in a
community post used `-v`; check with `--help` first.

### Pit 2: `kimi -p ""` rejected on kimi 1.36

Stdin path for large prompts is `--input-format text` + piped input, NOT
`-p ""`. Probe-01 initially claimed `-p ""` worked; Phase 2 T2 empirical
test failed with a Click usage error box. Codex review (C1) caught it.

### Pit 3: `session_id` lives on stderr, not stdout

`--output-format stream-json` emits assistant/tool events on stdout but
the `kimi -r <uuid>` resume hint is on stderr, via
`_print_resume_hint → _emit_fatal_error`. Consumers that do `2>/dev/null`
lose session-id primary path and must fall back to
`~/.kimi/kimi.json → work_dirs[].last_session_id`.

### Pit 4: `work_dirs[].path` is verbatim, not realpath'd

In Phase 2 we thought `/tmp/x` vs `/private/tmp/x` would be normalized.
It isn't — kimi stores whatever string was passed via `-w`. Solution:
plugin code always calls `fs.realpathSync(cwd)` before spawning kimi and
compares the same value when reading `kimi.json`.

### Pit 5: `(none)` skeleton defeats naive empty-diff checks

`collectReviewContext` always emits the section heading even on a clean
tree, with `(none)` as the body. A plain `!content.trim()` check never
fires. Fix: `isEmptyContext()` helper in `git.mjs` strips the skeleton
before the check.

### Pit 6: Load-bearing UX strings in markdown rules get dropped on long outputs

Phase 3 `review.md` said "if truncated, warn prominently at the top" and
"if retry used, add a footnote at the end". On 15+ finding lists the
warning and footnote went missing. Fix: promote to JSON fields
(`truncation_notice` / `retry_notice` prefilled strings) + simple
"render <field> VERBATIM" directives.

### Pit 7: `status ?? 0` collapses signal kills

`spawn` with `signal === "SIGINT"` and `status === null` must map to 130,
not 0. Phase 2 codex C1 caught the signal-to-status mapper missing.

### Pit 8: Kimi genuinely remembers small facts across resume

Phase 4 T7: `/kimi:task "remember 4242"` then `task --resume-last "what
number?"` → kimi answered "4242". Not just session-ID plumbing; real
model recall. But don't rely on it for large multi-step state — see
`kimi-prompt-antipatterns.md` pit 3.

### Pit 9: Severity enum leaks into Chinese

Kimi translates `"severity": "critical"` → `"severity": "严重"` unless
explicitly blocked. Schema validator catches it; prompt should too.

### Pit 10: SessionStart hook 5s timeout was too aggressive

First-cold-start SessionStart lifecycle hook hit the timeout on a
warm-boot laptop. Bumped to 15s. Subsequent runs cache the env-write and
finish in <1s.

## E. CLI-integration checklist (mechanical — run before Phase 0 on next plugin)

For each item, open a probe script in `doc/probe/` and commit the result
to `probe-results.json`.

- [ ] Target CLI supports headless `-p <prompt>` / `--print`?
- [ ] JSON structured output? Flag name? Event taxonomy? Per-token, per-message, or per-turn granularity?
- [ ] `session_id` delivery path — stdout event / stderr hint / local metadata file? Does `--quiet` suppress any of them?
- [ ] `stats` / token-usage available? If dropped by printer, source-read to confirm.
- [ ] Install method — npm / pip / pipx / uv / shell-installer / brew? Post-install PATH issues?
- [ ] Auth — OAuth / API key / local credentials file? Cheapest "am I logged in?" probe?
- [ ] Config file format — JSON / TOML / YAML / custom? Any multi-file layering?
- [ ] Directory layout under `~/.<tool>/`?
- [ ] Exit-code taxonomy — Click usage=2, signal=130/143, in-band config error?
- [ ] Large-prompt delivery — `-p` accepts stdin or empty-string trick? Temp-file fallback needed?
- [ ] `--max-steps-per-turn` or equivalent step budget? Cheapest N that still ping-returns?
- [ ] Session-ID exchange under `--resume` — does session recall actually work or is it just ID plumbing?

## F. LLM-behavior checklist (the "soul" — grounds the prompt-design skill)

These surface only via live prompt experimentation. Allocate Phase 0.5 or
Phase 2 dry runs for them.

- [ ] JSON-output compliance — markdown-fence leaks? Prose preamble? Severity enum translation?
- [ ] Context-window effective utilization — quality cliff at what fraction of claimed window?
- [ ] Rate limits — RPM / TPM / concurrent session cap?
- [ ] Chinese-vs-English prompt → output language switching. Meta-language matching rule (lessons D9).
- [ ] Tool-call propensity on simple Q&A — does `max-steps=1` starve a routine probe?
- [ ] Reasoning-chain / thinking-block trigger conditions + cost.
- [ ] "Can't do it" expressions — apologetic refusal / empty string / structured error / null field?

## G. Decision-fork log (cross-AI review留痕)

Every spec-level or plan-level 3-way review produces accept / reject /
partial-accept entries. Append them here.

### Spec v0.1 (2026-04-20)

- **Accept (codex):** stream-json is native, not synthesized. UTF-8
  StringDecoder mandatory at stdio boundary.
- **Accept (codex):** session-ID via stderr regex + `kimi.json.work_dirs`
  fallback; reject global snapshot diff.
- **Accept (gemini):** skill scaffolds front-load to Phase 1/2, not
  Phase 5.
- **Accept (gemini):** re-scope to include 1-shot retry on review JSON
  parse.
- **Reject (gemini):** MVP-3 command restriction. Full parity preserved.
- **Reject (gemini):** CHANGELOG lock / rollback consensus. Over-eng for
  v0.1.

### Phase 3 plan (2026-04-20)

- **Accept (codex C-H1/H2):** per-finding required-field validator +
  schema-load try/catch before prompt build.
- **Accept (codex C-M1):** reject multiple top-level JSON values in
  extract.
- **Accept (gemini G-H1/2/3):** `isEmptyContext` helper + truncation/
  retry notices as JSON fields.

### Phase 4 plan (2026-04-20)

- **Accept (codex C-M1):** `anySession` pushed into `resolveCancelableJob`
  lib option.
- **Accept (gemini G-C1):** stop-gate scanner reads all lines, not
  strict-first.
- **Accept (gemini G-C2):** SessionStart timeout 5s → 15s.
- **Accept (gemini G-H1):** escape-hatch stderr note on review-gate
  enable.
- **Reject (gemini G-H2/M1/M2):** over-specification for v0.1.

## H. API behavior contract pits (cross-provider)

The systematic "CLI docs say one thing, actual behavior says another"
surface. Run this checklist on every new provider before writing a plan.

**Claude Code side (not provider CLI, but same surface):**
- [ ] `claude plugins install` accepts only `<plugin>@<marketplace>`, not
      a filesystem path. Dev install = `claude plugins marketplace add
      <path>` first, then `install <plugin>@<marketplace>`.

**Provider CLI side:**
- [ ] Streaming granularity — per-token / per-message / per-turn? Verify
      by inducing SIGTERM midstream and reading residual stdout.
- [ ] Content block structure — string vs typed-block list? Known
      `type` values? Unknown-type policy?
- [ ] Session-ID delivery channels + which survive `--quiet` / CI /
      non-TTY.
- [ ] Stats (token usage) — in printed events? Internal only? Which
      flag exposes?
- [ ] Path storage normalization — verbatim / absolute / symlink-resolved?
      `/tmp` vs `/private/tmp` pitfall.
- [ ] Signal handling — SIGINT / SIGTERM / SIGKILL behavior; graceful
      flush? Partial stdout recovery?
- [ ] Invalid-model reaction — instant reject vs runtime exception with
      a session artifact left behind.
- [ ] Tool-result event shape — same event channel as assistant or
      separate `role: "tool"`?
- [ ] Auth-probe minimal cost — is there a `max-steps=1` or equivalent
      zero-work ping?
- [ ] Upsert semantics — CLI creates `~/.<tool>/…` on first call or
      caller must `mkdir -p`?
- [ ] Resume-session scope — rehydrates full history / only last turn /
      only session-ID plumbing?

## Appendix I: Kimi's actual checklist answers (gemini Phase-5-plan G5)

Sections E and F above are blank checklists for the *next* sibling plugin
to fill in. This appendix records the answers Kimi's own Phase 0–4 probes
produced, so future readers can see concrete examples of what "answering
the checklist" looks like.

### E answers (CLI-integration)

| Question | Kimi 1.36 answer |
|---|---|
| Headless `-p`? | Yes: `kimi -p "<prompt>" --print --output-format stream-json`. Empty `-p ""` rejected; use `--input-format text` + stdin. |
| JSON output taxonomy | Per-turn JSONL (one event per fully-emitted message); no typed `init`/`message`/`result` envelope — role-based (`{role:"assistant",content:[blocks]}` / `{role:"tool",...}`). |
| `session_id` delivery | Primary: stderr regex `/kimi -r ([0-9a-f-]{36})/` (not suppressed by `--quiet`). Secondary: `~/.kimi/kimi.json.work_dirs[].last_session_id` keyed by verbatim `-w` path. |
| Stats availability | Token usage internally tracked but `JsonPrinter` drops via `case _: pass`. No flag exposes it; v0.1 renders nothing. |
| Install method | Official: shell installer script. Alt: `uv tool install --python 3.13 kimi-cli` (explicit Python pin avoids 3.12/3.11 mismatch). Fallback: `pipx install kimi-cli` (PATH may not auto-resolve). |
| Auth | `~/.kimi/credentials/` non-empty + ping-call success. `kimi login` is interactive only — `/kimi:setup` cannot automate. |
| Config format | TOML (`~/.kimi/config.toml`); top-level key `default_model`. |
| Directory layout | `~/.kimi/{config.toml, kimi.json, credentials/, sessions/<md5(path)>/<uuid>/, logs/}` — sessions is TWO-LEVEL (work_dir hash / session uuid). |
| Exit codes | 0 OK, 1 LLM-not-set, 2 Click usage error (Unicode boxed stderr), 130 SIGINT, 143 SIGTERM. |
| Large-prompt path | `--input-format text` + piped stdin. `LARGE_PROMPT_THRESHOLD_BYTES = 100_000`. |
| `--max-steps-per-turn` | `PING_MAX_STEPS = 1` works for ping. Rescue uses default (unbounded / kimi-controlled). |
| Session recall under `--resume` | Real (not just plumbing). T7 confirmed kimi remembered "4242" across resume. Caveat: multi-step tool state is unreliable. |

### F answers (LLM-behavior)

| Question | Kimi v1-128k answer |
|---|---|
| JSON compliance | Weak. Markdown fence ~25% of raw runs; `好的，这是 JSON：` preamble ~15%; severity enum translation to Chinese ~35% without explicit ban. Strict negative rules + schema validator catch all three. |
| Context window effective use | Not empirically bounded in v0.1. Observed good quality up to ~50K prompt. Future probes should test 128K ceiling. |
| Rate limits | Not observed during v0.1 probes (single-caller, low volume). |
| Chinese/English switch | Meta-language matching rule: if user prompt is Chinese, meta-language (task framing, contracts) should be Chinese. JSON keyword enforcement stays English. Mismatch causes unpredictable output language. |
| Tool-call propensity | High. Ping without `--max-steps-per-turn 1` burns 5–6 steps before giving up. |
| Reasoning chain | Emitted as `content[].type === "think"` blocks; dropped by default extractor. `think` blocks observed especially on review tasks. |
| Refusal expression | Terse apologetic Chinese prose ("抱歉，我无法..."). Does not produce structured error. Treat as "low-confidence finding" rather than hard fail. |

## Appendix II: Phase tag map

| Tag | Commit | Summary |
|---|---|---|
| `phase-0-final` | 18276a0 | Probes 01-06 done; probe-results.json v3 authoritative |
| `phase-1-skeleton` | 23f625f | Repo skeleton; `/kimi:setup` passes via marketplace install |
| `phase-2-ask` | b5ed35f | `/kimi:ask` + streaming; T2/T3/T4 PASS |
| `phase-2-polish` | cc71b7c | 3-way review integrated (codex C1/H1/H2 + gemini G-C1/H1/H3) |
| `phase-3-review` | ff1fc69 | `/kimi:review` + 1-shot retry; T5 PASS |
| `phase-3-polish` | 3a8af73 | Post-review polish (codex C-H1/L1 + gemini G-H1/H2/H3/M2/M3) |
| `phase-4-background` | 52f1091 | `/kimi:rescue` + background + agent + hooks; T6/T7 PASS |
| `phase-4-polish` | 75ae5fe | Post-review polish (codex C-M1 + gemini G-H1) |
| `phase-5-final` | (set by Task 5.10) | Adversarial-review + review.mjs extraction + skill + lessons.md + phase-1-template; T9 + T5-regate PASS; v0.1 frozen |
```

- [ ] **Step 2: Spot-check size and all 8 sections present**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
wc -l lessons.md
grep -E "^## [A-H]\." lessons.md | sort
```

Expected: wc-l output shows ~280–320 lines; grep shows lines `## A.` through `## H.` (8 top-level sections, sorted alphabetical).

- [ ] **Step 3: Commit Task 5.8**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add lessons.md
git commit -q -m "docs: lessons.md sections A-H from Phase 0-4 real experience"
```

---

## Task 5.9: Extract `docs/superpowers/templates/phase-1-template.md`

**Files:**
- Create: `docs/superpowers/templates/phase-1-template.md`

Closes spec §6.2 "模板沉淀" (gemini Phase-5-plan G1). The template parameterizes Phase 1's repo-init + 5 near-copy lib tasks (original Task 1.1–1.6 in `docs/superpowers/plans/2026-04-20-phase-1-skeleton.md`) over `<llm>` — minimax/qwen/doubao plugin authors can fork this template, substitute their provider name, and have a working Phase-1 starter in minutes instead of re-reading the full kimi Phase-1 plan.

This is a doc-extraction task: read the existing Phase-1 plan, hoist the mechanical scaffold into a placeholder-parameterized form, keep the provider-specific cuts behind clearly-labeled `{{LLM}}` / `{{LLM_CAP}}` / `{{LLM_CLI_INSTALL}}` markers.

- [ ] **Step 1: Read the source Phase-1 plan**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
wc -l docs/superpowers/plans/2026-04-20-phase-1-skeleton.md
grep -nE "^## Task 1\.[1-6]" docs/superpowers/plans/2026-04-20-phase-1-skeleton.md
```

Record the Task 1.1–1.6 start lines. You'll lift those sections verbatim, then substitute provider tokens.

- [ ] **Step 2: Ensure the templates directory exists**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
mkdir -p docs/superpowers/templates
```

- [ ] **Step 3: Write `docs/superpowers/templates/phase-1-template.md`**

Create the file with this outer scaffold; fill the `## Task T.N` bodies by lifting from the kimi Phase-1 plan with these substitutions:

| Token in template | Fill when instantiating |
|---|---|
| `{{LLM}}` | lowercase plugin name (e.g. `minimax`) |
| `{{LLM_CAP}}` | capitalized name (e.g. `MiniMax`) |
| `{{LLM_CLI}}` | CLI binary name (e.g. `minimax`) |
| `{{LLM_CLI_INSTALL}}` | shell installer / `uv tool install --python 3.N <pkg>` / `pipx install <pkg>` / `npm install -g <pkg>` |
| `{{LLM_SESSION_ENV}}` | `<LLM>_COMPANION_SESSION_ID` |
| `{{LLM_STATE_DIR}}` | `~/.claude/plugins/<llm>/` |
| `{{LLM_HOME_DIR}}` | `~/.<llm>/` |
| `{{PROBE_RESULTS_PATH}}` | `doc/probe/probe-results.json` (per repo convention) |

```markdown
# {{LLM}}-plugin-cc Phase 1 Skeleton Implementation Template

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to instantiate this template into a concrete Phase-1 plan for your provider, then execute task-by-task.
> **Instantiation workflow:**
> 1. Copy this file to `docs/superpowers/plans/YYYY-MM-DD-phase-1-skeleton.md` in the NEW plugin's repo.
> 2. Global find-and-replace all `{{…}}` placeholders per the substitution table below.
> 3. Run Phase 0 probes against the target CLI first; amend any section where your provider's reality diverges from Kimi's (e.g. event taxonomy, session-id path, exit codes). Every divergence gets a note in the NEW plugin's `lessons.md` Section D.
>
> **Source:** Derived from `kimi-plugin-cc` Phase 1 plan (2026-04-20). Preserve the 6-task structure unless your Phase 0 probes reveal that a task doesn't apply.

**Goal:** Stand up a minimal Claude Code plugin shell for {{LLM_CAP}} with `/{{LLM}}:setup` passing T1 + T8.

**Architecture:** Mirror `gemini-plugin-cc` / `kimi-plugin-cc` repo layout. Fresh commit per task; keep lib files small + single-responsibility.

**Tech Stack:** Node built-ins only — zero npm deps across the plugin.

**Reference spec:** `docs/superpowers/specs/YYYY-MM-DD-{{LLM}}-plugin-cc-design.md`
**Reference source:** `/Users/bing/-Code-/kimi-plugin-cc/` (use this, not gemini-plugin-cc directly — kimi already contains the cross-provider lessons kimi-plugin-cc accumulated, so ports from kimi avoid re-treading those pits).

## Substitution Table

| Placeholder | Example (minimax-plugin-cc) | Description |
|---|---|---|
| `{{LLM}}` | `minimax` | lowercase plugin name; file-path safe |
| `{{LLM_CAP}}` | `MiniMax` | display name; used in prose |
| `{{LLM_CLI}}` | `minimax` | CLI binary name invoked via spawn |
| `{{LLM_CLI_INSTALL}}` | `pipx install minimax-cli` | install command for `/{{LLM}}:setup` |
| `{{LLM_SESSION_ENV}}` | `MINIMAX_COMPANION_SESSION_ID` | env var for Claude Code session id |
| `{{LLM_STATE_DIR}}` | `~/.claude/plugins/minimax/` | plugin state dir |
| `{{LLM_HOME_DIR}}` | `~/.minimax/` | provider CLI's own home dir |

## Task T.1: Initialize repo + marketplace skeleton

[Lift from kimi Phase-1 Task 1.1, substitute tokens. The mechanical steps (`git init`, `.claude-plugin/marketplace.json`, `plugins/{{LLM}}/plugin.json`, `.gitignore`) are boilerplate.]

## Task T.2: Port `args.mjs` + `process.mjs` near-verbatim

[Lift from kimi Phase-1 Task 1.2. These two files have zero provider-specific content. Copy from kimi-plugin-cc's `plugins/kimi/scripts/lib/args.mjs` + `process.mjs` and rename only module-level `// {{LLM}}-specific` comment lines if present (there shouldn't be any).]

## Task T.3: Port `git.mjs` near-verbatim

[Lift from kimi Phase-1 Task 1.3. Includes `isEmptyContext` helper — do NOT drop it (Phase 3 lesson).]

## Task T.4: Port `state.mjs` with path constant rename

[Lift from kimi Phase-1 Task 1.4. Substitute `kimi` → `{{LLM}}` in the state path constant and timing-history stub filename.]

## Task T.5: Port `render.mjs` near-verbatim

[Lift from kimi Phase-1 Task 1.5.]

## Task T.6: Write `{{LLM}}.mjs` — CLI-specific primitives

[This is NOT a lift. This is the provider-specific file; every sibling plugin writes this from scratch. Include pointers to the kimi.mjs structure as a shape reference (sentinels, parsers, session-id helpers, callXxx, callXxxStreaming) but every body will differ. Reference `lessons.md` Section E (CLI checklist) before starting — those are the 12 questions whose answers shape this file.]

## Exit criteria (all must hold before tag `phase-1-skeleton`)

- Marketplace + plugin.json valid (`claude plugins validate <path>` passes)
- `/{{LLM}}:setup --json` returns `{installed, authenticated, model, version}` on a machine with {{LLM_CLI}} installed + logged-in (T1)
- On a machine without {{LLM_CLI}}, `/{{LLM}}:setup` surfaces the install recommendation with `{{LLM_CLI_INSTALL}}` (T8)
- Git tag `phase-1-skeleton` applied.

## Hand-off to Phase 2

Phase 2 (`ask` + streaming) pins to:
- `callXxx` + `callXxxStreaming` in `{{LLM}}.mjs`
- `/{{LLM}}:ask` command file
- stream-json (or provider equivalent) integration
- T2/T3/T4 gates

Do NOT start Phase 2 until T1+T8 green + `phase-1-skeleton` tagged.
```

Fill each `## Task T.N` body by opening `docs/superpowers/plans/2026-04-20-phase-1-skeleton.md` (in the kimi-plugin-cc repo), copying the corresponding Task 1.N block, and applying the substitution table. Keep the inline code, test commands, and commit hooks. Strip any commentary that's already captured in kimi's own lessons.md Section D (don't duplicate — reference the lesson instead).

- [ ] **Step 4: Verify the template has the expected placeholder tokens**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
grep -oE '\{\{[A-Z_]+\}\}' docs/superpowers/templates/phase-1-template.md | sort -u
```

Expected (all 7 substitution tokens listed in the table):

```
{{LLM}}
{{LLM_CAP}}
{{LLM_CLI}}
{{LLM_CLI_INSTALL}}
{{LLM_HOME_DIR}}
{{LLM_SESSION_ENV}}
{{LLM_STATE_DIR}}
```

If any extra tokens show up, either add them to the substitution table or replace them with a concrete default.

- [ ] **Step 5: Confirm the template has non-trivial body content (not just scaffold)**

```bash
wc -l docs/superpowers/templates/phase-1-template.md
```

Expected: ≥ 400 lines. If the file is under 200 lines, the Task T.1–T.6 bodies were not lifted — re-read Step 3.

- [ ] **Step 6: Commit Task 5.9**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add docs/superpowers/templates/phase-1-template.md
git commit -q -m "docs(template): phase-1-template.md for sibling-plugin Phase-1 authoring"
```

---

## Task 5.10: Final 3-way review + CHANGELOG + tag `phase-5-final`

**Files:**
- Modify: `CHANGELOG.md` (append Phase 5 completion entry)

Per `feedback_3way_review_specs.md`: plans get 2 review rounds by default. The Phase 5 plan review (pre-execution) fires when this document is saved; the impl review (post-execution) fires here. Record outcomes, then tag v0.1.

- [ ] **Step 1: Dispatch post-execution 3-way review in parallel**

Fire two agents in a single message (codex:codex-rescue + gemini:gemini-agent) with this prompt shape:

```
Review the kimi-plugin-cc Phase 5 implementation.

Scope:
- plugins/kimi/scripts/lib/review.mjs (new shared module)
- plugins/kimi/scripts/lib/kimi.mjs (diff: moved extract/validate/error + added buildAdversarialPrompt + callKimiAdversarialReview)
- plugins/kimi/commands/adversarial-review.md (new)
- plugins/kimi/prompts/adversarial-review.md (new)
- plugins/kimi/scripts/kimi-companion.mjs (diff: added runAdversarialReview handler + dispatcher case + USAGE line)
- plugins/kimi/skills/kimi-prompting/{SKILL.md,references/*.md}
- lessons.md (new at repo root)

Plan: docs/superpowers/plans/2026-04-20-phase-5-adversarial-polish.md

Look for:
1. Missing exit-code propagation edges (adversarial-review handler parity with review).
2. Adversarial-review prompt weaknesses that would let kimi soften into balanced prose.
3. review.mjs extraction seams — any leak of kimi-specific text / bindings?
4. lessons.md gaps vs spec §6.2 (sections A–H completeness).
5. Missing guardrails in kimi-prompting references (enforcement vs description).

Report convergent findings separately; per feedback_review_diminishing_returns.md we only do round-2 on convergent unresolved issues.
```

Record convergent findings in a temporary file `doc/review/phase-5-post.md` (not committed to the skill layer).

- [ ] **Step 2: Integrate findings into `phase-5-polish` commit**

For each accepted finding, make the smallest possible fix. Commit with
message `fix: <short>` referencing the finding ID.

For declined findings, document the rationale in the CHANGELOG entry
(Step 4) so later readers see the choice.

- [ ] **Step 3: Non-negotiable T5 + T9 re-gate (gemini Phase-5-plan G7)**

Tasks 5.1 + 5.2 aggressively refactor the core review pipeline. Tag `phase-5-final` is blocked until BOTH commands prove green on a clean diff. Do not rely on T9 alone — the T5 regression surface is exactly where the extraction could leak.

```bash
cd /tmp/kimi-t9-test
# Reset to the post-bug-add state used during Task 5.6 Step 1.
# (If /tmp/kimi-t9-test was cleaned, re-run Task 5.6 Step 1 first.)

# T5: balanced review must return valid schema JSON, verdict in {approve, needs-attention}.
node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs review > review-regate.json 2> review-regate.stderr
node -e '
  const d = JSON.parse(require("fs").readFileSync("/tmp/kimi-t9-test/review-regate.json","utf8"));
  if (!d.ok) { console.error("T5 FAIL: ok=false:", d.error); process.exit(1); }
  if (!["approve","needs-attention"].includes(d.verdict)) { console.error("T5 FAIL: invalid verdict:", d.verdict); process.exit(1); }
  if (!Array.isArray(d.findings)) { console.error("T5 FAIL: findings not array"); process.exit(1); }
  console.log("T5 PASS: verdict="+d.verdict+", findings="+d.findings.length);
' || exit 1

# T9: adversarial review must also return valid schema JSON.
node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs adversarial-review > adversarial-regate.json 2> adversarial-regate.stderr
node -e '
  const d = JSON.parse(require("fs").readFileSync("/tmp/kimi-t9-test/adversarial-regate.json","utf8"));
  if (!d.ok) { console.error("T9 FAIL: ok=false:", d.error); process.exit(1); }
  if (!["approve","needs-attention"].includes(d.verdict)) { console.error("T9 FAIL: invalid verdict:", d.verdict); process.exit(1); }
  console.log("T9 PASS: verdict="+d.verdict+", findings="+d.findings.length);
' || exit 1
```

Expected: both `T5 PASS` and `T9 PASS` print. Any FAIL blocks the tag; debug, fix, re-run — do not tag on a stale green.

- [ ] **Step 4: Append CHANGELOG.md entry**

Prepend to `CHANGELOG.md` (reverse chronological, flat format):

```markdown
## 2026-04-20 phase-5-final [claude-opus-4.7]
- **status**: done
- **scope**: plugins/kimi/scripts/lib/{review.mjs,kimi.mjs}, plugins/kimi/scripts/kimi-companion.mjs, plugins/kimi/commands/adversarial-review.md, plugins/kimi/prompts/adversarial-review.md, plugins/kimi/skills/kimi-prompting/**, lessons.md
- **summary**: Phase 5 closes v0.1. `/kimi:adversarial-review` now live (same JSON schema as `/kimi:review`, red-team prompt stance). Review pipeline extracted into `scripts/lib/review.mjs` (extract/validate/reviewError/runReviewPipeline — provider-agnostic, sibling-plugin-reusable). kimi-prompting skill finalized with 3 references grounded in Phase 2–4 observations. lessons.md captures A-H sections per spec §6.2. T9 PASS: both /kimi:review and /kimi:adversarial-review produce valid schema JSON on a shared 3-line buggy diff. 3-way review convergent findings integrated in `phase-5-polish` commit.
- **next**: v0.1 tag + tag `phase-5-final`. v0.2 backlog: deferred cleanups (codex M1 cwd realpath, codex L1 shape unification, gemini G-C2 E2BIG >1MB, gemini G-M1 thinkBlocks phrasing) + template extraction for minimax-plugin-cc kickoff.
```

- [ ] **Step 5: Tag**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add CHANGELOG.md
git commit -q -m "chore: CHANGELOG for Phase 5 + v0.1 close"
git tag phase-5-final
git tag -l | tail
```

Expected tag list ends with `phase-5-final`.

- [ ] **Step 6: Update memory index**

Update `/Users/bing/.claude/projects/-Users-bing--Code--kimi-plugin-cc/memory/project_current_progress.md`:
- Bump the phase table: add row `phase-5-final` with the Phase 5 commit SHA
- Bump the progress line: "62/85 tasks ≈ 73%" → "72/85 tasks ≈ 85% through v0.1 (Phase 5 done; v0.1 ready to tag)"
- Move the "Ready to execute next" section to reflect v0.1 tag + minimax-plugin-cc kickoff

Update `/Users/bing/.claude/projects/-Users-bing--Code--kimi-plugin-cc/memory/MEMORY.md`:
- Update the `project_current_progress.md` line: `— Phase 0-5 done; v0.1 ready to tag; next is minimax-plugin-cc kickoff`

- [ ] **Step 7: Commit Task 5.10**

(Memory files live outside the repo — no commit needed. The repo commit was Step 5.)

---

## Self-Review

After the full plan is drafted, check these before handing off:

**1. Spec coverage (`docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` §1.2 v0.1 deliverables):**

- 8 commands: setup ✓ (Phase 1) / ask ✓ (Phase 2) / review ✓ (Phase 3) / rescue ✓ (Phase 4) / cancel ✓ (Phase 4) / status ✓ (Phase 4) / result ✓ (Phase 4) / **adversarial-review ✓ (Task 5.5)**
- 3 skills: kimi-cli-runtime ✓ (Phase 1) / **kimi-prompting ✓ (Task 5.7)** / kimi-result-handling ✓ (Phase 3)
- 1 agent ✓ (Phase 4)
- 2 hooks ✓ (Phase 4)
- 1 schema ✓ (Phase 3)
- marketplace ✓ (Phase 1)
- **lessons.md ✓ (Task 5.8)**
- CHANGELOG.md ✓ (Task 5.10)
- **independent git repo ✓** (this repository was initialized at Phase 0; spec §1.2 "独立 git 仓库" satisfied from day 1)
- **phase-1-template.md ✓ (Task 5.9)** — spec §6.2 "模板沉淀" (gemini Phase-5-plan G1)

All items accounted for.

**2. Spec §6.1 T-checklist:**

- T1 (setup probe) — Phase 1 ✓
- T2 (headless ask) — Phase 2 ✓
- T3 (streaming ask) — Phase 2 ✓
- T4 (session-id) — Phase 2 ✓
- T5 (review) — Phase 3 ✓
- T6 (background) — Phase 4 ✓
- T7 (resume) — Phase 4 ✓
- T8 (fresh install) — Phase 1 + live-verified through marketplace install
- **T9 (adversarial) — Task 5.6 ✓**

All covered.

**3. Placeholder scan:** Grep the plan for "TBD", "TODO", "implement later", "fill in details":

```bash
grep -n -E "TBD|TODO|implement later|fill in details|add appropriate|similar to task" docs/superpowers/plans/2026-04-20-phase-5-adversarial-polish.md
```

Expected: zero matches (other than the one `// TODO(Phase 5)` reference in the kimi.mjs-source-quote context, which is the TODO we're *removing*).

**4. Type consistency:**

- `buildAdversarialPrompt({ context, focus, schemaPath, retryHint })` — 4-arg destructure, same shape as `buildReviewPrompt`. ✓
- `callKimiAdversarialReview({ context, focus, schemaPath, model, cwd, timeout, truncated })` — same shape as `callKimiReview`. ✓
- `runReviewPipeline({ buildPrompt, callLLM, context, focus, schemaPath, model, cwd, timeout, truncated, retryWarning })` — provider-agnostic; both wrappers pass through consistently. ✓
- `extractReviewJson(text)` / `validateReviewOutput(data)` / `reviewError({...})` — signatures identical to Phase 3 versions; re-exported from kimi.mjs for back-compat. ✓
- `loadPromptTemplate(rootDir, name)` / `interpolateTemplate(template, variables)` — imported from prompts.mjs unchanged. ✓
- `MAX_REVIEW_DIFF_BYTES = 150_000` / `TRUNCATION_NOTICE` / `RETRY_NOTICE` — same values, re-exported. ✓
- Companion dispatcher case name `"adversarial-review"` matches `commands/adversarial-review.md` argument. ✓

No mismatches.

**5. Execution handoff — chosen: Subagent-Driven with `codex:codex-rescue` as primary implementer.**

Implementer split (decided post pre-execution 3-way review, gemini Phase-5-plan G2):

| Task | Implementer | Rationale |
|---|---|---|
| 5.1 | **codex** | Pure mechanical refactor: move bodies, re-export. Code-transformation task. |
| 5.2 | **codex** | Extract orchestrator with signature preserved; diff-driven. |
| 5.3 | **codex** | Write a prompt template with fixed structure — lift from gemini, apply kimi-strict rules + adversarial stance rules. |
| 5.4 | **codex** | Add 2 functions with signatures already specified. Mechanical. |
| 5.5 | **codex** | Handler mirrors existing `runReview` + wire dispatcher + shouldUnpackBlob fix. Mechanical. |
| 5.6 | **codex** | Live test with pass/fail gates. Codex runs shell + parses JSON — well-suited. |
| 5.7 | **Claude (self)** | Prose synthesis across Phase 2–4 observations. Requires kimi-specific wisdom codex doesn't have. |
| 5.8 | **Claude (self)** | Same — lessons.md synthesis + appendix. |
| 5.9 | **Claude (self)** | Template extraction requires reading + parameterizing the kimi Phase-1 plan with taste. |
| 5.10 | **Claude (self, with codex assist)** | 3-way review dispatch + CHANGELOG authoring + tag gate. Integration + judgment. |

For codex-implemented tasks, spec-compliance review + code-quality review are dispatched after the implementer reports DONE, per `superpowers:subagent-driven-development`.

---

**Plan v2 complete** after integrating codex + gemini Phase-5-plan review findings (C1 shouldUnpackBlob, C2 RETRY_NOTICE debrand, G1 phase-1-template, G3 adversarial prompt hardening, G4 T9 regex check, G5 lessons appendix, G6 no_changes antipattern, G7 T5 regate). Ready to dispatch codex for Task 5.1.
