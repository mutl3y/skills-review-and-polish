# Test Fixtures — ground truth for validating the engine port

These are curated mock customization skills with **known, deliberately-injected
issues**. Use them to confirm the ported analyzer (Phase 1) detects the right
issues per category — i.e. that the port didn't regress detection vs the source
engine. Each `SKILL.md` contains a label table documenting every injected issue.

> Source: `mock_skill/` (PRIMARY) and `mock_skills_4/` (ADVERSARIAL/HARD) from
> `vscode-chat-customizations-evaluation`. SECONDARY/HYGIENE sets and the 355-file
> `prod_skills/` were intentionally NOT copied (redundant depth / too large).

## How to use

- **Release calibration uses clean fixtures first**:
  `npm run test:calibration` runs `scripts/e50-clean-architecture.mjs` against
  `tests/fixtures/clean` + `tests/fixtures/expected` when `OPENROUTER_API_KEY`
  is available. The analyzer must not see label scaffolding during release
  calibration.
- **Detection rate** = `detected / expected`. The source engine's target was **≥60% overall** (legacy, single-category guidance — see "Model-aware detection rate" below for the current multi-category workflow).
- **Scoring uses Jaccard / IoU**, which also penalizes false positives:
  `TP = min(detected, expected)`, `FP = max(0, detected-expected)`,
  `FN = max(0, expected-detected)`, `Jaccard = TP / (TP+FP+FN)`.
