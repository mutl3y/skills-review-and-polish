# 20260710 — Documentation Review Experiment

## Goal

Iterate on the [`documentation-review`](../../../.github/experiments/documentation-review/) skill through a series of single-variable experiments ([`EXPERIMENTS.md`](../../../.github/experiments/EXPERIMENTS.md)) that improve both the skill and the Skills Review analyzer. Zero findings is **not** the objective — the objective is improving both the skill and the analyzer without sacrificing either.

## Status

**25 experiments complete (2026-07-10):** E1, E2, E3, E5, E7, E7b, E8, v7, E10, E9, v8, E11, E12, E13, E14, E15, E16, E12-rerun, E14-fixtures, E7-underperformers, E12-N3, E12-N3-hallucination, E12-N3-mode-analysis, E18, **E19**. **5 analyzer fixes shipped** (1 in `buildUserPrompt`, 3 in prompt files, 1 in `findingFilter.ts`, 1 in `scoring.ts`). **94 LLM calls** total (88 prior + 6 E19). **0 rate-limit events** (post-rate-limit). **All 448 unit tests + 4 fixture-validation tests pass.**

**4 open follow-ups** (E20–E23) in `plan.yaml#experiments`. Highest priority: E20 (15 min) — update `tests/fixtures/README.md` with model-aware detection-rate thresholds. See `notes/lessons-learned.md` for the full synthesis.

See [`plan.yaml`](./plan.yaml) for the full per-experiment detail, hypotheses, verdicts, and code changes.

## Headline results

- **Genuine prompt issues** dropped from 3 to 0 across v3→v6, then E8 surfaced 2 new genuine ambiguities in v6 that v7 resolved.
- **E8** (buildUserPrompt grounding): v6 median findings 4→2 (-50%).
- **E10** (coverage.prompt pre-check): v7 median 5→3 (-40%), coverage-gap 3/3→1/3 (-67%).
- **E9** (structural-quality type disambiguation): cognitive-* type flicker ELIMINATED.
- **E11** (findingFilter Rules 8-10): hygiene-* L2/L9 FPs ELIMINATED.
- **E12** (generalization test, 17 fixtures): no regressions; known-good fixtures maintain 100%.
- **E13** (real-world baseline, 15 skills from awesome-copilot-fork): 11/15 A/A+ (73%).
- **E14** (length tier tune): ≤300/0, ≤500/3, ≤750/8, ≤1200/15, >1200/22 (was ≤200/0, ≤350/5, ≤550/12, ≤800/22, >800/35).
- **E15** (scoring bug fix): clean skills (0 findings) now correctly grade A+ instead of Ungraded.
- **E16** (v7 re-measurement): v7 grade improved C→B- (median) due to E14 tier change. **Clean validation** that the tuning is data-driven.
- **E12-N3** (N=3 noise floor on Gemini Flash Lite): 48 calls, 5.5 min, $0.01. **N=3 medians confirm E14/E15 don't regress.** Gemini is ~3x more verbose than gpt-4o-mini (126% vs 37% detection rate) but extras are real new findings, not hallucinations. See `notes/e12-n3-hallucination-analysis.md`.
- **E12-N3 mode analysis** (single vs focused vs multi-wave): single-pass (1 call, 5584-char prompt) DOES let the LLM focus on the labeled category (100% in-cat on 3/6 labeled fixtures). For future fixture-specific runs, use `analysisMode: 'focused'` with `enabledWaves: ['hygiene']` to give 100% attention to one category. See `notes/analysisMode-tradeoff.md`.
- **E18 focused-mode breakthrough** — re-ran the 4 E12-N3 underperformers with `analysisMode: 'multiWave'` + `enabledWaves: [specific]`. **98.1% in-cat detection** (52/53), up from 5.7% (3/53) with single mode. **The "underperformers" were a single-mode dilution issue, not a real analyzer failure.** The 5584-char single-pass prompt dilutes the LLM's attention across 6 categories. Focused mode (1 call per category, 100% attention) gives 2-3x better in-category detection. **The E7-underperformers paper analysis (P1-P3b fixes) is no longer needed** — focused mode alone gives 98%. See `notes/e18-focused-mode-results.md`.
- **E19 focused-mode re-test of the 2 E12-N3 outliers** — extended E18 to the 2 borderline fixtures (test-instruction-quality, test-contradictions-hard). Both hit 100%+ in-cat with focused mode (186.7% and 106.7% respectively). **All 4+2 E12-N3 borderline/underperformers are now explained by single-mode dilution. The E7 paper analysis is FULLY RETIRED.** 6 LLM calls, $0.005, ~1 min. See `notes/e19-focused-mode-results.md`.
- **E7-underperformers** (paper analysis, SUPERSEDED by E18): 3 distinct root causes for 4 underperformers + 4 concrete fixes proposed (P1 coverage pre-check relaxation, P2 deterministic circular detector, P3a dead-prompt relaxation, P3b deterministic version-mismatch detector). See `notes/underperformer-investigation.md`. **E18 invalidates this analysis — focused mode alone gives 98% in-cat, so no P1-P3b fixes needed.**

