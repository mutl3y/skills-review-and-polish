# Release Readiness

## Verdict: Released — production-ready authoring-time linter

Skills Review and Polish is released as a production-ready, human-in-the-loop
linter for AI customization files. It is suitable for everyday prompt and skill
review. Formal accuracy certification (e.g. unattended release blocking on a
fixed precision threshold) remains future work; precision hardening is ongoing,
not a blocker on using it as a linter today.

Current evidence (last calibration run 2026-07-18):

- Clean-fixture schema-mode recall: 87.3% on 5×3 (E50, post-truncation-fix)
- Clean-fixture precision proxy: 63.3% on 5×3
- Over-report ratio: 1.38x (well under 3x gate)
- Per-iteration noise (remeasured 2026-07-18, post provider hardening):
  **range 3 (penalty), 1 finding across 10 runs** on
  `test-contradictions-direct` (schema-mode, post-processor ON). The earlier
  range-110/16-finding figure was measured before the `temperature:0` /
  `top_p:0` defaults and error-scoped structured-output fallback landed; that
  hardening — not seeded sampling — collapsed the variance. A fixed `seed` was
  prototyped and empirically shown not to help (greedy decoding at temp 0 has
  no sampling to seed; residual noise is server-side non-determinism), so the
  `seed` change was reverted.
- Retry/merge path made deterministic (2026-07-18): the analyzer no longer
  picks the longer of two degraded retry responses, which was injecting
  variance. Only a clean retry recovery (stop finish, no error) beats the
  first response.
- Production-skill noise floor: not measured yet (see open follow-ups)
- Fixes: human-reviewed diff mode is the safe default; loop mode remains experimental

## Recommended Adaptive Output-Budget Settings (2026-07-17)

For OpenRouter providers with schema-mode, set:

```json
{
  "skillsReviewAndPolish.external.adaptiveResponseTokens": true,
  "skillsReviewAndPolish.external.adaptiveMaxResponseTokens": 131072,
  "skillsReviewAndPolish.external.minAdaptiveResponseTokens": 16384,
  "skillsReviewAndPolish.external.adaptiveCharsPerToken": 4
}
```

Source: `scripts/demos/adaptive-quality-playbook-live.mjs` on real production skill (292K-char quality-playbook). Default `adaptiveCharsPerToken=8` gave the model less room than the fixed 16K ceiling; `4` matches structured-JSON output density. Default `adaptiveMaxResponseTokens=65536` is enough for most production skills; raise to 131072 for 1M-context Gemini paths.

## Release Gates

| Gate | Beta | Formal release |
| --- | --- | --- |
| Compile | Must pass | Must pass |
| Unit tests | Must pass | Must pass |
| Markdown lint | Must not add new docs lint failures | Must pass or have an explicit archived waiver |
| Clean-fixture recall | Current 42% baseline acceptable if documented | Stable threshold by category |
| Precision | Manual spot checks | Manual production-sample precision gate |
| MCP config parity | Required | Required |
| Telemetry | Disabled unless implemented | Implemented or absent |

## Required Commands

```bash
npm run compile
npx vitest run --config tests/vitest.config.ts
npm run lint:md
```

Use `scripts/e50-clean-architecture.mjs` as the LLM calibration path when API
credentials are available. Unit tests should remain offline and deterministic.
