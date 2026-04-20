# Prompt Blocks

Reusable XML-tagged blocks for composing Kimi prompts. Mix and match; wrap
each block in the tag shown in its heading.

## Core Wrapper

### `task`

Use in nearly every prompt.

```xml
<task>
Describe the concrete job, the relevant repository or failure context, and the
expected end state.
</task>
```

## Output and Format

### `output_contract`

Use when the response shape is schema-bound (review / adversarial-review).
Kimi's JSON compliance is empirically uneven — every negative rule here
addresses a real failure observed in Phase 3 T5 dry runs.

```xml
<output_contract>
Return ONLY the JSON object matching the schema below.
No markdown code fence around the object (no ```json … ```).
No prose before (no "好的" / "Here is" / "This review").
No prose after (no "让我知道" / "Let me know").
Use EXACT English severity strings: critical, high, medium, low.
Do NOT translate severity to Chinese.
</output_contract>
```

### `compact_output_contract`

Use when you want concise prose instead of a schema.

```xml
<compact_output_contract>
Keep the answer compact and structured.
Put the highest-value finding or decision first.
No long scene-setting or repeated recap.
</compact_output_contract>
```

## Follow-through and Completion

### `completeness_contract`

Use for `/kimi:rescue` / multi-step work.

```xml
<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check for follow-on fixes, edge cases, or cleanup before declaring done.
</completeness_contract>
```

### `verification_loop`

Use when correctness matters.

```xml
<verification_loop>
Before finalizing, verify the result against the task requirements and the
changed files or tool outputs.
If a check fails, revise the answer instead of reporting the first draft.
</verification_loop>
```

## Grounding and Safety

### `grounding_rules`

Use for review, research, or root-cause analysis.

```xml
<grounding_rules>
Ground every claim in the provided context or your tool outputs.
Do not present inferences as facts.
If a point is a hypothesis, label it clearly.
</grounding_rules>
```

### `action_safety`

Use for write-capable tasks (`/kimi:rescue`).

```xml
<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless required for correctness.
Call out risky or irreversible actions before taking them.
</action_safety>
```

## Task-Specific Blocks

### `attack_surface`

Use in adversarial review.

```xml
<attack_surface>
Prioritize failures that are expensive, dangerous, or hard to detect:
- auth, permissions, tenant isolation, and trust boundaries
- data loss, corruption, duplication, and irreversible state changes
- rollback safety, retries, partial failure, and idempotency gaps
- race conditions, ordering assumptions, stale state, and re-entrancy
- empty-state, null, timeout, and degraded dependency behavior
- version skew, schema drift, migration hazards, and compatibility regressions
- observability gaps that would hide failure or make recovery harder
</attack_surface>
```

### `finding_bar`

Use in any review.

```xml
<finding_bar>
Report only material findings.
Do not include style feedback, naming feedback, low-value cleanup, or
speculative concerns without evidence.
A finding should answer:
1. What can go wrong?
2. Why is this code path vulnerable?
3. What is the likely impact?
4. What concrete change would reduce the risk?
</finding_bar>
```

### `research_mode`

Use for exploration, comparisons, or recommendations.

```xml
<research_mode>
Separate observed facts, reasoned inferences, and open questions.
Prefer breadth first, then go deeper only where the evidence changes the
recommendation.
</research_mode>
```
