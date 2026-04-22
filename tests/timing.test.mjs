import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { resolveTimingsFile, resolveTimingsLockFile } from "../plugins/kimi/scripts/lib/paths.mjs";

import { TimingAccumulator } from "../plugins/kimi/scripts/lib/timing.mjs";

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
