import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { resolveTimingsFile, resolveTimingsLockFile } from "../plugins/kimi/scripts/lib/paths.mjs";

import {
  TimingAccumulator,
  appendTimingHistory,
  loadTimingHistory,
} from "../plugins/kimi/scripts/lib/timing.mjs";

describe("paths.mjs — timing helpers", () => {
  it("resolveTimingsFile() returns ~/.kimi/plugin-cc/timings.ndjson", () => {
    const expected = path.join(os.homedir(), ".kimi", "plugin-cc", "timings.ndjson");
    assert.equal(resolveTimingsFile(), expected);
  });

  it("resolveTimingsLockFile() returns ~/.kimi/plugin-cc/timings.ndjson.lock", () => {
    const expected = path.join(os.homedir(), ".kimi", "plugin-cc", "timings.ndjson.lock");
    assert.equal(resolveTimingsLockFile(), expected);
  });
});

describe("TimingAccumulator — toJSON()", () => {
  const baseInput = {
    spawnedAt:     1000,
    firstEventAt:  1200,
    lastEventAt:   4900,
    closedAt:      5000,
    exitCode:      0,
    signal:        null,
    timedOut:      false,
    bgWaitEntered: false,
    prompt:        "hi",
    response:      "hello",
    requestedModel: "kimi-code/kimi-for-coding",
  };

  it("normal success: all 4 timestamps present → invariantOk=true; sum = totalMs", () => {
    const r = new TimingAccumulator(baseInput).toJSON();
    assert.equal(r.firstEventMs, 200);
    assert.equal(r.streamMs, 3700);
    assert.equal(r.tailMs, 100);
    assert.equal(r.totalMs, 4000);
    assert.equal(r.invariantOk, true);
    assert.equal(r.terminationReason, "exit");
  });

  it("no parseable event before close → all three intervals null; invariantOk=false; totalMs set", () => {
    const r = new TimingAccumulator({ ...baseInput, firstEventAt: null, lastEventAt: null }).toJSON();
    assert.equal(r.firstEventMs, null);
    assert.equal(r.streamMs, null);
    assert.equal(r.tailMs, null);
    assert.equal(r.totalMs, 4000);
    assert.equal(r.invariantOk, false);
  });

  it("clock skew: firstEventAt < spawnedAt → invariantOk=false", () => {
    const r = new TimingAccumulator({ ...baseInput, firstEventAt: 900 }).toJSON();
    assert.equal(r.firstEventMs, -100);
    assert.equal(r.invariantOk, false);
  });

  it("terminationReason priority: timedOut > signal > error > exit", () => {
    assert.equal(new TimingAccumulator({ ...baseInput, timedOut: true, signal: "SIGTERM", exitCode: 1 }).toJSON().terminationReason, "timeout");
    assert.equal(new TimingAccumulator({ ...baseInput, signal: "SIGTERM", exitCode: 1 }).toJSON().terminationReason, "signal");
    assert.equal(new TimingAccumulator({ ...baseInput, exitCode: 1 }).toJSON().terminationReason, "error");
    assert.equal(new TimingAccumulator(baseInput).toJSON().terminationReason, "exit");
  });

  it("invariantOk requires non-negative intervals: positive tailMs passes, negative fails (clock-went-backwards case)", () => {
    // Baseline: all intervals positive, invariantOk=true
    const r1 = new TimingAccumulator(baseInput).toJSON();
    assert.equal(r1.invariantOk, true);
    assert.equal(r1.tailMs, 100);

    // Force tailMs negative: closedAt (4899) < lastEventAt (4900)
    // Simulates system clock adjustment mid-run — honest invariant failure.
    const r2 = new TimingAccumulator({ ...baseInput, closedAt: 4899 }).toJSON();
    assert.equal(r2.tailMs, -1);
    assert.equal(r2.invariantOk, false);
  });

  it("invariantKind always '3term' literal", () => {
    assert.equal(new TimingAccumulator(baseInput).toJSON().invariantKind, "3term");
  });

  it("toJSON() returns exactly 21 inner fields", () => {
    const r = new TimingAccumulator(baseInput).toJSON();
    assert.equal(Object.keys(r).length, 21);
  });

  it("promptBytes / responseBytes = Buffer.byteLength utf8", () => {
    let r = new TimingAccumulator({ ...baseInput, prompt: "hi", response: "hello" }).toJSON();
    assert.equal(r.promptBytes, 2);
    assert.equal(r.responseBytes, 5);
    r = new TimingAccumulator({ ...baseInput, prompt: "你好", response: "世界" }).toJSON();
    assert.equal(r.promptBytes, 6);
    assert.equal(r.responseBytes, 6);
    r = new TimingAccumulator({ ...baseInput, prompt: "", response: "" }).toJSON();
    assert.equal(r.promptBytes, 0);
    assert.equal(r.responseBytes, 0);
  });

  it("spawnedAt emitted as number (epoch ms), NOT ISO string — v3 CR4 regression guard", () => {
    const r = new TimingAccumulator(baseInput).toJSON();
    assert.equal(typeof r.spawnedAt, "number");
    assert.equal(r.spawnedAt, 1000);
  });

  it("bgWaitEntered boolean passes through to toJSON output", () => {
    const r = new TimingAccumulator({ ...baseInput, bgWaitEntered: true }).toJSON();
    assert.equal(r.bgWaitEntered, true);
  });
});

