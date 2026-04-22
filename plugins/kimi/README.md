## Notes

### Note on pre-v0.1 job ids

If you created background jobs with the initial v0.1 build (before commit `aa0bde6`), their ids will show `gr-*` or `gt-*` prefix instead of `kr-*` / `kt-*`. This is cosmetic only — the old ids still work as arguments to `/kimi:status`, `/kimi:result`, `/kimi:cancel`. To clear: `/kimi:cancel <old-id>` (if still running), or let the 7-day TTL expire them (see `KIMI_JOB_TTL_DAYS`).
