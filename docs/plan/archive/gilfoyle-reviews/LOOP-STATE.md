# Loop State

- **Current iteration:** 22
- **Target:** 30 (then reassess with user)
- **Last review scope:** Bounded review — `src/core/analyzer.ts` + `src/core/scoring.ts` + `src/core/findingFilter.ts` + `src/core/fixer.ts` + `src/core/types.ts`
- **Last findings:** No critical/high. 2 Medium + 5 Low + 3 Nit remediated.
- **Next action:** Run iteration 23 — bounded review of a subsystem not yet covered this pass (e.g. `src/providers/*` + `src/pricing.ts`, or `src/ui/*`).
- **In-progress work:** None — working tree clean.
- **Last commit:** `48ffdb7` (docs(skill): add token-efficiency guidance to review loop)

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

## Iter 22 remediation summary

- **M1:** rate-limit summary diagnostic shared the `llm-rate-limited` code with
  per-wave diagnostics → `rateLimitedWaveCount` reported N+1. Gave the summary
  a distinct `llm-rate-limited-summary` code; added to `INFRA_SKIP`.
- **M2:** `frontmatterRange`/`skillDomainHint` stopped at the first `\n---` even
  inside a multi-line frontmatter value. Added shared `findFrontmatterEnd` that
  only matches a standalone `---` line (also handles EOF without trailing NL).
- **L1:** redundant-instruction deletion could leave orphan blank lines — now
  deletes the exact span with surrounding newlines deterministically.
- **L2:** contradiction findings carried no `relevantText` (fixer relied on a
  fragile regex) — analyzer now sets `relevantText: c.instruction1`.
- **L3:** `contradictionCrossReferenceRule` used case-sensitive containment —
  now case-insensitive.
- **L4:** `findTextRange` fuzzy fallback reported `endChar` from fragment length
  instead of the actual matched span — now measures the real span.
- **N1:** partial-word match only sorted by hintLine when >1 match — now always.
- **N2:** `parseSkillType` failed on BOM/leading blank line — now trims them.
- **N3:** `convertResultsToRecommendations` now excludes all infra codes
  (incl. `llm-rate-limited`, `llm-loop-detected`, `high-complexity`,
  `limited-coverage`) from the recommendation stream.

## Key lessons (see skill)

- Bounded scoped reviews with the `Explore` agent; never broad "review everything" prompts (subagent gets stuck).
- Neutral prompts only — don't steer toward a verdict.
- Review MCP + extension together (they share security logic and diverge).
- Consolidate duplicated logic into `src/core/*.ts` shared modules.
