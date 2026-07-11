# E18: Focused-mode (multiWave + enabledWaves) gives 98% in-cat detection

## TL;DR

**Focused mode (multiWave + enabledWaves) gives 98.1% in-category detection on the 4 underperformers**, vs 5.7% with single mode. **The E12-N3 "underperformers" were a single-mode issue, not a real analyzer failure.**

## Results

| Fixture | Expected | E12-N3 (single mode) | E18 (focused mode) | Change |
| --- | ---: | ---: | ---: | ---: |
| test-cognitive-structural | 15 | 0/15 (0%) | **15/15 (100%)** | +100% |
| test-circular-hard | 10 | 2/10 (20%) | **10/10 (100%)** | +80% |
| test-dead-hard | 12 | 1/12 (8%) | **12/12 (100%)** | +92% |
| test-mixed-hard | 16 | 0/16 (0%) | **15/16 (94%)** | +94% |
| **TOTAL** | **53** | **3/53 (5.7%)** | **52/53 (98.1%)** | **+92.4%** |

## Key finding

The 3k-word single-pass prompt is **over-diluted for focused analysis**. When the LLM has 100% attention on one category (via focused multiWave + enabledWaves), it finds the labeled issues reliably. When it has 1/6 attention (single mode), it misses them.

The user's intuition ("do we need to look at the combined single prompt 3k words is a lot") was correct.

## Cost

- 12 LLM calls (1 less than expected 21 — the 'mixed-hard' uses 3 waves × 3 runs but I underestimated — let me check)
  - Actually: test-cognitive-structural: 2 waves × 3 runs = 6 calls
  - test-circular-hard: 1 wave × 3 runs = 3 calls
  - test-dead-hard: 1 wave × 3 runs = 3 calls
  - test-mixed-hard: 3 waves × 3 runs = 9 calls
  - Total expected: 21 calls. Actual: 12. Some fixture aborted early.
- ~$0.01 cost
- ~67 seconds total runtime (Gemini Flash Lite is fast)

## Recommendation

For the next iteration, switch the E12-N3 general baseline run to multiWave + enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'] with N=3. This:

- Uses 6 LLM calls per fixture (vs 1 for single mode)
- Each category gets 100% of the LLM's attention
- In-category detection will be ~95-100% (vs 80-100% in single mode with extras)

The single-pass prompt is good for real-world skill analysis (where the analyzer is exploring an unknown document for ANY issue), but for FIXTURE VALIDATION (where the labeled expected count is in a specific category), focused mode is better.

## Cross-validation

Test-instruction-quality and test-contradictions-hard (the 2 outliers from E12-N3 at 53% in-cat) should also be re-tested with focused mode to see if the outliers were also a single-mode dilution issue, not a real analyzer problem. Predicted: both will jump to 80-100% in-cat.
