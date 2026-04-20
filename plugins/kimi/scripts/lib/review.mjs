// Provider-agnostic review primitives. Sibling plugins can import the same
// module; only the prompt builder and model-call wiring are provider-specific.

// ── Constants ─────────────────────────────────────────────
//
// Diff budget for any review pipeline. Current prompts leave margin for the
// schema block, summary, and focus line so the full request stays under a
// conservative ceiling. Callers can override this later if needed.
export const MAX_REVIEW_DIFF_BYTES = 150_000;

// Render-layer notices. These strings flow through JSON fields that command
// files render verbatim, so the warning is not lost on long outputs.
export const TRUNCATION_NOTICE =
  "⚠️ Diff exceeded the review budget; only the first 150 KB was reviewed. Findings below are INCOMPLETE. Consider narrowing scope (--scope staged) or running per-path.";
export const RETRY_NOTICE =
  "(The first response was malformed; the retry succeeded.)";

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
