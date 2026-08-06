# Loop State

- **Current iteration:** 30 (TARGET REACHED — reassess with user)
- **Target:** 30
- **Last review scope:** Bounded review — `src/providers/*` + `src/pricing.ts` + `src/modelCatalog.ts` (rotation item 2)
- **Last findings:** No critical/high. 2 Medium + 3 Low remediated.
- **Next action:** Reassess with the user. The loop has run 30 iterations with no critical/high findings since iter 20. Recommend: (a) stop and consider the loop converged, or (b) run an independent verification pass on the highest-risk subsystems (MCP+extension, providers) with a different scoped prompt to catch false negatives, per the stopping-rule guidance.
- **In-progress work:** None — working tree clean.
- **Last commit:** `0fa1187` (fix(iter29): remediate bounded review of analyzer/scoring)

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
| 24 | bounded joint (MCP + extension) | 0 | 1M/3L/1N fixed |
| 25 | bounded (fixer, acceptedFindings) | 0 | 2M/3L fixed |
| 26 | bounded (ui, config) | 0 | 2M/4N fixed |
| 27 | bounded (tests, CI, release) | 0 | 1H/2M/2L fixed |
| 28 | cross-subsystem joint (provider→core, ext→MCP) | 0 | 2M/3L fixed |
| 29 | bounded (analyzer, scoring) | 0 | 3M/2L fixed |
| 30 | bounded (providers, pricing, modelCatalog) | 0 | 2M/3L fixed |

## Iter 30 remediation summary

- **M1:** OpenRouter context disk cache lacked the `isRealPricingCache`
  content-quality check (a test mock writing 1000+ sequential entries was
  trusted as real). Added `isRealContextCache` mirroring pricing.ts.
- **M2:** static fallback table keys were raw spaced-hyphen form, so the
  `normalizeModelId` lookup branch never matched. Keys now stored in
  normalized form; removed the now-redundant `gpt-4o-mini` entry (it's in the
  catalog and the normalized lookup finds it there).
- **L1:** `isRateLimitError` matched bare `'exceeded'`, misclassifying
  "max_tokens exceeded"/"context_length exceeded" as rate limits. Narrowed to
  rate-limit-specific phrases (externalProvider + vscodeLmProvider).
- **L2:** `parseOpenRouterResponse` defaulted a missing `prompt`/`completion`
  field to $0 (under-reporting cost). Now skips entries with a missing field.

## Recurrence map (all iterations)

| file:line → symptom | Iterations seen |
|---------------------|-----------------|
| MCP/extension divergence on shared security logic | 21, 24, 28 |
| MCP handler missing `isError: true` on error return | 24 |
| Hardcoded wave list vs `ALL_WAVES` | 24 |
| fixDocument anchor re-derivation vs fixIssue target | 25 |
| acceptedFindings store entry validation | 25 |
| Config union cast without validation | 26 |
| Release script env-var vs CLI-arg secret handling | 27 |
| Provider/core contract mismatch (finishReason) | 28 |
| Extension/MCP context-length fallback divergence | 28 |
| Analyzer/scoring contract mismatch (rate-limit summary code) | 29 |
| Disk-cache content-quality check (pricing vs catalog) | 30 |

## Notes / latent issues

- `validateRelevantText`'s `GENERIC_PATTERNS` rejection is effectively
  unreachable: every generic word is <5 chars, so the 5-char length floor fires
  first. Pre-existing; not a correctness bug (the floor is the real guard).
  Flagged for a future cleanup, not escalated.
- Iter 26 subagent first attempt failed with a GitHub service error; retried
  once with a narrower scope and succeeded.
- Extension/MCP budget asymmetry (iter 28 L3) is intentional; documented.

## Key lessons (see skill)

- Bounded scoped reviews with the `Explore` agent; never broad "review everything" prompts (subagent gets stuck).
- Neutral prompts only — don't steer toward a verdict.
- Review MCP + extension together (they share security logic and diverge).
- Consolidate duplicated logic into `src/core/*.ts` shared modules.
