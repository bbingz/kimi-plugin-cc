import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Realpath-normalize cwd so spawn and session-id lookup hash to the
// same workspace slug regardless of /tmp → /private/tmp symlinks on
// macOS or similar. Returns original cwd on ENOENT / EACCES.
//
// This file contains zero provider-specific strings — sibling plugins
// (minimax / qwen / doubao) copy verbatim, no substitution needed.
// Closes the "v0.2 gap" flagged in lessons.md §Pit 4.
export function resolveRealCwd(cwd) {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return cwd;
  }
}

export function resolveTimingsFile() {
  return path.join(os.homedir(), ".kimi", "plugin-cc", "timings.ndjson");
}

export function resolveTimingsLockFile() {
  return path.join(os.homedir(), ".kimi", "plugin-cc", "timings.ndjson.lock");
}
