# E40b — Ambiguity prompt fix v2: structured criteria + boundary rule

**Date:** 2026-07-11
**Status:** Probe validated; full E33 in progress
**Model:** `qwen/qwen3-coder-30b-a3b-instruct`
**Mode:** `analysisMode: 'multiWave'`, all 6 waves (E33) / ambiguities-only (E40b probe)

## TL;DR

E40 added a quick prompt edit ("would a reasonable practitioner's action change?") but a quick test still showed 0 ambiguities on test-contradictions-direct. The wording change wasn't enough. **E40b restructures the prompt into explicit criteria (a1/a2/b/c), adds a boundary rule clarifying ambiguity-vs-contradiction, and explicitly lists positive examples.** Quick probe (3 runs, ambiguity wave only) on test-contradictions-direct: median **8/11** (was 0/11). Full E33 re-run in progress to confirm no regressions on test-ambiguities / test-ambiguities-hard.

## The problem E40 didn't solve

The E40 prompt edit was a single-sentence change. The structure of the prompt still had the original "materially different model behavior" criterion at the top and a conflicting "E33 v4 strict different-actions-vs-different-wording" historical note buried in the middle. The LLM was following the top-level criterion (a) and concluding "if most engineers would do the same thing, no flag". The broadening in the examples list (lines 8-15) was being read as illustrative, not as overriding the headline.

Also: the prompt's "Do NOT report contradictions" rule was being misread by the LLM as "if the ambiguous term is inside a contradictory clause, don't flag". On test-contradictions-direct, every paragraph has both an ambiguity and a contradiction, so the LLM was suppressing all ambiguity findings.

## E40b fix

Restructured the prompt into:

1. **Boundary rule** (new): an ambiguous term used inside a clause that also contains a contradiction is still an ambiguity finding. The contradiction wave reports the contradiction; this wave reports the ambiguous term. Report them separately.

2. **Structured criteria (a1/a2/b/c)** instead of a single "materially different" criterion:
   - (a1) **Action-defining term is undefined** — names an actor, scope, threshold, timeframe, quantity, or procedure that controls whether/what action is taken, but the document does not define it. **Exhaustive list of positive examples** (40+ terms).
   - (a2) **Interpretation gap changes a practitioner's action** — even if MOST practitioners would do the same thing, a junior's action could differ from a senior's, OR the document does not define the threshold. If a junior might skip, a senior might escalate, or a reviewer might accept vs reject — flag it.
   - (b) Weak obligation language without specification.
   - (c) Delegated decision without criteria.

3. **Removed** the contradictory "Flag ambiguity where" footer that re-stated the old (a) criterion.

4. **Added** "Do NOT flag bare pronouns or referents whose target is unambiguous in context" — this is the guard against over-flagging on test-ambiguities / test-ambiguities-hard.

5. **Removed** the historical "E30 over-flagging" note — it was sending the wrong signal (the LLM was treating it as "be conservative").

## E40b probe results (ambiguity wave only, N=3, qwen3-coder-30b)

| Fixture | Expected | E33 v5/E38 (full) | E40 M3 (full) | E40b probe (ambig only) |
|---|---:|---:|---:|---:|
| test-contradictions-direct | 11 | 0 | 0-1 | **7-11 (median 8)** |

The probe's 3 runs varied (8, 7, 11) — noise is high even with N=3, but the LLM is now finding the right terms. The 11/11 run 3 included:

- "appropriate team" (undefined actor)
- "high-throughput production environments" (undefined scope)
- "high-priority releases" (undefined threshold)
- "emergency hotfixes" (undefined scope)
- "frontend applications" (undefined scope)
- "staging" / "production" (undefined environments)

## E33 full re-run (in progress)

Running 13 fixtures × 3 runs at N=3, all 6 waves. Will report:

- ambiguity-llm recall per fixture (vs E33 baseline)
- any regressions in non-ambiguity categories

## Risk

The prompt now flags MORE things. On test-ambiguities (current 17/20) and test-ambiguities-hard (current 4/20) the new prompt may over-fire. The "bare pronoun" guard should help, but I'll measure.

## Files changed

- `src/core/prompts/ambiguity.prompt` — restructured per above
- `scripts/e40b-ambiguity-probe.mjs` (new) — 3-run ambiguity-only probe
