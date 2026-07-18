# Surgical Fix Guards - Hardcoded Safety Values

This document explains the hardcoded safety guards in the surgical fixer and which values could be exposed as user settings in the future.

## Overview

The surgical fixer applies multiple safety guards to prevent destructive or incorrect edits. These guards are **hardcoded** for safety and stability, but some could be made configurable for advanced users.

Release positioning:

- `diff` mode is the supported default. Users review every proposed change before applying it.
- `loop` mode is experimental. Do not use it as an unattended release gate until calibration and fix-quality gates are revalidated.
- `chat` mode is a handoff path, not an automatic fixer.

## Hardcoded Guard Values

### Size Bounds (`computeFixBounds`)

**Bounds are proportional to original text length, not fixed values.**

| Code | Upper Bound Formula | Lower Bound Formula | Notes |
| ---- | ------------------- | ----------------- | ----- |
| `ambiguity-llm` (subtractive) | `originalLength × 1.1` | `originalLength × 0.5` | Tight growth limit - fixes should shrink or stay similar |
| `ambiguity-llm` (additive) | `max(originalLength × 1.6, originalLength + 80)` | `originalLength × 0.5` | Guarantees +80 chars for short texts, allows modest expansion |
| Other codes | `originalLength × 1.5` | `originalLength × 0.5` | Standard growth/shrinkage limits |

**Examples (for a 100-character fragment):**

- `ambiguity-llm` (subtractive): upper = 100 × 1.1 = 110 chars, lower = 100 × 0.5 = 50 chars
- `ambiguity-llm` (additive): upper = max(100 × 1.6, 100 + 80) = max(160, 180) = 180 chars, lower = 100 × 0.5 = 50 chars
- Other codes: upper = 100 × 1.5 = 150 chars, lower = 100 × 0.5 = 50 chars

**Examples (for a 50-character fragment):**

- `ambiguity-llm` (subtractive): upper = 50 × 1.1 = 55 chars, lower = 50 × 0.5 = 25 chars
- `ambiguity-llm` (additive): upper = max(50 × 1.6, 50 + 80) = max(80, 130) = 130 chars (the +80 guarantee wins), lower = 50 × 0.5 = 25 chars
- Other codes: upper = 50 × 1.5 = 75 chars, lower = 50 × 0.5 = 25 chars

Why these values?

- 1.1x for subtractive ambiguity fixes prevents padding/explanatory clauses
- 1.5x general limit prevents structural damage
- 0.5x floor prevents accidental deletion of entire sections
- +80 char guarantee for additive fixes ensures room for concrete clauses

### Anchor Limits

| Guard | Value | Purpose |
| ----- | ----- | ------- |
| `MAX_SURGICAL_ANCHOR_CHARS` | 350 chars | Prevents LLM from receiving huge fragments that could corrupt structure |

### Obligation/Scope Words (`OBLIGATION_TOKENS`, `EMPHASIS_SCOPE_WORDS`)

These are **closed grammatical classes** that must be preserved:

**Obligation tokens** (must not be dropped): `consider`, `should`, `may`, `might`, `recommend`, `optional`, `prefer`, `must`, `required`, `shall`, `at least`, `at most`, `if possible`, `when possible`, `where possible`, `appropriate`, `necessary`

**Scope words** (must not be dropped): `all`, `only`, `never`, `always`, `every`, `each`, `complete`, `comprehensive`, `exclusively`, `genuine`, `independently`, `fully`, `entire`, `explicit`, `mandatory`, `strictly`

## Guards That Could Be Exposed as Settings

### Potential Settings

| Setting | Current Value | Rationale for Exposure |
| ------- | ------------- | -------------------- |
| `fix.guard.upperBoundMultiplier` | 1.5 (1.1 for ambiguity) | Some users may want looser bounds for verbose fixes |
| `fix.guard.lowerBoundMultiplier` | 0.5 | Rarely needs changing, but could be useful for very short fragments |
| `fix.guard.maxAnchorChars` | 350 | Users with long paragraphs might want higher limits |
| `fix.guard.preserveObligationWords` | true | Advanced users might want to disable for specific workflows |
| `fix.guard.preserveScopeWords` | true | Same as above |

