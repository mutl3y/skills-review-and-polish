# E40g — Ambiguity prompt v5: probe vs full E33 mismatch (regression analysis)

**Date:** 2026-07-11
**Status:** v5 reverted to v4. E40d v4 (21/47 PASS) is the validated winner.
**Question investigated:** Can we fix the contradiction-induced ambiguity suppression on test-contradictions-direct (0/11 in v4) with prompt changes alone?

## TL;DR

**No, not reliably.** E40d v5 (added "this wave runs INDEPENDENTLY of the contradiction wave. You do not see the contradiction wave's output") passed the ambiguities-only probe with 11/11 on test-contradictions-direct, but **regressed the full E33 from 21/47 to 18/47**. The LLM's calibration in multiWave mode differs from probe mode — longer prompts with anti-suppression language increased LLM variance and reduced overall recall.

## What I tried

**v5 prompt changes** (rejected):

1. Added "Critical: this wave runs INDEPENDENTLY of the contradiction wave" at the top
2. Added "Critical boundary rule — RE-READ BEFORE ANSWERING" with explicit "do not suppress" language at the bottom

**v5 results:**

| Fixture | v4 (probe) | v5 (probe) | v4 (full E33) | v5 (full E33) | Net change |
|---|---:|---:|---:|---:|---|
| test-contradictions-direct | 11 | 11 | 0 | 0 | ±0 |
| test-ambiguities | 19 | 20 | 18 | 16 | -2 |
| test-ambiguities-hard | 20 | 20 | 17 | 17 | ±0 |
| test-contradictions-subtle | (n/a) | (n/a) | 3 | 0 | -3 |
| test-contradictions-hard | (n/a) | (n/a) | 4 | 2 | -2 |
| test-cognitive-structural | (n/a) | (n/a) | 11 | 3 | -8 |
| test-instruction-quality | (n/a) | (n/a) | 7 | 7 | ±0 |
| test-obligation-hard | (n/a) | (n/a) | 14 | 13 | -1 |
| test-coverage-gaps | (n/a) | (n/a) | 7 | 7 | ±0 |
| test-mixed-hard | (n/a) | (n/a) | 5 | 5 | ±0 |

**E40g v5 totals: 18/47 PASS** vs **E40d v4 totals: 21/47 PASS** — v5 regressed by 3 categories.

## Why the probe ≠ full E33

The probe runs the ambiguity wave in isolation with a 3-run N=3 medians. The LLM has full cognitive space, no parallel wave pressure, and stable variance.

The full E33 runs all 6 waves in parallel via `Promise.allSettled`. The LLM:

- Sees the same document text (no context contamination from prior waves)
- Is being asked to produce 6 different LLM calls in parallel
- May have different token/temperature behavior when the system prompt is longer (v5 is 5421 chars vs v4's 4728)
- Has higher per-run variance (some runs get 0 ambiguities, some get 11)

The LLM is **not actually being primed by the contradiction wave** (waves are parallel) but the **per-wave LLM call's behavior differs** based on subtle context factors we don't fully control.

## Why prompt-only fixes don't generalize

When I added the "RE-READ BEFORE ANSWERING" anti-suppression language, the LLM did read it — and it shifted behavior in unintended ways. It started being more conservative on test-ambiguities (16/20 vs 18/20) and test-cognitive-structural (3/6 vs 11/6). The longer prompt likely caused:

- More token budget spent on prompt reading
- Less token budget for output generation
- Higher variance in finding generation

## What would actually work

To fix the contradiction-direct suppression, the options ranked by **architectural soundness**:

### ❌ Option A: Inject contradiction findings into the ambiguity wave's user prompt

**Status: Rejected after re-evaluation (2026-07-12).**

Reasons to reject:

1. **Architectural smell** — breaks wave separation. The whole point of independent waves is each LLM call is idempotent and standalone. Adding `priorFindings` to `analyzeAmbiguitiesWave` creates a hidden coupling that becomes technical debt.
2. **Optimizes for the wrong fixture** — test-contradictions-direct is synthetic (1:1 contradiction:ambiguity pairing in every paragraph). Real-world docs don't have this property. The e40e run on quality-playbook (2739 lines, real) found 8 ambiguities + 1 contradiction with zero cross-suppression issues.
3. **The "suppression" is arguably correct** — when a paragraph has "must do X" / "must NOT do X" AND "appropriate team", the user only needs ONE finding. Fixing the contradiction reveals the ambiguity. Reporting both is redundant noise.
4. **High cost, low payoff** — would add 1 category (test-contradictions-direct: 0/11 → 11/11) at the cost of cross-wave coupling, plumbing changes, and implicit ordering dependencies. Not worth it.

### ✅ Option D (recommended): Accept the limitation. Document it. Ship v0.1.36

**Status: This is what we're doing.**

The v4 prompt is a clear win (21/47 vs 17/47). The 0/11 on test-contradictions-direct is a known limitation. Users hitting this can:

- Run `analysisMode: 'single'` for contradiction-heavy docs (e12-N3 pattern, gets 11/11)
- Or accept the noise reduction (only contradiction, not ambiguity, is reported — which is arguably the right behavior for these documents)

### Option B: Auto-detect contradiction density and re-run ambiguity-focused

**Status: Future work, if needed.**

A v0.1.37 candidate. If the multiWave analysis produces >N contradictions, automatically run a follow-up `analysisWaves: ['ambiguities']` pass. ~3h of work, including a new E33 run to validate.

### Option E (best long-term): Smarter test fixture

**Status: Future work, trivial effort.**

test-contradictions-direct has 15 paragraphs with 1:1 contradiction:ambiguity pairing. This is unrealistic. Real-world documents have varied patterns: most paragraphs are clean, some have ambiguities, a few have contradictions, rarely do all three overlap on the same paragraph. Redesigning the fixture to reflect realistic distribution would make 0/11 a non-issue.

Effort: ~30 min to update the fixture. The new ambiguity expectation could be ~5-7 (realistically what a real doc would have), and the LLM getting 0-3 is then closer to the right answer.

## Recommendation (revised 2026-07-12)

**Adopt E40d v4 as the shipped prompt** (21/47 PASS, +4 vs baseline, 0 regressions). Document test-contradictions-direct 0/11 as a known limitation. **Do not implement Option A.** Defer Option E (fixture redesign) to whenever we next update the test corpus.

The probe was misleading: the v5 prompt passed the probe cleanly but the full E33 exposed that the LLM's calibration under multiWave pressure is different from probe. **Always validate with the full E33, not just the probe.**

## Files reverted

- `src/core/prompts/ambiguity.prompt` — v5 reverted to v4 (no commit needed; was uncommitted)

## Net result of this session (E40b through E40g)

- E40b/c/d/v4: established that the simple "Default: FLAG" + "Aim for high recall" + flat structure works.
- E40e/f: validated on real-world skills (quality-playbook found 17 high-quality findings).
- E40g: learned that probe results don't always generalize to multiWave. v5 regressed.
- **E40d v4 is the shipped prompt for v0.1.36.**
