# E51 — Production skill test: coverage v2 prompt vs baseline

**Date:** 2026-07-12
**Status:** COMPLETED — v2 NOT recommended for shipping
**Model:** `qwen/qwen3-coder-30b-a3b-instruct`
**Mode:** `analysisMode: 'multiWave'`, all 6 waves

## TL;DR

**The v2 coverage prompt does NOT improve coverage detection on production skills.** The fixture-based improvement (5/13 → 12-14/13 on test-coverage-gaps) was an artifact of the broken test architecture (label leakage). On production skills, v2 produces:

- **Coverage-gap: identical** (5/5 per skill, unchanged)
- **Ambiguity-llm: -54%** (cross-wave contamination — the "Default: FLAG" framing bleeds into ambiguity)
- **Hygiene-over-specification: +3** (cosmosdb-datamodeling only — unclear if real)

**Recommendation: Do NOT ship v2 coverage prompt.** The E50 test architecture fix is the real improvement.

## Why This Matters

The E43 work showed v2 coverage prompt improved test-coverage-gaps from 5/13 to 12-14/13 on fixtures. The E50 clean architecture demo showed that **fixture labels were a huge hint** — the LLM was reading the test metadata and label markers in the fixture body. So the v2 improvement on fixtures was likely:

1. The "Default: FLAG" framing genuinely helping the LLM be more aggressive
2. PLUS the fixture labels priming the LLM to find coverage gaps

On production skills (no labels, no scaffolding), only #1 applies. And #1 doesn't help — the coverage wave is already finding the same patterns.

## Results: 4 Production Skills

| Skill | Baseline | v2 | Delta |
|---|---:|---:|---:|
| sql-optimization | 13 | 9 | -4 |
| salesforce-component-standards | 9 | 5 | -4 |
| context-map | 10 | 11 | +1 |
| cosmosdb-datamodeling | 19 | 15 | -4 |
| **Total** | **51** | **40** | **-11 (-22%)** |

### Per-code breakdown

| Code | Baseline | v2 | Delta |
|---|---:|---:|---:|
| ambiguity-llm | 26 | 12 | **-14 (-54%)** |
| coverage-gap | 20 | 20 | 0 |
| contradiction | 0 | 0 | 0 |
| hygiene-over-specification | 0 | 3 | +3 |
| cognitive-nested-conditions | 1 | 1 | 0 |
| cognitive-priority-conflict | 1 | 1 | 0 |

## Interpretation

### Coverage-gap: unchanged (the original goal)

The "exactly 1 coverage-gap per skill" pattern from E30 corpus scan is unchanged. The v2 prompt's "Default: FLAG" framing didn't help coverage detection on real skills. This is the **expected** behavior — the coverage wave was already finding the same patterns.

### Ambiguity-llm: -54% (cross-wave contamination)

This is the same pattern I saw in E43 v2 on fixtures. The "Default: FLAG" framing in the coverage prompt is bleeding into the ambiguity wave, making it more conservative. This is **good** (fewer false positives) but it's not what we were trying to fix.

The E40d ambiguity v4 prompt already reduced ambiguity-llm by 40% on the 327-skill corpus (E32). The v2 coverage prompt adds another 54% reduction on top of that. But this is **cross-wave contamination**, not a real improvement to ambiguity detection.

### Hygiene-over-specification: +3 (cosmosdb-datamodeling only)

v2 found 3 new hygiene-over-specification findings in cosmosdb-datamodeling. Could be real (the LLM is now more aggressive) or could be noise (N=1). Need more data to confirm.

## What This Validates

1. **The E50 test architecture fix is the real improvement.** Without it, we can't tell fixture improvements from label-leverage artifacts.

2. **The v2 coverage prompt is not a clear win.** The fixture improvement was an artifact. On production, it doesn't help coverage and has cross-wave side effects.

3. **The cross-wave contamination pattern is real.** The "Default: FLAG" framing in one wave affects other waves. This was visible in E43 v2 on fixtures and is confirmed in E51 on production.

## Files

- `scripts/e51-production-skill-test.mjs` — production test script
- `src/core/prompts/coverage.v2.prompt` — v2 candidate (NOT recommended for shipping)
- `src/core/prompts/coverage.baseline.bak` — backup of v0.1.36 baseline
- `.github/experiments/documentation-review/data/e51-production-test-2026-07-12T22-08-49-708Z.json` — full results

## Recommendation

**Do NOT ship v2 coverage prompt in v0.1.37.** The production data does not support it.

**Do ship the E50 test architecture fix.** This is the real improvement — it gives us a way to validate prompts properly.

**Next steps:**
1. Apply E50 to more fixtures (to validate the pattern works generally)
2. Re-test any future prompt changes against the E50 architecture
3. Discuss shipping v0.1.37 with the E50 architecture as the foundation
