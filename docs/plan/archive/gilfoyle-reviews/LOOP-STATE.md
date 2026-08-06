# Loop State

- **Current iteration:** 26
- **Target:** 30 (then reassess with user)
- **Last review scope:** Bounded review — `src/ui/*` + `src/config.ts` (rotation item 5)
- **Last findings:** No critical/high. 2 Medium + 4 Nit remediated (1 Nit statusBar left as-is — internal data).
- **Next action:** Run iteration 27 — bounded review of Tests + CI + release scripts (rotation item 6).
- **In-progress work:** None — working tree clean.
- **Last commit:** `9e3e5d5` (fix(iter25): remediate bounded review of fixer/acceptedFindings)

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

## Iter 26 remediation summary

- **M1:** `provider` cast to union without validation — a malformed value
  silently fell through to the vscode-lm branch. Now validated against the
  union, falling back to `vscode-lm`.
- **M2:** `pickerSortBy`/`logLevel` cast to unions without validation — now
  validated with fallbacks.
- **N1:** `externalRequestTimeoutMs` accepted 0/negative — now clamped to a
  sane minimum (≥1000ms, else default).
- **N2:** `maxDiagnostics` accepted 0/negative — now clamped to ≥1.
- **N3:** statusBar `showResult` interpolates `grade` raw — left as-is (grade
  is internal, always from scoreSkill's fixed letter set; low risk).

## Recurrence map (all iterations)

| file:line → symptom | Iterations seen |
|---------------------|-----------------|
| MCP/extension divergence on shared security logic | 21, 24 |
| MCP handler missing `isError: true` on error return | 24 |
| Hardcoded wave list vs `ALL_WAVES` | 24 |
| fixDocument anchor re-derivation vs fixIssue target | 25 |
| acceptedFindings store entry validation | 25 |
| Config union cast without validation | 26 |

## Notes / latent issues

- `validateRelevantText`'s `GENERIC_PATTERNS` rejection is effectively
  unreachable: every generic word is <5 chars, so the 5-char length floor fires
  first. Pre-existing; not a correctness bug (the floor is the real guard).
  Flagged for a future cleanup, not escalated.
- Iter 26 subagent first attempt failed with a GitHub service error; retried
  once with a narrower scope (config.ts + statusBar.ts) and succeeded.

## Key lessons (see skill)

- Bounded scoped reviews with the `Explore` agent; never broad "review everything" prompts (subagent gets stuck).
- Neutral prompts only — don't steer toward a verdict.
- Review MCP + extension together (they share security logic and diverge).
- Consolidate duplicated logic into `src/core/*.ts` shared modules.
