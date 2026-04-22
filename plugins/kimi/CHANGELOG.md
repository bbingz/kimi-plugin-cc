# kimi plugin CHANGELOG

## 0.1.0 — see repo-root CHANGELOG.md for authoritative history

This sub-CHANGELOG is intentionally minimal. v0.1 development history,
post-v0.1 review integration, and ongoing collaboration entries all live
at the repo-root `CHANGELOG.md`. This file is retained only so tooling
that hard-codes `plugins/kimi/CHANGELOG.md` as a path still finds a
valid file.

### Pre-v0.1 job-id prefix migration

If you created background jobs with the initial v0.1 build (before commit `aa0bde6`), their ids will show `gr-*` or `gt-*` prefix instead of `kr-*` / `kt-*`. This is cosmetic only — the old ids still work as arguments to `/kimi:status`, `/kimi:result`, `/kimi:cancel`. To clear: `/kimi:cancel <old-id>` (if still running), or let the 7-day TTL expire them (see `KIMI_JOB_TTL_DAYS`).
