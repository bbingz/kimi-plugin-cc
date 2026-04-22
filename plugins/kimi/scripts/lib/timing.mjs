// plugins/kimi/scripts/lib/timing.mjs
// 3-term timing telemetry (cold / stream / tail) for kimi-plugin-cc.
// Mirrors minimax 3-term schema with invariantKind="3term".
// See docs/superpowers/specs/2026-04-22-v0.2-p1-timing-design.md for rationale.

export class TimingAccumulator {
  constructor({
    spawnedAt,
    firstEventAt,
    lastEventAt,
    closedAt,
    timedOut = false,
    bgWaitEntered = false,
    exitCode = null,
    signal = null,
    prompt = "",
    response = "",
    requestedModel = null,
  } = {}) {
    this._spawnedAt = spawnedAt;
    this._firstEventAt = firstEventAt;
    this._lastEventAt = lastEventAt;
    this._closedAt = closedAt;
    this._exitCode = exitCode;
    this._signal = signal;
    this._timedOut = timedOut;
    this._bgWaitEntered = bgWaitEntered;
    this._promptBytes = Buffer.byteLength(prompt || "", "utf8");
    this._responseBytes = Buffer.byteLength(response || "", "utf8");
    this._requestedModel = requestedModel;
  }

  toJSON() {
    const firstEventMs = this._firstEventAt != null
      ? this._firstEventAt - this._spawnedAt : null;
    const streamMs = (this._firstEventAt != null && this._lastEventAt != null)
      ? this._lastEventAt - this._firstEventAt : null;
    const tailMs = (this._lastEventAt != null && this._closedAt != null)
      ? this._closedAt - this._lastEventAt : null;
    const totalMs = this._closedAt != null
      ? this._closedAt - this._spawnedAt : null;

    const allPresent  = firstEventMs != null && streamMs != null && tailMs != null && totalMs != null;
    const allNonNeg   = allPresent && firstEventMs >= 0 && streamMs >= 0 && tailMs >= 0 && totalMs >= 0;
    const sumInTol    = allPresent && Math.abs(totalMs - (firstEventMs + streamMs + tailMs)) <= 1;
    const invariantOk = allPresent && allNonNeg && sumInTol;

    let terminationReason;
    if (this._timedOut) terminationReason = "timeout";
    else if (this._signal) terminationReason = "signal";
    else if (this._exitCode != null && this._exitCode !== 0) terminationReason = "error";
    else terminationReason = "exit";

    return {
      spawnedAt: this._spawnedAt,
      firstEventMs,
      ttftMs: null,
      streamMs,
      toolMs: null,
      retryMs: null,
      tailMs,
      totalMs,
      promptBytes: this._promptBytes,
      responseBytes: this._responseBytes,
      exitCode: this._exitCode,
      terminationReason,
      timedOut: this._timedOut,
      signal: this._signal,
      bgWaitEntered: this._bgWaitEntered,
      requestedModel: this._requestedModel,
      usage: [],
      tokensPerSec: null,
      coldStartPhases: null,
      invariantOk,
      invariantKind: "3term",
    };
  }
}
