# /kimi:timing

Show timing telemetry for recent `/kimi:ask`, `/kimi:task`, `/kimi:review` calls.

## Usage

```
/kimi:timing                                    # default: --history --last 20
/kimi:timing --last                             # detail of most recent job
/kimi:timing <jobId>                            # detail of specific job
/kimi:timing --history [--last N] [--kind KIND] [--since DUR]
/kimi:timing --stats   [--kind KIND]            [--since DUR]
```

- `--last N` (inside `--history` only): limit to last N records
- `--kind`: filter by kind (`ask`, `task`, `review`, `adversarial-review`)
- `--since`: time window, `\d+[mhd]` (1-9999m / 1-9999h / 1-365d)

## Internals

Executes `runTimingCommand(args)` in `plugins/kimi/scripts/kimi-companion.mjs`. Read-only — does NOT invoke kimi-cli. Data source: `~/.kimi/plugin-cc/timings.ndjson`.
