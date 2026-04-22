// Provider-agnostic review primitives. Sibling plugins can import the same
// module; only the prompt builder and model-call wiring are provider-specific.

import { errorResult } from "./errors.mjs";

// ── Constants ─────────────────────────────────────────────
//
// Diff budget for any review pipeline. Current prompts leave margin for the
// schema block, summary, and focus line so the full request stays under a
// conservative ceiling. Callers can override via `runReviewPipeline`'s
// `maxDiffChars` / `truncationNotice` / `retryNotice` options when the
// provider has a smaller context window (gemini 5-way-review H3 +
// qwen 5-way-review M1): sibling plugins with a 32k-context model would
// otherwise hard-fail on 150 KB diffs.
//
// Name kept for back-compat. NB: measurement is JS string length
// (UTF-16 code units, i.e. chars, NOT UTF-8 bytes). The companion's
// truncation check uses `context.content.length` at ~kimi-companion.mjs:417
// and ~:534. New callers / sibling plugins should think in "chars";
// a fresh refactor can rename when the existing consumers are touched.
export const MAX_REVIEW_DIFF_BYTES = 150_000;

// Render-layer notices. These strings flow through JSON fields that command
// files render verbatim, so the warning is not lost on long outputs.
// The truncation notice includes a template-variable `{BUDGET_KB}` that
// `formatTruncationNotice` substitutes with the actual effective budget.
export const TRUNCATION_NOTICE_TEMPLATE =
  "⚠️ Diff exceeded the review budget; only the first {BUDGET_KB} KB was reviewed. Findings below are INCOMPLETE. Consider narrowing scope (--scope staged) or running per-path.";
export const TRUNCATION_NOTICE = formatTruncationNotice(MAX_REVIEW_DIFF_BYTES);
export const RETRY_NOTICE =
  "(The first response was malformed; the retry succeeded.)";

// Build a truncation notice string matching the caller's effective budget.
// Exported so sibling plugins can construct a notice that matches their own
// `MAX_REVIEW_DIFF_BYTES` override without copy-pasting the template text.
export function formatTruncationNotice(maxDiffBytes) {
  // Decimal KB (1000 bytes) matches the intent of `MAX_REVIEW_DIFF_BYTES =
  // 150_000` → "150 KB" rather than the 146 KB you'd get from 1024-based
  // division. Consistent with how the constant is spelled.
  const budgetKb = Math.round(maxDiffBytes / 1000);
  return TRUNCATION_NOTICE_TEMPLATE.replace("{BUDGET_KB}", String(budgetKb));
}

// ── JSON extraction ──────────────────────────────────────
//
// Handles 3 dirty modes observed from LLMs: (a) bare JSON, (b) ```json ... ```
// markdown fence, (c) prose preamble then JSON. Walks balanced braces so
// trailing prose after valid JSON is tolerated; rejects multiple top-level
// JSON values.
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

