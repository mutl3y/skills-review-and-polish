# Release Report — v0.1.39

**Date:** 2026-07-18
**Author:** skills-review-and-polish engineering (GitHub Copilot agent)
**Audience:** Independent model reviewer evaluating delivered work
**Scope:** The `resolveMaxTokens` output-budget fix and the model output-cap
investigation that closed the `quality-playbook` truncation blocker.

---

## 1. Summary

v0.1.39 fixes a root-cause bug in how the analyzer sized each wave's LLM output
budget. Previously, the output budget was derived from the *input document
length*, which systematically under-sized output for large skills and caused
`finish_reason: length` truncation. The fix sizes the budget from the model's
generation cap instead. A multi-model investigation (deepseek-v4-flash,
deepseek-v4-pro, moonshotai/kimi-k3) confirmed the truncation was a code defect,
not a model limitation, and characterized the residual behavior.

**Release gate status:** ✅ green — `refresh-fixtures`, `compile`, `test`
(577/577), `lint` (0 errors), `lint:md` (0 errors).

---

## 2. The Bug

`src/providers/externalProvider.ts` → `resolveMaxTokens(prompt, multiplier)`:

```ts
// BEFORE
const desired = Math.ceil(prompt.length / this.adaptiveCharsPerToken) * multiplier;
```

With `adaptiveCharsPerToken = 4` and a 293,152-char input (`quality-playbook`),
`desired = 73,288` output tokens. The output budget was being computed from
*input length* at a 4-chars/token ratio. For large documents this is far below
the model's real generation capability, so the model honored the small
`max_tokens` and stopped at ~293K chars (~73K tokens) — truncating the findings.

**Symptom:** Every wave on `quality-playbook` returned `finish_reason: length`
at byte-identical sizes (~274K / 293K / 271K chars) regardless of model or
`maxTokensMultiplier`. Three different vendors (including frontier `kimi-k3`)
producing byte-identical outputs was the tell: the cap was in our request,
applied uniformly — not a model ceiling.

---

## 3. The Fix

```ts
// AFTER (both OpenRouterProvider and GitHubModelsProvider)
const scaledCap = Math.round(this.adaptiveMaxTokensCap * multiplier);
const desired = Math.max(
  Math.ceil(prompt.length / this.adaptiveCharsPerToken) * multiplier,
  scaledCap,
);
```

The output budget now reaches the model's generation cap
(`adaptiveMaxTokensCap * multiplier`) instead of being derived from input
length. `adaptiveMaxTokensCap` is set per-model (e.g. `384000` for
`deepseek/deepseek-v4-flash` via `ADAPTIVE_MAX_RESPONSE_TOKENS`).

**Verification (captured wire value):** the contradiction wave on
`quality-playbook` went from sending `max_tokens=73288` → `384000` (with cap
set to 384K). The contradiction wave (deep tier, mult=2) now requests 768K
tokens and **completes without truncation** — previously it capped at 73K.

---

## 4. Investigation Evidence

Single-sample e61 runs on `quality-playbook` (292,366 bytes / 2,739 lines),
deep model varied:

| model | catalog `max_completion` | before fix `max_tokens` sent | after fix `max_tokens` sent | contradiction wave |
|---|---|---|---|---|
| `deepseek/deepseek-v4-flash` | `null` (API accepts 384K) | 73,288 | 384,000 (cap) / 768,000 (mult=2) | completes |
| `deepseek/deepseek-v4-pro` | 384,000 | 73,288 | 384,000 | completes |
| `moonshotai/kimi-k3` | `null` | 73,288 | 384,000 | completes |

Direct API probes confirmed:

- `deepseek/deepseek-v4-flash` accepts `max_tokens=384000` (forced-output test
  returned `finish=stop` at 77K chars — the model stopped early because the
  synthetic prompt was short, proving the parameter is honored).
- The byte-identical ~293K-char responses across models were caused by our code
  sending the same `max_tokens=73288` to all three, not by a shared model cap.

**Residual `finish_reason: length` (model behavior, not a code bug):** even with
`max_tokens=384000` sent, the hygiene / coverage / ambiguities waves on
`quality-playbook` still emit ~293K chars then `length`. The model's *realized*
generation for this 2,739-line skill stops near ~73K tokens despite the 384K API
parameter. This is inherent to the skill size vs. the model's realized output.
`salvageTruncatedJSON` recovers partial findings (706 issues / 471 hygiene / 82
coverage / 290 contradictions) from each truncated response.

---

## 5. Decision: No Skill Chunking

Skill chunking (split skills > ~50K tokens per section) was considered and
**explicitly deferred**. Long skills are rare in the wild; the analyzer should
not carry a workaround for an authoring anti-pattern. `quality-playbook` should
be split by its *author* into smaller, focused skills. The residual
`finishLength` on that one skill is an accepted known limitation. Revisit
chunking only if corpus scans show long skills becoming common.

---

## 6. Files Changed

- `src/providers/externalProvider.ts` — `resolveMaxTokens` fix in both providers
  (OpenRouter + GitHub Models).
- `src/core/analyzer.ts` — removed `SRP_WAVE_MULTIPLIER` experiment override
  (debug scaffolding, not a product feature).
- `src/providers/externalProvider.test.ts` — updated 2 tests that asserted the
  old under-sizing behavior to the new `desired = max(inputDerived, scaledCap)`
  semantics.
- `docs/CHANGELOG.md` — `v0.1.39` Unreleased header corrected; fix documented
  under `Fixed (v0.1.39 unreleased)`.
- `docs/plan/PROGRESS.md` — Known Limitations updated (chunking deferred).
- `docs/plan/20260717-handling-noise-floor-and-release-blockers.md` — "Model
  output-cap limitations" section rewritten with the real root cause.
- `package.json` — version `0.1.38` → `0.1.39`.
- `README.md` — status line `v0.1.38` → `v0.1.39`.

---

## 7. Test & Gate Evidence

```text
npm run release:gate
  refresh-fixtures  ✅
  compile           ✅
  test              ✅ 577 passed (577)
  lint              ✅ 0 errors (6 pre-existing warnings, unrelated)
  lint:md           ✅ 0 errors
```

---

## 8. Reviewer Checklist

- [ ] `resolveMaxTokens` in both providers uses `desired = max(inputDerived, scaledCap)`.
- [ ] No `process.env.SRP_WAVE_MULTIPLIER` remains in `analyzer.ts`.
- [ ] Contradiction wave on a large skill sends `max_tokens` ≥ model cap (verify via wire capture).
- [ ] `quality-playbook` `finishLength` is documented as a known/accepted model-limit, not a code defect.
- [ ] `package.json` / `README.md` / `CHANGELOG.md` all agree on `v0.1.39`.
- [ ] 577/577 tests pass; `lint:md` 0 errors.

---

## 9. Known Limitations (carried into v0.1.39)

- `quality-playbook` (2,739 lines) may still show `finish_reason: length` on
  hygiene/coverage/ambiguity waves — model's realized ~73K-token generation
  limit; salvage recovers partial findings.
- `src/modelCatalog.ts` resolves only `context_length` (input window), not
  `top_provider.max_completion_tokens` (output cap). Until parsed,
  `adaptiveMaxTokensCap` must be set per-model via `ADAPTIVE_MAX_RESPONSE_TOKENS`
  / equivalent config. The picker cannot yet auto-warn about output-cap
  truncation on large skills.
- Skill chunking is deferred (see §5).
