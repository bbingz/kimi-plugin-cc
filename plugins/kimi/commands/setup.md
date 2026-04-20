---
description: Check whether the local Kimi CLI is ready, authenticated, and has configured models
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*), Bash(uv:*), Bash(pipx:*), Bash(sh:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" setup --json "$ARGUMENTS"
```

Interpret the JSON result:

### Not installed (`installed: false`)

Check which installers are available in `installers.*`. Build the AskUserQuestion option list **dynamically**, only including options whose installer is detected. Always include `Skip for now`.

Possible options (include only if the installer is present):
- `Install via shell script (Recommended, official)` → runs `curl -LsSf https://cdn.kimi.com/binaries/kimi-cli/install.sh | bash` (URL verified; previous plans used a wrong kimi.moonshot.cn URL that 404s)
- `Install via uv` → runs `uv tool install --python 3.13 kimi-cli`. If the install reports `error: unexpected argument '--python'`, the user's uv is too old; fall back to `uv tool install kimi-cli` and warn them about potential Python version mismatch.
- `Install via pipx (unverified)` → runs `pipx install kimi-cli`
- `Skip for now`

**Edge case: 0 installers detected.** If `shellInstaller`, `uv`, and `pipx` are all false, do NOT use AskUserQuestion (it requires ≥2 options). Instead, print: "No installer detected. Install one of: curl (for the official shell script), uv, or pipx. Then re-run `/kimi:setup`."

After successful install, re-run the setup subcommand. If it still reports `installed: false`, check whether `~/.local/bin/kimi` exists on disk — if yes, tell the user: "kimi is installed at `~/.local/bin/kimi` but not on your PATH. Add `~/.local/bin` to PATH (e.g. in your shell rc file) and reopen your shell, then re-run `/kimi:setup`."

### Installed but not authenticated (`installed: true, authenticated: false`)

Do NOT attempt to run `kimi login` from a tool call — it's interactive. Tell the user verbatim: "Run `! kimi login` in your terminal to authenticate, then re-run `/kimi:setup`."

### All good (`installed: true, authenticated: true`)

Print the full status JSON block to the user so they can see `version`, `model`, `configured_models`, etc. If the user passed `--enable-review-gate` or `--disable-review-gate`, acknowledge — the review-gate state toggle is implemented in Phase 4; for now tell them: "review-gate toggle arrives in Phase 4; your setting is recorded but has no effect yet."

### Output rules

- Present the setup output faithfully; do not paraphrase the JSON fields.
- Do not auto-suggest any installs when already installed and authenticated.
- Do not fetch or analyze anything external beyond what the companion returns.
