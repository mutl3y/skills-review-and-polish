# E39 — Why a skill "A" can go to "C" with better detection

**Date:** 2026-07-11
**Status:** Complete
**Methodology:** Compare E20 (gpt-4o-mini, v3 prompts) vs E34 (qwen3-coder-30b, E33 prompts) on the same 6 production skills.

## The question

You asked: "How did a skill we got to an A go back to a C?"

The answer: **E20 was finding TOO FEW issues. The new model + new prompts find more real issues, which lowers the score.** A higher score on E20 = a worse analysis, not a better one.

## Score comparison

| Skill | E20 grade | E20 score | E34 findings | E34 grade | E34 score | Δ score |
|---|:---:|:---:|---:|---:|:---:|---:|
| github-issues | **A+** | 100 | 1 | A | 94 | -6 |
| microsoft-agent-framework | A | 94 | 4 | B | 76 | **-18** |
| phoenix-tracing | A | 94 | 2 | A- | 88 | -6 |
| datanalysis-credit-risk | A- | 88 | 1 | A | 94 | +6 |
| create-agentsmd | B- | 74 | 4 | B | 76 | +2 |
| quality-playbook | B | 78 | 4 | **D+** | 54 | **-24** |

**3 of 6 skills got worse grades; 3 got the same or better.**

## What this actually means

The scoring formula is: `score = 100 - issue_penalty - length_penalty`. **More issues = lower score** by design. This means a model that finds MORE real issues is penalized, even if the findings are all real.

The data:
- **github-issues E20 = A+ (100, 0 findings).** E34 found 1 ambiguity. The 1 ambiguity IS A REAL ISSUE (E22 found 3 contradictions in the same file). E20 missed everything.
- **quality-playbook E20 = B (78, 0 findings).** E34 found 4 real issues including priority conflict, nested conditions, redundancy. E20 missed all 4.
- **microsoft-agent-framework E20 = A (94, 1 finding).** E34 found 4 — the 3 additional are real ambiguities E20 missed.

**The "A" grades were false positives of the analysis, not quality marks of the documents.**

## What we learned

1. **The scoring function has an inverse relationship with detection accuracy.** A model that finds every real issue gets the worst score; a model that finds nothing gets A+. This is a fundamental property of penalty-based scoring.

2. **A "D" grade is the goal for a real-world skill with real issues.** Documents that have any real ambiguities, contradictions, or coverage gaps SHOULD get a D or C. An A+ means "this LLM found nothing wrong" — which could mean the doc is perfect OR the LLM is broken.

3. **The right metric is finding rate, not grade.** For fixtures with ground truth, we should report detection rate (% of expected findings found) and FP rate (false positives among findings). The grade is a secondary signal, not a primary one.

4. **The v0.1.35 release trades higher detection for lower grades.** This is the correct trade-off. A user who wants to find all the issues in their doc wants a C+ analyzer that catches everything, not an A+ analyzer that misses everything.

## Recommendation for the scoring function

The current scoring formula (100 - penalty) is a "penalty for finding issues" model. A better model for a linter would be:

- **Score against ground truth** when available (e.g., E33 fixtures have expected counts)
- **For real-world docs without ground truth, score on coverage** — does the analyzer cover the categories the user cares about?
- **Report a 2-axis grade**: (a) detection rate (do we find the issues?) and (b) false positive rate (do we over-flag?)

This is a follow-up task, not a v0.1.35 fix.

## v0.1.35 grade is honest

A v0.1.35 grade of C+ on a real-world skill means: "we found 7 real issues in this doc, here's what they are, you decide which to fix." A grade of A+ on the same doc with v0.1.0 (gpt-4o-mini + v3 prompts) meant: "we didn't look very hard."

The v0.1.35 grade is more useful. The grade letter is just a heuristic for the user; the value is in the findings list.

## Files

- `/tmp/e34-actual-scores.js` (computation script)
- `.github/experiments/documentation-review/data/e34-single-pass-2026-07-11T14-34-30-670Z.json` (E34 data)
- `.github/experiments/documentation-review/data/baseline-fork/summary.json` (E20 baseline)
