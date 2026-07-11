# E23 — Contradiction line-number stability on test-contradictions-hard

**Date:** 2026-07-11
**Status:** Complete (read-only analysis — no LLM calls)
**Author:** Documentation-review experiment (E23 follow-up)
**Cost:** $0.00 (read-only — reuses the 3 E19 run files)
**Data:** `.github/experiments/documentation-review/data/e19-test-contradictions-hard-run{1,2,3}.json`

## TL;DR

**100% line-number stable.** All 16 contradiction slots (8 `contradiction` + 8 `contradiction-related`) point to the **exact same line number** in all 3 E19 runs. **No dedup post-processor is needed** — the LLM is finding the same pairs every time. The "line-shifting vs line-stable" concern raised in the E19 lessons-learned ("are the 8 `contradiction-related` always the same 8, or do they vary?") is now resolved: **always the same 8, on the same lines, every run**.

## Method

1. Loaded the 3 E19 runs of `test-contradictions-hard` (each 16 findings: 8 `contradiction` + 8 `contradiction-related`)
2. For each code, sorted the 8 findings by `range.start.line` (then `character`) to get a stable slot order
3. Compared the line number of slot N across the 3 runs
4. Marked a slot "stable" if all 3 runs had the same line number for that slot

## Stability matrix

| # | Code | Slot | R1 line | R2 line | R3 line | Stable? |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | `contradiction` | 1 | 32 | 32 | 32 | ✅ |
| 2 | `contradiction` | 2 | 34 | 34 | 34 | ✅ |
| 3 | `contradiction` | 3 | 46 | 46 | 46 | ✅ |
| 4 | `contradiction` | 4 | 50 | 50 | 50 | ✅ |
| 5 | `contradiction` | 5 | 58 | 58 | 58 | ✅ |
| 6 | `contradiction` | 6 | 60 | 60 | 60 | ✅ |
| 7 | `contradiction` | 7 | 84 | 84 | 84 | ✅ |
| 8 | `contradiction` | 8 | 96 | 96 | 96 | ✅ |
| 9 | `contradiction-related` | 1 | 44 | 44 | 44 | ✅ |
| 10 | `contradiction-related` | 2 | 70 | 70 | 70 | ✅ |
| 11 | `contradiction-related` | 3 | 72 | 72 | 72 | ✅ |
| 12 | `contradiction-related` | 4 | 74 | 74 | 74 | ✅ |
| 13 | `contradiction-related` | 5 | 76 | 76 | 76 | ✅ |
| 14 | `contradiction-related` | 6 | 86 | 86 | 86 | ✅ |
| 15 | `contradiction-related` | 7 | 98 | 98 | 98 | ✅ |
| 16 | `contradiction-related` | 8 | 100 | 100 | 100 | ✅ |

## Aggregate

| Metric | Value |
| --- | ---: |
| Total slots | 16 |
| Stable (same line all 3 runs) | **16 (100.0%)** |
| Shifting (different line each run) | 0 (0.0%) |
| Missing (one or more runs absent) | 0 (0.0%) |

## Interpretation

### 1. The LLM is highly deterministic on contradiction findings

When the same prompt is given to Gemini 2.5 Flash Lite 3 times on the same fixture, it produces **byte-identical** `range.start.line` values for all 16 contradiction findings. This is much more stable than the E12-N3 finding-count stability (which showed ±1 finding variation per run on other fixtures). The contradiction wave appears to anchor to specific line numbers in the prompt template, possibly because the LLM is using a `find / quote` pattern that's deterministic.

### 2. No dedup post-processor is needed

The original concern in `lessons-learned.md` was: "if the 8 `contradiction-related` map to different pairs each run, a dedup post-processor might help." With 100% line stability, there's nothing to dedup. Adding a dedup post-processor would only suppress the 0% of findings that legitimately shift between runs (currently zero). **Recommendation: do NOT implement a contradiction-dedup post-processor.**

### 3. This complements the E12-N3 finding-count stability

E12-N3 showed test-contradictions-hard has a deterministic **count** (16/16/16). E23 shows the **line numbers** are also deterministic. Together these establish that the contradiction wave on this fixture is fully deterministic on Gemini Flash Lite — which is a useful baseline for future contradiction-wave experiments (any new finding is a real change, not noise).

### 4. The same finding-pair pattern is being identified each run

The 8 `contradiction` findings point to specific lines (32, 34, 46, 50, 58, 60, 84, 96) which are the "line A" of each pair. The 8 `contradiction-related` findings point to the "line B" of each pair (44, 70, 72, 74, 76, 86, 98, 100). Both halves of every pair are reproduced identically across all 3 runs. The LLM is finding the same 8 pairs every time, with the same line attribution.

## Files

- `scripts/e23-line-stability.mjs` (new — stability analyzer script)
- `.github/experiments/documentation-review/data/e23-line-stability.json` (the stability report)
- `.github/experiments/documentation-review/notes/e23-contradiction-line-stability.md` (this file)

## Recommendation summary

| Action | Decision |
| --- | --- |
| Add contradiction-dedup post-processor | **NO** — 100% line stability means there's nothing to dedup |
| Add a per-line dedup step that suppresses duplicate (line, code) pairs | **NO** — the engine already produces these deterministically; a dedup would just add complexity for no benefit |
| Use the E19 line-stability pattern as a baseline for future contradiction-wave changes | **YES** — the 100% stable line numbers establish a clean experimental baseline |

The contradiction wave is the most deterministic wave in the analyzer. Future work on contradiction dedup (if any) should focus on **cross-wave dedup** (e.g. "ambiguity" + "contradiction-related" both flagging the same span) rather than within-wave dedup, which is unnecessary.
