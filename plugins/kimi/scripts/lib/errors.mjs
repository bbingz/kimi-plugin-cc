// Canonical transport-error / catch-wrapper envelope.
//
// Shared by every `run*` handler in the companion, the defensive
// prompt-size cap in the provider transport module (C3), and the review
// pipeline's `reviewError` (which composes this shape + pipeline-specific
// fields).
//
// Lives in its own leaf module to sidestep the circular dependency
// that would exist if the helper were in job-control.mjs (which
// imports from the provider transport module) or the transport module
// itself (whose local `streamErrorResult` serves a different purpose —
// see the transport module's comment at the rename).
//
// Zero provider-specific strings — siblings copy verbatim.

export function errorResult({ kind = null, error, status = null, stdout = "", detail = null } = {}) {
  return { ok: false, kind, error, status, stdout, detail };
}
