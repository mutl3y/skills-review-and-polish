
# Handover Update — 2026-07-13: v0.1.37/v0.1.38 Released

## Current State (Updated)

- **Branch:** main (HEAD: d0aa476)
- **Version:** 0.1.38 (PUBLISHED to VS Code marketplace)
- **Tests:** 485 unit tests passing
- **Compilation:** Clean (npm run compile)

## What Was Done in v0.1.37/v0.1.38 (since 2026-07-12)

### Multi-model scan recommended configuration (E53/E54/E56)

**Default config in package.json:**
- `model`: `google/gemini-2.5-flash-lite` (47% recall on test fixtures)
- `deepModel`: `deepseek/deepseek-chat-v3` (90% on circular, 3x contradiction improvement)

### E56 corpus scan results

| Metric | E30 (qwen-only) | E56 (multi-model) | Change |
|---|---:|---:|---:|
| Total findings | 1664 | **8811** | **+429%** |
| Cost | $0.50 | **$0.24** | **-52%** |
| Circular definitions | 1 | 15 | +1400% |
| Contradictions | 11 | 35 | +218% |
| Dead instructions | 0 | 29 | new |
| Ambiguity | 939 | 5235 | +458% |
| Coverage gaps | 323 | 2103 | +551% |
| Time | 48 min | 47 min | similar |

### Test architecture (E50)

- **Clean fixtures** (15): `tests/fixtures/clean/*.md` — no labels, no scaffolding
- **Expected answer files** (15): `tests/fixtures/expected/*.json`
- **Test runner:** `scripts/e50-clean-architecture.mjs`
- **Result:** 18/43 = 42% recall on clean fixtures (down from 22/47 = 47% with labels, but more honest)

### E58 — quality-playbook review

Scanned the 2738-line B-grade skill in 24.6s. Found **41 real findings**:
- 22 ambiguity-llm (subjective terms)
- 12 hygiene-redundant-instruction (duplicate text)
- 4 contradiction-related (line 358 default behavior conflict)
- 2 hygiene-vague-cognitive-directive
- 1 contradiction (line 358)

**E11 said 0 findings for this skill. E58 found 41. The E11 evaluation was missing real issues.**

### Documents Updated

- `package.json` — model/deepModel defaults, version 0.1.38
- `README.md` — v0.1.38 status
- `docs/USER-GUIDE.md` — new model recommendations, marked qwen as "Avoid"
- `docs/CHANGELOG.md` — full v0.1.37/v0.1.38 changes
- `src/core/prompts/hygiene.prompt` — circular rule fix (0/7 → 5/7 on test-circular-hard)

### New Scripts

- `scripts/e50-clean-architecture.mjs` — clean architecture test runner
- `scripts/e50-generate-clean-fixtures.mjs` — generator for clean fixtures
- `scripts/e51-production-skill-test.mjs` — production skill recall test
- `scripts/e52-model-comparison.mjs` — 2-model comparison
- `scripts/e53-model-comparison-clean.mjs` — 7-model comparison on clean fixtures
- `scripts/e54-models-not-yet-tested.mjs` — wildcards (Claude, Gemini Pro, o1/o3, deepseek, Grok, Mistral)
- `scripts/e55-cost-analysis.mjs` — cost estimates
- `scripts/e56-corpus-rescan-multimodel.mjs` — corpus scan with multi-model mix
- `scripts/e58-quality-playbook-review.mjs` — single-skill deep review

### New Notes

- `notes/e51-production-test.md` — E51 production test results
- `notes/e56-corpus-multimodel.md` — full E56 corpus scan results
- `notes/e57-manual-sample-review.md` — manual sample review of E56 results
- `notes/e58-quality-playbook-review.md` — single-skill deep review
- `notes/e60-suggested-improvements.md` — prioritized list of next improvements

(Other experiment notes — e50, e52, e53, e54, e55 — exist as scripts but their detailed report notes were not created; the scripts and data files are the source of truth for those.)

## What's Next (v0.1.39+)

See `notes/e60-suggested-improvements.md` for a prioritized list of 13 improvements.
The top 3 are:
1. **P0: Improve contradiction detection** for test-contradictions-direct (4/15 → 10+/15)
2. **P0: Improve dead-instruction detection** (2/12 → 8+/12)
3. **P0: Add MIX model option to config UI** (already in code, just needs UX)

## Cost Summary (v0.1.37 work)

- E43-E50 prompt work: ~$0.20
- E51-E58 model comparison + corpus scan: ~$1.50
- Total: ~$1.70 for 600+ LLM calls and a major improvement

---

## Verification Note (2026-07-13)

This HANDOVER was verified using the `documentation-review` skill (SKILL.md).
Result: **Factually Accurate with 3 minor corrections applied** (HEAD reference, 5 missing notes references corrected, line count off by 1).
All 25+ Factual Statements (version, test count, model config, E56 corpus results, E58 findings, E30 baseline, file references for scripts that exist) verified against Repository Evidence.