## Cost

- **88 LLM calls** total across all experiments. **0 rate-limit events.**
- All runs used `analysisMode: single` (1 call/file). Models: gpt-4o-mini (E1-E16) and google/gemini-2.5-flash-lite via OpenRouter (E12-N3).
- 30s cooldown by default; 0ms cooldown for OpenRouter runs (no rate limits).
- See `plan.yaml#iterations` for the full per-iteration delta and code changes.

## Layout

| Path | Purpose |
| --- | --- |
| `versions/v{1,2,3}/SKILL.md` | Skill revisions |
| `data/*.json` | Per-experiment findings data |
| `data/baseline-fork/*.json` | E13 real-world baseline data |
| `data/e12-*.json` | E12 + E12-rerun fixture data |
| `data/e12-n3-*.json` | E12-N3 N=3 medians (Gemini) |
| `logs/*.log` | Per-experiment LLM run logs |
| `notes/*.md` | E12-N3, E7-underperformers, analysisMode-tradeoff analyses |
| `plan.yaml` | Full machine-readable experiment log |

## Latest results (2026-07-10)

- **E12-N3 (Gemini Flash Lite, N=3):** 48 calls, 5.5 min, $0.01. Detection rate 126.3% (vs 37% for gpt-4o-mini). The "extras" are real new issues in the documents, not hallucinations — the fixture labels are incomplete.
- **E12-N3-mode-analysis:** `analysisMode: 'single'` correctly focuses the LLM on the labeled category (100% in-cat on test-ambiguities, test-ambiguities-hard, test-coverage-gaps-hard). For future fixture-specific runs (E18+), use `analysisMode: 'focused'` with `enabledWaves: ['hygiene']` to boost test-circular-hard from 0% to 60-80% detection.
- **E12-rerun:** "Regressions" on 2 known-good fixtures were confirmed as LLM noise (±6 per scan), not real regressions. E14/E15 changes are SAFE.
- **E7-underperformers:** 4 underperformers have 3 distinct root causes; 4 fixes proposed (P1: coverage pre-check, P2: circular detector, P3: dead-instruction).
- **E14-fixtures:** 7 new edge-case fixtures created (empty-body, frontmatter-only, extreme-length 10035 lines, type-workflow, type-meta, type-simple, all-finding-types). Fixture-validation gate still passes.
- **E16 v7 re-measurement:** v7 grade improved C→B- (median) from E14 tier change alone. E15 had no impact on v7 (always has findings).
- **E18 focused-mode breakthrough:** re-ran the 4 E12-N3 underperformers with `analysisMode: 'multiWave'` + `enabledWaves: [specific]`. **98.1% in-cat detection** (52/53), up from 5.7% (3/53) with single mode. 12 calls, 67s, $0.01. **The "underperformers" were a single-mode dilution issue, not a real analyzer failure.** Invalidates the E7-underperformers paper analysis. See `notes/e18-focused-mode-results.md`.

## Recommended next steps

The full synthesis is in [`notes/lessons-learned.md`](../../experiments/documentation-review/notes/lessons-learned.md). Remaining open items (E20–E23) are documented in `plan.yaml#experiments`:

1. **E20 (15 min)** — update `tests/fixtures/README.md` with model-aware detection-rate thresholds (Gemini 126%, gpt-4o-mini 37%) and the corrected single-vs-focused-mode API guidance. The 60% threshold in the current README is model-dependent and outdated.
2. **E21 (30 min)** — add `analysisWaves: [string]` API to `src/core/index.ts` + `src/core/types.ts`. Lets users say "analyze only the cognitive-load wave" without `multiWave` mode.
3. **E22 (5 min)** — run v7 through focused `multiWave` with all 6 waves and compare against the E13 single-mode baseline. Validates that focused mode works for real-world skills, not just labeled fixtures.
4. **E23 (30 min)** — implement the contradiction-dedup investigation. Re-run test-contradictions-hard with N=3 to see if its 8 ambiguity findings are stable across runs; if unstable, add a deduplication post-processor.
