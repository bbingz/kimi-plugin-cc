# kimi-plugin-cc Phase 3 Review + Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/kimi:review` end-to-end: git-diff collection (from Phase 1 `git.mjs`) → prompt with schema → `callKimi` → JSON extraction → schema validation → 1-shot retry on parse failure → Claude-facing output. Exit: **T5** (small sample diff yields schema-complete JSON findings; malformed first response auto-retries once and succeeds or reports a clear error).

**Architecture:** Review pipeline is orthogonal to ask: same `callKimi` underneath, but the prompt carries the schema literal, the post-processor locates the first `{`, the validator checks required fields + enums with hand-written logic (no ajv dep), and a single reissue happens if parse fails. Phase 3 also cashes in four deferred items from Phase 2 post-review (codex M2/M3, gemini G6 SKILL modularization, `renderGeminiResult` rename) because they all touch the same files this phase already opens.

**Tech Stack:** Node built-ins (`node:fs`, `node:path`, `node:child_process`). No npm deps. Uses existing `git.mjs::collectReviewContext` + `kimi.mjs::callKimi` + `render.mjs::renderReviewResult`.

**Reference spec:** `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` §4.2 (/kimi:review row), §6.1 T5.
**Reference probe data:** `doc/probe/probe-results.json` — `output_format.stream_json_supported: true`; `content_block_types` names; `auth_ping.recommended_timeout_ms`.
**Reference source:** `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/scripts/gemini-companion.mjs` review block (L266-330) + `schemas/review-output.schema.json`. **Read but do NOT copy mechanically** — kimi's prompt needs stronger JSON constraint wording (spec §4.2) and has no `approvalMode` concept.

**v0.1 total budget:** ~85 tasks. This plan covers **Phase 3 only (8 tasks, ~55 steps)**. Cumulative after Phase 3 = ~44 / 85 (52%).

**Exit criteria (all must hold before tag `phase-3-review`):**
- `/kimi:review` on a small staged diff returns `{ok: true, verdict, summary, findings, next_steps}` matching `plugins/kimi/schemas/review-output.schema.json`
- JSON extraction handles all 3 observed kimi dirty-JSON modes: (a) bare JSON, (b) markdown fence `` ```json ... ``` ``, (c) prose preamble + JSON
- 1-shot retry: if the first response fails parse OR fails schema validation, re-prompt ONCE with a short error hint; second failure returns a structured `{ok: false, error, rawText, parseError}` — no infinite loop
- Schema validation covers: top-level required keys; `verdict` enum `[approve|needs-attention]`; each finding's `severity` enum `[critical|high|medium|low]`; number bounds on `confidence` and `line_start`/`line_end`
- Empty-diff path returns `{ok: true, verdict: "no_changes", response: "No changes to review."}` without calling kimi
- Large-diff truncation warns (sets `truncated: true`), does NOT error
- Housekeeping cash-ins:
  - `!assistantText.trim()` in callKimi + callKimiStreaming (codex Phase-2-review M3)
  - sessionId-null stderr warning also fires in JSON + stream modes of runAsk (codex Phase-2-review M2)
  - `renderGeminiResult` → `renderKimiResult` rename (Phase 1 tech debt)
  - SKILL.md split into `references/ask-render.md` + `references/review-render.md` (gemini Phase-2-review G6 + original plan G6)
- Git tag `phase-3-review` applied

