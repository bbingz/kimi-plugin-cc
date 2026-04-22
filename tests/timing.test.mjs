import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { resolveTimingsFile, resolveTimingsLockFile } from "../plugins/kimi/scripts/lib/paths.mjs";

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
