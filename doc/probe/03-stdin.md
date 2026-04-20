# Probe 03: stdin + large-prompt delivery

## Results
| Mechanism | 200B (Step 1) | 20KB (Step 2/3) | 200KB (Step 4) | Notes |
|---|---|---|---|---|
| stdin pipe, no `-p` | YES | N/A (tested with 20KB inline/tmpfile instead) | YES | Works perfectly; kimi reads from stdin when `-p` is omitted |
| inline `-p "$BIG"` | N/A | YES | YES | Works reliably; shell variable expansion handles 20KB and 200KB without issues |
| tmpfile + `-p "$(cat ...)"` | N/A | YES | N/T | Tested at 20KB only; command substitution works flawlessly |

## Raw exit codes and match results

### Step 1: Pure stdin (200B)
```
exit-a=0
stdin-read=YES
```
Command: `echo "Reply with exactly: OK" | kimi --print --output-format stream-json`

### Step 2: Inline -p with 20KB prompt
```
exit-b=0
inline-p=YES
```
Command: `kimi -p "$BIG" --print --output-format stream-json` (where BIG = ~20KB)

### Step 3: Tmpfile + command substitution with 20KB
```
exit-c=0
tmpfile-cat=YES
```
Command: `kimi -p "$(cat /tmp/big-prompt.txt)" --print --output-format stream-json`

### Step 4a: stdin with 200KB
```
exit-huge-stdin=0
stdin-200k=YES
```
Command: `cat /tmp/huge-prompt.txt | kimi --print --output-format stream-json`

### Step 4b: Inline -p with 200KB
```
exit-huge-inline=0
inline-200k=YES
```
Command: `kimi -p "$HUGE" --print --output-format stream-json` (where HUGE = ~200KB)

## Recommendation (for Phase 2 kimi.mjs)
- **LARGE_PROMPT_STRATEGY** = `stdin`
- **LARGE_PROMPT_THRESHOLD_BYTES** = `100000` (100KB)
- **Rationale**: stdin pipe delivery is the most reliable and scalable mechanism for large prompts. It avoids shell argument size limits entirely and is demonstrated to work seamlessly at 200KB+. While inline `-p "$BIG"` also works up to at least 200KB on macOS (the default ARG_MAX is typically 256KB), stdin is more portable across platforms and operating systems with lower ARG_MAX limits (e.g., some Linux distributions). tmpfile + command substitution is viable but adds file I/O overhead and is less elegant. Prefer stdin for anything over 100KB to future-proof against platform variations.

## Caveats
- No platform-specific arg-length failures observed on macOS (Darwin 25.4.0). The system appears to handle 200KB+ inline arguments without error.
- kimi rejects `-p ""` (empty prompt) with error "Prompt cannot be empty", so stdin delivery only works when `-p` is omitted entirely.
- All tests used `--output-format stream-json` to verify response format; all matched the expected `"text":\s*<RESPONSE>` pattern from P0.1 findings.
- The 200KB test used 200,000 'X' characters (not representative of typical prompts), but validated large binary-like content handling.
