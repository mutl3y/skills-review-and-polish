# Handover — 2026-07-18 — Determinism & noise-floor resolution

> **Audience:** the model / maintainer who looks after this repo next.
> **Read this before:** touching the analyzer retry path, the provider
> sampling params, the release-readiness doc, or reaching for `seed` /
> `tool_calls` to "fix determinism." All three were evaluated this session;
> two were rejected with data.

## TL;DR

The **schema-mode response-shape instability** that was the main formal-release
blocker in the 2026-07-17 handover is **resolved — empirically, not
aspirationally.** The 10× noise-floor probe on `test-contradictions-direct`
(schema-mode, post-processor ON) now reads:

```text
successful: 10 of 10
totals (sorted): [117, 120, 120, 120, 120, 120, 120, 120, 120, 120]
range: 3, median: 120   (52–53 findings)
```

That is **range 3 penalty / 1 finding across 10 runs**, with **9 of 10 runs on
the identical value**. Compare the 2026-07-17 handover's figure of **range 89
penalty / 42 findings**. ~30× collapse. For a linter this is deterministic.

**What fixed it was provider hardening** (`temperature: 0` / `top_p: 0`
defaults + error-scoped `disableStructuredOutput` fallback, both landed
2026-07-17 post-handover) **plus one analyzer change made today** (deterministic
retry/merge). It was *not* `seed` and *not* `tool_calls`.

---

## What was done this session (2026-07-18)

1. **Release-readiness review (v0.1.39).** Verified the v0.1.39 release report
   claims against the code: `resolveMaxTokens` uses
   `desired = max(inputDerived, scaledCap)` in both providers;
   `SRP_WAVE_MULTIPLIER` is gone from `analyzer.ts`; versions agree at 0.1.39;
   `release:gate` green (577/577 tests, lint 0 errors, lint:md 0 errors).
   Verdict: beta/RC-positioned release is justified; formal accuracy claims are
   not (see "Calibration reality" below).

2. **Evaluated `seed` for determinism — rejected, with data.** Prototyped
   `seed` end-to-end (provider options, `ChatBody`, both `buildBody`s, env
   gate `SRP_SEED` in the probe, unit tests). Ran the noise-floor probe both
   ways:

   | run | range | median | distribution |
   | --- | --- | --- | --- |
   | seed OFF | 3 | 118 | `[117, 118×6, 120×3]` |
   | seed=12345 | **5** | 120 | `[115, 118×4, 120×5]` |

   Seed was **neutral-to-slightly-worse**, so the whole change was **reverted**
   (provider fields, `ChatBody.seed`, env gate, unit tests, and an orphaned
   `seed?: number` in `src/core/types.ts` `EngineConfig` that was declared but
   never read). See "Why seed can't help" below.

3. **Made the retry/merge path deterministic** (`src/core/analyzer.ts`,
   `sendLLMRequestWithFinishRetry`). Previously, when a wave got a non-stop
   finish and retried, the merge picked **the longer of the two degraded
   responses** (`retry.text.length > response.text.length`). Two independent
   samples of the same prompt produce different lengths, so this was a
   deliberate variance injection. Now only a **clean retry recovery** (stop
   finish, no error, passes `shouldRetryFinishResponse`) beats the first
   response; otherwise the **first** is kept. Under greedy decoding the first
   response is the deterministic result.

4. **Re-measured after the fix.** Post-fix run: range 3, median 120, and the
   distribution tightened from three distinct values to `[117, 120×9]` — 9/10
   identical. The retry/merge fix did what it was supposed to.

5. **Updated `docs/RELEASE-READINESS.md`.** Replaced the stale
   range-110/16-finding noise floor with the remeasured range-3/1-finding
   figure, credited provider hardening (not seed), documented why seed was
   reverted, and recorded the deterministic retry/merge change.

### Files touched

- `src/core/analyzer.ts` — deterministic retry/merge (the only shipped code change).
- `docs/RELEASE-READINESS.md` — corrected noise floor + rationale.
- Net-zero / reverted: `src/providers/externalProvider.ts`,
  `src/providers/externalProvider.test.ts`, `src/core/types.ts`,
  `scripts/probes/noise-floor-10x.mjs` (all back to their pre-session state
  after the seed revert).

### Verification

- `npm run compile` ✅
- `npx vitest run --config tests/vitest.config.ts` → **577/577 pass** ✅
- `npm run lint:md` → 0 errors ✅
- Noise-floor probe (post-fix): range 3, 10/10 success, 9/10 identical ✅

---

## Learnings (the load-bearing part)

### 1. `seed` cannot fix greedy-decoding non-determinism

`seed` makes **sampling** reproducible. This analyzer already runs at
`temperature: 0` / `top_p: 0`, i.e. **greedy argmax decoding** — there is no
sampling to seed. The residual range-3 noise is **server-side**: floating-point
non-determinism across batches, MoE expert routing, etc. Seed doesn't touch
that layer. Empirically confirmed: seeded runs were no tighter (range 5 vs 3).

