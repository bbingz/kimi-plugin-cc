# Kimi Prompt Anti-Patterns

Patterns observed to fail empirically during `kimi-plugin-cc` Phase 2–4.
Each entry documents: observed failure → why it happened → what to do instead.

## 1. "Please return JSON." without strict rules

**Observed:** During Phase 3 T5 dry runs, kimi wrapped its JSON output in a
markdown fence roughly 1 run in 4, and prefixed with `好的，这是 JSON：`
roughly 1 run in 6. Both forms break `JSON.parse` on the raw response.

**Fix:** Explicit strict-output rules (`kimi-prompt-recipes.md` Review
section). Include: "No markdown code fence. No prose before. No prose after."
Restate these as negative examples — kimi treats positive-only instructions
as soft. See `buildReviewPrompt` in `plugins/kimi/scripts/lib/kimi.mjs`.

## 2. "severity must be critical/high/medium/low"

**Observed:** Phase 3 validation surfaced `"严重"` / `"高"` / `"中"` / `"低"`
in kimi output when the prompt didn't block translation. Kimi's Chinese
prior over-translates even enum values.

**Fix:** Say "the EXACT English strings" and list them verbatim. Add a
schema-validator guard that rejects translated values so parse-layer errors
fire before the render layer sees them (we do this in `validateReviewOutput`).

## 3. Expecting session-resume to carry arbitrary state

**Observed:** Kimi's `--resume <id>` reattaches to a session but behavior
varies by model and context-window settings. In Phase 2 T7 we observed kimi
genuinely recall a short string ("4242") across resume; in Phase 4 multi-turn
rescue tests it sometimes forgot intermediate tool calls.

**Fix:** Do not assume prior-turn tool outputs survive. If a later turn
needs a fact from an earlier turn, restate it explicitly in the new prompt.
Use resume only for "keep the same model personality" — not "remember
everything".

## 4. Tool-use expectations in simple Q&A

**Observed:** Without `--max-steps-per-turn`, a simple `/kimi:ask "what time
is it?"` burned 6 steps before giving up (kimi tried to invoke a shell tool
to check, then filesystem, then web fetch).

**Fix:** `/kimi:ask` pins `PING_MAX_STEPS = 1` at the probe level and avoids
tool-capable system text in the prompt. Use tool-heavy prompts only for
`/kimi:rescue --write` (which allows a higher step budget).

## 5. Chinese prompt + English enforcement language

**Observed:** Phase 4 `/kimi:rescue` tests showed kimi switching output
language unpredictably when the body was Chinese but the output contract
was English. Output sometimes came back in Chinese, sometimes English,
sometimes mixed.

**Fix:** Match the meta-language to the body language. If the user's prompt
is Chinese, write the `<output_contract>` in Chinese too. The content of
the contract (strict JSON rules, schema, enum lists) can stay English
since JSON keywords are language-neutral.

**Exception — mixed Chinese narrative + English code/schema** (kimi
4-way-review M1, flagged by Kimi-as-reviewer): the most common
`/kimi:review` case is "Chinese user asks a question about English
diff" — full-Chinese meta is WRONG here. Keep `STRICT OUTPUT RULES`
in English (enum values, schema, "no markdown fence"). Translating
those to Chinese puts extra pressure on Kimi's already-weak English
enum adherence (see §2) and tends to push `"severity": "critical"`
toward `"severity": "严重"`. Rule of thumb: meta-language follows
the majority-content language — if `REVIEW_INPUT` is English code,
meta stays English even when the user chat was Chinese.

## 6. Asking Kimi to "think harder" without a thinking block

**Observed:** Prompts like "think carefully" or "reason step by step" in
plain text produced marginal quality gains — kimi emitted the reasoning
as `content[].type === "think"` blocks and then a terse answer. The
`think` blocks are dropped by default in `extractAssistantText`
(`kimi-result-handling` skill), so the extra reasoning went unused on the
render side.

**Fix:** Either render the `think` blocks explicitly (planned v0.2
`--show-thinking` flag), or drop the "think step by step" cue if the
answer is what you want. Do not conflate "kimi thought about it" with
"kimi communicated its reasoning".

## 7. Large prompt via `-p "$(cat file)"` on kimi 1.36

