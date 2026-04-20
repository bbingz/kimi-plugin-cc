# Probe 02: kimi.json work_dirs + session dir hash

## Environment
- Repo path probed: `/Users/bing/-Code-/kimi-plugin-cc`
- Session id before: `8e1d0952-181f-4894-a272-3628e193ed05`
- Session id after: `d6df0d1a-da92-46ef-8238-475228cd041b`
- Session id from stderr (ground truth from P0.1 pattern): `d6df0d1a-da92-46ef-8238-475228cd041b`

## Findings
- **work_dirs_updated_in_print_mode**: `true` (evidence: before=`8e1d0952-181f-4894-a272-3628e193ed05` changed to after=`d6df0d1a-da92-46ef-8238-475228cd041b`)
- **new_entry_for_fresh_path**: `false` (entry already existed for this repo path before probe)
- **last_session_id_matches_stderr**: `true` (SESSION_AFTER `d6df0d1a-da92-46ef-8238-475228cd041b` matches stderr UUID exactly)
- **last_session_id_updated_synchronously**: `true` (work_dirs entry was updated immediately after kimi invocation)
- **hash_algorithm**: `md5` (confirmed: `49e48aeb71ecd1b044a88bf82d5fc6ee` exists as session dir; sha1 and sha256-first32 variants do not match)
- **path_storage_format**: `verbatim-input` (kimi.json stored path matches exactly what was passed via `-w` flag, no realpath resolution)

## Diff of kimi.json (before vs after)
```diff
31c31
<       "last_session_id": "8e1d0952-181f-4894-a272-3628e193ed05"
---
>       "last_session_id": "d6df0d1a-da92-46ef-8238-475228cd041b"
```

## Sessions dir changes
```
/Users/bing/.kimi/sessions/49e48aeb71ecd1b044a88bf82d5fc6ee
```

## Implication for spec §3.4 Secondary fallback

**Secondary path lookup is viable in --print mode.** This probe confirms that `kimi.json.work_dirs[].last_session_id` is updated synchronously and reliably during `--print` invocations, and the updated value matches the stderr-reported session UUID without exception. Phase 1 can implement Secondary fallback by cross-referencing the current working directory against `work_dirs[].path` entries and reading their `last_session_id` field. As a tertiary safeguard, the stderr pattern `kimi -r ([0-9a-f-]{36})` remains available for systems unable to read `~/.kimi/kimi.json`. Additionally, session directories are organized by MD5 hash of the repo path: `~/.kimi/sessions/{md5(repo_path)}/`, enabling deterministic directory naming without stat calls to kimi.json.
