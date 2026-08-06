# Loop State

- **Current iteration:** 21
- **Target:** 30 (then reassess with user)
- **Last review scope:** Duplication audit — MCP + extension + core (providerKeys, pathSafety, modelNames, llmText, tokenBudget, redact)
- **Last findings:** No critical/high. Consolidated 5 duplication clusters (1 had diverged: statusBar redaction).
- **Next action:** Run iteration 22 — bounded review of a subsystem not yet covered this pass (e.g. `src/core/analyzer.ts` + `src/core/scoring.ts`, or `src/providers/*` + `src/pricing.ts`).
- **In-progress work:** None — working tree clean.
- **Last commit:** `eee689e` (docs(instructions): trim INSTRUCTIONS.md to 12 lines)

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

## Key lessons (see skill)

- Bounded scoped reviews with the `Explore` agent; never broad "review everything" prompts (subagent gets stuck).
- Neutral prompts only — don't steer toward a verdict.
- Review MCP + extension together (they share security logic and diverge).
- Consolidate duplicated logic into `src/core/*.ts` shared modules.