// ── Schema validation ────────────────────────────────────
//
// Hand-written validator for review-output.schema.json. Checks:
//   (1) required top-level keys
//   (2) verdict enum (approve | needs-attention) — NOT "no_changes"
//   (3) per-finding required fields
//   (4) severity enum + numeric bounds on confidence/line_start/line_end
// Zero-deps rule: not a full JSON Schema implementation; only the rules the
// command contract actually depends on.
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
          errors.push(`findings[${i}].severity must be critical|high|medium|low, got ${JSON.stringify(f.severity)}`);
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
        // Reverse-range guard (codex 4-way-review L4): `line_end >=
        // line_start` is a semantic invariant the prompt implies but the
        // schema doesn't spell out; without the check, `{start: 42, end: 10}`
        // passes validation and downstream renderers show "42-10" which
        // confuses users.
        if (Number.isInteger(f.line_start) && Number.isInteger(f.line_end) && f.line_end < f.line_start) {
          errors.push(`findings[${i}].line_end (${f.line_end}) must be >= line_start (${f.line_start})`);
        }
      });
    }
  }
  if ("next_steps" in data && !Array.isArray(data.next_steps)) {
    errors.push("next_steps must be an array");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// All non-ok returns from the shared review pipeline go through this helper so
// render-layer consumers see a consistent failure shape.
// `truncationNotice` / `retryNotice` default to the module-level constants so
// external callers (non-pipeline) keep the v0.1 shape. `runReviewPipeline`
// threads the caller-effective values (derived from `maxDiffChars`) through
// every call site below so sibling plugins with a smaller budget don't see a
// "150 KB" notice on error paths (T5 I1).
export function reviewError({
  error, rawText = null, parseError = null, firstRawText = null,
  transportError = null, truncated, retry_used, sessionId = null,
  status = null,
  truncationNotice = TRUNCATION_NOTICE,
  retryNotice = RETRY_NOTICE,
}) {
  return {
    // Compose canonical envelope (ok, kind, error, status, stdout, detail)
    // from ./errors.mjs, then layer on the pipeline-specific fields. Top-level
    // `status` mirrors the transport-layer `streamErrorResult` shape in
    // kimi.mjs so downstream exit-code mappers see a consistent field
    // regardless of whether the failure originated in the transport layer or
    // the review pipeline (qwen 4-way-review M2). Non-transport failures
    // default to null; transport failures propagate status via
    // `transportError.status` AND copy to top-level `status` for direct
    // consumption. Adversarial callers can override `kind` at their call site
    // if they need to.
    ...errorResult({ kind: "review", error, status: status ?? (transportError?.status ?? null) }),
    rawText,
    parseError,
    firstRawText,
    transportError,
    truncated,
    truncation_notice: truncated ? truncationNotice : null,
    retry_used,
    retry_notice: retry_used ? retryNotice : null,
    sessionId,
  };
}

// ── Pipeline orchestrator ──────────────────────────────────
//
// Drives the build → call → extract → validate → retry-once loop. Provider
// injects:
//   buildPrompt({ context, focus, schemaPath, retryHint }) → string
//   callLLM({ prompt, model, cwd, timeout, resumeSessionId })
//     → { ok, response, sessionId?, status?, partialResponse?, error? }
// Sibling plugins provide their own pair. The pipeline never imports a
// provider module — all binding happens at the call site.
//
// Returns success-shape: { ok:true, ...parsedReview, truncated, truncation_notice,
// retry_used, retry_notice, sessionId }, or reviewError-shape on failure.
//
// `retryWarning` defaults to a neutral string so sibling plugins that inherit
// this module get the same observability breadcrumb; callers can override
// (or pass null to suppress) if they need a provider-specific label.
// `truncationNotice` / `retryNotice` overrides let sibling plugins with a
// different `maxDiffChars` budget emit a matching user-facing note
// (gemini 5-way-review H3 + qwen 5-way-review M1). Defaults mirror the
// exported `TRUNCATION_NOTICE` / `RETRY_NOTICE` constants.
export function runReviewPipeline({
  buildPrompt, callLLM,
  context, focus = null, schemaPath,
  model = null, cwd = process.cwd(), timeout,
  truncated = false,
  retryWarning = "Warning: review response failed parse/validation; retrying once with error hint...\n",
  maxDiffChars = MAX_REVIEW_DIFF_BYTES,
  truncationNotice = formatTruncationNotice(maxDiffChars),
  retryNotice = RETRY_NOTICE,
} = {}) {
  let firstPrompt;
  try {
    firstPrompt = buildPrompt({ context, focus, schemaPath });
  } catch (e) {
    return reviewError({
      error: `Failed to build review prompt: ${e.message}`,
      truncated,
      retry_used: false,
      truncationNotice,
      retryNotice,
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
      truncationNotice,
      retryNotice,
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
        truncation_notice: truncated ? truncationNotice : null,
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
      truncationNotice,
      retryNotice,
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
      truncationNotice,
      retryNotice,
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
      truncationNotice,
      retryNotice,
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
      truncationNotice,
      retryNotice,
    });
  }

  return {
    ok: true,
    ...retryExtracted.data,
    truncated,
    truncation_notice: truncated ? truncationNotice : null,
    retry_used: true,
    retry_notice: retryNotice,
    sessionId: retryResult.sessionId,
  };
}