- `expected` = issues detectable with the current analyzer categories (issues
  needing new categories are excluded — see each SKILL.md's label table).
- **Remember the ±6 noise floor**: run N≥3 scans and compare medians, never a
  single scan (see `docs/plan/LEARNINGS.md`).

## Release thresholds

Current beta baseline:

- Labeled fixtures: about 47% recall
- Clean fixtures: about 42% recall
- `test:calibration` default minimum recall: 42%
- Default maximum over-report ratio: 3x raw detections versus expected

Formal release should not use the beta threshold. It needs stable per-category
recall thresholds plus a manual production-sample precision gate.

## Model-aware detection rate (E12 baseline)

The 60% threshold above is a single-category target measured against
`gpt-4o-mini`. The E12-N3 rerun (N=3 runs per fixture, model
`google/gemini-2.5-flash-lite` via OpenRouter) showed the rate is
strongly model-dependent. Counts are medians across 3 runs.

| Model | Overall detection rate | Notes |
| --- | ---: | --- |
| `gpt-4o-mini` (E12 original) | 37% | Under-detects; misses real ambiguities and over-eager categories. |
| `google/gemini-2.5-flash-lite` (E12-N3) | 126% | Over-reports; extras are real new findings the fixture labels did not anticipate, **not** hallucinations. |
| Median across 3 runs (recommended) | — | Use the per-run median of N≥3 scans, not a single scan, to stay within the ±6 noise floor. |

> See `.github/experiments/documentation-review/notes/e12-n3-hallucination-analysis.md`
> for the per-fixture breakdown and the "real vs hallucinated" analysis. The
> 126% over-reporting on `test-contradictions-direct` is 15 contradictions (real,
> 100% stable) + 18 ambiguity/coverage/hygiene findings (also real, just not
> labelled) — not hallucinated.

## Recommended structure for new fixtures (per-category labels)

Each fixture's `Test metadata` block should list **every** expected category,
not just the headline one. Use the following table layout. Median counts come
from the 3 runs in the corresponding `e12-n3-<fixture>.json`.

```markdown
> | Category | Expected count | Detectable? |
> | --- | ---: | --- |
> | Contradictions | 15 | YES |
> | Ambiguities | 11 | YES |
> | Coverage gaps | 2 | YES |
> | Hygiene | 5 | YES |
> | **Total** | **33** | — |
```

To compute the counts:

1. Open `.github/experiments/documentation-review/data/e12-n3-<fixture>.json`
2. Read the `runs` array (length 3).
3. For each `runs[i].by_code`, take the per-code count.
4. Median per code across the 3 runs (e.g. `[14, 15, 14]` → `14`).
5. Sum across codes within each category (see `CATEGORY_MAP` in
   `docs/plan/LEARNINGS.md` or `src/core/vocabulary.ts`).
6. Skip infra codes (`llm-error`, `llm-parse-error`, `high-complexity`).
7. Skip categories where the median run had zero findings (don't pad with 0).

**Yes, this is also the recommended workflow for evaluating production skills.**
The E12-N3 noise analysis showed single-run counts vary by up to ±11 on the
same fixture (see `test-dead-hard`: R1=1, R2=12, R3=12). The N≥3 median
workflow is what makes detection-rate numbers reproducible.

## PRIMARY set — `primary/` (91 detectable issues, no JIT references)

| Fixture | Expected | Category | Notes |
|---------|---------:|----------|-------|
| `primary/test-contradictions-direct/SKILL.md` | 15 | contradiction | |
| `primary/test-contradictions-subtle/SKILL.md` | 12 | contradiction | |
| `primary/test-ambiguities/SKILL.md` | 20 | ambiguity | |
| `primary/test-cognitive-structural/SKILL.md` | 13 | cognitive_load + persona + structural | 2 injected not counted (detected as contradiction/out-of-scope) |
| `primary/test-coverage-gaps/SKILL.md` | 15 | coverage_gap | |
| `primary/test-instruction-quality/SKILL.md` | 13 | ambiguity + contradiction + cognitive_load | 2 need new categories |
| `primary/mcp-security-audit/` | — | (real-world sample) | Used for noise/variance probing, not a fixed count |

## ADVERSARIAL / HARD set — `adversarial/` (camouflaged, real-world-domain)

Issues are deliberately disguised so the analyzer can't pattern-match shallow cues.
See `adversarial/ADVERSARIAL-DESIGN.md` for the design rationale.

| Fixture | Expected | Category | Notes |
|---------|---------:|----------|-------|
| `adversarial/test-contradictions-hard/SKILL.md` | 8 | contradiction | 15 labeled sides → 8 pairs; one finding per pair |
| `adversarial/test-ambiguities-hard/SKILL.md` | 20 | ambiguity | Regulatory-sounding phrases lacking concrete definitions |
| `adversarial/test-coverage-gaps-hard/SKILL.md` | 15 | coverage_gap | Obvious domains covered; gaps in less-visible critical areas |
| `adversarial/test-obligation-hard/SKILL.md` | 15 | obligation_strength | Strong verb up front, hedge buried later |
| `adversarial/test-circular-hard/SKILL.md` | 10 | contradiction (circular def) | Jargon makes loops look like precise definitions |
| `adversarial/test-dead-hard/SKILL.md` | 12 | dead_instruction | Syntactically valid but removed/renamed APIs |
| `adversarial/test-mixed-hard/SKILL.md` | 16 | contradiction + ambiguity + obligation + structural + coverage | Hardest variant of each in one document |

## E33 — Current detection rates (2026-07-11)

The table below shows the median detection count from the E33 fixture validation script (`scripts/e33-fixture-validation.mjs`) on the 2026-07-11 prompts, which include the E31 anti-boilerplate rules. Counts are medians across N=3 runs with `qwen/qwen3-coder-30b-a3b-instruct` on OpenRouter.

**Status legend:** ✓ = 100% recall, ⚠ = 50-99% recall, ✗ = <50% recall

| Fixture | Category | Expected | Median | Recall | Status |
|---|---:|---:|---:|---:|---|
| test-contradictions-direct | contradiction | 15 | 45 | 300% | ✓ |
| test-contradictions-direct | ambiguity-llm | 11 | 0 | 0% | ✗ |
| test-contradictions-direct | hygiene | 5 | 2 | 40% | ✗ |
| test-contradictions-subtle | contradiction | 12 | 36 | 300% | ✓ |
| test-contradictions-subtle | ambiguity-llm | 4 | 0 | 0% | ✗ |
| test-contradictions-subtle | coverage-gap | 1 | 1 | 100% | ✓ |
| test-contradictions-subtle | hygiene | 6 | 0 | 0% | ✗ |
| test-ambiguities | ambiguity-llm | 20 | 18 | 90% | ⚠ |
| test-cognitive-structural | cognitive | 5 | 2 | 40% | ✗ |
| test-cognitive-structural | persona-inconsistency | 4 | 4 | 100% | ✓ |
| test-coverage-gaps | coverage-gap | 13 | 1 | 8% | ✗ |
| test-coverage-gaps | ambiguity-llm | 7 | 7 | 100% | ✓ |
| test-instruction-quality | contradiction | 1 | 3 | 300% | ✓ |
| test-contradictions-hard | contradiction | 8 | 18 | 225% | ✓ |
| test-contradictions-hard | persona-inconsistency | 1 | 1 | 100% | ✓ |
| test-ambiguities-hard | ambiguity-llm | 20 | 19 | 95% | ⚠ |
| test-obligation-hard | ambiguity-llm | 15 | 15 | 100% | ✓ |
| test-dead-hard | hygiene-dead-instruction | 12 | 12 | 100% | ✓ |
| test-mixed-hard | contradiction | 2 | 6 | 300% | ✓ |
| test-mixed-hard | ambiguity-llm | 5 | 5 | 100% | ✓ |
| test-mixed-hard | dead | 2 | 2 | 100% | ✓ |

**14/47 (30%) category-fixture pairs at 100% recall.** The "300% over" cases (contradiction detection) are correct over-detection — the contradiction wave finds more than the labeled count because the body also has unlabeled contradictions (E30 corpus scan confirmed this is real signal, not hallucination).

## E33 v2 — Current detection rates (2026-07-12, post E40d v4 prompt + redesigned contradictions-direct fixture)

After deploying the E40d v4 ambiguity prompt and the redesigned test-contradictions-direct fixture (separates ambiguities from contradictions into different sentences), 6-run aggregate medians on the targeted fixture show real improvement:

| Fixture | Category | Expected | E40d v4 (orig fixture) | **E41 v2 (redesigned, 6 runs)** | Change |
|---|---:|---:|---:|---:|---|
| test-contradictions-direct | ambiguity-llm | 11 | 0 | **2** | +2 |
| test-contradictions-direct | hygiene | 5 | 0 | **4** | +4 |
| test-contradictions-direct | contradiction | 15 | 45 | 42 | -3 (less over-fire) |
| test-contradictions-subtle | ambiguity-llm | 4 | 0 | **2** | +2 |

The redesigned fixture surfaces REAL findings the original was hiding: "staging", "production", "developer convenience credentials" (undefined domain terms) and multiple hygiene issues (over-specification, unordered process, vague-cognitive-directive).

See `notes/e41-fixture-redesign.md` for full analysis.

### Known limitations (2026-07-11)

1. **Coverage-gap silent-gap inference (test-coverage-gaps, test-coverage-gaps-hard):** 1/13, 1/15 — the LLM treats body section mentions as "addressed" even when the body doesn't actually provide handling. The "mentioned but not handled" rule added in E33 v4 didn't fully solve this. The cognitive gap is the LLM's ability to do fine-grained inference from domain knowledge.
2. **Hygiene-* on fixtures focused on other categories:** When a fixture's primary category is contradiction, the LLM often finds the labeled hygiene as a related-but-different code. Re-run with a single-wave focus would likely recover these.
3. **Cognitive-* family on adversarial fixtures:** Documented as noise-variance in E22/E23. Run with N=10 medians for tighter results.
4. **test-contradictions-direct/subtle ambiguity-llm:** 0% recall — the new material-difference test may be over-strict for these specific test cases. Investigate if the labeled ambiguities are material-difference vs wording-only.

## EDGE CASES set — `edge-cases/` (stress fixtures for analyzer robustness)

These fixtures stress the analyzer's handling of unusual document shapes
(very small, very large, non-standard types, malformed YAML). They are
NOT counted in the primary/adversarial detection-rate target because
the expected count is often 0 (the goal is "don't crash, don't
hallucinate", not "detect N issues").

| Fixture | Expected | Category | Notes |
|---------|---------:|----------|-------|
| `edge-cases/empty-body/SKILL.md` | 0 | none | Frontmatter only, no body. Negative-control for empty-doc handling. |
| `edge-cases/frontmatter-only/SKILL.md` | 1 | hygiene | 30-line YAML (8 version stamps) + 2-line body. Tests frontmatter-heavy docs. |
| `edge-cases/extreme-length/SKILL.md` | 1 | none / hygiene | 10000+ lines of filler content. Tests extreme-length handling and E14 length-tier scoring. |
| `edge-cases/type-workflow/SKILL.md` | 5 | cognitive_load | `type: workflow` with 10-step approval workflow. Tests workflow-type scoring branch. |
| `edge-cases/type-meta/SKILL.md` | 4 | coverage_gap | `type: meta` with skill-routing rules. Tests meta-type scoring branch. |
| `edge-cases/type-simple/SKILL.md` | 2 | hygiene | `type: simple` with 50 lines. Tests simple-type scoring branch. |
| `edge-cases/all-finding-types/SKILL.md` | 12 | mixed | 200-line stress fixture. Tests detection breadth across all 5 categories. |

## Suggested validation harness (to build during/after Phase 1)

A tiny vitest that, for each fixture, runs `Engine.analyze()` (N=3, median),
maps detected codes → categories, and asserts `detected >= floor(0.6 * expected)`
per category and Jaccard above a threshold. This becomes the regression gate for
the analyzer port — the in-repo equivalent of the source repo's battle harness.

The per-category threshold should use the **per-fixture per-category expected
count** from each SKILL.md's "Test metadata" table (see "Recommended structure
for new fixtures" above), not the legacy single-category headline count. The
E12-N3 data showed the headline count is typically the *labelled* subset of
what Gemini actually finds; the per-category table captures the full picture.
