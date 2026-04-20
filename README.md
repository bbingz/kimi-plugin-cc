# kimi-plugin-cc

Claude Code plugin integrating Moonshot Kimi CLI.

**Status:** v0.1. See `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` for design and `lessons.md` for migration experience.

## Prerequisites

- [Claude Code](https://claude.ai/code)
- Kimi CLI ≥ 1.34 (`uv tool install --python 3.13 kimi-cli` or the official shell installer)
- Authenticated Kimi CLI (run `kimi login` once in your terminal)

## Install (development)

Claude Code `plugins install` takes a plugin name from a **registered marketplace**, not a filesystem path. Register this repo as a local marketplace first, then install by name:

```bash
# 1) Register this repo as a marketplace (one-time per machine; run from the repo root or pass the repo path)
claude plugins marketplace add "$PWD"

# 2) Install the kimi plugin from it
claude plugins install kimi@kimi-plugin

# 3) Verify
claude plugins list | grep kimi
```

Restart your Claude Code session after install so slash commands become available.

## Commands (v0.1)

- `/kimi:setup` — verify Kimi CLI installation, authentication, and configured models
- `/kimi:ask` — one-shot prompt to Kimi
- `/kimi:review` — balanced code review of the current diff (JSON)
- `/kimi:adversarial-review` — red-team review of the current diff (same schema, stricter stance)
- `/kimi:rescue` — delegate a multi-step task to Kimi via the `kimi-agent` subagent
- `/kimi:status` / `/kimi:result` / `/kimi:cancel` — background-job lifecycle

## License

MIT
