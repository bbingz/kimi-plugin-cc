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

export function percentile(values, p) {
  const filtered = values.filter((v) => v != null && typeof v === "number" && Number.isFinite(v));
  if (filtered.length === 0) return null;
  const sorted = filtered.slice().sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[idx];
}

const SINCE_RE = /^(\d+)([mhd])$/;
const SINCE_RANGES = {
  m: { min: 1, max: 9999 },
  h: { min: 1, max: 9999 },
  d: { min: 1, max: 365 },
};

function parseSince(value) {
  const m = String(value).match(SINCE_RE);
  if (!m) throw new Error(`invalid --since value '${value}' (expected e.g. 30m, 24h, 7d)`);
  const n = Number(m[1]);
  const unit = m[2];
  const range = SINCE_RANGES[unit];
  if (n < range.min || n > range.max) {
    throw new Error(`--since '${value}' out of range (minutes 1-9999, hours 1-9999, days 1-365)`);
  }
  const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * multiplier;
}

export function filterHistory(records, { kind, last, since } = {}) {
  let out = records;
  if (kind != null) out = out.filter((r) => r.kind === kind);
  if (since != null) {
    const cutoffMs = parseSince(since);
    const threshold = Date.now() - cutoffMs;
    out = out.filter((r) => (r.recordedAt ?? 0) >= threshold);
  }
  if (last != null && last > 0) out = out.slice(-last);
  return out;
}

const PERCENTILE_CUTOFFS = { p50: 1, p95: 20, p99: 100 };
const METRICS = ["firstEventMs", "streamMs", "tailMs", "totalMs"];

export function computeAggregateStats(records) {
  // Drop records with invariantOk=false or bgWaitEntered=true (tail pollution)
  const excludedInvariant = records.filter((r) => r.timing?.invariantOk === false).length;
  const excludedBgWait = records.filter((r) => r.timing?.bgWaitEntered === true).length;
  const valid = records.filter(
    (r) => r.timing?.invariantOk !== false && r.timing?.bgWaitEntered !== true
  );

  const n = valid.length;
  const percentiles = {};
  for (const [p, cutoff] of Object.entries(PERCENTILE_CUTOFFS)) {
    if (n < cutoff) { percentiles[p] = null; continue; }
    const row = {};
    for (const m of METRICS) {
      row[m] = percentile(valid.map((r) => r.timing?.[m]), Number(p.slice(1)) / 100);
    }
    percentiles[p] = row;
  }

  let slowest = null;
  for (const r of valid) {
    const total = r.timing?.totalMs || 0;
    if (!slowest || total > slowest.totalMs) {
      slowest = { jobId: r.jobId, totalMs: total };
    }
  }

  return {
    validCount: n,
    excludedInvariant,
    excludedBgWait,
    percentiles,
    slowest,
  };
}

function formatMs(ms) {
  if (ms == null) return "—";
  return `${Math.round(ms)}`;
}

function truncateId(id, max = 13) {
  if (!id) return "???";
  return id.length <= max ? id : id.slice(0, max - 3) + "...";
}

function formatBar(value, max, width = 20) {
  if (max <= 0 || value == null || value < 0) return "";
  const chars = Math.round((value / max) * width);
  return "█".repeat(Math.max(0, Math.min(width, chars))) || "▏";
}

const FOOTER_NOTE =
  "Served model: unknown (1.37 does not surface per-model usage — see doc/probe/probe-results-v4.json Q1)";

