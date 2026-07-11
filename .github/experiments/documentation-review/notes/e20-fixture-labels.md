# E20 — Per-category labels for fixture SKILL.md files

**Date:** 2026-07-10
**Status:** Complete
**Author:** Documentation-review experiment (E20 open follow-up)

## Summary

Each of the 16 PRIMARY and ADVERSARIAL fixture `SKILL.md` files now carries a
per-category `Test metadata` table in addition to the legacy single-category
headline count. The category counts come from the 3 runs in
`e12-n3-<fixture>.json` (Gemini 2.5 Flash Lite, OpenRouter), taking the median
per analyzer code, summing within categories, and dropping categories where
all 3 runs had zero findings.

The user-facing rationale is documented in `tests/fixtures/README.md`
("Model-aware detection rate" and "Recommended structure for new fixtures"
sections). Headline notes: Gemini's 126% detection rate is real-finding
over-reporting, not hallucination; gpt-4o-mini's 37% is under-detection. The
fixture labels only captured the headline category, so the new tables make
the full picture visible without changing the analyzer.

## Per-fixture per-category counts (median across 3 runs)

Counts are integer medians of per-code totals, summed within category. Infra
codes (e.g. `llm-error`, `llm-parse-error`, `high-complexity`) are excluded.

| Fixture | Headline cat | Cont | Amb | Cov | Hyg | Pers | Cog | Dead | Circ | Total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| primary/test-ambiguities | ambiguity | — | 20 | — | — | — | — | — | — | 20 |
| primary/test-ambiguity-pub-and-empty | ambiguity + coverage | — | 2 | 1 | 4 | — | — | — | — | 7 |
| primary/test-cognitive-structural | mixed | — | 6 | 4 | 4 | 4 | 5 | — | 1 | 24 |
| primary/test-contradictions-direct | contradiction | 15 | 11 | 2 | 5 | — | — | — | — | 33 |
| primary/test-contradictions-subtle | contradiction | 12 | 4 | 1 | 6 | — | 2 | — | — | 25 |
| primary/test-coverage-gaps | coverage_gap | — | 7 | 13 | 5 | — | 1 | — | — | 26 |
| primary/test-instruction-quality | mixed | 1 | 8 | 2 | 7 | — | 4 | 1 | — | 23 |
| primary/test-skill-itself-pub-ambiguity | ambiguity | — | 1 | 1 | 4 | — | — | 1 | — | 7 |
| primary/mcp-security-audit | (real-world) | — | 2 | 1 | 4 | — | — | — | — | 7 |
| adversarial/test-ambiguities-hard | ambiguity | — | 20 | — | 1 | — | — | — | — | 21 |
| adversarial/test-circular-hard | structural (circular) | — | — | — | 2 | — | 1 | — | 10 | 13 |
| adversarial/test-contradictions-hard | contradiction | 8 | 11 | — | 5 | 1 | — | — | — | 25 |
| adversarial/test-coverage-gaps-hard | coverage_gap | — | — | 15 | 7 | — | — | — | — | 22 |
| adversarial/test-dead-hard | structural (dead) | — | — | — | — | — | — | 12 | — | 12 |
| adversarial/test-mixed-hard | mixed | 2 | 5 | 2 | 5 | — | 4 | 2 | 2 | 22 |
| adversarial/test-obligation-hard | obligation_strength | — | 15 | 2 | 5 | — | 1 | — | — | 23 |

Category columns: Cont = Contradictions, Amb = Ambiguities, Cov = Coverage
gaps, Hyg = Hygiene, Pers = Persona, Cog = Cognitive, Dead = Dead, Circ =
Circular. `—` means the category had zero findings across all 3 runs and was
omitted from the SKILL.md metadata per the "skip zero categories" rule.

## Total label count

| Scope | Headline labels | Per-category labels (after E20) |
| --- | ---: | ---: |
| PRIMARY (8 fixtures, 9 SKILL.md files counting mcp-security-audit) | 8 | 36 |
| ADVERSARIAL (7 fixtures) | 7 | 23 |
| **Total (16 fixtures as listed)** | **15** | **59** |

The 15 injected-fixture headline labels (8 primary + 7 adversarial) plus
mcp-security-audit's "no headline" status (real-world sample) gives 15
"headline labels" in the table. The 59 per-category labels include the
original 15 headline categories (when they had at least one finding) plus
44 new category labels (e.g. 11 ambiguity findings on
`test-contradictions-direct` where the headline was 15 contradictions). On
average that's ~3.9× label coverage per fixture.

(Real-world `mcp-security-audit` had no headline label; the new section
contributes 3 per-category labels, counted above.)

## Fixtures with zero findings in any category

**None.** Every one of the 16 fixtures had ≥1 non-zero finding in some
category, and every fixture has at least one category besides the headline
one. (Two fixtures had only the headline category populated — `test-ambiguities`
with 20 ambiguities, and `test-dead-hard` with 12 dead — but both had at least
one visible category in the new table.)

## Skipped categories (median = 0 across all 3 runs)

Per the "don't pad with 0" rule, these fixture/category combinations were
omitted from the new metadata:

