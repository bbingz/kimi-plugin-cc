# kimi-plugin-cc

Claude Code plugin integrating Moonshot Kimi CLI.

**Status:** v0.1 in development. See `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` for design.

## Prerequisites

- [Claude Code](https://claude.ai/code)
- Kimi CLI ≥ 1.34 (`uv tool install --python 3.13 kimi-cli` or the official shell installer)
- Authenticated Kimi CLI (run `kimi login` once in your terminal)

## Install (development)

Claude Code `plugins install` takes a plugin name from a **registered marketplace**, not a filesystem path. Register this repo as a local marketplace first, then install by name:

```bash
# 1) Register this repo as a marketplace (one-time per machine)
claude plugins marketplace add /Users/bing/-Code-/kimi-plugin-cc

# 2) Install the kimi plugin from it
claude plugins install kimi@kimi-plugin

# 3) Verify
claude plugins list | grep kimi
```

Restart your Claude Code session after install so slash commands become available.

## Commands (v0.1 incremental)

- `/kimi:setup` — verify Kimi CLI installation, authentication, and configured models
- (more commands arrive in Phase 2+)

## License

MIT