export function renderSingleJobDetail(record) {
  if (!record) return "No timing record.\n";
  const lines = [];
  const { jobId, kind, requestedModel, totalMs, firstEventMs, streamMs, tailMs,
          promptBytes, responseBytes, exitCode, terminationReason, invariantOk,
          invariantKind, bgWaitEntered } = record;

  // Compact fallback for small totals (spec §4 SH4 fix)
  if (totalMs != null && totalMs < 200) {
    lines.push(
      `Job ${jobId} (kind=${kind}, total=${formatMs(totalMs)} ms)  ` +
      `cold ${formatMs(firstEventMs)} · stream ${formatMs(streamMs)} · tail ${formatMs(tailMs)}  ` +
      `${invariantOk ? "✓" : "✗"} ${invariantKind} v1`
    );
    if (bgWaitEntered) lines.push(`  Note: bgWaitEntered=true — tail may include bg-poll wait, excluded from --stats.`);
    return lines.join("\n") + "\n";
  }

  // Full bar-chart detail
  lines.push(`Job ${jobId} (kind=${kind}, model=${requestedModel || "null"})`);
  lines.push("─".repeat(59));
  const intervals = [
    ["cold    (spawn → 1st event)", firstEventMs],
    ["stream  (1st → last event)", streamMs],
    ["tail    (last event → close)", tailMs],
  ];
  const maxInterval = Math.max(...intervals.map(([, v]) => v ?? 0));
  for (const [label, v] of intervals) {
    const msStr = formatMs(v).padStart(6);
    const bar = formatBar(v, maxInterval);
    lines.push(`  ${label}  ${msStr} ms   ${bar}`);
  }
  lines.push("  " + "─".repeat(41));
  lines.push(`  total                            ${formatMs(totalMs).padStart(4)} ms`);
  lines.push("");
  lines.push(`  prompt bytes:    ${promptBytes}`);
  lines.push(`  response bytes:  ${responseBytes}`);
  lines.push(`  exit:            ${exitCode ?? "null"} (${terminationReason})`);
  lines.push(`  schema:          ${invariantKind} v1  ${invariantOk ? "✓ invariant OK" : "✗ invariant broken"}`);
  lines.push("");
  if (bgWaitEntered) {
    lines.push(`  Note: bgWaitEntered=true — tail may include bg-poll wait, excluded from --stats.`);
  }
  lines.push(`  ${FOOTER_NOTE}`);
  return lines.join("\n") + "\n";
}

export function renderHistoryTable(records, { kind = "all", since = "all" } = {}) {
  if (!records || records.length === 0) {
    return "No timing records matched the current filters.\n";
  }
  const lines = [];
  lines.push(`Last ${records.length} jobs (kind=${kind}, since=${since}):`);
  lines.push("");
  lines.push("JobId         Kind    Cold   Stream   Tail   Total    Model                    Exit  ✓");
  for (const r of records) {
    const cold = r.firstEventMs ?? null;
    const stream = r.streamMs ?? null;
    const tail = r.tailMs ?? null;
    const total = r.totalMs ?? null;
    const mark = r.invariantOk ? "✓" : `✗ (${r.terminationReason || "?"})`;
    const model = (r.requestedModel || "").slice(0, 24).padEnd(24);
    lines.push(
      `${truncateId(r.jobId).padEnd(13)} ` +
      `${(r.kind || "").padEnd(7)} ` +
      `${(cold == null ? "--" : formatMs(cold)).padStart(4)}  ` +
      `${(stream == null ? "--" : formatMs(stream)).padStart(6)} ` +
      `${(tail == null ? "--" : formatMs(tail)).padStart(5)} ` +
      `${(total == null ? "--" : formatMs(total)).padStart(6)}  ` +
      `${model} ` +
      `${String(r.exitCode ?? "-").padStart(3)}  ${mark}`
    );
  }
  return lines.join("\n") + "\n";
}

export function renderAggregateTable(stats, { kind = "all" } = {}) {
  if (!stats || stats.validCount === 0) {
    return "No timing records matched the current filters.\n";
  }
  const lines = [];
  const header = `Aggregate stats (kind=${kind}, n=${stats.validCount} valid`;
  const parts = [header];
  if (stats.excludedInvariant > 0) parts.push(` / ${stats.excludedInvariant} excluded for invariantOk=false`);
  if (stats.excludedBgWait > 0)    parts.push(` / ${stats.excludedBgWait} excluded for bgWaitEntered=true`);
  parts.push("):");
  lines.push(parts.join(""));
  lines.push("");
  lines.push("              Cold       Stream      Tail      Total");
  for (const p of ["p50", "p95", "p99"]) {
    const row = stats.percentiles[p];
    if (!row) {
      lines.push(`${p.padEnd(14)}—`);
      continue;
    }
    lines.push(
      `${p.padEnd(14)}` +
      `${formatMs(row.firstEventMs).padStart(6)}  ` +
      `${formatMs(row.streamMs).padStart(10)}  ` +
      `${formatMs(row.tailMs).padStart(6)}  ` +
      `${formatMs(row.totalMs).padStart(10)}`
    );
  }
  lines.push("");
  if (stats.slowest) {
    lines.push(`Slowest: ${stats.slowest.jobId} (total=${stats.slowest.totalMs} ms)`);
    lines.push("");
  }
  lines.push("Note: 3-term schema — ttft/tool/retry/per-model metrics not available on kimi 1.37.");
  lines.push("      (see doc/probe/probe-results-v4.json §implications_for_p1_timing)");
  return lines.join("\n") + "\n";
}
