# Probe 06: Fresh-path upsert behavior

This probe was added after 3-way review of Phase 0. Gemini [P1] required empirical validation of the "first call from a brand-new work directory" branch. Codex source-read had confirmed upsert logic in `kimi_cli/session.py::Session.create()` (calls `new_work_dir_meta()` + `save_metadata()` when a path is unseen). This probe confirms the behavior live and tests for a side question: is the stored path the verbatim input, or `canonical()` (symlink-resolved)?

## Run

Created a fresh directory `/tmp/kimi-fresh-<pid>`, verified no prior `work_dirs` entry, ran `kimi -p "..." --print --output-format stream-json -w <fresh>`, observed kimi.json diff and session directory creation.

```
input:       /tmp/kimi-fresh-32940
realpath:    /private/tmp/kimi-fresh-32940   # macOS symlinks /tmp → /private/tmp
entry_before: no
kimi exit:   0
stderr session hint: kimi -r 22c1cc04-fc62-4cf4-98e0-ad42b47042bd
```

## Findings

- **new_entry_for_fresh_path**: **true**. A brand-new `work_dirs` entry was appended to `~/.kimi/kimi.json`:
  ```json
  {
    "path": "/tmp/kimi-fresh-32940",
    "kaos": "local",
    "last_session_id": "22c1cc04-fc62-4cf4-98e0-ad42b47042bd"
  }
  ```
- **path_storage_format**: **verbatim** (NOT realpath-resolved).
  - `md5("/tmp/kimi-fresh-32940")` = `efd78797f975137c179b2dfdb8f0590d` → directory exists under `~/.kimi/sessions/` ✓
  - `md5("/private/tmp/kimi-fresh-32940")` = `28e98fc8e442f577661136ab569bc9c6` → directory does NOT exist ✗
  - Conclusion: kimi stores the path string that was passed via `-w` without following symlinks. Codex's source-read of `canonical()` appears to do normalization (absolute + remove `..`/`.`) but NOT symlink resolution.
- **last_session_id**: matches the stderr-emitted UUID exactly (third probe confirmation after P0.2 and P0.5).

## Implication for Phase 1

- `getKimiAuthStatus` and `callKimi` can safely pass `-w <cwd>` even on first invocation — kimi will create the entry and directory automatically. No pre-flight `mkdir` or `kimi init` is needed.
- When resolving `~/.kimi/kimi.json.work_dirs[].path` against the current cwd for the Secondary session-id fallback, compare against the **verbatim string** passed via `-w`. If plugin code always passes `process.cwd()` (which Node resolves to realpath) and kimi's `.path` stores the verbatim `-w` value, ensure both sides use the **same** form consistently. Recommendation: always pass `-w` with `fs.realpathSync(process.cwd())` in Phase 1 to make comparisons deterministic.
- Codex's `path_storage_format: "canonical"` claim should be read as "absolute + dot-segment-normalized," not as "symlink-resolved." Update `probe-results.json` accordingly.
