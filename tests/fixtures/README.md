# Test Fixtures — ground truth for validating the engine port

These are curated mock customization skills with **known, deliberately-injected
issues**. Use them to confirm the ported analyzer (Phase 1) detects the right
issues per category — i.e. that the port didn't regress detection vs the source
engine. Each `SKILL.md` contains a label table documenting every injected issue.

> Source: `mock_skill/` (PRIMARY) and `mock_skills_4/` (ADVERSARIAL/HARD) from
> `vscode-chat-customizations-evaluation`. SECONDARY/HYGIENE sets and the 355-file
> `prod_skills/` were intentionally NOT copied (redundant depth / too large).

## How to use
- **Detection rate** = `detected / expected`. The source engine's target was **≥60% overall**.
- **Scoring uses Jaccard / IoU**, which also penalizes false positives:
  `TP = min(detected, expected)`, `FP = max(0, detected-expected)`,
  `FN = max(0, expected-detected)`, `Jaccard = TP / (TP+FP+FN)`.
- `expected` = issues detectable with the current analyzer categories (issues
  needing new categories are excluded — see each SKILL.md's label table).
- **Remember the ±6 noise floor**: run N≥3 scans and compare medians, never a
  single scan (see `docs/plan/LEARNINGS.md`).

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

## Suggested validation harness (to build during/after Phase 1)
A tiny vitest that, for each fixture, runs `Engine.analyze()` (N=3, median),
maps detected codes → categories, and asserts `detected >= floor(0.6 * expected)`
per category and Jaccard above a threshold. This becomes the regression gate for
the analyzer port — the in-repo equivalent of the source repo's battle harness.
