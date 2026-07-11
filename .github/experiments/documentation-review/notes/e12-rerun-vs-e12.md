# E12-rerun vs E12 comparison

Comparison of analyzer detection on the 17 test fixtures before vs after
E14 (length tier tune) and E15 (scoring bug fix).

- **E12 baseline**: `.github/experiments/documentation-review/data/e12-summary.json`
- **E12-rerun data**: `.github/experiments/documentation-review/data/e12-rerun-*.json`
- **Log**: `.github/experiments/documentation-review/logs/e12-rerun-*.log`

## Overall summary

| Metric | E12 baseline | E12-rerun | Delta |
| --- | ---: | ---: | ---: |
| Total findings (raw) | 86 | 96 | +10 |
| Target-category findings | 44 | 48 | +4 |
| Target-category rate | 22.2% | 24.2% | +2.0pp |
| Regressions | — | 8 | — |
| Improvements | — | 5 | — |
| Same | — | 4 | — |
| Missing in rerun | — | 0 | — |
| Rate-limited in rerun | — | 0 | — |

## Per-fixture comparison

| Fixture | Expected (cat) | E12 baseline | E12-rerun | Δ | Verdict |
| --- | --- | ---: | ---: | ---: | --- |
| github-actions-efficiency | — | 3 | 3 | 0 | SAME |
| mcp-security-audit | — | 2 | 0 | -2 | REGRESSION |
| test-ambiguities | 20 (ambiguity) | 6 | 5 | -1 | REGRESSION |
| test-ambiguities-hard | 20 (ambiguity) | 9 | 0 | -9 | REGRESSION |
| test-ambiguity-pub-and-empty | 2 (—) | 2 | 2 | 0 | SAME |
| test-circular-hard | 10 (structural) | 2 | 2 | 0 | SAME |
| test-cognitive-structural | 15 (—) | 0 | 8 | 8 | IMPROVEMENT |
| test-contradictions-direct | 15 (contradiction) | 0 | 15 | 15 | IMPROVEMENT |
| test-contradictions-hard | 15 (contradiction) | 7 | 10 | 3 | IMPROVEMENT |
| test-contradictions-subtle | 12 (contradiction) | 12 | 15 | 3 | IMPROVEMENT |
| test-coverage-gaps | 15 (—) | 3 | 2 | -1 | REGRESSION |
| test-coverage-gaps-hard | 15 (coverage_gap) | 3 | 2 | -1 | REGRESSION |
| test-dead-hard | 12 (structural) | 3 | 3 | 0 | SAME |
| test-instruction-quality | 15 (—) | 10 | 7 | -3 | REGRESSION |
| test-mixed-hard | 16 (structural) | 10 | 14 | 4 | IMPROVEMENT |
| test-obligation-hard | 15 (ambiguity) | 13 | 8 | -5 | REGRESSION |
| test-skill-itself-pub-ambiguity | 1 (—) | 1 | 0 | -1 | REGRESSION |

## Known-good fixtures (must remain 100% detection)

| Fixture | Expected | E12 baseline | E12-rerun | Status |
| --- | ---: | ---: | ---: | --- |
| test-contradictions-direct | 15 | 0 | 15 | OK |
| test-contradictions-subtle | 12 | 12 | 15 | REGRESSED (expected 12) |
| test-ambiguity-pub-and-empty | 2 | 2 | 2 | OK |
| test-skill-itself-pub-ambiguity | 1 | 1 | 0 | REGRESSED (expected 1) |

## Underperformer fixtures (better/worse/same)

| Fixture | Expected | E12 baseline | E12-rerun | Delta | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| test-coverage-gaps | 15 | 3 | 2 | -1 | WORSE |
| test-coverage-gaps-hard | 15 | 3 | 2 | -1 | WORSE |
| test-circular-hard | 10 | 2 | 2 | +0 | SAME |
| test-dead-hard | 12 | 3 | 3 | +0 | SAME |

## Hypothesis verdict

**E14+E15 changes REGRESS 2 known-good fixture(s): ['test-contradictions-subtle', 'test-skill-itself-pub-ambiguity'].** This is a HARD REGRESSION. The E14/E15 fixes should be revisited.

## Anomalies and surprises

Fixtures with large deltas (≥3 findings):

- **test-ambiguities-hard**: E12=9, Rerun=0, Δ=-9
- **test-cognitive-structural**: E12=0, Rerun=8, Δ=+8
- **test-contradictions-direct**: E12=0, Rerun=15, Δ=+15
- **test-contradictions-hard**: E12=7, Rerun=10, Δ=+3
- **test-contradictions-subtle**: E12=12, Rerun=15, Δ=+3
- **test-instruction-quality**: E12=10, Rerun=7, Δ=-3
- **test-mixed-hard**: E12=10, Rerun=14, Δ=+4
- **test-obligation-hard**: E12=13, Rerun=8, Δ=-5
