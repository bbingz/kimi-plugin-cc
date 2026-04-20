# kimi-plugin-cc

Claude Code plugin integrating Moonshot Kimi CLI.

**Status:** v0.1 in development. See `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md` for design.

## Prerequisites

- [Claude Code](https://claude.ai/code)
- Kimi CLI ≥ 1.34 (`uv tool install --python 3.13 kimi-cli` or the official shell installer)
- Authenticated Kimi CLI (run `kimi login` once in your terminal)

## Install (development)

```
claude plugins add /Users/bing/-Code-/kimi-plugin-cc/plugins/kimi
```

## Commands (v0.1 incremental)

- `/kimi:setup` — verify Kimi CLI installation, authentication, and configured models
- (more commands arrive in Phase 2+)

## License

MIT