**Explicit non-goals:**
- Background mode `--background` for /kimi:review → Phase 4 (requires job-control.mjs which isn't ported yet)
- `/kimi:adversarial-review` → Phase 5
- `/kimi:rescue` + agent → Phase 4
- Full AJV or ajv-based validation → hand-written minimal validator is sufficient for the 4 hard rules; schema doc is still the source of truth
- Diff-viewer-aware rendering (line-number mapping back into source) → Phase 5 polish

---

## File Structure

**Create:**
- `plugins/kimi/schemas/review-output.schema.json`
- `plugins/kimi/commands/review.md`
- `plugins/kimi/skills/kimi-result-handling/references/ask-render.md`
- `plugins/kimi/skills/kimi-result-handling/references/review-render.md`

**Modify:**
- `plugins/kimi/scripts/lib/kimi.mjs` — add `buildReviewPrompt`, `extractReviewJson`, `validateReviewOutput`, `callKimiReview` (1-shot retry wrapper); also whitespace-trim guard (M3)
- `plugins/kimi/scripts/lib/render.mjs` — rename `renderGeminiResult` → `renderKimiResult` + cascade to `renderReviewResult`
- `plugins/kimi/scripts/kimi-companion.mjs` — add `runReview` subcommand; extend sessionId-null warning to JSON + stream paths (M2)
- `plugins/kimi/skills/kimi-result-handling/SKILL.md` — reduce to cross-command rules; defer to `references/<command>-render.md`

**Unchanged:**
- `args.mjs`, `process.mjs`, `state.mjs`, `git.mjs` — already ported in Phase 1 with `collectReviewContext` intact
- Commands: `setup.md`, `ask.md` — Phase 2 contracts stable

---

## Task 3.1: Housekeeping cash-ins (3 deferred items from Phase 2 post-review)

**Files:**
- Modify: `plugins/kimi/scripts/lib/kimi.mjs`
- Modify: `plugins/kimi/scripts/kimi-companion.mjs`
- Modify: `plugins/kimi/scripts/lib/render.mjs`

Single commit that clears three small post-Phase-2 debts so Phase 3 review work doesn't trip over them later.

- [ ] **Step 1: Whitespace-only response guard (codex M3)**

In `kimi.mjs`, find the two `if (!assistantText)` / `if (!streamedText)` guards. Change to trim-based:

In `callKimi` (the sync path):

```js
if (!assistantText.trim()) {
```

In `callKimiStreaming`:

```js
const streamedText = textParts.join("");
if (!streamedText.trim()) {
```

Keep everything inside the branch unchanged. Rationale in comment (replace the existing block comment above each guard):

```js
// ── No-visible-text guard (gemini G1 + codex Phase-2-review M3 trim) ──
// If assistant produced no visible text OR only whitespace, treat as
// failure regardless of event count. Catches three silent-failure modes:
//   (a) Exit 0 + 0 events     (stream-json format unknown / uncommon dump)
//   (b) Exit 0 + think-only   (reasoning but no surfaced answer)
//   (c) Exit 0 + whitespace   (e.g. only "   \n" — visually empty to user)
```

- [ ] **Step 2: sessionId-null warning in JSON + stream modes (codex M2)**

In `kimi-companion.mjs::runAsk`, the current text-mode path writes a stderr warning when `!result.sessionId`. JSON and streaming paths are silent. Extend the warning:

Find:

```js
  if (options.stream) {
    // ...existing streaming block
    process.stdout.write(JSON.stringify(summary) + "\n");
    process.exit(result.ok ? KIMI_EXIT.OK : (result.status ?? 1));
  }
```

Add a stderr warning BEFORE `process.exit` on the streaming path:

```js
    if (result.ok && !result.sessionId) {
      process.stderr.write(
        "Warning: session_id could not be captured. --resume will not work for this call.\n"
      );
    }
    process.stdout.write(JSON.stringify(summary) + "\n");
    process.exit(result.ok ? KIMI_EXIT.OK : (result.status ?? 1));
  }
```

Find the JSON-output branch:

```js
  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
```

Add a stderr warning inside the JSON branch (kept outside the JSON output so structured consumers still get clean JSON on stdout):

```js
  if (options.json) {
    if (result.ok && !result.sessionId) {
      process.stderr.write(
        "Warning: session_id could not be captured. --resume will not work for this call.\n"
      );
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
```

The existing text-mode warning block (after `formatAskFooter`) stays — it handles the non-JSON path.

- [ ] **Step 3: Rename `renderGeminiResult` → `renderKimiResult`**

In `plugins/kimi/scripts/lib/render.mjs`, rename the function and update the one internal caller:

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
grep -n "renderGeminiResult" plugins/kimi/scripts/lib/render.mjs
```

Expected: 2 matches (declaration + internal call in `renderReviewResult`).

Edit both:

- Declaration: `export function renderGeminiResult(result)` → `export function renderKimiResult(result)`
- Internal caller in `renderReviewResult`: `lines.push(renderGeminiResult(result));` → `lines.push(renderKimiResult(result));`

Then search the rest of the codebase to confirm there are no other callers:

```bash
grep -rn "renderGeminiResult" plugins/ scripts/ 2>/dev/null
```

Expected: no matches (the function was only used internally in render.mjs; Phase 2 `runAsk` uses stdout-verbatim, not this renderer).

- [ ] **Step 4: Syntax check + quick smoke**

```bash
node --check plugins/kimi/scripts/lib/kimi.mjs
node --check plugins/kimi/scripts/kimi-companion.mjs
node --check plugins/kimi/scripts/lib/render.mjs

# regression: text-mode ask still prints response + footer
node plugins/kimi/scripts/kimi-companion.mjs ask "Reply with exactly: regression" 2>&1 | head -3
```

Expected: first 3 commands exit 0. The ask output shows the response line plus footer.

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/scripts/lib/kimi.mjs plugins/kimi/scripts/kimi-companion.mjs plugins/kimi/scripts/lib/render.mjs
git commit -m "chore: Phase 3 housekeeping (whitespace-trim guard, sessionId warn, rename render)"
```

---

## Task 3.2: Split kimi-result-handling SKILL into references (gemini G6)

**Files:**
- Create: `plugins/kimi/skills/kimi-result-handling/references/ask-render.md`
- Create: `plugins/kimi/skills/kimi-result-handling/references/review-render.md`
- Modify: `plugins/kimi/skills/kimi-result-handling/SKILL.md`

Before wiring `/kimi:review`, split the skill. The main SKILL.md becomes cross-command rules; per-command rendering specifics move to `references/<command>-render.md`. When the review command lands in Task 3.6, it'll include its own reference block in review-render.md.

- [ ] **Step 1: Create `references/` subdirectory and write `ask-render.md`**

```bash
mkdir -p plugins/kimi/skills/kimi-result-handling/references
```

Create `plugins/kimi/skills/kimi-result-handling/references/ask-render.md` with content:

```markdown
# /kimi:ask rendering rules

Command file `plugins/kimi/commands/ask.md` is the authoritative rendering contract for `/kimi:ask`. This file holds the background rationale that the command file condenses into rules.

## Output channel contract

`/kimi:ask` runs in **text mode** by default. The companion writes to stdout:

```
<response verbatim>

(session: <uuid> · model: <name> [· thinkBlocks: N])
```

When `--json` is passed, the entire `{ok, response, sessionId, events, toolEvents, thinkBlocks}` object goes to stdout as pretty-printed JSON. `--stream` (developer-only, blocked when `KIMI_COMPANION_CALLER=claude`) emits one JSONL event per line plus a final `{summary: {...}}` line.

## Presentation to the user (text mode)

1. **Verbatim output.** Present stdout unchanged. No prefix (no "Kimi says:"), no wrapping, no paraphrase, no translation.
2. **Disagreement is the ONLY allowed addition.** One line after the footer: `Note: Claude disagrees on X because Y.` — omit when you agree. This is the sole exception to verbatim.
3. **Chinese responses stay in Chinese.** Do not offer unprompted translation; if the user later asks, translate then.
4. **Think-blocks count is a signal only.** The footer may show `thinkBlocks: N`. Do not fabricate their contents or promise a way to view them until `--show-thinking` lands.

## Error path (exit != 0)

Claude receives stderr with `Error: <msg>` and optional `Partial response:` block. Match the error keyword to one of three declarative suggestions (ask.md specifies them literally):

- `"not configured"` → direct to `/kimi:setup` then `--model <name>`.
- `"timed out"` → split prompt or reduce scope, then retry.
- `"interrupted"` (SIGINT or SIGTERM) → plain "Retry when ready."

**MUST NOT end these with a question mark.** Declarative only. Do NOT auto-retry.

## Silent-failure modes the companion catches

- `!assistantText.trim()` (Task 3.1): think-only or whitespace-only responses fail with `ok: false`, status `0`, raw stdout clipped to 2000 chars.
- Missing sessionId: footer prints `session: unknown (not captured)` AND stderr warning fires in ALL modes (Task 3.1 cash-in).
- Resume-mismatch: runAsk warns when `--resume <sid>` was requested but `result.sessionId !== sid` (gemini G-H1).
```

- [ ] **Step 2: Do NOT create `review-render.md` yet**

Review-level rendering rules land in Task 3.6 (after the command contract is finalized). Addressing v1-review convergence (codex C-L1 + gemini G-H3): the v1 plan had a scaffold here that Task 3.6 immediately overwrote — wasted write. Task 3.2 only creates `ask-render.md` and slims `SKILL.md`. Task 3.6 creates `review-render.md` in one shot.

- [ ] **Step 3: Slim down main `SKILL.md`**

Replace the `## Command-specific rendering` section (added in Phase 2 Commit B) with a shorter pointer block. Keep every other section unchanged.

Current section:

```markdown
## Command-specific rendering

**Command files (`plugins/kimi/commands/<name>.md`) are authoritative for their own rendering contract.** They supersede this skill's examples when they disagree. ...
```

Replace with:

```markdown
## Command-specific rendering

**Per-command rendering rules live in `references/<command>-render.md`.** Read the matching reference for the command you're rendering:

- `/kimi:ask` → `references/ask-render.md`
- `/kimi:review` → `references/review-render.md` (lands in Task 3.6)
- (others will be added as they land in later phases)

Command files (`plugins/kimi/commands/<name>.md`) remain the authoritative source of truth — the reference docs capture background rationale and cross-command patterns that wouldn't fit in a command file's frontmatter-bounded budget. When a command file and a reference disagree, the command file wins.
```

The `## Chinese/mixed-language output`, `## Think blocks`, `## What still needs Phase 5 work` sections stay as they are.

- [ ] **Step 4: Verify**

```bash
ls plugins/kimi/skills/kimi-result-handling/
ls plugins/kimi/skills/kimi-result-handling/references/
wc -l plugins/kimi/skills/kimi-result-handling/SKILL.md plugins/kimi/skills/kimi-result-handling/references/*.md
```

Expected: `references/` exists with 1 file (`ask-render.md`). SKILL.md shrank (from ~93 to ~60 lines). `review-render.md` is deliberately absent until Task 3.6 (v2 plan fix: avoid scaffold-then-overwrite waste).

- [ ] **Step 5: Commit**

```bash
git add plugins/kimi/skills/kimi-result-handling/
git commit -m "docs(skill): split kimi-result-handling into per-command references"
```

---

## Task 3.3: Copy + proofread review-output schema

**Files:**
- Create: `plugins/kimi/schemas/review-output.schema.json`

Source is `/Users/bing/-Code-/gemini-plugin-cc/plugins/gemini/schemas/review-output.schema.json` (70 lines). The schema is LLM-agnostic — spec §4.2 says "independent copy, byte-aligned at creation but maintained separately".

- [ ] **Step 1: Create schemas/ and write the file**

```bash
mkdir -p plugins/kimi/schemas
```

Write `plugins/kimi/schemas/review-output.schema.json` with EXACTLY this content (byte-aligned with gemini at Phase 3 Task 3.3 creation time — kimi-specific tweaks get added only when we observe divergence empirically in T5 soak):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["verdict", "summary", "findings", "next_steps"],
  "properties": {
    "verdict": {
      "type": "string",
      "enum": ["approve", "needs-attention", "no_changes"],
      "description": "Overall review verdict. 'no_changes' is a companion-side fast path when the diff is empty — no kimi call is made. Kimi itself should never return 'no_changes'; validator rejects it unless the payload is the fast-path shape."
    },
    "summary": {
      "type": "string",
      "minLength": 1,
      "description": "One-paragraph summary of the review"
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["severity", "title", "body", "file", "line_start", "line_end", "confidence", "recommendation"],
        "properties": {
          "severity": {
            "type": "string",
            "enum": ["critical", "high", "medium", "low"]
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "description": "Short title for the finding"
          },
          "body": {
            "type": "string",
            "minLength": 1,
            "description": "Detailed description of the issue"
          },
          "file": {
            "type": "string",
            "description": "File path relative to repo root"
          },
          "line_start": {
            "type": "integer",
            "minimum": 1
          },
          "line_end": {
            "type": "integer",
            "minimum": 1
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Confidence score (0-1)"
          },
          "recommendation": {
            "type": "string",
            "description": "Suggested fix or action"
          }
        }
      }
    },
    "next_steps": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1
      },
      "description": "Recommended next actions"
    }
  }
}
```

- [ ] **Step 2: Verify it's valid JSON**

```bash
python3 -c 'import json; d = json.load(open("plugins/kimi/schemas/review-output.schema.json")); print("required:", d["required"]); print("verdict enum:", d["properties"]["verdict"]["enum"])'
```

Expected: `required: ['verdict', 'summary', 'findings', 'next_steps']` and `verdict enum: ['approve', 'needs-attention']`.

- [ ] **Step 3: Commit**

```bash
git add plugins/kimi/schemas/review-output.schema.json
git commit -m "feat(schema): review-output.schema.json (byte-aligned copy from gemini-plugin-cc)"
```

---

## Task 3.4: Review prompt builder + JSON extractor + validator in `kimi.mjs`

**Files:**
- Modify: `plugins/kimi/scripts/lib/kimi.mjs`

Add three pure functions (testable in isolation) plus a `callKimiReview` wrapper that composes them with `callKimi` and a single retry.

- [ ] **Step 1: Add imports if not already present**

At the top of `kimi.mjs`, ensure these imports exist (they were added earlier in Phase 1/2):

- `import fs from "node:fs";`
- `import path from "node:path";`

Add a constant near the other constants (below `LARGE_PROMPT_THRESHOLD_BYTES`):

```js
// Diff budget for /kimi:review (spec §4.2; probe 03 stdin headroom is ~200k,
// but leave margin for schema block + summary + focus line in the prompt).
// Reviews above this get truncated with a visible warning.
export const MAX_REVIEW_DIFF_BYTES = 150_000;
```

- [ ] **Step 2: Append `buildReviewPrompt` above the final exports block**

```js
// ── Review prompt (spec §4.2; strong JSON constraint per kimi behavior) ──
//
// Load the schema from plugins/kimi/schemas/review-output.schema.json at call
// time (not module load) so schema edits during development don't require a
// companion restart. Caller passes { context, focus, schemaPath }.
export function buildReviewPrompt({ context, focus, schemaPath, retryHint = null }) {
  const schema = fs.readFileSync(schemaPath, "utf8").trim();
  // Focus wording (gemini v1-review G-M2): "Focus area: X" was ambiguous
  // between weight-toward vs limit-to. "Pay particular attention" clarifies
  // it's a weight cue while preserving room to flag out-of-focus criticals.
  const focusLine = focus
    ? `\nPay particular attention to: ${focus}. You may still report critical issues outside this area.\n`
    : "";
  const retryBlock = retryHint
    ? `\n\n[IMPORTANT] Your previous response failed JSON parsing or schema validation. The error was: ${retryHint}\nReturn ONLY the JSON object — no prose, no markdown fence, no commentary before or after. Nothing but the JSON. Use the EXACT English severity strings (critical/high/medium/low) — do NOT translate them.\n`
    : "";

  // Kimi constraint wording is tighter than gemini's (spec §4.2): kimi
  // empirically adds "好的，这是 JSON：" prose preambles and sometimes wraps
  // output in markdown fences despite explicit instructions. Our prompt tells
  // it exactly what NOT to do in addition to what to do.
  return `You are reviewing code changes. Return your review as a single JSON object matching this schema:

\`\`\`json
${schema}
\`\`\`

STRICT OUTPUT RULES (kimi-plugin-cc §4.2):
- Return ONLY the JSON object.
- No markdown code fence around it (no \`\`\`json ... \`\`\`).
- No prose before (no "好的" / "Here is" / "This review").
- No prose after (no "让我知道" / "Let me know").
- \`severity\` MUST be one of the EXACT English strings: critical, high, medium, low. Do NOT translate these to Chinese (gemini v1-review G-M1; kimi priors may produce 严重/高/中/低 — those FAIL schema validation).
- \`verdict\` MUST be: approve or needs-attention (never "no_changes" — that's a companion-side fast path for empty diffs).
- For each finding you DO include, fill ALL required fields: severity, title, body, file, line_start, line_end, confidence, recommendation. Empty findings array is fine if the diff is clean; partially-filled findings are rejected.
- Do NOT fabricate line numbers. If you are unsure of exact lines, omit the entire finding.${retryBlock}

${context.summary}${focusLine}

${context.content}`;
}
```

- [ ] **Step 3: Append `extractReviewJson`**

```js
// Locate and parse the JSON object in kimi's response. Handles 3 observed
// dirty modes: (a) bare JSON, (b) ```json ... ``` fence, (c) prose + JSON.
// Returns { ok: true, data } or { ok: false, error, parseError, rawText }.
export function extractReviewJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "empty response", parseError: null, rawText: text };
  }

  // Strip markdown fences first (mode b).
  let candidate = text.trim();
  const fenceMatch = candidate.match(/^\`\`\`(?:json)?\s*\n([\s\S]*?)\n\`\`\`\s*$/);
  if (fenceMatch) candidate = fenceMatch[1].trim();

  // Locate first '{' (mode c prose preamble).
  const firstBrace = candidate.indexOf("{");
  if (firstBrace === -1) {
    return { ok: false, error: "no JSON object found in response", parseError: null, rawText: text };
  }
  candidate = candidate.slice(firstBrace);

  // Walk forward to matching brace (ignore string contents). Prevents failure
  // when kimi appends trailing prose after valid JSON.
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

  // Reject trailing JSON/structured content (codex v1-review C-M1): if kimi
  // emits `{...}{...}` or `{...}[...]`, our walker would take the first object
  // and ignore the rest. Treat that as "malformed — retry" so the second
  // attempt has a chance at producing a single object.
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
```

- [ ] **Step 4: Append `validateReviewOutput`**

```js
// Minimal hand-written validator for review-output.schema.json.
// Enforces the 4 contract rules that T5 + prompt cover:
//   (1) required top-level keys
//   (2) verdict enum (approve | needs-attention) — NOT "no_changes";
//       that's a companion-side fast-path shape, not kimi output
//   (3) per-finding required fields (codex v1-review C-H1 fix)
//   (4) severity enum + numeric bounds on confidence/line_start/line_end
// Returns { ok: true } or { ok: false, errors: [string, ...] }.
// Intentionally NOT a full JSON Schema implementation — we avoid the ajv
// dep (zero-deps rule) and only check the rules T5 + the command contract
// actually care about.
export function validateReviewOutput(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["payload is not an object"] };
  }
  for (const k of ["verdict", "summary", "findings", "next_steps"]) {
    if (!(k in data)) errors.push(`missing top-level field: ${k}`);
  }
  if ("verdict" in data && !["approve", "needs-attention"].includes(data.verdict)) {
    errors.push(`verdict must be "approve" or "needs-attention" (no_changes is a companion-side shape, not a valid kimi verdict), got ${JSON.stringify(data.verdict)}`);
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
        // Per-finding required fields (codex C-H1): reject partial findings.
        // The prompt explicitly tells kimi to omit entire findings it can't
        // fill, so missing fields signal the LLM ignored instructions.
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
```

- [ ] **Step 5: Append `callKimiReview` with 1-shot retry**

```js
// Unified review-error shape (codex v1-review C-M2). ALL non-ok returns go
// through this helper so review-render.md consumers see a consistent
// { ok:false, error, rawText?, parseError?, firstRawText?, transportError?,
//   truncated, retry_used, sessionId? } shape — never a raw errorResult
// spread that leaks callKimi's transport fields (status/partialResponse/events).
function reviewError({ error, rawText = null, parseError = null, firstRawText = null, transportError = null, truncated, retry_used, sessionId = null }) {
  return {
    ok: false,
    error,
    rawText,
    parseError,
    firstRawText,
    transportError,
    truncated,
    retry_used,
    sessionId,
  };
}

// High-level wrapper: build prompt → callKimi → extract → validate → retry
// once if parse or validation fails. Returns a shape extended with
// { verdict, summary, findings, next_steps, truncated, retry_used, sessionId }
// on success, or the reviewError shape above on failure.
//
// Kimi's first-shot JSON compliance is historically uneven (spec §4.2 motivates
// the retry). The retry prompt appends a terse error hint so kimi corrects in
// place rather than re-reasoning from scratch. Reusing the same session via
// `resumeSessionId` is a best-effort nudge; kimi 1.36's session store retains
// prior messages so the model sees its own malformed output when correcting.
export function callKimiReview({ context, focus, schemaPath, model, cwd, timeout, truncated = false }) {
  // Schema load try/catch (codex v1-review C-H2). Without this, a missing or
  // malformed schema file would throw sync inside buildReviewPrompt and
  // escape runReview as an uncaught exception. Surface as reviewError instead.
  let firstPrompt;
  try {
    firstPrompt = buildReviewPrompt({ context, focus, schemaPath });
  } catch (e) {
    return reviewError({
      error: `Failed to load review schema at ${schemaPath}: ${e.message}`,
      truncated,
      retry_used: false,
    });
  }

  const firstResult = callKimi({ prompt: firstPrompt, model, cwd, timeout });
  if (!firstResult.ok) {
    return reviewError({
      error: firstResult.error || "kimi call failed",
      transportError: { status: firstResult.status ?? null, partialResponse: firstResult.partialResponse ?? null },
      truncated,
      retry_used: false,
      sessionId: firstResult.sessionId ?? null,
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
        retry_used: false,
        sessionId: firstResult.sessionId,
      };
    }
  }

  // Operator breadcrumb (gemini v1-review G-L3). Goes to stderr so structured
  // consumers keep getting clean JSON on stdout, and so background jobs log
  // the retry rate over time for observability.
  process.stderr.write("Warning: kimi review response failed parse/validation; retrying once with error hint...\n");

  // Retry once with error hint. Reuse the same session so kimi sees the prior
  // exchange (best-effort; if session didn't persist, the hint alone still
  // steers correction).
  const retryHint = firstExtracted.ok
    ? `schema validation errors: ${firstValidation.errors.slice(0, 3).join("; ")}`
    : `parse failure (${firstExtracted.error}${firstExtracted.parseError ? ": " + firstExtracted.parseError : ""})`;
  let retryPrompt;
  try {
    retryPrompt = buildReviewPrompt({ context, focus, schemaPath, retryHint });
  } catch (e) {
    return reviewError({
      error: `Failed to rebuild review prompt for retry: ${e.message}`,
      firstRawText: firstResult.response,
      truncated,
      retry_used: true,
      sessionId: firstResult.sessionId ?? null,
    });
  }
  const retryResult = callKimi({
    prompt: retryPrompt,
    model,
    cwd,
    timeout,
    resumeSessionId: firstResult.sessionId || null,
  });
  if (!retryResult.ok) {
    return reviewError({
      error: `Retry kimi call failed: ${retryResult.error}`,
      transportError: { status: retryResult.status ?? null, partialResponse: retryResult.partialResponse ?? null },
      firstRawText: firstResult.response,
      truncated,
      retry_used: true,
      sessionId: retryResult.sessionId ?? null,
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
    retry_used: true,
    sessionId: retryResult.sessionId,
  };
}
```

- [ ] **Step 6: Export the new names**

Append to the final `export { ... }` block:

```js
export {
  PING_MAX_STEPS,
  SESSION_ID_STDERR_REGEX,
  LARGE_PROMPT_THRESHOLD_BYTES,
  MAX_REVIEW_DIFF_BYTES,
  PARENT_SESSION_ENV,
  KIMI_BIN,
  DEFAULT_TIMEOUT_MS,
  AUTH_CHECK_TIMEOUT_MS,
};
```

(`buildReviewPrompt`, `extractReviewJson`, `validateReviewOutput`, `callKimiReview` are already exported via `export function`.)

- [ ] **Step 7: Syntax check**

```bash
node --check plugins/kimi/scripts/lib/kimi.mjs
```

- [ ] **Step 8: Smoke test extractor + validator (no kimi call)**

```bash
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(m => {
  // mode (a): bare
  const a = m.extractReviewJson(`{"verdict":"approve","summary":"ok","findings":[],"next_steps":[]}`);
  console.assert(a.ok && a.data.verdict === "approve", "bare JSON");

  // mode (b): markdown fence
  const b = m.extractReviewJson("```json\n" + `{"verdict":"approve","summary":"ok","findings":[],"next_steps":[]}` + "\n```");
  console.assert(b.ok && b.data.verdict === "approve", "fenced");

  // mode (c): prose + JSON + prose
  const c = m.extractReviewJson(`好的，这是 JSON：\n{"verdict":"needs-attention","summary":"x","findings":[],"next_steps":[]}\n让我知道`);
  console.assert(c.ok && c.data.verdict === "needs-attention", "prose preamble");

  // malformed
  const d = m.extractReviewJson(`{"verdict":"approve"`);
  console.assert(!d.ok, "unterminated");

  // validator: required missing
  const v1 = m.validateReviewOutput({verdict:"approve"});
  console.assert(!v1.ok && v1.errors.some(e => e.includes("summary")), "missing fields");

  // validator: bad verdict
  const v2 = m.validateReviewOutput({verdict:"meh", summary:"x", findings:[], next_steps:[]});
  console.assert(!v2.ok && v2.errors.some(e => e.includes("verdict")), "bad verdict");

  // validator: bad severity
  const v3 = m.validateReviewOutput({verdict:"approve", summary:"x", findings:[{severity:"urgent"}], next_steps:[]});
  console.assert(!v3.ok && v3.errors.some(e => e.includes("severity")), "bad severity");

  // validator: happy
  const v4 = m.validateReviewOutput({verdict:"approve", summary:"x", findings:[], next_steps:[]});
  console.assert(v4.ok, "happy");

  console.log("extractor + validator PASS");
});
'
```

Expected: `extractor + validator PASS`; 7 assertions pass silently.

- [ ] **Step 9: Commit**

```bash
git add plugins/kimi/scripts/lib/kimi.mjs
git commit -m "feat(kimi): review prompt builder, JSON extractor, validator, callKimiReview"
```

---

## Task 3.5: `review` subcommand in `kimi-companion.mjs`

**Files:**
- Modify: `plugins/kimi/scripts/kimi-companion.mjs`

- [ ] **Step 1: Extend imports**

Find the existing import from `./lib/kimi.mjs` and add `callKimiReview` + `MAX_REVIEW_DIFF_BYTES`:

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

Add imports for git helpers and path resolution (near the top, with other imports):

```js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureGitRepository, collectReviewContext } from "./lib/git.mjs";
```

Add a `ROOT_DIR` constant near the top (under imports), used to locate the schema file:

```js
// Plugin root is two levels above this file (scripts/kimi-companion.mjs →
// plugins/kimi). Used for loading packaged schemas.
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
```

- [ ] **Step 2: Add `runReview` function between `formatAskFooter` and the dispatcher**

```js
async function runReview(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, {
    valueOptions: ["model", "base", "scope"],
    booleanOptions: ["json"],
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
```

- [ ] **Step 3: Wire `review` into dispatcher**

Update the `switch (sub)` block to add the `review` case:

```js
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
```

- [ ] **Step 4: Extend `UNPACK_SAFE_SUBCOMMANDS` and `shouldUnpackBlob`**

`/kimi:review`'s `$ARGUMENTS` contract is: flags first (`--base foo --scope staged --model kimi-code/kimi-for-coding`) then optional focus terms (positional words). Unlike ask where a whole prompt can contain spaces, review focus terms are typically short, space-separated keyword lists ("auth login", "error handling"). Reuse the ask split heuristic: split when the FIRST token is a known review flag.

Find the existing block:

```js
const UNPACK_SAFE_SUBCOMMANDS = new Set(["setup", "ask"]);

const ASK_KNOWN_FLAG = /^(?:--(?:json|stream|model|resume)(?:=.*)?|-[mr])$/;

function shouldUnpackBlob(sub, rest) {
  // ...
}
```

Extend:

```js
const UNPACK_SAFE_SUBCOMMANDS = new Set(["setup", "ask", "review"]);

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
```

The extra `|| tokens.every(t => !t.startsWith("-"))` branch for review handles the case where user writes `/kimi:review auth login` (no flags, just focus keywords) — those should ALSO be split into positionals.

- [ ] **Step 5: Update `USAGE` text**

```js
const USAGE = `Usage: kimi-companion <subcommand> [options]

Subcommands:
  setup [--json]                       Check kimi CLI availability, auth, and configured models
  ask [--json] [--stream] [-m <model>] [-r <sessionId>] "<prompt>"
                                       Send a one-shot prompt. --stream emits JSONL events as they arrive.
  review [--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [-m <model>] [focus...]
                                       Review current diff. Always emits JSON matching review-output schema.

(More subcommands arrive in Phase 4+.)`;
```

- [ ] **Step 6: Syntax check**

```bash
node --check plugins/kimi/scripts/kimi-companion.mjs
```

- [ ] **Step 7: Commit**

```bash
git add plugins/kimi/scripts/kimi-companion.mjs
git commit -m "feat(companion): review subcommand with 1-shot retry"
```

---

## Task 3.6: `/kimi:review` command file + review-render.md polish

**Files:**
- Create: `plugins/kimi/commands/review.md`
- Modify: `plugins/kimi/skills/kimi-result-handling/references/review-render.md`

- [ ] **Step 1: Write `plugins/kimi/commands/review.md`**

```markdown
---
description: Run a Kimi code review on the current diff
argument-hint: '[--base <ref>] [--scope <auto|staged|unstaged|working-tree|branch>] [--model <model>] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run:

```bash
KIMI_COMPANION_CALLER=claude node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" review "$ARGUMENTS"
```

The companion always emits JSON to stdout matching `plugins/kimi/schemas/review-output.schema.json`. Parse it and present to the user.

**Top-level fields:**
- `ok`: true / false
- `verdict`: `"approve"` | `"needs-attention"` | `"no_changes"`
- `summary`: one-paragraph overview
- `findings`: array of finding objects (severity, title, body, file, line_start, line_end, confidence, recommendation)
- `next_steps`: array of recommended actions
- `truncated`: whether the diff was cut off
- `retry_used`: whether the first response required a retry

**If `verdict === "no_changes"`**: tell the user "No changes to review." and stop.

**If `ok === false`**: show `error`, `rawText` (if present, clipped to 500 chars), and note whether a retry was used. Do NOT auto-retry — the companion already tried once. Suggest running `/kimi:review --scope staged` or reducing diff size.

**If `ok === true` and `findings` is non-empty:**
1. **If `truncated === true`, warn PROMINENTLY at the top BEFORE verdict/findings**: "⚠️ Diff exceeded the review budget; only the first 150 KB was reviewed. Findings below are INCOMPLETE. Consider narrowing scope (`--scope staged`) or running per-path." (gemini v1-review G-M3: users miss the warning when it's buried below findings.)
2. Present the `verdict` and `summary` prominently.
3. Sort findings by severity (`critical > high > medium > low`), then by `file` (alphabetical), then by `line_start` (ascending).
4. For each finding, show:
   - Severity badge (e.g. 🔴 critical, 🟠 high, 🟡 medium, 🔵 low — or plain text if the user dislikes emoji).
   - Title.
   - `file:line_start` (or `file:line_start-line_end` if the range spans).
   - Body verbatim.
   - Recommendation.
5. List `next_steps`.
6. If `retry_used === true`: append one discreet line at the END: "(Kimi's first response was malformed; the retry succeeded.)"
7. If Claude's own `/review` already ran earlier this conversation, compare findings: both-found, only-kimi, only-claude buckets.

**Do NOT auto-fix any issues.** Ask the user which items to address. One question at a time if multiple clusters.

### Options

- `--base <ref>` — base ref for `branch` scope (defaults to auto-detected main/master)
- `--scope <...>` — `auto` (default; local mods first, then branch diff), `staged`, `unstaged`, `working-tree`, `branch`
- `--model <name>` — override default model (see `/kimi:setup`)
- `[focus ...]` — optional focus keywords appended to the prompt (e.g. `auth middleware`)
```

- [ ] **Step 2: Create `references/review-render.md` (background rationale only)**

The file does NOT exist yet — Task 3.2 Step 2 deliberately skipped it (v2 plan fix: avoid the v1 scaffold-then-overwrite waste that codex C-L1 + gemini G-H3 flagged, and avoid duplicating the JSON shape + 7-step rules between command.md and the reference).

Create `plugins/kimi/skills/kimi-result-handling/references/review-render.md` with content that holds ONLY the rationale — all concrete rules live in `commands/review.md`:

```markdown
# /kimi:review rendering rationale

Command file `plugins/kimi/commands/review.md` holds the concrete rules (JSON shape, presentation steps, severity badges, sort order). This reference explains the WHY — background rationale that wouldn't fit in the command file's frontmatter-bounded budget.

## Why the retry exists

Kimi's first-shot JSON compliance is historically uneven (spec §4.2; empirical observations include markdown fences, "好的，这是 JSON：" prose preambles, and Chinese severity translations). The companion tries ONCE more with an error hint appended. The retry prompt is sent on the SAME session via `--resume <sid>` — best-effort nudge so kimi sees its prior malformed output and corrects in place rather than re-reasoning from scratch.

UX: if `retry_used === true` and `ok === true`, surface discreetly at the END of the rendered output ("Kimi's first response was malformed; the retry succeeded.") — signals something minor happened without distracting from findings. If `retry_used === true` and `ok === false`, escalate prominently — both attempts failed, and the raw texts (`firstRawText` + `rawText`) help operators debug.

Operator breadcrumb: a stderr warning "kimi review response failed parse/validation; retrying once..." fires before the retry, so background-job logs record the retry rate over time (gemini v1-review G-L3).

## Why severity is English-only

Kimi priors may produce Chinese severity labels ("严重", "高", "中", "低") because the reviewed code is often Chinese-authored. The schema + validator enforce `critical|high|medium|low` as the exact English strings (gemini v1-review G-M1). A translated severity triggers a retry; the retry prompt restates the enum explicitly.

## Why partial findings are rejected

The prompt tells kimi: "fill ALL required fields for findings you include; omit the entire finding if you can't fill them." This prevents half-filled objects (e.g. severity-only, or no line numbers) that the user can't act on. Validation rejects any finding missing: severity, title, body, file, line_start, line_end, confidence, recommendation (codex v1-review C-H1).

## Why truncation is a top-of-render warning

For diffs >150 KB, the kimi call reviews only the first 150 KB slice. Findings returned don't cover the tail. If the warning is buried under the findings list, users assume the review is comprehensive (gemini v1-review G-M3). The command file therefore requires the warning to appear BEFORE verdict/summary — breaking the usual "summary first" pattern is the right tradeoff.

## Non-findings shapes

Two shapes bypass the standard `{verdict, summary, findings, next_steps}` payload:

- **Empty diff fast path**: `{ok: true, verdict: "no_changes", response: "No changes to review.", truncated: false}` — no kimi call. The schema's `verdict` enum accepts `no_changes` specifically for this shape; the validator also accepts it but `buildReviewPrompt` tells kimi NEVER to produce `no_changes` (it's companion-side only).
- **Failure after retry**: `{ok: false, error, rawText?, parseError?, firstRawText?, transportError?, truncated, retry_used, sessionId?}` — all fields nullable except the 4 that are always present (`ok`, `error`, `truncated`, `retry_used`). `transportError` carries the original callKimi status + partialResponse when the failure was at the kimi call level, not at parse/validation.

## Comparison with Claude's own `/review`

When the user has run Claude's built-in `/review` earlier in the conversation:
- **Both found**: overlapping findings (likely real issues) — surface first.
- **Only Kimi**: unique to Kimi — may reflect different priors or language-specific intuition.
- **Only Claude**: unique to Claude — may reflect different priors or blind spots.

Do NOT auto-pick; present three buckets and let the user prioritize.

## Absolutely no auto-fix

Even `low`-severity findings stay read-only until the user asks. Ask one question when multiple issue clusters exist ("Address the SQL injection first? Then the missing tests?"), not a shotgun prompt.
```

- [ ] **Step 3: Verify**

```bash
head -7 plugins/kimi/commands/review.md
wc -l plugins/kimi/skills/kimi-result-handling/references/review-render.md
```

Expected: frontmatter present; review-render.md is ~60 lines.

- [ ] **Step 4: Commit**

```bash
git add plugins/kimi/commands/review.md plugins/kimi/skills/kimi-result-handling/references/review-render.md
git commit -m "feat(command): /kimi:review + expand review-render reference"
```

---

## Task 3.7: T5 validation + retry soak

**Files:** (no code changes)

Six checks. Requires a git repo with at least one small change staged.

- [ ] **Step 1: Prepare a small sample staged diff**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
# Fabricate a small deliberately-flawed JS file to review, stage it.
cat > /tmp/sample-bug.js <<'JS'
function totalPrice(items) {
  var sum = 0;
  for (var i = 0; i <= items.length; i++) {  // off-by-one
    sum += items[i].price;
  }
  return sum;
}
JS
mkdir -p /tmp/kimi-review-sandbox && cd /tmp/kimi-review-sandbox
git init -q && git config user.email test@test && git config user.name t
cp /tmp/sample-bug.js .
git add sample-bug.js
git status --short
```

Expected: one staged file `A  sample-bug.js`.

- [ ] **Step 2: T5 — basic review emits schema-complete JSON**

```bash
cd /tmp/kimi-review-sandbox
OUT=$(node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs review --scope staged)
echo "$OUT" | python3 - <<'PY'
import json, sys
d = json.loads(sys.stdin.read())
assert d["ok"] is True, d
assert d["verdict"] in ("approve", "needs-attention"), d["verdict"]
assert isinstance(d["summary"], str) and len(d["summary"]) > 0
assert isinstance(d["findings"], list)
assert isinstance(d["next_steps"], list)

# Gemini v1-review G-H1: the sample has a deliberate off-by-one (i <= items.length)
# — kimi MUST catch it or at least surface SOMETHING. An empty findings array
# against a known-buggy sample means the extraction/prompt path silently lost
# the review; require at least one finding to prove the pipeline exercises
# end-to-end.
assert len(d["findings"]) > 0, f"expected at least one finding on buggy sample; got {d}"

# Now validate structure of the first finding (which definitely exists).
f = d["findings"][0]
assert f["severity"] in ("critical", "high", "medium", "low"), f
assert isinstance(f.get("title"), str) and len(f["title"]) > 0
assert isinstance(f.get("body"), str) and len(f["body"]) > 0
# line_start/line_end are required per v2 validator; assert their shape too
assert isinstance(f.get("line_start"), int) and f["line_start"] >= 1
assert isinstance(f.get("line_end"), int) and f["line_end"] >= 1

print(f"T5 PASS — verdict={d['verdict']}, findings={len(d['findings'])}, retry_used={d.get('retry_used')}, first severity={f['severity']}")
PY
```

Expected: `T5 PASS` with at least 1 finding, verdict, retry_used flag. If kimi fails to flag the off-by-one, the assertion fires and we investigate (prompt too weak? sample too small?). Do NOT weaken the assertion — a silent pass here is worse than a noisy failure.

- [ ] **Step 3: Empty-diff path**

```bash
cd /tmp/kimi-review-sandbox
git commit -q -m "stage sample"
OUT=$(node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs review --scope staged)
echo "$OUT" | python3 -c 'import json, sys; d = json.loads(sys.stdin.read()); assert d["ok"] is True and d["verdict"] == "no_changes", d; print("empty-diff PASS")'
```

Expected: `empty-diff PASS`.

- [ ] **Step 4: Invalid-model routing**

```bash
cd /tmp/kimi-review-sandbox
echo "var x = 1;" >> sample-bug.js && git add sample-bug.js
node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs review --scope staged --model "not-a-real-model-9999" > /tmp/badmodel.json 2>&1 || true
python3 - <<'PY'
import json
d = json.load(open("/tmp/badmodel.json"))
assert d["ok"] is False, "must fail"
assert "not configured" in d["error"].lower() or "LLM not set" in d["error"]
print("invalid-model PASS — error:", d["error"][:100])
PY
```

Expected: `invalid-model PASS`.

- [ ] **Step 5: Retry logic (synthetic — via unit test, no real kimi call)**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
node -e '
import("./plugins/kimi/scripts/lib/kimi.mjs").then(m => {
  // Simulate extractReviewJson on kimi-style malformed outputs
  const cases = [
    [`好的，这是 JSON：\n{"verdict":"approve","summary":"ok","findings":[],"next_steps":[]}`, true],
    ["```json\n" + `{"verdict":"approve","summary":"ok","findings":[],"next_steps":[]}` + "\n```", true],
    [`{"verdict":"approve","summary":"ok","findings":[],"next_steps":[]}  \n\nLet me know!`, true],
    [`Let me think...\n{"verdict":"approve"`, false],  // unterminated
    [``, false],
  ];
  for (const [input, expected] of cases) {
    const r = m.extractReviewJson(input);
    console.assert(r.ok === expected, "case failed: " + input.slice(0, 40));
  }
  console.log("extractor-modes PASS");
});
'
```

Expected: `extractor-modes PASS`.

- [ ] **Step 6: Large-diff truncation**

```bash
cd /tmp/kimi-review-sandbox
# Create a large change (~200KB)
python3 -c '
with open("big.js","w") as f:
  f.write("// auto-generated large file\n")
  for i in range(10000):
    f.write(f"function f{i}() {{ return {i}; }}\n")
'
git add big.js
SIZE=$(wc -c < big.js)
echo "size: $SIZE"
OUT=$(node /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi/scripts/kimi-companion.mjs review --scope staged 2>/dev/null)
echo "$OUT" | python3 -c 'import json, sys; d = json.loads(sys.stdin.read()); assert d["truncated"] is True, d; print("truncation PASS — ok=" + str(d["ok"]) + " truncated=True")'
```

Expected: `truncation PASS — ok=True truncated=True`.

- [ ] **Step 7: Cleanup + no commit**

```bash
rm -rf /tmp/kimi-review-sandbox /tmp/sample-bug.js /tmp/badmodel.json
```

(No commit in Task 3.7 — it's validation only.)

---

## Task 3.8: Phase 3 CHANGELOG + tag

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Append CHANGELOG entry**

Insert at the top of `CHANGELOG.md` (below header line):

```markdown
## 2026-04-20 [Claude Opus 4.7 — Phase 3 /kimi:review + retry]

- **status**: done
- **scope**: plugins/kimi/scripts/lib/kimi.mjs, plugins/kimi/scripts/kimi-companion.mjs, plugins/kimi/scripts/lib/render.mjs, plugins/kimi/commands/review.md (new), plugins/kimi/schemas/review-output.schema.json (new), plugins/kimi/skills/kimi-result-handling/{SKILL.md, references/ask-render.md (new), references/review-render.md (new)}
- **summary**: /kimi:review end-to-end with 1-shot JSON-parse retry. 8 tasks:
  - **Task 3.1 (housekeeping)**: codex Phase-2-review M3 (whitespace-trim no-visible-text guard), codex M2 (sessionId-null warning in JSON+stream paths), render rename `renderGeminiResult` → `renderKimiResult`.
  - **Task 3.2 (SKILL split)**: kimi-result-handling/SKILL.md slimmed to cross-command rules; per-command rendering in `references/ask-render.md` + `references/review-render.md` (gemini G6 closed).
  - **Task 3.3 (schema)**: `plugins/kimi/schemas/review-output.schema.json` copied byte-aligned from gemini-plugin-cc.
  - **Task 3.4 (review lib)**: buildReviewPrompt (strong kimi-specific "no fence / no preamble" constraint), extractReviewJson (3 dirty-modes: bare / fenced / prose+JSON), validateReviewOutput (hand-written minimal validator; required keys + verdict/severity enums + numeric bounds), callKimiReview (1-shot retry wrapper reusing same session).
  - **Task 3.5 (companion)**: runReview subcommand, dispatcher wiring, UNPACK_SAFE_SUBCOMMANDS extended with review + REVIEW_KNOWN_FLAG regex.
  - **Task 3.6 (command)**: /kimi:review command file + polished review-render reference.
  - **Task 3.7 (T5 validation)**: basic review emits schema-complete JSON; empty-diff returns no_changes; invalid-model routes correctly; extractor handles all 3 dirty modes; large-diff truncation works.
- **Exit criteria met**: T5 PASS, empty-diff PASS, invalid-model PASS, extractor-modes PASS, truncation PASS. Git tag `phase-3-review` applied. Cumulative 44/85 tasks (52%).
- **next**: author docs/superpowers/plans/YYYY-MM-DD-phase-4-background-agent.md. Phase 4 adds /kimi:rescue + job-control.mjs + agent subagent + hooks.
```

- [ ] **Step 2: Commit and tag**

```bash
cd /Users/bing/-Code-/kimi-plugin-cc
git add CHANGELOG.md
git commit -m "chore: Phase 3 /kimi:review + retry complete; T5 PASS"
git tag -a phase-3-review -m "Phase 3 complete: /kimi:review with schema + 1-shot retry"
git log --oneline phase-2-polish..HEAD
git tag --list 'phase-*'
```

Expected: `phase-3-review` in tag list; 7-8 new commits since `phase-2-polish`.

---

## Self-Review

**Spec coverage:**
- §4.2 `/kimi:review` row → Task 3.4 + 3.5 + 3.6 ✅
- §4.2 "Prompt 比 gemini 版更啰嗦强约束" → `buildReviewPrompt` kimi-specific block (Task 3.4 Step 2) ✅
- §4.2 "schema 文件在 plugins/kimi/schemas/review-output.schema.json (独立副本)" → Task 3.3 ✅
- §4.2 "后处理 indexOf("{") 找 JSON 起点；parse 失败展示原文 + 告警" → `extractReviewJson` + callKimiReview retry (Task 3.4) ✅
- §6.1 T5 "对 3-5 行样例 diff; schema 齐全" → Task 3.7 Step 2 ✅
- §4.4 `kimi-result-handling` split → Task 3.2 (addresses gemini G6 from plan reviews) ✅

**Review integration audit:**

Phase 2 post-review findings cashed in this phase:
- codex M2 (sessionId-null in JSON/stream) → Task 3.1 Step 2 ✅
- codex M3 (whitespace-only trim) → Task 3.1 Step 1 ✅
- gemini G6 (SKILL modularization) → Task 3.2 ✅

**Phase 3 plan v1 3-way review findings (v1 → v2 integration, 2026-04-20):**

Round 1 (plan v1, 10 findings total):
- **codex C-H1** (High): validateReviewOutput accepted `{findings:[{}]}` (missing per-finding required fields) → Task 3.4 Step 4 extended with `requiredFindingKeys` loop + non-empty title/body checks ✅
- **codex C-H2** (High): buildReviewPrompt throws sync on missing/malformed schema → Task 3.4 Step 5 `callKimiReview` wraps both buildReviewPrompt calls in try/catch, Task 3.5 Step 2 runReview adds defensive outer try/catch ✅
- **codex C-M1** (Medium): extractReviewJson silently accepted trailing content after first balanced object → Task 3.4 Step 3 now rejects trailing `{` or `[` and routes to retry ✅
- **codex C-M2** (Medium): callKimiReview failure shape inconsistent (raw errorResult spread leaked transport fields) → Task 3.4 Step 5 introduces `reviewError()` helper + `transportError` nested field for all non-ok returns ✅
- **codex C-L1 + gemini G-H3 (convergent)**: Task 3.2 scaffold of review-render.md → overwritten in Task 3.6 wasted a write AND duplicated JSON shape + 7-step rules between command.md and reference → Task 3.2 Step 2 now skips review-render.md entirely; Task 3.6 Step 2 creates it with background rationale only (no JSON shape, no step-by-step rules — those stay in command.md) ✅
- **gemini G-H1** (High): T5 test `if d["findings"]` swallowed empty-findings case → Task 3.7 Step 2 now asserts `len(d["findings"]) > 0` and structurally validates first finding's line_start/line_end ✅
- **gemini G-H2** (High): `no_changes` verdict violated schema enum → Task 3.3 Step 1 schema extended to include `"no_changes"` in enum with a description explaining it's companion-side fast-path ✅; validator still rejects `no_changes` from kimi output explicitly (Task 3.4 Step 4 comment)
- **gemini G-M1** (Medium): Chinese severity translation risk → Task 3.4 Step 2 prompt adds explicit "Do NOT translate these to Chinese" rule + retry hint also restates exact English enum ✅
- **gemini G-M2** (Medium): Focus prompt ambiguity → Task 3.4 Step 2 rewritten to "Pay particular attention to: X. You may still report critical issues outside this area." ✅
- **gemini G-M3** (Medium): Truncation warning buried → Task 3.6 Step 1 moves truncation warning to step 1 (BEFORE verdict/summary) with emoji + INCOMPLETE label ✅
- **gemini G-L3** (Low, cheap): stderr breadcrumb for retry → Task 3.4 Step 5 `process.stderr.write` before retry ✅

Round 2 (plan v2): deferred to post-execution — diminishing returns expected per `feedback_review_diminishing_returns.md` since all convergent and single-reviewer-but-clearly-correct findings are integrated.

Explicitly deferred further:
- codex M1 / L1 (cwd realpath, cosmetic shape) — not review-blocking
- gemini G-C2 (E2BIG >1MB) — review budget is 150 KB, well below threshold
- gemini G-M1 thinkBlocks UX — cosmetic
- gemini G-M2 sibling template extraction — Phase 5 scope

**Placeholder scan:** all code blocks have literal values. No `<TBD>` / `<FILL>`. Schema file content is byte-aligned with gemini-plugin-cc intentionally.

**Type consistency:** `buildReviewPrompt` / `extractReviewJson` / `validateReviewOutput` / `callKimiReview` used consistently across Tasks 3.4 + 3.5. `MAX_REVIEW_DIFF_BYTES` referenced in both kimi.mjs (source of truth) and kimi-companion.mjs (caller). Return shapes for ok/error paths match between Task 3.4 Step 5 and the command.md rendering rules in Task 3.6.

**Cross-platform:** No macOS-only features. `child_process` + `spawnSync` identical behavior.

**Security:** Review prompt carries user diff content verbatim into kimi — but the companion already sanitizes via stdin when large. No shell injection possible; all args passed via native `spawn` argv. Schema validation runs on LLM output, not user input; no eval / function constructors.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-04-20-phase-3-review-retry.md` (v2, 1 round of 3-way review integrated).

Two execution options:

**1. Subagent-Driven (recommended)** — one fresh subagent per task (sonnet for kimi.mjs + companion edits; haiku for schema + command.md + skill docs). Serial — most tasks touch kimi.mjs or companion.mjs, so parallel is unsafe.

**2. Inline Execution** — do it in-session.

**Pre-execution review status:** Round 1 of 3-way review (codex + gemini) integrated into v2. Per `feedback_review_diminishing_returns.md`, round 2 is skipped by default because all convergent + clear-signal findings are closed. Proceed to execution.

**Which approach?**

---

## Follow-up plans (written after `phase-3-review` tag)

- `phase-4-background-agent.md` — `/kimi:rescue` + job-control.mjs + agent subagent + hooks
- `phase-5-adversarial-polish.md` — `/kimi:adversarial-review` + skills finalize + lessons.md final
