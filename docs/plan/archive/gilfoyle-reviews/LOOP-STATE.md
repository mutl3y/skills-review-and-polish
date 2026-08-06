# Loop State

- **Current iteration:** 29
- **Target:** 30 (then reassess with user)
- **Last review scope:** Bounded review — `src/core/analyzer.ts` + `src/core/scoring.ts` (rotation restart, item 1)
- **Last findings:** No critical/high. 3 Medium + 2 Low remediated.
- **Next action:** Run iteration 30 — bounded review of `src/providers/*` + `src/pricing.ts` + `src/modelCatalog.ts` (rotation item 2). At 30, reassess with the user.
- **In-progress work:** None — working tree clean.
- **Last commit:** `3ad44fe` (fix(iter28): remediate cross-subsystem joint review)

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

## Iter 29 remediation summary

- **M1:** `textSimilarity` computed Levenshtein distance on 100-char-truncated
  strings but divided by full-length `maxLen`, inflating similarity for long
  messages and causing false `llm-loop-detected` hits. Now divides by the
  truncated length.
- **M2:** `llm-rate-limited-summary` was not in `INCOMPLETE_ANALYSIS_CODES`, so
  a fully rate-limited run scored ~100 (grade Ungraded) instead of score 0.
  Added the summary code to `INCOMPLETE_ANALYSIS_CODES`.
- **M3:** the finish-reason retry reused the stale `disableStructuredOutput`
  value computed before the first call, so after an `error` finish set the
  wave flag the retry still ran in schema mode. Now recomputes the flag.
- **L1:** `processHygiene` set `relevantText` to `text_to_fix` while the range
  was anchored on `relevant_text` — fixer target diverged from the span. Now
  anchors both on `relevant_text`.
- **L2:** `AnalysisHistoryStore.set()` never recorded an access timestamp, so a
  store filled purely via `set()` had an empty timestamp map and never evicted.
  Now `set()` calls `touch()`.

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
