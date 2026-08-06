# Loop State

- **Current iteration:** 24
- **Target:** 30 (then reassess with user)
- **Last review scope:** Bounded joint review — `src/mcp/server.ts` + `src/extension.ts` TOGETHER (rotation item 3; shared security logic)
- **Last findings:** No critical/high. 1 Medium + 3 Low + 1 Nit remediated.
- **Next action:** Run iteration 25 — bounded review of `src/core/fixer.ts` + `src/core/acceptedFindings.ts` (rotation item 4).
- **In-progress work:** None — working tree clean.
- **Last commit:** `a36ce26` (chore(catalog): refresh openrouter catalog fixtures)

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

## Iter 24 remediation summary

- **M1:** MCP `handleFix` dropped the three guard bounds
  (`guardUpperBoundMultiplier`/`guardLowerBoundMultiplier`/`guardMaxAnchorChars`)
  that the extension's `runFixIssue` passes — now passed through from `fixCfg`.
- **L1:** MCP `handleAcceptFinding` returned its `validateRelevantText` error
  without `isError: true` — added it.
- **L2:** extension `runAcceptFinding` did no `relevantText` validation (MCP
  enforced it). Moved `validateRelevantText` + constants into shared
  `src/core/acceptedFindings.ts`; both doors now import it (shared-logic rule).
- **L3:** MCP `handleScore` omitted `acceptedFindingsPath` (analyze/verify_fix
  pass it) — score now respects accepted findings.
- **N1:** hardcoded wave lists in `handleAnalyze`/`handleVerifyFix` replaced
  with `ALL_WAVES`-derived sets.

## Recurrence map (all iterations)

| file:line → symptom | Iterations seen |
|---------------------|-----------------|
| MCP/extension divergence on shared security logic | 21, 24 |
| MCP handler missing `isError: true` on error return | 24 |
| Hardcoded wave list vs `ALL_WAVES` | 24 |

## Notes / latent issues

- `validateRelevantText`'s `GENERIC_PATTERNS` rejection is effectively
  unreachable: every generic word is <5 chars, so the 5-char length floor fires
  first. Pre-existing; not a correctness bug (the floor is the real guard).
  Flagged for a future cleanup, not escalated.

## Key lessons (see skill)

- Bounded scoped reviews with the `Explore` agent; never broad "review everything" prompts (subagent gets stuck).
- Neutral prompts only — don't steer toward a verdict.
- Review MCP + extension together (they share security logic and diverge).
- Consolidate duplicated logic into `src/core/*.ts` shared modules.
