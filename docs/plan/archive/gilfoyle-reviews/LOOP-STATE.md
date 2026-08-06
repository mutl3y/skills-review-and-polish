# Loop State

- **Current iteration:** 25
- **Target:** 30 (then reassess with user)
- **Last review scope:** Bounded review — `src/core/fixer.ts` + `src/core/acceptedFindings.ts` (rotation item 4)
- **Last findings:** No critical/high. 2 Medium + 3 Low remediated.
- **Next action:** Run iteration 26 — bounded review of `src/ui/*` + `src/config.ts` (rotation item 5).
- **In-progress work:** None — working tree clean.
- **Last commit:** `4c51e7d` (fix(iter24): remediate joint MCP+extension review)

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

## Iter 25 remediation summary

- **M1:** `fixDocument` re-derived the anchor independently of `fixIssue`'s
  `resolveAnchorText`; when `line` disambiguated a duplicated anchor, the
  replacement could target a different fragment than the one guarded/fixed.
  Added `targetText` to `FixIssueResult`; `fixDocument` now reuses it.
- **M2:** `loadAcceptedFindings` validated only the top-level `entries` shape;
  a corrupted entry missing `textPattern` made `normalize()` throw inside
  `isFindingAccepted`, crashing `filterAcceptedResults`. Now validates/sanitizes
  each entry and drops malformed ones.
- **L1:** `expandToParagraph` used the unnormalized `phrase` against
  whitespace-normalized content, so the fast path missed multi-space variants.
  Now uses `normPhrase`.
- **L2:** `saveAcceptedFindings` used a fixed `.tmp` name with no concurrency
  guard; two writers could collide. Now uses a unique temp name (pid + random).
- **L3:** redundant-instruction deletion consumed a preceding newline
  unconditionally, which could merge lines when the anchor wasn't on its own
  line. Now only strips it when the anchor starts a line.

## Recurrence map (all iterations)

| file:line → symptom | Iterations seen |
|---------------------|-----------------|
| MCP/extension divergence on shared security logic | 21, 24 |
| MCP handler missing `isError: true` on error return | 24 |
| Hardcoded wave list vs `ALL_WAVES` | 24 |
| fixDocument anchor re-derivation vs fixIssue target | 25 |
| acceptedFindings store entry validation | 25 |

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
