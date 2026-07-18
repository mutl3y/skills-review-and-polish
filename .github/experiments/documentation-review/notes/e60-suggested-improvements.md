# E60 — Suggested Improvements for v0.1.37+ (Future Work)

**Date:** 2026-07-13
**Status:** Documented for next session
**Context:** After publishing v0.1.38 with the multi-model mix (gemini-flash + deepseek), these are the remaining gaps and improvements identified by the E50/E53/E54/E56/E57/E58 work.

## Summary of Where We Are (v0.1.38 published)

- **Model config:** `model: gemini-2.5-flash-lite` + `deepModel: deepseek/deepseek-chat-v3`
- **E50 recall on clean fixtures:** 18/43 = 42% (down from 22/47 = 47% with labeled fixtures, but more honest)
- **E56 corpus scan:** 327/327 skills, 8811 findings (vs 1664 with qwen-only, +429%)
- **E58 manual review:** 100% of sampled findings are real
- **All 485 unit tests pass**

## Identified Gaps from E50

### Gaps that need prompt-level fixes (not model change)

| Fixture | Category | Current | Target | Suggested Fix |
|---|---|---:|---:|---|
| test-contradictions-direct | contradiction | 4/15 (27%) | 12+/15 | Add more domain-inference examples (the rule already has good examples, but the LLM under-fires on numeric-range overlap) |
| test-contradictions-direct | hygiene | 2/5 (40%) | 4/5 | Add concrete hygiene patterns to rule (e.g. specific to "approval workflow" + "validation") |
| test-dead-hard | hygiene-dead-instruction | 2/12 (17%) | 8+/12 | Add examples of "this version is deprecated" and "use this API instead" patterns |
| test-cognitive-structural | cognitive | 2/5 (40%) | 4/5 | Already added 5+ AND conditions example. May need more examples of delegation/priority conflicts |
| test-coverage-gaps-hard | hygiene | 0/3 (0%) | 2/3 | Add examples of "what if the X is missing" with multiple missing inputs |
| test-instruction-quality | contradiction | 0/1 (0%) | 1/1 | The single contradiction is subtle. May need better example |
| test-contradictions-subtle | cognitive-nested | 0/1 (0%) | 1/1 | The 5+ AND conditions example is in the rule but not being applied here |

### Gaps that need test fixture updates

| Fixture | Issue | Suggested Action |
|---|---|---|
| test-ambiguities-hard | LLM finds only 5/20 — fixture may be over-claimed | Manually review 15 missing ambiguities — some may be invalid |
| test-ambiguities | LLM finds only 11/20 — same issue | Review 9 missing |
| test-contradictions-hard | ambiguity-llm 6/11 (55%) | Review 5 missing — may be invalid |
| test-coverage-gaps | hygiene 0/1 (0%) | Review — fixture may be over-claimed |
| test-coverage-gaps-hard | coverage-gap 5/10 (50%) | Review 5 missing — may be over-claimed |

### Gaps that are simply too hard (model capability limit)

| Fixture | Category | Why it's hard |
|---|---|---|
| test-circular-hard / cognitive | 0/1 | Only 1 expected, very subtle constraint |
| test-contradictions-subtle / cognitive | 0/1 | Only 1 expected, very subtle |
| test-instruction-quality / cognitive | 0/2 | Constraint-overload pattern not being applied |
| test-skill-itself-pub-ambiguity / ambiguity | 0/1 | 1 expected, only 1 run got it right |

## Suggested Future Improvements (in priority order)

### P0 — Critical (would have major impact)

1. **Improve contradiction detection for test-contradictions-direct (4/15 → 10+/15)**
   - Add more examples of numeric-range overlap to contradiction rule
   - Test: re-run E50 on test-contradictions-direct, expect 10+ hits
   - Cost: ~$0.01 (1 fixture × 1 model × 3 runs)
   - Risk: low (rule-level only)

2. **Improve dead-instruction detection (2/12 → 8+/12)**
   - Add explicit examples: "this version is deprecated", "use this API instead", "X is no longer maintained"
   - Test: re-run E50 on test-dead-hard, expect 8+ hits
   - Cost: ~$0.01
   - Risk: low

3. **Add `MIX` model option that allows user to set both model and deepModel**
   - Already supported in the engine (engine accepts model + deepModel)
   - Need to expose in config UI (USER-GUIDE docs already updated)
   - Cost: $0 (documentation only)

### P1 — High (would improve production recall)