- `primary/test-ambiguities`: Contradictions, Coverage gaps, Hygiene, Persona, Cognitive, Dead, Circular
- `primary/test-ambiguity-pub-and-empty`: Contradictions, Persona, Cognitive, Dead, Circular
- `primary/test-cognitive-structural`: Contradictions, Dead
- `primary/test-contradictions-direct`: Persona, Cognitive, Dead, Circular
- `primary/test-contradictions-subtle`: Persona, Dead, Circular
- `primary/test-coverage-gaps`: Contradictions, Persona, Dead, Circular
- `primary/test-instruction-quality`: Persona, Circular
- `primary/test-skill-itself-pub-ambiguity`: Contradictions, Persona, Cognitive, Circular
- `primary/mcp-security-audit`: all but Ambiguities, Coverage gaps, Hygiene
- `adversarial/test-ambiguities-hard`: Contradictions, Coverage gaps, Persona, Cognitive, Dead, Circular
- `adversarial/test-circular-hard`: Contradictions, Ambiguities, Coverage gaps, Persona, Dead
- `adversarial/test-contradictions-hard`: Coverage gaps, Cognitive, Dead, Circular
- `adversarial/test-coverage-gaps-hard`: Contradictions, Ambiguities, Persona, Cognitive, Dead, Circular
- `adversarial/test-dead-hard`: all but Dead
- `adversarial/test-mixed-hard`: Persona
- `adversarial/test-obligation-hard`: Contradictions, Persona, Dead, Circular

## Recommended next-step for production

**Yes — `tests/fixtures/README.md` should also recommend the N=3 median
workflow for production-skill analysis.** The E12-N3 noise floor is the
binding constraint, not the fixture labels themselves:

- `test-dead-hard` showed R1=1, R2=12, R3=12 — an 11-finding single-run
  variance on a fixture the labels say has exactly 12. A production user
  who runs the analyzer once on a 12-issue skill could see anything from 1
  to 12+ findings and have no way to know whether to trust the count.
- `test-coverage-gaps` showed R1=26, R2=10, R3=14 — a 16-finding variance
  even on a fixture with a known injected count.
- The E7 underperformer investigation and the e12-n3-hallucination-analysis
  both show that single-scan counts are not reproducible.

The README update added a "yes, this is also the recommended workflow for
production skills" sentence in the per-category section. The next experiment
(E21?) should run a small production-skill probe with N=3 to quantify the
same noise floor on real-world skills, before claiming the N=3 workflow is
a general recommendation rather than a fixture-specific one.

**Concrete next step:** add a "Production workflow" subsection to
`tests/fixtures/README.md` (or to `docs/USER-GUIDE.md`) that says:

> When using the analyzer on a real skill, run it N=3 times, take the
> median of each finding code's count, and report the per-category
> median as the finding count. A single scan can vary by ±11 even on a
> small, well-defined skill; the N=3 median is the only reproducible
> measurement.

This is a documentation change only — no source code changes needed for
this experiment.

## Modified files

- `tests/fixtures/primary/test-ambiguities/SKILL.md`
- `tests/fixtures/primary/test-ambiguity-pub-and-empty/SKILL.md`
- `tests/fixtures/primary/test-cognitive-structural/SKILL.md`
- `tests/fixtures/primary/test-contradictions-direct/SKILL.md`
- `tests/fixtures/primary/test-contradictions-subtle/SKILL.md`
- `tests/fixtures/primary/test-coverage-gaps/SKILL.md`
- `tests/fixtures/primary/test-instruction-quality/SKILL.md`
- `tests/fixtures/primary/test-skill-itself-pub-ambiguity/SKILL.md`
- `tests/fixtures/primary/mcp-security-audit/SKILL.md`
- `tests/fixtures/adversarial/test-ambiguities-hard/SKILL.md`
- `tests/fixtures/adversarial/test-circular-hard/SKILL.md`
- `tests/fixtures/adversarial/test-contradictions-hard/SKILL.md`
- `tests/fixtures/adversarial/test-coverage-gaps-hard/SKILL.md`
- `tests/fixtures/adversarial/test-dead-hard/SKILL.md`
- `tests/fixtures/adversarial/test-mixed-hard/SKILL.md`
- `tests/fixtures/adversarial/test-obligation-hard/SKILL.md`
- `tests/fixtures/README.md` (added "Model-aware detection rate" and
  "Recommended structure for new fixtures" sections; preserved legacy
  tables and headline counts)

## Verification

- `npm run compile` → clean.
- `npx vitest run --config tests/vitest.config.ts tests/fixture-validation.test.ts src/fixture-validation.test.ts` → 4/4 passed.
- `npm run lint:md` for the 16 fixture SKILL.md files → 0 new issues
  (pre-existing MD060/MD022 in the README was not introduced by this change;
  new tables follow the file's existing `compact` style convention).

## Constraints respected

- No source code in `src/` was modified.
- E12-N3 data files were not modified.
- Analyzer behavior was not changed.
- Only `replace_string_in_file` and `multi_replace_string_in_file` were used
  for the fixtures, preserving the existing per-file change history. The
  `mcp-security-audit` SKILL.md had no `Test metadata` blockquote to update,
  so its new section was added at the end of the file.
- Categories with median = 0 across all 3 runs were omitted from each
  fixture's metadata per the "don't pad with 0" rule.
