# Loop State

- **Current iteration:** 28
- **Target:** 30 (then reassess with user)
- **Last review scope:** Cross-subsystem joint review — provider→core data flow + extension→MCP shared logic (every-3-iterations check)
- **Last findings:** No critical/high. 2 Medium + 3 Low remediated (1 Low documented as intentional).
- **Next action:** Run iteration 29 — bounded review of a subsystem (rotation restarts: `src/core/analyzer.ts` + `src/core/scoring.ts`).
- **In-progress work:** None — working tree clean.
- **Last commit:** `a18fe75` (fix(iter27): remediate bounded review of tests/CI/release)

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

## Iter 28 remediation summary

- **M1:** `VsCodeLmProvider` never set `finishReason`, so the analyzer's
  finish-reason retry and schema-mode hardening were dead code for the
  vscode-lm door. Success paths now return `finishReason: 'stop'`.
- **M2:** MCP `CopilotProvider` built without `editorVersion` (defaulted to
  `vscode/1.90.0`) while the extension passes the real version. MCP now passes
  `process.env.COPILOT_EDITOR_VERSION` so the two doors send the same
  Editor-Version header when the env var is set.
- **L1:** Copilot context-length fallback diverged: MCP picked the smallest
  across all three models, extension only resolved the standard model. The
  extension now mirrors the multi-model fallback.
- **L2:** deep→standard fallback in `callLLM` omitted `maxTokensMultiplier`
  (and its retry) — now passed through so a headroom-requesting wave doesn't
  lose output budget on the fallback path.
- **L3:** budget accounting exists only on the MCP door (reserve/charge/
  cooldown); the extension has no quota guard. Documented as intentional —
  the extension is interactive with HITL confirmation; the MCP is agent-driven
  and needs the guard. No code change.

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

## Notes / latent issues

- `validateRelevantText`'s `GENERIC_PATTERNS` rejection is effectively
  unreachable: every generic word is <5 chars, so the 5-char length floor fires
  first. Pre-existing; not a correctness bug (the floor is the real guard).
  Flagged for a future cleanup, not escalated.
- Iter 26 subagent first attempt failed with a GitHub service error; retried
  once with a narrower scope and succeeded.
- Extension/MCP budget asymmetry (L3 above) is intentional; documented.

## Key lessons (see skill)

- Bounded scoped reviews with the `Explore` agent; never broad "review everything" prompts (subagent gets stuck).
- Neutral prompts only — don't steer toward a verdict.
- Review MCP + extension together (they share security logic and diverge).
- Consolidate duplicated logic into `src/core/*.ts` shared modules.