**Observed:** kimi 1.36 rejects `-p ""` with a usage error box; large
prompt delivery via stdin uses `--input-format text` + piped input, NOT
`-p ""`.

**Fix:** Use `callKimi`'s built-in large-prompt branch (`LARGE_PROMPT_
THRESHOLD_BYTES = 100_000`) which routes to stdin automatically. Never
hand-construct `kimi -p ""` in a prompt template or shell recipe.

## 8. Hallucinating `"no_changes"` as a valid verdict

**Observed during plan review:** Without an explicit ban, LLMs
(including kimi) may emit `{"verdict": "no_changes", ...}` when they
interpret a small-but-non-empty diff as "nothing material to say". The
companion-side fast path for an empty diff ALSO uses `verdict:
"no_changes"` — but it's emitted by the companion (`runReview`
/`runAdversarialReview`), not by the LLM. When the LLM produces this
verdict, `validateReviewOutput` rightly rejects it and the review
appears to fail schema validation.

**Fix:** Every review prompt must say: `verdict MUST be: approve or
needs-attention (never "no_changes" — that is a companion-only fast
path for empty diffs).` Both `buildReviewPrompt` and
`buildAdversarialPrompt` include this line; `validateReviewOutput`
enforces the enum. Do not relax the schema to accept `"no_changes"`
from the LLM — the split contract is intentional.

## 9. Using `K2.6 Agent` / `K2.6 Agent Swarm` models for review or ask

**Observed (2026-04-20, K2.6 release):** Moonshot's K2.6 ships as a
family — K2.6 (chat/code), **K2.6 Agent** (website + full-stack builder
specialized in video hero sections, WebGL shaders, GSAP/Framer, React
19 + shadcn, auth + DB wiring), and **K2.6 Agent Swarm** (multi-agent
long-horizon orchestration). Users whose `~/.kimi/config.toml` has
any of these as `[models.*]` entries can pass `-m k2.6-agent` (or
similar) to `/kimi:ask`, `/kimi:review`, `/kimi:adversarial-review`.
The agent-family system prior strongly biases toward scaffolding
files and calling tools — it will read the repo, write generated
code, and produce React/TS output even when the prompt asks for a
one-paragraph answer or a strict JSON review. Our `STRICT OUTPUT
RULES` in `buildReviewPrompt` are prompt-layer constraints; the agent
system prior overrides them empirically often enough that JSON
compliance drops sharply.

**Fix:** Do not pass K2.6 Agent / K2.6 Agent Swarm to these commands:

- `/kimi:ask` — use a chat/code model (`K2.6`, `K2.6 Code`, or
  `kimi-k2.5`)
- `/kimi:review` — same
- `/kimi:adversarial-review` — same

Agent-family models are appropriate for `/kimi:rescue` /
`/kimi:task --background` where the goal IS "go do work, write files,
invoke tools" — that's the sweet spot. A future `/kimi:scaffold`
command (v0.2 backlog) will expose the agent's website-building
capability explicitly, so users don't have to route through
`/kimi:rescue` with an awkward prompt.

**How to spot an agent variant in your config:** the plugin's
`readKimiConfiguredModels()` lists every `[models.*]` section title
verbatim — it doesn't classify agent vs. chat. As of the K2.6 family
release, **if the section title (or model display name) contains the
word `agent` or `swarm`, treat it as the agent variant** and steer
away from `/kimi:ask` / `/kimi:review`. Common patterns observed in
published examples:

- `[models."kimi-k2.6-agent"]` — agent
- `[models."kimi-k2.6-agent-swarm"]` — agent swarm
- `[models."kimi-k2.6"]` — chat/code (safe for review/ask)
- `[models."kimi-k2.6-code"]` — chat/code (safe for review/ask)
- `[models."kimi-for-coding"]` — kimi's "Kimi for Code" rebrand,
  chat-family (safe)

If the section title is ambiguous (custom provider label, no
`agent`/`swarm` keyword), check the provider's docs before passing
`-m` to `/kimi:review`.

**Verify:** if `/kimi:review` output arrives with React/TS code
blocks, unprompted file scaffolding, or the schema validator
rejecting a response with a verdict like `"built"` or `"scaffolded"`,
confirm the model wasn't an agent variant before blaming the prompt.
Operator hygiene, not validator hygiene.
