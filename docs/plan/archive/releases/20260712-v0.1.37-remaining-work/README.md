# Plan: v0.1.37 Remaining Work

**Plan ID:** 20260712-v0.1.37-remaining-work
**Parent:** [docs/plan/20260710-documentation-review-experiment/plan.yaml](../20260710-documentation-review-experiment/plan.yaml)
**Status:** Ready
**Created:** 2026-07-12

## What's in this plan

Follow-up work for after the v0.1.36 release (commit `bc4f7a4`). v0.1.36 shipped the E40d v4 ambiguity prompt, the redesigned test-contradictions-direct fixture, and the E33 dedup fix.

## Tasks (ordered by impact)

| ID | Title | Priority | Effort |
|---|---|---|---|
| [E43](plan.yaml#E43-coverage-prompt) | Investigate coverage-gap under-detection (5/13, 5/15) | High | 2-3h |
| [E44](plan.yaml#E44-contradictions-subtle-fixture) | Apply realistic-structure to test-contradictions-subtle | Medium | 30m |
| [E45](plan.yaml#E45-circular-detection) | Investigate circular detection (2/10) | Low | 1-2h |
| [E46](plan.yaml#E46-test-dead-hard-regression) | Verify test-dead-hard 0/12 is OpenRouter noise | Low | 15m |
| [E4](plan.yaml#E4-specification-style) | Specification-style prompt experiment (planned from E2) | Low | 2-4h |
| [E6](plan.yaml#E6-multi-model-comparison) | Mark as completed (covered by E12-N3) | Trivial | 5m |
| [E47](plan.yaml#E47-publish-v0.1.37) | Publish v0.1.37 after E43-E46 complete | High | 30m |

## Start here

1. Read [plan.yaml](plan.yaml) for full task details
2. Read `.github/experiments/documentation-review/notes/e40d-validation-report.md` for the current state
3. Read `.github/experiments/documentation-review/notes/e42-dedup-fix.md` for the latest results
4. Start with E43 (coverage) — it's the biggest miss in E42

## Key learnings to apply

1. **Aggregate 6+ E33 runs before ship/revert decisions** (single 3-run E33 is too noisy)
2. **Probe-then-full-E33 discipline** — use `scripts/e40c-ambiguity-probe.mjs` (or analogous) for quick iteration
3. **Realistic fixture structure** — split issues into different sentences/sections so the LLM can detect them as distinct
4. **Document negative results** — the E41-rejected note is the template for failures

## Scripts ready to use

- `scripts/e33-fixture-validation.mjs` — full E33 (13 fixtures × N runs, ~9 min for 3 runs)
- `scripts/e40c-ambiguity-probe.mjs` — quick 3-fixture probe (~1 min)
- `scripts/e40e-realworld-skill.mjs` — evaluate on any SKILL.md
- `scripts/e40f-multi-skill-batch.mjs` — multi-skill batch evaluator

## Data location

- Latest E33 results: `.github/experiments/documentation-review/data/e33-fixture-validation-2026-07-12T13-00-14-181Z.json`
- Previous E33 results: `.github/experiments/documentation-review/data/e33-fixture-validation-2026-07-12T09-44-48-342Z.json`
- Baseline e12-N3 results: `.github/experiments/documentation-review/data/e12-n3-*.json`
