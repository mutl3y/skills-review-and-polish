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

To fix the contradiction-direct suppression, the options are:

### A. Inject contradiction findings into the ambiguity wave's user prompt
**Pros:** Surgical, targeted at the exact problem
**Cons:** Requires plumbing prior findings between waves; adds ~100-200 tokens per ambiguity call
**Effort:** ~2 hours (modify analyzeAmbiguitiesWave signature, add `priorFindings` param, plumb from `analyze()`)

### B. Run ambiguity wave in a separate session (focused mode for contradiction-heavy docs)
**Pros:** Matches e12-N3's success pattern (single mode)
**Cons:** 2x cost on contradiction-heavy docs; user has to opt in
**Effort:** ~1 hour (add an `analysisMode: 'auto'` that detects contradiction density and re-runs ambiguity if needed)

### C. Reorder waves to run ambiguity FIRST
**Pros:** Eliminates any temporal priming (though there shouldn't be any in parallel mode)
**Cons:** Doesn't match the current data — ambiguity-first might have other issues
**Effort:** ~30 min (swap wave order in `allPhaseConfigs`)

### D. Accept the 0/11 on contradiction-direct as a known issue
**Pros:** No work; E40d v4 is already a clear win
**Cons:** test-contradictions-direct is the most-validated fixture; 0/11 there is a regression vs the labeled ground truth
**Effort:** 0

## Recommendation

**Adopt E40d v4 as the shipped prompt** (21/47 PASS, +4 vs baseline, 0 regressions). Document test-contradictions-direct 0/11 as a known limitation. Defer Option A (inject contradiction findings) to v0.1.37 — it's a bigger change that needs its own experiment.

The probe was misleading: the v5 prompt passed the probe cleanly but the full E33 exposed that the LLM's calibration under multiWave pressure is different from probe. **Always validate with the full E33, not just the probe.**

## Files reverted

- `src/core/prompts/ambiguity.prompt` — v5 reverted to v4 (no commit needed; was uncommitted)

## Net result of this session (E40b through E40g)

- E40b/c/d/v4: established that the simple "Default: FLAG" + "Aim for high recall" + flat structure works.
- E40e/f: validated on real-world skills (quality-playbook found 17 high-quality findings).
- E40g: learned that probe results don't always generalize to multiWave. v5 regressed.
- **E40d v4 is the shipped prompt for v0.1.36.**
