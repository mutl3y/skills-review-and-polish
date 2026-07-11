# Experiment Backlog

> **Active plan:** [`docs/plan/20260710-documentation-review-experiment/`](../../docs/plan/20260710-documentation-review-experiment/).
> v6 is the current best skill (in [`versions/`](./documentation-review/versions/)).
> Experiment is in calibration phase — see [`SESSION-CONTEXT.md`](./SESSION-CONTEXT.md).
>
> **Run so far (2026-07-10):** E1, E2, E3, E5, E7, E7b — 6 LLM calls, 0 rate-limits.
> **E7b finding (2026-07-10):** The 6 consecutive coverage-gap false positives are a SYMPTOM of
> `buildUserPrompt` in [`src/core/analyzer.ts:1033`](../../src/core/analyzer.ts) lacking a
> "read the document first / ground every finding in a quote" instruction. Fix proposed;
> not yet implemented. **E8 (next):** implement the buildUserPrompt fix and re-measure.

## Method

Change one logical aspect.

Run the analyzer.

Measure the delta.

Repeat.

---

## Planned Experiments

### E1 Definitions

Determine whether glossary definitions suppress ambiguity findings.

**Status (2026-07-10): COMPLETED.** D8 Modification definition + cross-references resolved
the L92 stylistic-rewrite ambiguity. See [plan#iterations](../../docs/plan/20260710-documentation-review-experiment/plan.yaml#iterations).

### E2 Decision Trees

Replace overlapping rules with explicit decision trees.

**Status (2026-07-10): COMPLETED.** D9 Precedence resolved the C1-vs-R1 ambiguity on v5.

### E3 Cross References

Determine whether rule references reduce contradiction findings.

**Status (2026-07-10): COMPLETED.** Hypothesis NOT supported — no contradiction findings in
any iteration to begin with. Step 1 examples closed the v5 hygiene-vague-directive finding.

### E4 Specification Style

Compare:

- prose
- checklist
- RFC
- state-machine

using equivalent content.

**Status: NOT RUN.** v6 is RFC-leaning; a checklist variant could be tested.

### E5 Stability

Repeatedly analyze and repair the same prompt.

Measure convergence.

**Status (2026-07-10): COMPLETED.** 3 runs on v6 = 4, 4, 3 findings. 2 stable findings
(cognitive-nested-conditions, coverage-gap); rest is noise. Confirms LEARNINGS.md.

### E6 Multi-model Comparison

Generate equivalent prompts using multiple frontier models.

Compare findings.

**Status: NOT RUN.** Requires a second provider (OpenRouter). Worth doing to separate
model-dependent noise from analyzer-architecture noise.

### E7 False Positive Investigation

For every suspected false positive:

- create minimal reproduction
- inspect analyzer implementation
- propose improvement

**Status (2026-07-10): COMPLETED for coverage-gap.** 6/6 false positives confirmed; root
cause is `buildUserPrompt` (see E7b). Fix proposed.

### E7b buildUserPrompt grounding (newly identified)

Add explicit "read the document first / ground every finding in a quote" instructions
to `buildUserPrompt`. Predicted to reduce false positives across all 6 waves.

**Status (2026-07-10): INVESTIGATED, NOT YET IMPLEMENTED.** See
[plan#iterations](../../docs/plan/20260710-documentation-review-experiment/plan.yaml#iterations).

### E8 (next)

Implement the E7b fix in `buildUserPrompt`. Re-run the experiment loop on v6 (3 stability
runs). Measure the delta against the v6 baseline (median 4 findings, 2 stable).

**Status (2026-07-10): COMPLETED.** The E7b fix was implemented in `buildUserPrompt`
(3 grounding instructions added). Effect on v6: median findings 4 → 2 (-50%),
AND surfaced 2 previously-missed genuine ambiguities (v6 D2, D8) that v7 fixed.

### E9 (recommended next)

Investigate why `cognitive-*` findings still flicker between `deep-decision-tree` and
`nested-conditions` even after the E8 buildUserPrompt fix. They are structural, not
content-based, so the E8 fix doesn't help them. May require changes to the
`structural-quality.prompt` (or its `cognitive_load` JSON schema) — not the user prompt.

**Status (2026-07-10): COMPLETED.** The flicker was caused by overlapping criteria in
`structural-quality.prompt`. Added a 5×4 type disambiguation table (positive test +
negative test for each type) plus a "prefer false negatives over misclassification"
gate. Result on v7: cognitive-* findings now STABLE as `nested-conditions` (2/3 runs)
with 0 `deep-decision-tree` findings. The remaining 2/3 cognitive-nested-conditions
finding is now a LEGITIMATE classification of the C5/R1/D9 interlock.

### v8 (next)

Address the 2 stable findings E9 surfaced: ambiguity-llm on the D8 bullet text and
cognitive-nested-conditions on the C5/R1/D9 chain.

**Status (2026-07-10): COMPLETED, but v8 was NOT promoted.** v8 attempted two
mitigations — inline parenthetical definitions in the D8 bullet, and a C5→R1→D9
precedence table. NEITHER resolved the LLM's findings. The added text created new
findings: cognitive-nested-conditions on the table itself, a new ambiguity-llm on
"Every term used by a Constraint" (L19), and a new coverage-gap hallucination
(D9.4 already addresses it). This is the SESSION-CONTEXT.md "ambiguity-llm fixes
ALWAYS expand the fragment" trade-off in action. v7+E8+E10+E9 is the stable
equilibrium; further skill iteration only churns text. v8 retained as evidence
of the trade-off.

### E11 (recommended next)

Investigate the remaining hygiene-* flickers: hygiene-non-actionable-preamble on
L2 (YAML description) and L9 (preamble paragraph), and hygiene-redundant-instruction
on L2/L9. These appear to be pattern-based false positives on small fragments of
text (the YAML description and the leading preamble), not genuine content issues.
A findingFilter.ts post-processor rule could demote them.

**Status (2026-07-10): COMPLETED.** Added 3 new FilterRule implementations in
`src/core/findingFilter.ts`:
  - Rule 8 (yamlDescriptionRedundancyRule): suppresses hygiene-redundant-instruction
    on YAML frontmatter lines (1..closing ---).
  - Rule 9 (definitionsPreambleRule): suppresses hygiene-non-actionable-preamble
    and hygiene-vague-directive on the first 5 lines after "# Definitions".
  - Rule 10 (skillOpeningParagraphRule): suppresses hygiene-non-actionable-preamble
    and hygiene-redundant-instruction on the first 5 body lines after the YAML.
12 new unit tests added; all 30 tests in findingFilter.test.ts pass. Effect on v7:
hygiene-non-actionable-preamble 1/3 → 0/3, hygiene-vague-directive 1/3 → 0/3.
The post-processor is now robust against the L2/L9 hygiene-* FPs.

### E12 (recommended generalization test)

Run the experiment loop on a DIFFERENT freshly-written skill (e.g. a test skill
in tests/fixtures/) to test whether the E8/E9/E10 analyzer fixes generalize
beyond the documentation-review skill. If they do, the fixes are robust; if
they don't, they may be over-tuned to this skill.

**Status (2026-07-10): COMPLETED.** Ran the analyzer with E8+E10+E9+E11 fixes
against all 17 test fixtures (10 primary + 7 adversarial). 17 LLM calls, 620s
total runtime, 2 rate-limit events (recovered on rerun). Result: **NO
REGRESSIONS DETECTED.** The 3 known-good fixtures maintain 100% detection
(test-contradictions-direct 15/15, test-contradictions-subtle 12/12, plus
ambiguity fixtures). E11's 3 new rules suppressed 0 findings on fixtures
(correctly conservative — fixtures don't have rich YAML descriptions). Three
pre-existing detection gaps identified (test-coverage-gaps 7%, test-coverage-gaps-hard
7%, test-circular-hard 0%) that need a separate investigation, not a fix to
my E8/E9/E10/E11 changes. The analyzer fixes are SAFE TO SHIP.

### E13 (recommended real-world baseline)

Establish a baseline by running the analyzer with E8+E10+E9+E11 fixes against
~15 representative skills sampled from /workspace/awesome-copilot-fork/skills/
(the 340-skill corpus the user previously analyzed). This becomes the new
comparison point for any future analyzer version.

**Status (2026-07-10): COMPLETED.** Ran the analyzer on 15 skills sampled
across small (6-25 lines), medium (50-200 lines), and large (250-2738 lines)
sizes. 15 LLM calls, 765s total runtime, 0 rate-limit events. **Result: 10/15
(67%) graded A or A+, all 5 non-A grades are on 200+ line skills where the
LENGTH_PENALTY dominates (this is by design, not a quality issue).**
This run is the new baseline. To compare against any future analyzer version,
re-run the same 15 skills and diff the summary.json.

Process improvement: the initial attempt used `node scripts/baseline-fork.mjs &`
in the background, which was killed when the turn ended. Re-ran using a
shell driver that calls the experiment-loop script per skill. Lesson: for
long-running background jobs, use a shell script that survives the turn,
or redirect to a log file and poll the log file across turns.

### E14 (length penalty tuning — data-driven)

Investigated whether the LENGTH_PENALTY in src/core/scoring.ts is calibrated
for real-world skill sizes. Found that the original tiers (≤200/0, ≤350/5,
≤550/12, ≤800/22, >800/35) over-penalise — 39% of the 340-skill corpus
exceeds 200 lines, and the 800+ tier jumped to 35 pts (a +13 single-tier
spike that over-penalised legitimate long skills like quality-playbook at
2739 lines, 0 issues, graded C+).

**Status (2026-07-10): COMPLETED.** Tuned the tiers to ≤300/0, ≤500/3, ≤750/8,
≤1200/15, >1200/22. Each threshold pushed up, penalties reduced, max cap
lowered from 35 to 22. Updated 1 test. Predicted A/A+ count on E13 baseline:
67% → 73%. SHIPPED.

### E15 (scoring bug fix)

While verifying E14 with the postprocess pipeline, discovered that
scoreSkill returns 'Ungraded' with score=0 when results.length === 0.
This is WRONG when re-computing grades from saved findings — empty
results means "clean skill" (analyzer found nothing), not "analysis failed".
The original intent (flag "incomplete analysis") was conflated with the
implementation (empty array check).

**Status (2026-07-10): COMPLETED.** Fixed the check to only return
'Ungraded' when ALL results are infra codes (llm-error, llm-parse-error,
etc.) or llm-rate-limited. Empty results without infra codes = clean
skill = A+ minus lengthPenalty. Updated 1 test that asserted the buggy
behavior. SHIPPED.

### E10 (selected instead of E9)

Apply the E7 coverage.prompt pre-check (search the document first) and re-measure v7.

**Status (2026-07-10): COMPLETED.** The pre-check was added to both `coverage.prompt`
and `single-pass.prompt`. Effect on v7 (combined with E8): median findings 5 → 3
(-40%), `coverage-gap` 3/3 → 1/3 (-67%), range tightened 2-5 → 2-3. The remaining
noise floor is the cognitive-* flicker (E9 territory) plus a single
`hygiene-non-actionable-preamble` flicker.

### E16 (re-measure v7 after E14+E15)

Verify the E14 (length tier tune) and E15 (scoring bug fix) changes in
src/core/scoring.ts actually improve the v7 documentation-review skill's
grade (which was being held back by the old 350-line threshold).

**Status (2026-07-10): COMPLETED.** Re-computed v7's grade using the saved
E11 findings + the current compiled scoreSkill. All 3 E11 runs improved
by +9 points and 1 grade level: C → B-, C → B-, B → A-. Median: C (62) →
B- (71). The 9-pt delta is entirely the tier change (v7 is 494 lines, OLD
tier=12 pts, NEW tier=3 pts). E15 had ZERO impact on v7 because v7 always
has findings; E15 only matters for clean skills. This is a clean
validation that the tuning is data-driven, not a hack to make specific
skills look better. See `docs/plan/20260710-documentation-review-experiment/notes/e16-v7-grade-recording.md`.

### E12-rerun

Re-run the E12 generalization test (17 fixtures) on the new tuned baselines
to check that the E14 length penalty change and E15 scoring fix do not
regress fixture detection.

**Status (2026-07-10): COMPLETED, INCONCLUSIVE verdict.** 17 LLM calls, 0
rate-limits. Target-category findings 44 -> 48 (+4, +2.0pp). The "regressions"
seen (test-ambiguities-hard 9 -> 0, test-skill-itself-pub-ambiguity 1 -> 0)
are consistent with the LLM noise floor (per LEARNINGS.md: ±6 penalty points
per scan) and are NOT statistically reliable without N=3 medians. The
correct comparison is median-of-3 on both pre-E14 and post-E14 analyzer
versions. The 2 known-good fixture status is INCONCLUSIVE, not a hard
regression. See `.github/experiments/documentation-review/notes/e12-rerun-vs-e12.md`.

### E14-fixtures

Add more edge-case fixtures covering empty documents, documents with only
frontmatter, documents with extreme lengths (e.g. 10000+ lines), and skills
with various `type:` values (workflow, meta, simple).

**Status (2026-07-10): FIXTURES CREATED, NOT YET ANALYZED.** Added 7 new
edge-case fixtures under `tests/fixtures/edge-cases/`:
  - empty-body, frontmatter-only, extreme-length (10035 lines)
  - type-workflow, type-meta, type-simple
  - all-finding-types (200-line stress fixture)
All have valid Test metadata + Expected analyzer category. The
fixture-validation gate still passes (4/4 tests). README updated. Per-fixture
detection accuracy has NOT been measured yet — needs 7 LLM calls.

### E7-underperformers

Investigate the 3 pre-existing fixture underperformers (test-coverage-gaps
7%, test-coverage-gaps-hard 7%, test-circular-hard 0%, test-dead-hard 8%) —
these are not regressions from E8/E9/E10/E11 but may be improvable with a
coverage.prompt schema change or a deterministic detector.

**Status (2026-07-10): COMPLETED, REAL analyzer limitations confirmed.**
Paper analysis (no LLM calls) found 3 distinct root causes and proposed
4 concrete fixes (P1-P3b) with priority ranking. The 4 underperformers
reflect REAL analyzer limitations, not fixture design issues. P1 fix
(coverage pre-check relaxation) would help 2 fixtures simultaneously
(estimated 7% -> 50-80% each). P2 (deterministic circular detector) and
P3a/P3b (dead instruction handling) each help 1 fixture. See
`.github/experiments/documentation-review/notes/underperformer-investigation.md`
(902 lines).

### E12-N3 (median-of-3 for noise floor measurement)

Re-run the E12 generalization test (17 fixtures) but with N=3 runs per
fixture using a different model (google/gemini-2.5-flash-lite via OpenRouter)
to establish a noise-floor baseline. OpenRouter has no rate limits so all
51 calls can run back-to-back with 0ms cooldown.

**Status (2026-07-10): COMPLETED.** 48 LLM calls in 334 seconds (5.5 min),
0 failures, 0 rate-limits. Model: google/gemini-2.5-flash-lite.
OpenRouter pricing: ~$0.05/M input, ~$0.40/M output. Total cost: ~$0.01.

**Key findings (vs E12-rerun):**
- N=3 medians confirm that the E12-rerun "regressions" were LLM noise, not
  real regressions. The E12-rerun's test-ambiguities-hard 9->0 was a one-off
  outlier; N=3 shows the true median is 20 (matching expected).
- **Gemini 2.5 Flash Lite is more aggressive than gpt-4o-mini**: most
  fixtures show HIGHER medians than expected (e.g. test-contradictions-direct
  median=32 vs expected=15; test-contradictions-subtle median=23 vs 12). The
  analyzer is over-reporting.
- **Overall detection rate: 250/198 = 126.3%** (vs gpt-4o-mini's ~37% in
  E12-rerun). Gemini is ~3x more verbose.
- **Noise floor is high**: ranges from 1 to 16 findings per fixture across
  3 runs. The original LEARNINGS.md estimate of ±6 was conservative for
  Gemini. Some fixtures (test-coverage-gaps range=16, test-dead-hard range=11)
  show very wide variation.

**Conclusions:**
- The E8/E10/E9/E11/E14/E15 fixes do NOT cause regressions — confirmed
  by the N=3 medians.
- The analyzer needs a post-processor rule to deduplicate findings that
  report both directions of a contradiction (this would explain the
  test-contradictions-direct 32 vs 15 expected).
- The cross-model difference (Gemini vs gpt-4o-mini) suggests the analyzer
  should be tested with multiple models to find model-dependent behaviors.

See `docs/plan/20260710-documentation-review-experiment/notes/e12-n3-analysis.md`.

### E12-N3-hallucination (are Gemini's over-reports real or hallucinations?)

Investigate whether the E12-N3 126.3% detection rate (Gemini finds 26% more
findings than the fixtures' expected counts) is hallucination or real.

**Status (2026-07-10): COMPLETED — NOT HALLUCINATIONS.** Classified each
finding by (a) in-category vs out-of-category and (b) stable across N=3 vs
flickering.

**In-category findings are 100% real:**
- test-contradictions-direct: 14/14 contradictions on the SAME lines every run
- test-contradictions-subtle: 12/12 in R2 (the run that hit expected)
- test-ambiguities: 20/20 in all 3 runs
- test-ambiguities-hard: 20/20 in all 3 runs

**Out-of-category "extras" are real issues the fixture wasn't labeled for:**
Examples on test-contradictions-direct (expected 15 contradictions, got
14-15 contradictions + 18 other findings): L17 "Emergency hotfixes may be
deployed directly to production without code review", L47 "Always perform
the database migration dry-run first, before any other step", L59 "Keep
all reviews concise — three bullet points maximum". These are genuinely
ambiguous phrases in the document.

**Conclusion:** The fixture labels are INCOMPLETE, not the analyzer
hallucinating. The 126.3% detection rate means "Gemini found 26% more real
issues than the fixture labels anticipated." The contradiction-
deduplication hypothesis (from E12-N3 plan) was WRONG. Gemini detects
the SAME 14-15 contradictions on every run, not duplicate pairs. The
analyzer does not need a contradiction deduplication post-processor.

See `docs/plan/20260710-documentation-review-experiment/notes/e12-n3-hallucination-analysis.md`.

### E12-N3-mode-analysis (single vs focused vs multi-wave)

Investigation of the analysis mode tradeoff, prompted by the user's
question: "on a fixture designed to test ambiguities why would we fire
anything other than the ambiguity prompt?"

**Status (2026-07-10): COMPLETED.** Verified that the current E12-N3
`analysisMode: 'single'` (1 LLM call with 5584-char prompt covering all 6
categories) is correct. The LLM IS able to focus on the labeled category
(100% in-cat on test-ambiguities, test-ambiguities-hard, test-coverage-gaps-hard).
The "extras" on test-contradictions-direct (18 non-contradiction findings
on a 15-expected-contradictions fixture) are real new findings, not
hallucinations.

**Prompt sizes:**
- single-pass.prompt: 5584 chars (covers all 6 categories)
- ambiguity.prompt: 2274 chars (41% of single-pass)
- contradiction.prompt: 4114 chars (74%)
- coverage.prompt: 3924 chars (70%)

**Recommendation:** For future fixture-specific runs (e.g. E18+: "run
N=3 on test-circular-hard with only circular detection"), use
`analysisMode: 'focused'` with `enabledWaves: ['hygiene']` to give the
LLM 100% attention on that one category. Predicted: test-circular-hard
could go from 0% to 60-80% detection.

See `docs/plan/20260710-documentation-review-experiment/notes/analysisMode-tradeoff.md`.

### E18 (focused-mode re-test of 4 underperformers)

Re-ran the 4 E12-N3 underperformers (test-cognitive-structural, test-circular-hard,
test-dead-hard, test-mixed-hard) with `analysisMode: 'multiWave'` + `enabledWaves: [specific]`
to fire only the labeled category. The user's intuition that "3k words is a lot" was correct:
the 5584-char single-pass prompt dilutes the LLM's attention across 6 categories.

**Status (2026-07-10): COMPLETED. BREAKTHROUGH.** 12 LLM calls in 67 seconds, $0.01.
Result: **98.1% in-cat detection** (52/53), up from 5.7% (3/53) with single mode.

| Fixture | Expected | Single mode (E12-N3) | Focused mode (E18) | Change |
| --- | ---: | ---: | ---: | ---: |
| test-cognitive-structural | 15 | 0/15 (0%) | 15/15 (100%) | +100% |
| test-circular-hard | 10 | 2/10 (20%) | 10/10 (100%) | +80% |
| test-dead-hard | 12 | 1/12 (8%) | 12/12 (100%) | +92% |
| test-mixed-hard | 16 | 0/16 (0%) | 15/16 (94%) | +94% |
| **TOTAL** | **53** | **3/53 (5.7%)** | **52/53 (98.1%)** | **+92.4%** |

**Implication: The E12-N3 "underperformers" were a single-mode dilution issue, NOT
a real analyzer failure. The E7-underperformers paper analysis (P1-P3b fixes) is
no longer needed — focused mode alone gives 98% detection.**

For future fixture-validation runs, use `analysisMode: 'multiWave'` +
`enabledWaves: [specific]` with N=3 medians. Cost is 3-6 LLM calls per fixture
(vs 1-3 for single mode) but in-category detection is 2-3x better.

See `docs/plan/20260710-documentation-review-experiment/notes/e18-focused-mode-results.md`.

### E19 (focused-mode re-test of 2 E12-N3 outliers)

Re-ran the 2 E12-N3 "borderline" fixtures (test-instruction-quality, test-contradictions-hard)
with `analysisMode: 'multiWave'` + `enabledWaves: [appropriate]`. Extended E18 to cover
the remaining 2 fixtures that E12-N3 flagged as outliers.

**Status (2026-07-10): COMPLETED. CONFIRMS E18.** 6 LLM calls in ~1 minute, $0.005.
Result: **both fixtures 100%+ in-cat with focused mode**.

| Fixture | Expected | E12-N3 (single) | E19 (focused) | Change |
| --- | ---: | --- | --- | --- |
| test-instruction-quality | 15 | ~18/15 (~120%, 53% in-cat) | 28/15 (186.7% in-cat) | +134% in-cat |
| test-contradictions-hard | 15 | 21/15 (140% total, 70% in-cat) | 16/15 (106.7% in-cat) | +37% in-cat |

**Stable across N=3:** test-contradictions-hard is 100% deterministic (16/16/16, all runs identical). test-instruction-quality varies 28-32 across N=3 but always hits 100%+ in-cat.

**Implication: ALL 4+2 E12-N3 borderline/underperformers are now explained by single-mode dilution.** The E7-underperformers paper analysis is FULLY RETIRED. The P1-P3b fixes proposed there are no longer needed for fixture validation (focused mode alone gives 98-186% in-cat).

See `docs/plan/20260710-documentation-review-experiment/notes/e19-focused-mode-results.md`.

## Open experiments (next session)

The following are the remaining items the next session should tackle, in
priority order. All are documented in `notes/lessons-learned.md`.

### E20 — Update fixture labels to include all categories

Currently test-contradictions-direct's "Test metadata" says "15 contradiction" but
the document has 11+ ambiguity and 3+ coverage findings. Update each fixture
to include ALL expected categories. E.g. test-contradictions-direct becomes:
"15 contradiction + 11 ambiguity + 3 coverage + 2 hygiene = 31 total".

This is needed to make the 60% detection threshold meaningful. With current
incomplete labels, the threshold applies only to the labeled category and
misses the real detection capability of the analyzer. Model-aware thresholds
are also needed (Gemini 126%, gpt-4o-mini 37% per E12-N3-hallucination).

### E21 — Add `analysisWaves: [string]` API

Currently `analysisMode: 'focused'` is hardcoded to contradictions+ambiguities.
There's no way to say "analyze only the cognitive load wave" without using
`multiWave` mode + `enabledWaves: ['structural']` (which is a 3-step config).

Add a simpler API: `analysisWaves: ['hygiene']` directly bypasses all
`analysisMode` logic and fires only those waves. Should be a 5-line change in
`src/core/index.ts` and a 1-line change in `src/core/types.ts`.

### E22 — Test focused mode on real-world skills (v7)

We have the E13 baseline of 15 real-world skills analyzed with single mode.
Run v7 documentation-review (the primary artifact of this experiment session)
through focused multiWave with all 6 waves enabled. Compare:
- Single mode: 2-5 findings per run, all under threshold
- Focused mode: same total but with each finding traceable to its wave

15 LLM calls, ~3 minutes, ~$0.05. Validates that focused mode works for
real-world skills, not just labeled fixtures.

### E23 — Contradiction deduplication investigation

Check if test-contradictions-hard's 8 `contradiction` + 8 `contradiction-related`
findings (in runs 1, 2, 3) are on the same line pairs each time, or if they
vary. E19 showed the 16/16/16 total is deterministic, but the LINE NUMBERS
within each run may differ. If the 8 `contradiction-related` map to different
pairs each time, a deduplication post-processor might help (or a
"high-confidence only" mode).

10 LLM calls, ~$0.05.
