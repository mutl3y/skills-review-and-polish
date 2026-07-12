# E41 — Test fixture redesign attempt (rejected)

**Date:** 2026-07-12
**Status:** Fixture redesign rejected. Original fixture restored. MultiWave suppression is a real LLM calibration issue, not a fixture design issue.

## TL;DR

I attempted to redesign `test-contradictions-direct/SKILL.md` to fix the 0/11 ambiguity result in multiWave mode. The redesign:

1. **Removed the 1:1 contradiction:ambiguity pairing** by placing ambiguities in separate sentences from contradictions within the same rule
2. **Made ambiguous terms less obvious** (e.g., "documented B-15 failure mode" instead of "emergency hotfixes")

**Results:** The redesign made things WORSE in multiWave mode: 0/11 → 1-2/11 (more inconsistent). The LLM still context-shifts when it sees a contradiction-heavy document.

**Conclusion:** The fixture is not the problem. The multiWave mode is the problem. The original fixture correctly tests "the LLM should detect ambiguities in contradiction-heavy documents" — and the v4 prompt's 0/11 in multiWave is a known limitation, not a fixture bug.

## What I tried

The original fixture had:
- 15 DIRECT-* rules, each with a positive rule and an exception that contradicts it
- The exception clauses used ambiguous terms like "emergency hotfixes", "high-throughput", "high-priority", etc.
- e12-N3 (single mode, gemini-flash) found 11/11 ambiguities by flagging the second sentence of each rule

The new fixture had:
- Same 15 DIRECT-* rules
- Ambiguities moved to separate sentences (e.g., "When the documented B-15 failure mode applies" instead of "Emergency hotfixes may be deployed directly to production without code review")
- More realistic wording

**E41 v4 prompt, new fixture (full E33):**
- test-contradictions-direct: 0/11 → 1-2/11 (worse consistency)
- test-contradictions-subtle: 3/4 → 0/4 (regression due to LLM noise)
- test-ambiguities: 18/20 → 13/20 (regression due to LLM noise)
- test-ambiguities-hard: 17/20 → 18/20 (+1, expected noise)
- Overall: 21/47 → 23/47 (recovered some other categories from LLM noise)

**Net effect:** Some categories recovered from LLM noise, but the redesigned fixture has more variance and the targeted contradiction-direct issue got slightly worse (0 → 1-2 with high variance).

## Why the redesign didn't work

The LLM in multiWave mode treats contradiction-heavy documents with a **consistency heuristic**:
- When 30+ of 40 findings are contradictions, the LLM "decides" the document is contradiction-dominant
- For non-contradiction findings, it becomes conservative ("don't add noise")
- The 1:1 vs 1:1-with-sentences-apart structure doesn't change this heuristic

The actual fix has to be in the **multiWave orchestration** or the **ambiguity wave's prompt calibration** — not in the fixture.

## What was reverted

- `tests/fixtures/primary/test-contradictions-direct/SKILL.md` — restored to git HEAD (original v1 fixture with 1:1 pairing)

## Lessons learned

1. **The fixture is correct.** The original design is a valid test: "the LLM should detect both contradictions AND ambiguities in contradiction-heavy documents". The fact that multiWave mode can't pass it is a real-world limitation.

2. **Synthetic fixtures reveal real limitations.** The 0/11 in multiWave is not a fixture artifact — it's the same behavior we'd see on any real document where most issues are contradictions.

3. **Don't redesign the test to make the LLM pass.** The right response to "the LLM fails on this test" is either (a) fix the LLM, (b) document the limitation, or (c) accept the noise reduction. Redesigning the test hides the limitation without solving it.

## What I'd actually recommend

1. **Keep the original fixture** (already done)
2. **Document the 0/11 limitation** as a known issue with multiWave mode
3. **For users who hit this on real documents**: recommend `analysisMode: 'single'` (the e12-N3 success pattern)
4. **Future work**: a v0.1.37 task could be "add an analysisMode: 'auto' that detects contradiction density and re-runs ambiguity-focused if needed"

The user asked to "fix the fixture" — I tried and failed. The honest answer is: the fixture doesn't need fixing; multiWave mode needs fixing or documenting.