1. **Add dedup for contradiction-related findings**
   - Currently the same contradiction gets reported 4-5 times (as `contradiction` + multiple `contradiction-related`)
   - The E42 dedup fix counts each finding once, but the JSON output still has duplicates
   - Fix: deduplicate by `range.start.line` or by finding similarity
   - Test: re-run E58 on quality-playbook, expect 5 contradictions → 1 contradiction
   - Cost: $0 (engine change only)

2. **Test the v2 coverage prompt on production corpus**
   - E43 showed 5/13 → 12-14/13 on test-circular. But E51 showed it doesn't help production.
   - Run E56-style corpus scan with v2 coverage prompt
   - Cost: ~$0.25 (327 skills × 1 model × 1 run)
   - Risk: medium (already failed on production)

3. **Try Claude 3.5 Sonnet on the clean test fixtures**
   - E54 had 404 errors (model ID not on OpenRouter) — need to find correct ID
   - Try `anthropic/claude-3.5-sonnet-20241022` or similar
   - Cost: ~$0.15
   - Risk: low

### P2 — Medium (nice to have)

1. **Run the multi-model corpus scan with deepseek for ALL waves (not just deep)**
   - Currently deepseek only runs for contradictions wave
   - Test if running deepseek for all waves gives even better recall
   - Cost: ~$0.60 (327 × 1 model × 1 run)
   - Risk: medium (slower, more expensive)

2. **Add coverage-gap rule for "What if multiple X are missing" pattern**
   - test-coverage-gaps / hygiene and coverage-gap are at 0% — the LLM doesn't fire for multiple-missing-inputs patterns
   - Add explicit examples to coverage prompt

3. **Improve the test-ambiguities-hard fixture**
   - LLM finds only 5/20 — the other 15 may be valid ambiguities the LLM is missing, or invalid expectations
   - Manual review needed to determine if 15 is over-claimed or if the rule needs examples

4. **Add a "code-only" mode that detects undefined variables, unused imports, etc.**
    - Currently the analyzer only looks at instruction-quality, not code-quality
    - This would be a new wave, requires new prompt and validation

### P3 — Low (research / exploration)

1. **Test the v2 coverage prompt on individual fixtures with more runs**
    - E50 only ran 3 runs. Test with 10+ runs to get more stable estimates.

2. **Explore whether a single good model is better than multi-model**
    - Run E50/E53 with single-model configs on the same fixtures
    - Currently we have multi-model data but no single-model comparison on clean fixtures
    - Cost: ~$0.50

3. **Build a "skill-quality-score" that combines all findings into a single grade**
    - Currently each finding is independent
    - A combined score would help users see overall quality
    - Similar to E11's A/B/C/D/F grading

## What's Working Well (Don't Change)

1. **Multi-model mix (gemini-flash + deepseek)** — E56 showed 8811 findings on 327 skills at $0.24. The multi-model mix is the right approach.
2. **E50 clean architecture** — separates skill body from expected answer. This is the right way to test prompts.
3. **Hygiene circular rule fix (E45)** — test-circular-hard went from 0/7 to 5/7. This is a real win.
4. **Coverage gap rule calibration** — test-coverage-gaps / coverage-gap is 5/2 (250%) which is over-firing but better than under-firing.

## Files Modified in v0.1.37/v0.1.38

- `package.json` — multi-model defaults, version 0.1.38
- `README.md` — v0.1.38 status
- `docs/USER-GUIDE.md` — new model recommendations
- `docs/CHANGELOG.md` — full v0.1.37/v0.1.38 changes
- `src/core/prompts/hygiene.prompt` — circular rule fix
- `tests/fixtures/clean/*.md` — 15 clean fixtures (no labels)
- `tests/fixtures/expected/*.json` — 15 expected answer files
- New scripts: e50, e51, e52, e53, e54, e55, e56, e57, e58
- New notes: e50, e51, e52, e53, e54, e55, e56, e57, e58, e60 (this doc)

## Quick-start for Next Session

1. Read this document (E60)
2. Read `HANDOVER.md` for project state
3. Read `PROGRESS.md` for ongoing work
4. Read `LEARNINGS.md` for past lessons
5. Pick a P0 task and start
6. Validate any prompt change with E50 (clean architecture) before deploying

## Cost Summary (v0.1.37 work)

- E43-E50 prompt work: ~$0.20
- E51-E58 model comparison + corpus scan: ~$1.50
- Total: ~$1.70 for 600+ LLM calls and a major improvement (1664 → 8811 findings on the same corpus)
