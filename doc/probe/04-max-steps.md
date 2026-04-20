# Probe 04: --max-steps-per-turn ping stability

## Results (3 trials each; success = exit 0 AND ≥1 text content block)
| N | pass/total | notes |
|---|---|---|
| 1 | 3/3 | All trials passed reliably |
| 2 | 3/3 | All trials passed reliably |
| 3 | 3/3 | All trials passed reliably |

## Raw log
```
N=1 trial=1 exit=0 assistant_events=1 text_blocks=1 result=PASS
N=1 trial=2 exit=0 assistant_events=1 text_blocks=1 result=PASS
N=1 trial=3 exit=0 assistant_events=1 text_blocks=1 result=PASS
N=2 trial=1 exit=0 assistant_events=1 text_blocks=1 result=PASS
N=2 trial=2 exit=0 assistant_events=1 text_blocks=1 result=PASS
N=2 trial=3 exit=0 assistant_events=1 text_blocks=1 result=PASS
N=3 trial=1 exit=0 assistant_events=1 text_blocks=1 result=PASS
N=3 trial=2 exit=0 assistant_events=1 text_blocks=1 result=PASS
N=3 trial=3 exit=0 assistant_events=1 text_blocks=1 result=PASS
```

## Conclusion
- **PING_MAX_STEPS = 1** (smallest N with 3/3 PASS)
- Reason: Even with --max-steps-per-turn=1, the Kimi API reliably returns a complete text response ("pong") for ping requests, indicating that a single step is sufficient for this simple interaction.

## Fallback
Not needed; N=1 is 100% reliable across all trials.