> **Rule for next time:** before reaching for `seed`, check whether the request
> is already greedy. If `temperature: 0`, seed is dead config. Don't add it.

### 2. `tool_calls` would not have fixed response-shape instability either

Evaluated and rejected before any code was written. On Anthropic, OpenRouter
**already translates `json_schema` response_format into tool-use** with
`input_schema` (see `src/providers/llmResponseSchema.ts` header and
`externalProvider.ts` `buildBody` comment). Explicit `tool_calls` would be the
*same wire format* with more code. And the three real failure modes are
unaffected by format:

- `finish_reason: length` → output-token cap; tool calls have the same budget.
- `finish_reason: error` → provider/schema rejection; already handled by
  error-scoped `disableStructuredOutput`. Anthropic *only* accepts tool-use, so
  going tool_calls-native would **narrow** the escape hatch, not widen it.
- Schema adherence → already exact under `json_schema` (live probes: 8/8 keys,
  no enum violations).

> **Rule for next time:** format migrations don't fix token budgets or provider
> rejections. Diagnose the *actual* failure class first.

### 3. The retry/merge "longest-wins" heuristic was a hidden variance source

`shouldRetryFinishResponse` already (correctly) limits retries to `error` +
tiny bodies. But the merge then kept whichever degraded response was longer —
a proxy for "rambled more," which varies run to run. Deterministic rule now:
first response wins unless the retry is a *clean* recovery.

> **Rule for next time:** any time you re-sample an identical prompt and merge,
> the merge rule must be deterministic. Length is not a deterministic signal.

### 4. Provider hardening beat every cleverer intervention

The single biggest determinism win this whole arc was boring: pin
`temperature: 0` / `top_p: 0` and scope the structured-output fallback to
`error` only. That's what collapsed range 89 → 3. The sophisticated options
(seed, tool_calls, chunking) all solved the wrong problem.

### 5. Calibration reality (for the formal-release decision)

Don't conflate **recall** with **release-readiness.** Current honest numbers:

- Clean-fixture schema-mode recall: **87.3%** (5×3) — already strong; do NOT
  chase higher, that's what flooded production skills with ambiguity findings.
- Precision proxy: **63–73%** — the real gate. A linter lives on
  signal-to-noise; ~1 in 3 findings being noise erodes trust.
- Determinism: **now solved** (range 3, this session).

Formal release = **precision ≥ ~85%** (humans accept most findings) **+
recall stable ≥ 80%** (met) **+ deterministic output** (met). The remaining
work is precision hardening, not recall, not determinism.

> **Note:** `README.md` line ~10 still claims "about 47% recall on labeled
> fixtures and 42% on clean fixtures" — stale 07-16 baseline that under-sells
> the current 87.3%. Flagged this session; worth correcting so the public claim
> matches the data (kept honest, not hyped).

---

## Open follow-ups (carried, re-prioritized)

- **Production-skill noise floor** — still unmeasured. The fixture floor is
  now known (range 3); extend E61 with `SCORE_SAMPLES` and re-measure on
  `quality-playbook`, `sql-optimization`, `audit-integrity`. No longer blocked
  on determinism.
- **Precision hardening** — the actual path to formal release. Manual
  production-sample precision review; target ≥85% accepted-findings.
- **`README.md` recall figure** — update the stale 47%/42% to the current
  schema-mode numbers (with the methodology caveat).
- **wave-5 `e50-schema-validation`** — still `in-progress` in the remediation
  `plan.yaml`; the committed schema-mode baseline needs to be locked in.

## Resume commands

```bash
cd /workspace/skills-review-and-polish
git status --short
npx vitest run --config tests/vitest.config.ts 2>&1 | tail -6
npm run lint:md 2>&1 | tail -3

# Re-verify the noise floor (needs OPENROUTER_API_KEY):
source ~/.bashrc
node scripts/probes/noise-floor-10x.mjs 2>&1 | grep -aE "^run |range:|median:|successful:"
```

## Things NOT to do

- **Do NOT re-add `seed`** expecting determinism — it's greedy decoding; seed
  is inert. Measured and reverted this session.
- **Do NOT migrate to `tool_calls`** to fix response shape — same wire format
  on Anthropic, no effect on token budgets, narrows the fallback hatch.
- **Do NOT re-introduce length-based retry merging** — that's the variance
  source just removed. Merge must be deterministic.
- **Do NOT chase recall above ~87%** on the analyzer — precision is the gate,
  and over-flagging is the failure mode that floods production skills.
- **Do NOT bump `PENALTY_NOISE_MARGIN`** until the production-skill floor is
  measured; range 3 is a fixture number, not yet a production one.
