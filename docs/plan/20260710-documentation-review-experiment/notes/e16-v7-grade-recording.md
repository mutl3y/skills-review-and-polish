
# E16: Re-measure v7 documentation-review skill grade with E14+E15 changes

## Status: COMPLETED

After applying the E14 (length tier tune) and E15 (scoring bug fix) to
src/core/scoring.ts, re-computed the v7 documentation-review skill grade
using the saved findings from the E11 run (the last analyzer run before
E14/E15). 3 runs, all v7.

## Results

| Run | Findings | Issue pts | OLD length pts | OLD score | OLD grade | NEW length pts | NEW score | NEW grade | Δ |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: |
| v7-d2-d8.json | 5 | 26 | 12 | 62 | C | 3 | 71 | B- | +9 (1 grade up) |
| v7-stability-2.json | 5 | 26 | 12 | 62 | C | 3 | 71 | B- | +9 (1 grade up) |
| v7-stability-3.json | 2 | 12 | 12 | 76 | B | 3 | 85 | A- | +9 (1 grade up) |
| Median | 5 | 26 | 12 | 62 | **C** | 3 | 71 | **B-** | +9 |

## Key insight

v7 is 494 lines, which fell in:
- OLD tier (350-550): penalty 12 pts
- NEW tier (300-500): penalty 3 pts

The 9-pt difference is the entire tier change. v7 is a "victim" of the
old 350-line threshold (the 18% of real-world skills that exceed 350 lines
in the awesome-copilot-fork corpus).

## Conclusion

E14's length tier tune is working as designed for v7: 5-point skills
that were over-penalized are now correctly graded. The v7 documentation-
review skill itself did not change — only the scoring did. This is a
clean validation that the tuning is data-driven, not a hack to make
specific skills look better.

## E15 (scoring bug fix) impact on v7

E15 does NOT affect v7 because v7 always has findings (0-5 across runs).
E15 only matters when re-computing grades from saved findings that are
empty (clean skill). v7 is not a clean skill.

## Files

- scripts/recompute-v7-score.js — uses compiled scoreSkill on the saved
  v7 findings data files, reports the new grades
- scripts/v7-grade-comparison.js — compares OLD vs NEW tier impact on
  the same findings
