# Loop State

- **Current iteration:** 27
- **Target:** 30 (then reassess with user)
- **Last review scope:** Bounded review — Tests + CI + release scripts (rotation item 6)
- **Last findings:** No critical. 1 High + 2 Medium + 2 Low remediated.
- **Next action:** Run iteration 28 — cross-subsystem joint review (every 3 iterations): provider→core data flow + extension→MCP shared logic.
- **In-progress work:** None — working tree clean.
- **Last commit:** `96ce7d0` (fix(iter26): remediate bounded review of ui/config)

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

## Iter 27 remediation summary

- **H1:** `test:calibration:log` passed `RELEASE_GATE=1 node ...` through
  `run-with-log.mjs`, which spawns without a shell — `RELEASE_GATE=1` was
  treated as the executable name → ENOENT. Now exports the env var before the
  wrapper (`RELEASE_GATE=1 node scripts/run-with-log.mjs ... -- node ...`).
- **M1:** `publish-vsce.mjs` passed the marketplace PAT as a `--pat` CLI arg
  (visible in process list/logs). Now passes it via the `VSCE_PAT` env var
  (which vsce reads natively) in the child env.
- **M2:** E2E "Fix All" test used a no-op `toBeGreaterThanOrEqual(0)` assertion.
  Now asserts the notification (when present) is not an error.
- **L1:** `compile` script ran `rm -rf out/core/prompts` twice (copy-paste
  artifact) — removed the duplicate.
- **L2:** `tests/e2e/setup.ts` `hasAuthState` used `require('fs')` in an ESM
  module — now uses the already-imported `readFileSync`.

## Recurrence map (all iterations)

| file:line → symptom | Iterations seen |
|---------------------|-----------------|
| MCP/extension divergence on shared security logic | 21, 24 |
| MCP handler missing `isError: true` on error return | 24 |
| Hardcoded wave list vs `ALL_WAVES` | 24 |
| fixDocument anchor re-derivation vs fixIssue target | 25 |
| acceptedFindings store entry validation | 25 |
| Config union cast without validation | 26 |
| Release script env-var vs CLI-arg secret handling | 27 |

## Notes / latent issues

- `validateRelevantText`'s `GENERIC_PATTERNS` rejection is effectively
  unreachable: every generic word is <5 chars, so the 5-char length floor fires
  first. Pre-existing; not a correctness bug (the floor is the real guard).
  Flagged for a future cleanup, not escalated.
- Iter 26 subagent first attempt failed with a GitHub service error; retried
  once with a narrower scope and succeeded.

## Key lessons (see skill)

- Bounded scoped reviews with the `Explore` agent; never broad "review everything" prompts (subagent gets stuck).
- Neutral prompts only — don't steer toward a verdict.
- Review MCP + extension together (they share security logic and diverge).
- Consolidate duplicated logic into `src/core/*.ts` shared modules.
