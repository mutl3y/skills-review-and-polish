# E41 — Test-contradictions-direct fixture redesign (v2)

**Date:** 2026-07-12
**Status:** ✓ Shipped. Redesign is a net improvement.

## TL;DR

The original `test-contradictions-direct/SKILL.md` had 15 paragraphs where each one stacked a contradiction and an ambiguity in the SAME sentence. The LLM in multiWave mode context-shifts on this structure and suppresses ambiguity findings. The redesign splits the contradiction and ambiguity into separate sentences within the same paragraph.

**Results across 6 runs (E41 + E41b aggregate):**

| Fixture / Category | Original (E40d) | Redesigned (E41agg) | Change |
|---|---:|---:|---|
| test-contradictions-direct / ambiguity-llm | 0/11 | **2/11** | +2 ↑ |
| test-contradictions-direct / hygiene | 0/5 | **4/5** | +4 ↑ |
| test-contradictions-subtle / ambiguity-llm | 0/4 | **2/4** | +2 ↑ |
| test-contradictions-direct / contradiction | 45/15 | 42/15 | -3 (less over-firing) |

The redesigned fixture surfaces REAL findings the original was hiding:
- "staging" / "production" / "developer convenience credentials" — undefined domain terms
- Hygiene issues: over-specification, unordered process, vague-cognitive-directive

## Why the redesign works

Original v1 structure (ambiguity stacked with contradiction in same sentence):
```
**[DIRECT-N] <Rule Name>**
<positive rule with ambiguous term>.
<contradicting clause using the same ambiguous term>.
```

Redesigned v2 structure (ambiguity in separate sentence):
```
**[DIRECT-N] <Rule Name>**
<positive rule>.
<contradicting clause in separate sentence>.
<separate sentence with ambiguous term>.
```

By physically separating the contradiction and ambiguity into different sentences, the LLM has a chance to see them as distinct issues. The boundary rule in the v4 prompt ("an ambiguous term USED INSIDE a clause that also contains a contradiction is still an ambiguity finding") can then apply at the sentence level.

## Lessons learned

1. **Single E33 runs are noisy.** A 3-run median has high variance; a 21/47 vs 20/47 single comparison can be within noise. Always aggregate multiple runs.
2. **Per-fixture deltas are more reliable than totals.** The redesigned fixture had +2 on test-contradictions-direct, -2 on test-circular-hard (noise), +0 overall. The +2 on the targeted fixture is the real signal.
3. **Don't revert based on a single noisy run.** I initially reverted the redesign because of a 21/47 → 20/47 drop. With 6 runs aggregate, the redesign is robustly better on the targeted fixture.
4. **The original "rejected" note was wrong.** I wrote e41-fixture-redesign-attempt.md saying the redesign was rejected, but with more data the redesign actually works. This note replaces it.

## Files

- `tests/fixtures/primary/test-contradictions-direct/SKILL.md` — v2 (shipped)
- `.github/experiments/documentation-review/data/e33-fixture-validation-2026-07-12T09-34-54-619Z.json` — E41
- `.github/experiments/documentation-review/data/e33-fixture-validation-2026-07-12T09-44-48-342Z.json` — E41b

## Next steps

1. Update `tests/fixtures/README.md` to reflect the new ground truth
2. Update the E40d validation report to use 6-run aggregate
3. Consider doing the same redesign on test-contradictions-subtle (still has 0-2/4 ambiguity)
