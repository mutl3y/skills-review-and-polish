# E12-N3 Analysis Report

Total calls: 48 | Failed: 0 | Rate-limited: 0
Total time: 334s | Model: google/gemini-2.5-flash-lite | N=3

## Per-fixture: median vs expected (in target category)

| Fixture | Expected | Median | R1 | R2 | R3 | Range | Δ vs expected |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| primary/mcp-security-audit | ? | 7 | 10 | 2 | 7 | -3 | n/a |
| primary/test-ambiguities | 20 | 20 | 20 | 20 | 21 | 1 | +0 |
| primary/test-ambiguity-pub-and-empty | 2 | 5 | 8 | 5 | 5 | -3 | +3 |
| primary/test-cognitive-structural | 15 | 18 | 22 | 18 | 16 | -6 | +3 |
| primary/test-contradictions-direct | 15 | 32 | 33 | 32 | 26 | -7 | +17 |
| primary/test-contradictions-subtle | 12 | 23 | 23 | 12 | 24 | 1 | +11 |
| primary/test-coverage-gaps | 15 | 14 | 26 | 10 | 14 | -12 | -1 |
| primary/test-instruction-quality | 15 | 18 | 21 | 18 | 14 | -7 | +3 |
| primary/test-skill-itself-pub-ambiguity | 1 | 4 | 4 | 5 | 4 | 0 | +3 |
| adversarial/test-ambiguities-hard | 20 | 20 | 20 | 21 | 20 | 0 | +0 |
| adversarial/test-circular-hard | 10 | 12 | 10 | 12 | 12 | 2 | +2 |
| adversarial/test-contradictions-hard | 15 | 21 | 18 | 23 | 21 | 3 | +6 |
| adversarial/test-coverage-gaps-hard | 15 | 15 | 15 | 22 | 15 | 0 | +0 |
| adversarial/test-dead-hard | 12 | 12 | 1 | 12 | 12 | 11 | +0 |
| adversarial/test-mixed-hard | 16 | 16 | 16 | 16 | 20 | 4 | +0 |
| adversarial/test-obligation-hard | 15 | 20 | 20 | 22 | 18 | -2 | +5 |

## Detection rate by fixture (median / expected)

Overall median: 250 / 198 = 126.3%
Total LLM calls: 48
Total runtime: 334s
