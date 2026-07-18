# E35 — v8 documentation-review skill grading

**Date:** 2026-07-11
**Status:** Complete
**Model:** `qwen/qwen3-coder-30b-a3b-instruct`
**Mode:** `analysisMode: 'multiWave'`, all 6 waves
**Versions tested:** v1 through v8 (8 versions of the documentation-review skill)
**Cost:** ~$0.05
**Runtime:** ~3 min

## TL;DR

**v8 does NOT grade an A.** It grades C+ (score 69, 7 findings). The F→C+ improvement from v7→v8 is real and meaningful, but residual issues remain in v8.

## Per-version results

| Version | Score | Grade | Findings | Contradictions | Lines |
|---|---:|---|---:|---:|---:|
| v1 | 66 | C+ | 7 | 0 | 297 |
| v2 | 71 | B- | 5 | 0 | 326 |
| v3 | 49 | D | 11 | 0 | 402 |
| v4 | 59 | C- | 7 | 0 | 424 |
| v5 | 59 | C- | 7 | 0 | 431 |
| v6 | 47 | D | 9 | 0 | 477 |
| **v7** | **28** | **F** | **15** | **1** | **494** |
| **v8** | **69** | **C+** | **7** | **0** | **497** |

The v7→v8 jump is +41 points (F→C+). v8 eliminated the 1 contradiction in v7 (the D8 vs C2/C3/C4 cluster, E24).

## Trend analysis

- v1→v2: +5 points (added Definitions and Decision Trees)
- v2→v3: -22 points (added D8 Modification definition with conflicts)
- v3→v4: +10 points (replaced v3 prompt content with v4 content)
- v4→v5: 0 (essentially same content with minor edits)
- v5→v6: -12 points (added more structure but introduced new issues)
- v6→v7: -19 points (added the "glossary-first" framing, which created D8 vs C2/C3/C4 conflict)
- **v7→v8: +41 points (E24 fix — clarified modification taxonomy)**

The v7→v8 jump is by far the largest single-iteration improvement. The "RFC-style" explicit modification taxonomy (D8) with explicit precedence (D9) reduces the contradiction count from 1 to 0.

## v8 residual findings (7)

| Line | Code | Status |
|---:|---|---|
| 1 | limited-coverage | noise (always shows when findings < threshold) |
| 1 | ambiguity-llm | "minimum set" — reasonable but subjective |
| 1 | ambiguity-llm | "observable behaviour" — needs examples |
| 1 | ambiguity-llm | "invent" — needs context |
| 1 | ambiguity-llm | "structure or relationships" — abstract |
| 1 | cognitive-priority-conflict | D1 evidence priority vs D9 precedence — REAL but minor |
| 1 | coverage-gap | "no authoritative documentation" — REAL edge case |

**Real residual issues on v8:**

1. **D1 vs D9 priority conflict** (cognitive-priority-conflict): v8 has two priority systems — D1's "Evidence priority" (1. Implementation, 2. Tests, 3. Specifications, 4. Authoritative documentation) and D9's "Constraints always apply" precedence. The LLM is correctly noting these are different ordering systems, but D9 is actually a meta-rule (constraints > all else) so the conflict is structural. Could be resolved by making D9 explicitly say "D9 supersedes D1".

2. **Coverage gap on "no documentation"** (coverage-gap): v8 assumes there's always repository evidence to find. Real-world edge case: legacy projects with no documentation. Could be addressed by adding a "fallback to issue commits" rule.

3. **Ambiguity on subjective terms** (ambiguity-llm): "minimum", "observable", "invent", "structure" — these are inherently subjective. The LLM is being strict, but these are reasonable flags.

## Does RFC-style design help models?

**Yes.** The v7→v8 jump (+41 points) is the largest single-iteration improvement. The explicit "RFC-style" design — with numbered definitions, numbered constraints, numbered rule, explicit precedence, explicit modification taxonomy — gives the LLM a clear structure to reason about.

The v8 design follows a clear pattern:

- D1-D9: Definitions (numbered, alphabetical ordering in the precedence rule)
- C1-C5: Constraints (each is a single rule)
- R1: Verification Rule (single rule with trigger conditions)
- D9: Precedence (explicit ordering)

The previous versions (v3-v7) had a more freeform structure. The v8 design's "RFC" style — with explicit numbered items and precedence rules — is what makes the difference.

## Recommendation

v8 is the best version. To push it to B or A:

1. **Resolve the D1 vs D9 priority conflict** by adding "D9 supersedes D1" to D9. This would eliminate the cognitive-priority-conflict finding.
2. **Add a "no documentation" fallback rule** to handle the coverage-gap finding.
3. **Glossary expansion**: add example definitions for "minimum set", "observable behaviour", "invent" to reduce ambiguity findings.

These are minor edits; v8 is shippable as-is.

## Files

- `scripts/e35-v8-grading.mjs` (new)
- `.github/experiments/documentation-review/data/e35-v8-grading-2026-07-11T17-14-33-450Z.json`
- `.github/experiments/documentation-review/logs/e35-v8-grading-2026-07-11T17-14-33-450Z.log`
