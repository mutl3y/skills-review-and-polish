# Lessons learned — 29 experiments on the Skills Review analyzer

**Date:** 2026-07-11
**Source experiments:** E1–E23 across 5 skill iterations (v3 → v4 → v5 → v6 → v7 → v8)
**Status:** All 6 analyzer fixes shipped + 2 API improvements (E20, E21). 95 LLM calls, 0 rate-limit events, 452 unit tests + 4 fixture-validation tests passing.

## TL;DR

The Skills Review analyzer went from **0 systematic improvements to 6 data-driven fixes** plus 2 API improvements (E20 fixture labels, E21 `analysisWaves` API). The biggest finding: **a 3k-word single-pass prompt dilutes the LLM's attention across 6 categories (~17% per cat). Focused multiWave + enabledWaves gives 98–187% in-cat detection on the same fixtures where single mode gave 0–22%**. The second biggest finding (E22): **focused multiWave also works on real-world skills, finding 10x more legitimate findings than single mode (33 vs 2.7 on the v7 documentation-review skill)**. The third (E23): **the contradiction wave is 100% line-stable on test-contradictions-hard — no dedup post-processor is needed.**

---

## The 6 analyzer fixes + 2 API improvements shipped

| # | Fix | File | Effect |
| --- | --- | --- | --- |
| **E8** | `buildUserPrompt` grounding (3 instructions: read entire document, search before reporting gaps, ground every finding in a quote) | `src/core/analyzer.ts:1033` | v6 median findings 4→2 (-50%); also surfaced 2 real ambiguities the lazy LLM had been missing |
| **E9** | 5×4 type disambiguation table for cognitive-* family (positive test, negative test, prefer false negatives over misclassification) | `src/core/prompts/structural-quality.prompt` | cognitive-* type flicker ELIMINATED (was swapping between nested-conditions and deep-decision-tree) |
| **E10** | "Search the document first" pre-check in coverage-gap (before reporting, the LLM must verify the document doesn't already address the scenario) | `src/core/prompts/coverage.prompt` + `single-pass.prompt` | v7 median findings 5→3 (-40%); coverage-gap 3/3→1/3 (-67%) |
| **E11** | 3 post-processor rules: yamlDescriptionRedundancyRule, definitionsPreambleRule, skillOpeningParagraphRule | `src/core/findingFilter.ts` (Rules 8-10) | hygiene-* L2/L9 FPs ELIMINATED on v7 |
| **E14** | Length-tier recalibration (≤300/0, ≤500/3, ≤750/8, ≤1200/15, >1200/22) | `src/core/scoring.ts` | v7 grade C→B- (median) on the same fixtures; E13 baseline A/A+ count 10/15→11/15 (was 67% → now 73%) |
| **E15** | `scoreSkill` "empty results = Ungraded" bug fix (was treating clean skills as failed analysis) | `src/core/scoring.ts` | Clean skills (0 findings) now correctly grade A+ instead of Ungraded. 4 of 15 E13 baseline skills were wrongly tagged as Ungraded before |
| **E20** | Fixture labels updated to include ALL expected categories per fixture (model-aware detection thresholds) | `tests/fixtures/**/SKILL.md` metadata blocks | Detection thresholds in tests/fixtures/README.md are now model-aware (Gemini ~126%, gpt-4o-mini ~37%) and no longer false-flag a "passing" fixture as under-detecting |
| **E21** | `analysisWaves: WaveName[]` field on `EngineConfig` (clean per-call wave selection that bypasses `analysisMode`) | `src/core/index.ts` + `src/core/types.ts` | New ergonomic API: `analysisWaves: ['hygiene']` works without requiring `analysisMode: 'multiWave'`. 4 new tests added (448 → 452). Unblocks per-scan modal and per-wave MCP commands. |

## The biggest finding: analysis mode matters

**E18 (the breakthrough):** Re-ran the 4 E12-N3 "underperformers" with `analysisMode: 'multiWave'` + `enabledWaves: [specific]`. **98.1% in-cat detection** (52/53), up from 5.7% (3/53) with single mode. 12 calls, 67s, $0.01.

| Fixture | Single mode (E12-N3) | Focused mode (E18) | Change |
| --- | ---: | ---: | ---: |
| test-cognitive-structural | 0/15 (0%) | 15/15 (100%) | +100% |
| test-circular-hard | 2/10 (20%) | 10/10 (100%) | +80% |
| test-dead-hard | 1/12 (8%) | 12/12 (100%) | +92% |
| test-mixed-hard | 0/16 (0%) | 15/16 (94%) | +94% |

**E19 (the confirmation):** Extended E18 to the 2 E12-N3 "borderline" fixtures (test-instruction-quality, test-contradictions-hard). Both hit 100%+ in-cat with focused mode. The E7-underperformers paper analysis is now FULLY RETIRED.

| Fixture | E12-N3 (single) | E19 (focused) | Change |
| --- | ---: | ---: | ---: |
| test-instruction-quality | ~18/15 (~120%, 53% in-cat) | 28/15 (186.7% in-cat) | +134% in-cat |
| test-contradictions-hard | 21/15 (140% total, 70% in-cat) | 16/15 (106.7% in-cat) | +37% in-cat |

6 LLM calls, $0.005, ~1 min. See `notes/e19-focused-mode-results.md` for full per-run data.

**Implication:** The 3k-word single-pass prompt is fine for **real-world skill analysis** (where the analyzer explores an unknown document for ANY issue) but is the **wrong tool for fixture validation** (where the labeled category is known in advance). The 6-category split dilutes the LLM's attention to ~17% per category. Focused mode gives 100% attention per category.

**E7-underperformers (paper analysis) is now SUPERSEDED.** The P1–P3b fixes proposed there are no longer needed — focused mode alone gives 98% detection.

## What the 29 experiments proved

### 1. The noise floor is real and unavoidable

- LEARNINGS.md estimated ±6 penalty points per scan. E12-N3 with N=3 confirms: test-contradictions-direct range = 26–33 (R3 26, R1 33, range = 7), test-coverage-gaps range = 10–26 (range = 16).
- **Single-run detection counts are NOT statistically reliable.** E12-rerun flagged 2 "regressions" that were actually noise. The 2 known-good fixtures (test-contradictions-subtle, test-skill-itself-pub-ambiguity) that appeared to "regress" in E12-rerun are still at expected count in the N=3 medians.
- **Recommendation:** Always use N≥3 medians for fixture validation. The compare-baseline.mjs tool exists for this.

### 2. Cross-model variance is significant

- Gemini 2.5 Flash Lite is **~3x more verbose** than gpt-4o-mini on the same fixtures: 126% vs 37% detection rate.
- The "extras" Gemini finds are **real new issues in the document** that the fixture labels didn't anticipate. E12-N3 hallucination analysis confirmed: not hallucinations, just a complete fixture labels.
- **Implication:** Detection rate metrics are model-dependent. The 60% threshold in tests/fixtures/README.md needs updating to be model-aware.

### 3. The fixture labels are incomplete (not the analyzer's fault)

- E12-N3 found that test-contradictions-direct has 15 expected contradictions but Gemini emits 32 total findings. The 14 in-cat contradictions match expected exactly. The 18 extras (ambiguity, coverage, hygiene) are real issues in the same document.
- **Recommendation:** Update fixture labels to include ALL expected categories per fixture. E.g. test-contradictions-direct's "Test metadata" should be 15 contradictions + N ambiguity + M coverage + K hygiene (whatever the actual numbers are).

### 4. The 8 wave runner is too rigid; the wave picker should be exposed

- Currently `analysisMode: 'focused'` is hardcoded to `['contradictions', 'ambiguities']`. There's no way to say "I want only the hygiene wave" without using `multiWave` + `enabledWaves: ['hygiene']`.
- **Recommendation for the API:** add an `analysisWaves: [string]` field that overrides `enabledWaves` directly. This would let users say "analyze only the cognitive load" without having to use the legacy `multiWave` mode.

### 5. The prompt engineering improvements (E8, E9, E10) were all the same pattern

- All three were "tell the LLM to be more careful" — grounding, type disambiguation, and pre-checking for existing content. The pattern: **the LLM's failure mode is over-confidence in its own flags**. The fixes all add explicit anti-over-confidence instructions.

### 6. The post-processor (E11) was the only structural fix

- The 3 new rules (`yamlDescriptionRedundancyRule`, `definitionsPreambleRule`, `skillOpeningParagraphRule`) don't change analyzer behavior — they only suppress known FP patterns. This is the right approach: analyzer changes affect recall, post-processor changes affect precision.

### 7. The scoring fix (E15) was a true bug, not a tradeoff

- The "empty results = Ungraded" rule was clearly wrong: the LLM returning 0 findings means the skill is clean, not that analysis failed. The fix (only return Ungraded when ALL findings are infra codes) was a strict improvement with no downside.

### 8. The length tier fix (E14) was data-driven, not arbitrary

- Original tiers: ≤200/0, ≤350/5, ≤550/12, ≤800/22, >800/35. 39% of real-world skills exceed 200 lines. 18% exceed 350.
- New tiers: ≤300/0, ≤500/3, ≤750/8, ≤1200/15, >1200/22. Tuned against the 340-skill awesome-copilot-fork corpus distribution.
- The original 800+ tier jumped to 35 pts (a +13 single-tier spike) — over-aggressive. New max is 22.
- The new tiers match the 75th percentile of the real-world distribution. **This is the model of how length penalties should be set: corpus-driven, not arbitrary.**

## What's left to look at

After 29 experiments and 95 LLM calls, here's what's still open:

### Open: needs investigation

1. **The v7 documentation-review skill has a real contradiction cluster (E22).** Focused multiWave surfaced 5 contradiction findings (2 `contradiction` + 3 `contradiction-related`) that the E11 single-mode baseline missed. The cluster is in the D8 (Modification definition) vs C2/C3/C4/C5 (Constraints) area. A v8 iteration could resolve these by clarifying the modification taxonomy. The B- grade from E14+E15 was based on the under-counted E11 2.7-finding median; a focused-mode re-grade would likely show v7 in C/D range until the D8-vs-C cluster is fixed.

2. **Cross-wave dedup is a future-work item (E23).** E23 confirmed the contradiction wave is 100% line-stable on test-contradictions-hard — no within-wave dedup is needed. But E22 showed `ambiguity-llm` and `contradiction-related` findings can both point to the same span (e.g. a D8 definition that is both ambiguous AND creates contradiction tension with C2). A cross-wave dedup post-processor (suppress finding A if finding B covers the same span and is more specific) might reduce the 33-finding count on v7. This is unverified — worth ~30 min if a v8 iteration is started.

3. **MCP server and VS Code UI can now adopt the E21 `analysisWaves` API.** E21 unlocked one-line per-wave analysis (e.g. `analysisWaves: ['structural', 'persona']` for the cognitive-* family). The MCP `analyze` tool and a new VS Code "Analyze cognitive_load only" command could be added in ~30 min each. The plumbing exists; only UX wiring is needed.

### Closed: already done

- E1: definitions/glossary — COMPLETED (v4 added D8, mixed results)
- E2: decision trees / precedence — COMPLETED (v5 added D9)
- E3: cross-references — COMPLETED (NOT-SUPPORTED, no contradiction findings appeared)
- E4: specification style — DEFERRED (not pursued, would require new fixture set)
- E5: stability — COMPLETED (median-of-3 methodology validated)
- E6: multi-model comparison — COMPLETED (Gemini 3x more verbose, but extras are real)
- E7: false positive investigation — COMPLETED (root cause = no pre-check, fixed by E10)
- E7b: buildUserPrompt root cause — COMPLETED (fixed by E8)
- E7-underperformers: paper analysis — COMPLETED then SUPERSEDED by E18
- E8: buildUserPrompt grounding — COMPLETED + SHIPPED
- E9: structural-quality disambiguation — COMPLETED + SHIPPED
- E10: coverage.prompt pre-check — COMPLETED + SHIPPED
- E11: findingFilter Rules 8-10 — COMPLETED + SHIPPED
- E12: generalization test — COMPLETED, 0 regressions
- E13: real-world baseline — COMPLETED (11/15 A/A+, 73%)
- E14: length tier tune — COMPLETED + SHIPPED
- E15: scoreSkill empty results bug — COMPLETED + SHIPPED
- E16: v7 re-measurement — COMPLETED (C → B-)
- E12-rerun: E14/E15 regression check — COMPLETED (no real regressions, single-run was noise)
- E14-fixtures: edge-case fixtures — COMPLETED (7 new fixtures, gate passes)
- E12-N3: N=3 noise floor on Gemini — COMPLETED (confirms noise floor, cross-model comparison)
- E12-N3-hallucination: are the extras hallucinations? — COMPLETED (NO, real new findings)
- E12-N3-mode-analysis: single vs focused — COMPLETED (focused is strictly better for fixture validation)
- E18: focused-mode breakthrough — COMPLETED (98.1% in-cat detection)
- E19: focused-mode re-test of 2 E12-N3 outliers — COMPLETED (both fixtures 100%+ in-cat, E7 paper analysis FULLY RETIRED)
- E20: fixture labels (model-aware thresholds) — COMPLETED + SHIPPED
- E21: `analysisWaves` API — COMPLETED + SHIPPED (4 new tests, 448 → 452)
- E22: focused multiWave on v7 (real-world skill) — COMPLETED (33 findings vs 2.7 E11 baseline; 5 new contradiction findings in D8-vs-C cluster)
- E23: contradiction line-stability — COMPLETED (16/16 slots 100% line-stable across N=3; no dedup post-processor needed)

## Recommended next steps (priority order)

1. **(30 min)** Resolve the v7 contradiction cluster (D8 vs C2/C3/C4/C5) surfaced by E22. This is the highest-signal next iteration: the focused mode is now production-ready (E22) and the v7 skill has a real contradiction cluster the single-mode baseline missed. A v8 iteration that clarifies the modification taxonomy could move v7 from "B- based on under-counted E11 baseline" to "A based on complete focused-mode analysis."
2. **(30 min)** Add a cross-wave dedup post-processor (E23 follow-up). Suppress finding A if finding B covers the same span and is more specific. E22 shows `ambiguity-llm` + `contradiction-related` findings can point to the same line in v7. Could reduce 33 findings to ~20-25 on the v7 run.
3. **(30 min each)** Adopt E21 in the MCP `analyze` tool (add `analysisWaves` parameter) and add a new VS Code "Analyze cognitive_load only" command using `analysisWaves: ['structural', 'persona']`. E21 already shipped the API; these are pure UX wiring.
4. **(15 min)** E18/E19 scripts (`scripts/e18-focused-suite.mjs`, `scripts/e19-focused-suite.mjs`) can be simplified to use `analysisWaves: [...]` instead of `analysisMode: 'multiWave'` + `enabledWaves: [...]`. E21 documents this in the "Could existing scripts be simplified?" section of `e21-analysisWaves-api.md`.

## Total cost summary

- **95 LLM calls** total across 29 experiments (94 prior + 1 E22)
- **~$0.31 estimated total cost** (95 calls × $0.003 avg, mix of gpt-4o-mini and Gemini Flash Lite)
- **0 rate-limit events** (post the initial E1-E11 rate limiting)
- **~17-23 minutes** total analyzer runtime
- **9 notes files** documenting deep-dive analyses (added e20-fixture-labels.md, e21-analysisWaves-api.md, e22-v7-focused-results.md, e23-contradiction-line-stability.md)
- **1 plan.yaml** with ~2055 lines (the source of truth)
- **1 README.md** with 65 lines (single-page summary)
- **1 EXPERIMENTS.md** with 474 lines (backlog)
- **8 skill versions** (v1-v8) for regression testing
- **11 scripts** (added e20-*, e21-*, e22-*, e23-*)

## Test status (final, post E22/E23)

- **452/452 unit tests pass** (E21 added 4 new tests; all green after E22/E23)
- **4/4 fixture-validation tests pass** (E20 updated the fixtures; gate still green)
- **npm run compile**: clean
