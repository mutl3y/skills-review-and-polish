# Loop State

- **Current iteration:** 23
- **Target:** 30 (then reassess with user)
- **Last review scope:** Bounded review — `src/providers/*` + `src/pricing.ts` + `src/core/tokenBudget.ts` + `src/core/modelNames.ts`
- **Last findings:** No critical/high. 1 Medium + 6 Low + 1 Nit remediated.
- **Next action:** Run iteration 24 — bounded review of a subsystem not yet covered this pass (e.g. `src/ui/*`, or `src/mcp/*` + `src/extension.ts` together).
- **In-progress work:** None — working tree clean.
- **Last commit:** `ef35e69` (fix(iter22): remediate bounded review of analyzer/scoring/fixer/findingFilter)

## How to resume

1. Read this file.
2. Read `docs/plan/archive/releases/20260805-gilfoyle-loop-to-iter20/HANDOVER.md`.
3. `git log --oneline -10` + `git status --short` to confirm clean.
4. Run the next iteration per `.github/skills/gilfoyle-review-loop/SKILL.md`.

## Iteration history (recent)

| Iter | Scope | Critical/High | Outcome |
|------|-------|---------------|---------|
| 18 | full codebase | 3C/6H | remediated |
| 19 | convergence (steered — unreliable) | 0 | false all-clear |
| 20 | bounded (fixer, acceptedFindings, mcp, modelCatalog, extension) | 0 | 3 Medium/Low fixed |
| 21 | duplication audit (MCP+ext+core) | 0 | 5 clusters consolidated |
| 22 | bounded (analyzer, scoring, findingFilter, fixer, types) | 0 | 2M/5L/3N fixed |
| 23 | bounded (providers, pricing, tokenBudget, modelNames) | 0 | 1M/6L/1N fixed |

## Iter 23 remediation summary

- **M1:** a 400/422 response body without an `error` key was treated as success
  (empty text returned silently). `fetchJson` now throws `HttpError` for a
  4xx body lacking an `error` key, so it flows through the retry/error path.
- **L1:** external `resolveMaxTokens` hardcoded `/4` chars-per-token — now uses
  shared `CHARS_PER_TOKEN` from `tokenBudget.ts`.
- **L2:** `isRetryable` did `Number(code)`; string codes like
  `"rate_limit_exceeded"` became NaN and never matched — now also matches text.
- **L3:** `collectStreamText` injected literal `"undefined"` when a stream
  part's `.value` was undefined — now skips such parts.
- **L4:** `selectModel` pricing guard looked up `trimmed` against
  `modelToMultiplier` keyed by model.id — now looks up the actual returned
  model's id so a case/format mismatch can't bypass the guard.
- **L5:** `parseOpenRouterResponse` stored NaN for non-numeric pricing strings —
  now skips non-finite entries.
- **L6:** vscodeLm `resolveMaxTokens` had no context-window bound — now bounds
  output by `model.maxInputTokens` (mirrors external providers).
- **N1:** `formatPerMillion` had redundant branches — collapsed.

## Key lessons (see skill)

- Bounded scoped reviews with the `Explore` agent; never broad "review everything" prompts (subagent gets stuck).
- Neutral prompts only — don't steer toward a verdict.
- Review MCP + extension together (they share security logic and diverge).
- Consolidate duplicated logic into `src/core/*.ts` shared modules.