### Why They Are Currently Hardcoded

1. **Safety first** - These values were empirically tuned across 100+ skills to prevent data corruption
2. **Consistency** - All users get the same safe behavior
3. **Simplicity** - Fewer settings to understand for typical users

### When to Consider Making Them Configurable

- Users report "fix rejected" for legitimate reasons
- Domain-specific workflows need different guard behavior
- Advanced users want to experiment with looser constraints

## Guard Rejection Reasons

When a fix is skipped, the log shows the reason. Here is what each means:

| Reason | User-Friendly Explanation |
| ------ | ------------------------ |
| `anchor not found` | The flagged text was not found in the document - it may have been edited |
| `anchor too large` | Fragment exceeds 350 characters - too risky to fix automatically |
| `anchor overlaps frontmatter` | Cannot fix YAML metadata (name, description, etc.) |
| `ambiguous anchor` | Text appears multiple times - unsafe to fix without knowing which instance |
| `expansion` | Fix would make the text more than 1.5x longer |
| `shrinkage` | Fix would make the text less than half the original length |
| `obligation-drop:WORD` | Fix would remove an obligation word like "should" or "consider" |
| `numeric-change` | Fix would change a number or version value |
| `concept-swap` | Fix would change the meaning by swapping concepts |
| `fence-injection` | Fix would add code fences (```) - potential injection attack |
| `line-deletion` | Fix would delete lines - too destructive |
| `identical output` | LLM returned the same text - no fix needed |
| `self-critique:REASON` | LLM detected the fix added unverifiable facts |
| `semantic-judge:REASON` | LLM detected obligation/scope change |

## Other Hardcoded Values in the Codebase

### Analyzer Limits

| Constant | Value | Purpose |
| -------- | ----- | ------- |
| `MAX_HISTORY_ENTRIES` | 100 | Maximum analysis history entries to retain |
| `minLen` (for ambiguity) | 15 chars | Minimum text length to flag as ambiguous |

### MCP Server Limits

| Constant | Value | Purpose |
| -------- | ----- | ------- |
| `MAX_TEXT_LENGTH` | 100,000 chars | Maximum document size for MCP analyze tool (~25k tokens) |
| `MAX_RELEVANT_TEXT_LENGTH` | 200 chars | Maximum relevant text length in MCP responses |
| `MIN_RELEVANT_TEXT_LENGTH` | 3 chars | Minimum relevant text length to include |
| `ANALYZE_COOLDOWN_MS` | 5,000 ms | Cooldown between MCP analyze calls |

### Pricing Cache

| Constant | Value | Purpose |
| -------- | ----- | ------- |
| `COPILOT_CACHE_TTL_MS` | 24 hours | Copilot pricing cache duration |
| `OPENROUTER_CACHE_TTL_MS` | 1 hour | OpenRouter pricing cache duration |
| `OPENROUTER_DISK_CACHE_TTL_MS` | 15 minutes | Disk cache for OpenRouter pricing |
| `DEFAULT_FETCH_TIMEOUT_MS` | 10,000 ms | HTTP fetch timeout for pricing API |

### UI/Preview Limits

| Constant | Value | Purpose |
| -------- | ----- | ------- |
| `MAX_FIX_PREVIEW_ENTRIES` | 20 | Maximum diff preview entries stored |
| `FIX_PREVIEW_MAX_AGE_MS` | 10 minutes | Max age for cached fix previews |
| `FIX_CACHE_TTL_MS` | 30 seconds | Inline rewrites cache duration |
| `FIX_CACHE_MAX_SIZE` | 50 | Maximum inline rewrite cache entries |

### Accepted Findings

| Constant | Value | Purpose |
| -------- | ----- | ------- |
| `MAX_ACCEPTED_ENTRIES` | 500 | Maximum accepted findings per file |

## Related Documentation

- [LEARNINGS.md](plan/LEARNINGS.md) - Empirical tuning decisions
- [DEVELOPMENT-STANDARDS.md](DEVELOPMENT-STANDARDS.md) - Testing patterns
- [ARCHITECTURE.md](ARCHITECTURE.md) - Overall architecture