// Test isolation helpers — each test runs in a fresh tmp HOME so timings file is pristine.
let origHome;
function setupIsolatedHome() {
  origHome = process.env.HOME;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-timing-test-"));
  process.env.HOME = tmp;
  return tmp;
}
function teardownHome(tmp) {
  process.env.HOME = origHome;
  fs.rmSync(tmp, { recursive: true, force: true });
}

describe("appendTimingHistory + loadTimingHistory", () => {
  it("first call creates file + parent dir + envelope fields", () => {
    const tmp = setupIsolatedHome();
    try {
      const record = new TimingAccumulator({
        spawnedAt: 1000, firstEventAt: 1200, lastEventAt: 4900, closedAt: 5000,
      }).toJSON();
      const ok = appendTimingHistory("job-abc", "ask", record);
      assert.equal(ok, true);

      const file = resolveTimingsFile();
      assert.ok(fs.existsSync(file), "file created");
      const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      assert.equal(lines.length, 1);
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.jobId, "job-abc");
      assert.equal(parsed.kind, "ask");
      assert.equal(parsed.schemaVersion, 1);
      assert.equal(typeof parsed.recordedAt, "number");
      assert.equal(parsed.invariantKind, "3term");
      // Envelope (4) + inner (21) = 25 total
      assert.equal(Object.keys(parsed).length, 25);
    } finally { teardownHome(tmp); }
  });

  it("subsequent calls append; file ends with \\n", () => {
    const tmp = setupIsolatedHome();
    try {
      const record = new TimingAccumulator({ spawnedAt: 1, firstEventAt: 2, lastEventAt: 3, closedAt: 4 }).toJSON();
      appendTimingHistory("job-1", "ask", record);
      appendTimingHistory("job-2", "review", record);
      const text = fs.readFileSync(resolveTimingsFile(), "utf8");
      assert.ok(text.endsWith("\n"));
      assert.equal(text.split("\n").filter(Boolean).length, 2);
    } finally { teardownHome(tmp); }
  });

  it("crash-recovery leading newline: if file lacks trailing \\n, next append prepends one", () => {
    const tmp = setupIsolatedHome();
    try {
      const file = resolveTimingsFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Simulate a torn write — valid JSON but no trailing newline
      fs.writeFileSync(file, '{"jobId":"torn","kind":"ask","recordedAt":1,"schemaVersion":1}');
      const record = new TimingAccumulator({ spawnedAt: 1, firstEventAt: 2, lastEventAt: 3, closedAt: 4 }).toJSON();
      appendTimingHistory("job-fresh", "ask", record);
      const text = fs.readFileSync(file, "utf8");
      // Expect \n between torn record and fresh one
      const lines = text.split("\n").filter(Boolean);
      assert.equal(lines.length, 2);
      assert.equal(JSON.parse(lines[0]).jobId, "torn");
      assert.equal(JSON.parse(lines[1]).jobId, "job-fresh");
    } finally { teardownHome(tmp); }
  });

  it("loadTimingHistory returns [] when file missing", () => {
    const tmp = setupIsolatedHome();
    try {
      assert.deepEqual(loadTimingHistory(), []);
    } finally { teardownHome(tmp); }
  });

  it("loadTimingHistory strips truncated last line before splitting", () => {
    const tmp = setupIsolatedHome();
    try {
      const file = resolveTimingsFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Valid line + truncated partial line (no closing brace; no trailing newline)
      fs.writeFileSync(file, '{"jobId":"a","kind":"ask","recordedAt":1,"schemaVersion":1,"invariantKind":"3term"}\n{"jobId":"b","kind');
      const records = loadTimingHistory();
      assert.equal(records.length, 1);
      assert.equal(records[0].jobId, "a");
    } finally { teardownHome(tmp); }
  });

  it("loadTimingHistory with limit=N returns last N records", () => {
    const tmp = setupIsolatedHome();
    try {
      const record = new TimingAccumulator({ spawnedAt: 1, firstEventAt: 2, lastEventAt: 3, closedAt: 4 }).toJSON();
      for (let i = 0; i < 5; i++) appendTimingHistory(`job-${i}`, "ask", record);
      const last3 = loadTimingHistory({ limit: 3 });
      assert.equal(last3.length, 3);
      assert.equal(last3[0].jobId, "job-2");
      assert.equal(last3[2].jobId, "job-4");
    } finally { teardownHome(tmp); }
  });

  // v2 additions (S1, S3 edge cases):
  it("envelope fields spawnedAt/recordedAt are both typeof number — guards minimax ISO drift (S1)", () => {
    const tmp = setupIsolatedHome();
    try {
      const record = new TimingAccumulator({
        spawnedAt: 1000, firstEventAt: 1200, lastEventAt: 4900, closedAt: 5000,
      }).toJSON();
      appendTimingHistory("job-x", "ask", record);
      const line = fs.readFileSync(resolveTimingsFile(), "utf8").split("\n").filter(Boolean)[0];
      const parsed = JSON.parse(line);
      assert.equal(typeof parsed.spawnedAt, "number", "spawnedAt must be epoch ms number, NOT ISO string");
      assert.equal(typeof parsed.recordedAt, "number", "recordedAt must be epoch ms number");
    } finally { teardownHome(tmp); }
  });

  it("empty jobId accepted — envelope records jobId as empty string (S3 edge case)", () => {
    const tmp = setupIsolatedHome();
    try {
      const record = new TimingAccumulator({ spawnedAt: 1, firstEventAt: 2, lastEventAt: 3, closedAt: 4 }).toJSON();
      const ok = appendTimingHistory("", "ask", record);
      assert.equal(ok, true);
      const parsed = JSON.parse(fs.readFileSync(resolveTimingsFile(), "utf8").split("\n").filter(Boolean)[0]);
      assert.equal(parsed.jobId, "", "empty jobId stored as empty string, not undefined");
    } finally { teardownHome(tmp); }
  });

  it("lock timeout returns false without throwing (S3 edge case)", () => {
    const tmp = setupIsolatedHome();
    try {
      // Simulate held lock by creating the lockfile with a live pid (process.pid itself)
      fs.mkdirSync(path.dirname(resolveTimingsLockFile()), { recursive: true });
      fs.writeFileSync(resolveTimingsLockFile(), String(process.pid));
      const record = new TimingAccumulator({ spawnedAt: 1, firstEventAt: 2, lastEventAt: 3, closedAt: 4 }).toJSON();
      // With a live-pid lockfile younger than stale_ms, acquire will time out → return false
      const ok = appendTimingHistory("job-blocked", "ask", record);
      assert.equal(ok, false);
      // Clean up the manufactured lock
      try { fs.unlinkSync(resolveTimingsLockFile()); } catch {}
    } finally { teardownHome(tmp); }
  });
});
