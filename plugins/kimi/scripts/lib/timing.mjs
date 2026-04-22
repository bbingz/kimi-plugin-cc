// plugins/kimi/scripts/lib/timing.mjs
// 3-term timing telemetry (cold / stream / tail) for kimi-plugin-cc.
// Mirrors minimax 3-term schema with invariantKind="3term".
// See docs/superpowers/specs/2026-04-22-v0.2-p1-timing-design.md for rationale.

import fs from "node:fs";
import path from "node:path";
import { resolveTimingsFile, resolveTimingsLockFile } from "./paths.mjs";

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

const TIMING_MAX_BYTES       = Number(process.env.KIMI_MAX_TIMING_BYTES || 10 * 1024 * 1024);
const TIMING_LOCK_STALE_MS   = 30_000;
const TIMING_LOCK_POLL_MS    = 25;
const TIMING_LOCK_TIMEOUT_MS = 5_000;

export function appendTimingHistory(jobId, kind, record) {
  const file = resolveTimingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const envelope = {
    jobId,
    kind,
    recordedAt: Date.now(),
    schemaVersion: 1,
    ...record,
  };

  const lock = acquireTimingLockSync();
  if (!lock) {
    try { process.stderr.write(`[timing] lock acquire timeout; dropping record ${jobId || "?"}\n`); } catch {}
    return false;
  }
  try {
    let leadingNewline = "";
    try {
      const st = fs.statSync(file);
      if (st.size > 0) {
        const buf = Buffer.alloc(1);
        const fd = fs.openSync(file, "r");
        try { fs.readSync(fd, buf, 0, 1, st.size - 1); }
        finally { fs.closeSync(fd); }
        if (buf[0] !== 0x0A) leadingNewline = "\n";
      }
    } catch { /* fresh file */ }

    const line = leadingNewline + JSON.stringify(envelope) + "\n";
    fs.appendFileSync(file, line);

    try {
      const st = fs.statSync(file);
      if (st.size > TIMING_MAX_BYTES) {
        const raw = fs.readFileSync(file, "utf8");
        const lines = raw.split("\n").filter(Boolean);
        const valid = [];
        for (const l of lines) {
          try { JSON.parse(l); valid.push(l); } catch { /* drop invalid */ }
        }
        const keep = valid.slice(Math.floor(valid.length / 2));
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, keep.join("\n") + "\n");
        fs.renameSync(tmp, file);
      }
    } catch (e) {
      try { process.stderr.write(`[timing] trim failed (record already appended): ${e.message}\n`); } catch {}
    }
    return true;
  } finally {
    lock.release();
  }
}

function acquireTimingLockSync() {
  const lockFile = resolveTimingsLockFile();
  const start = Date.now();

  while (Date.now() - start < TIMING_LOCK_TIMEOUT_MS) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      const ourInode = fs.statSync(lockFile).ino;
      return {
        release: () => {
          try {
            const st = fs.statSync(lockFile);
            if (st.ino === ourInode) fs.unlinkSync(lockFile);
          } catch {}
        },
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;

      let stale = false;
      try {
        const st0 = fs.statSync(lockFile);
        if (Date.now() - st0.mtimeMs > TIMING_LOCK_STALE_MS) {
          stale = true;
        } else {
          const pid = Number((fs.readFileSync(lockFile, "utf8") || "").trim());
          if (pid && !pidAlive(pid)) {
            const st1 = fs.statSync(lockFile);
            if (st1.ino === st0.ino) stale = true;
          }
        }
      } catch { /* gone between ops; retry */ }

      if (stale) { try { fs.unlinkSync(lockFile); } catch {} }

      const until = Date.now() + TIMING_LOCK_POLL_MS;
      while (Date.now() < until) { /* spin */ }
    }
  }
  return null;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code !== "ESRCH"; }
}

export function loadTimingHistory({ limit = null } = {}) {
  const file = resolveTimingsFile();
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { if (e.code === "ENOENT") return []; throw e; }

  if (text.length > 0 && !text.endsWith("\n")) {
    const lastNewline = text.lastIndexOf("\n");
    text = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : "";
  }

  const records = [];
  let lineNum = 0;
  for (const line of text.split("\n")) {
    lineNum += 1;
    if (!line) continue;
    try { records.push(JSON.parse(line)); }
    catch { try { process.stderr.write(`[timing] skipping malformed record at line ${lineNum}\n`); } catch {} }
  }
  return limit != null ? records.slice(-limit) : records;
}
