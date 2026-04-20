# kimi-plugin-cc working directory instructions

This repo is a Claude Code plugin that wraps Moonshot Kimi CLI. Structure mirrors `/Users/bing/-Code-/gemini-plugin-cc/` but every file is hand-rewritten (P2).

## Before coding
- Read `docs/superpowers/specs/2026-04-20-kimi-plugin-cc-design.md`
- Read `doc/probe/probe-results.json` for literal values (event keys, exit codes, hash algo, etc.)
- Read recent 5 entries of `CHANGELOG.md`

## Before committing
- Append CHANGELOG entry (status / scope / summary / next)
- Run T-checklist rows your change could affect
- Never sed/cp from gemini — read and rewrite
