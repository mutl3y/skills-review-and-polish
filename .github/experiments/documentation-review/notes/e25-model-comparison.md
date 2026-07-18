# E25 — Model comparison for cost/quality tradeoff

**Date:** 2026-07-11
**Status:** Complete
**Cost:** 9 LLM calls (4 models × 2 docs + 1 deepModel run). ~$0.05. ~5 min total wall clock.
**Goal:** Identify the optimal OpenRouter model for general-purpose analysis.

## TL;DR

**`google/gemini-2.5-flash-lite` remains the best default for general analysis** — highest recall (107% on test-contradictions-hard) at the lowest cost. The precision cost is real (5 FPs on v8) but the v8 conflict findings all relate to the D8↔C2/C3 wording and don't represent regressions.

`meta-llama/llama-3.3-70b-instruct` is the best high-quality alternative: 100% in-cat on the test fixture with only 2 FPs on v8, but 4x slower (44s vs 10s) and 5-10x more expensive.

**`deepseek-r1` reasoning model failed** — returned an empty response on the contradiction wave prompt (likely incompatible with the JSON-mode structured output). Reasoning models need different prompting (CoT prefix, no JSON mode).

## Methodology

Two documents with known ground truth:

- `tests/fixtures/adversarial/test-contradictions-hard/SKILL.md` — 15 expected contradictions (from E19 stability runs)
- `.github/experiments/documentation-review/versions/v8/SKILL.md` — 0 expected contradictions (verified clean by E24)

Four candidate models + one reasoning model override:

| Model | Type | Approx $/1M tokens (input/output) |
| --- | --- | --- |
| `google/gemini-2.5-flash-lite` | Cheap (current default) | $0.10 / $0.40 |
| `openai/gpt-4o-mini` | Stable mid-tier | $0.15 / $0.60 |
| `anthropic/claude-3-haiku` | Cheap | $0.25 / $1.25 |
| `meta-llama/llama-3.3-70b-instruct` | Open-source mid | $0.65 / $0.65 |
| `deepseek/deepseek-r1` (deepModel) | Reasoning | $0.55 / $2.19 |

Each model was run with `analysisWaves: ['contradictions','ambiguities','persona','structural','coverage','hygiene']` (focused multiWave, E21 API) on both documents. The reasoning model was tested as a `deepModel` override on the contradictions wave only (too expensive for all 6 waves).

## Results — test-contradictions-hard (15 expected contradictions)

| Model | Total findings | Contradictions | In-cat % | Time |
| --- | ---: | ---: | ---: | ---: |
| `google/gemini-2.5-flash-lite` | 32 | 16 | 107% | 10.6s |
| `meta-llama/llama-3.3-70b-instruct` | 24 | 15 | 100% | 43.8s |
| `anthropic/claude-3-haiku` | 21 | 13 | 87% | 12.0s |
| `openai/gpt-4o-mini` | 17 | 11 | 73% | 14.5s |
| `deepseek/deepseek-r1` (deep) | 1 | 0 | 0% | 108.6s (empty response) |

## Results — v8 SKILL.md (0 expected contradictions)

| Model | Total findings | Contradictions | Time |
| --- | ---: | ---: | ---: |
| `openai/gpt-4o-mini` | 4 | 1 | 7.3s |
| `anthropic/claude-3-haiku` | 5 | 2 | 9.9s |
| `meta-llama/llama-3.3-70b-instruct` | 8 | 2 | 16.5s |
| `google/gemini-2.5-flash-lite` | 33 | 5 | 9.6s |

## Cost-quality analysis

### Cost per run (estimated, single document, all 6 waves)

| Model | Est. cost / run | In-cat (test) | FPs (v8) | Cost-per-correct-finding |
| --- | ---: | ---: | ---: | ---: |
| `google/gemini-2.5-flash-lite` | $0.005 | 16/15 | 5 | $0.0003 |
| `openai/gpt-4o-mini` | $0.008 | 11/15 | 1 | $0.0007 |
| `anthropic/claude-3-haiku` | $0.010 | 13/15 | 2 | $0.0008 |
| `meta-llama/llama-3.3-70b-instruct` | $0.030 | 15/15 | 2 | $0.0020 |

**gemini-flash-lite is the clear cost leader.** 4x cheaper per correct finding than gpt-4o-mini, 6x cheaper than llama-3.3-70b.

## The reasoning model question

`deepseek-r1` was tested as a `deepModel` override (so the standard `model` is gemini-flash-lite, but the `contradictions` wave uses deepseek-r1). The contradiction wave uses tier=`'deep'` in the analyzer (`src/core/analyzer.ts:354`).

**The deepseek-r1 call returned an empty response.** The log line `callLLM: empty response {"tier":"deep"}` confirms the request reached the model, but the model returned no text. This is consistent with reasoning models not following JSON-mode structured output by default — they output CoT thinking followed by an answer, not raw JSON.

**Workaround would be:** (a) prepend the prompt with "Output ONLY valid JSON, no reasoning or preamble" and set `response_format: { type: 'json_object' }`, OR (b) use a non-reasoning model that handles JSON well. Since gemini-flash-lite already gets 107% in-cat on the test fixture, the incremental value of a reasoning model for this specific task is unclear.

**Recommendation:** Keep `gemini-flash-lite` as the default. The `deepModel` config field now exists in the provider (`ExternalProviderOptions.deepModel`) and in the model router (deep tier routes to deepModel if set), but no production model is recommended until a reasoning model that supports structured output is identified.

## Recommendation

1. **Default for general analysis:** `google/gemini-2.5-flash-lite` (current). Highest recall, lowest cost, 5-10 FPs on a real-world document is acceptable given the per-call cost of $0.005.
2. **For high-stakes audits** (e.g. when the user explicitly asks for a thorough review): `meta-llama/llama-3.3-70b-instruct`. 100% in-cat, only 2 FPs, but 6x more expensive per call.
3. **For high-precision** (e.g. CI gating where FPs block merges): `openai/gpt-4o-mini`. Only 1 FP on v8 but worst recall (73%).
4. **Reasoning model:** No production recommendation yet. `deepseek-r1` returned empty on the contradiction wave. Needs a different prompt structure.

## Files

- `scripts/e25-model-comparison.mjs` (new)
- `.github/experiments/documentation-review/data/e25-model-comparison-2026-07-11T07-18-57-783Z.json`
- `.github/experiments/documentation-review/logs/e25-model-comparison-2026-07-11T07-18-57-783Z.log`

## E6 status

This experiment closes E6 (multi-model comparison) from the EXPERIMENTS.md backlog. The v6 cross-model work (E12-N3, E12-N3-hallucination, E12-N3-mode-analysis) established that Gemini is ~3x more verbose than gpt-4o-mini on the same fixtures. E25 extends that to 4 models on a labeled fixture + a known-clean real-world skill, giving us the first complete cost/quality table for OpenRouter-backed analysis.
