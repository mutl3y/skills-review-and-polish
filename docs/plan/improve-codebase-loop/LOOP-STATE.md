# Loop State

- **Current iteration:** 4 (completed 2026-08-09)
- **Target:** none (stop on the stop rule: no findings at Medium or above,
  after the independent verification pass — not a fixed iteration count)
- **Last review scope:** independent data-flow / input-validation pass (3rd
  distinct lens) via gilfoyle-code-review-lean
- **Last findings:** 1 Medium remediated (I1: extension `fix` LM tool missing
  the duplicate-anchor guard the MCP door has — fixed via shared
  `validateFixAnchor` in `src/core/fixer.ts`). Carried: 2 Low (I2: extension LM
  tools lack document-size gate; I3: shared budget excludes interactive spend).
  No High/Critical.
- **Next action:** run iteration 5 — one more fresh independent verification pass
  to confirm convergence. Each Medium found (H1, I1) has been a door-divergence;
  the parity is only as strong as the least-guarded caller.
- **In-progress work:** None — working tree clean after iter-4 commit
- **Last commit:** `fix(iter4): shared validateFixAnchor guard for both fix doors`

## Restart note

The loop was restarted from scratch on 2026-08-08. The previous iter-31 history
was archived to `20260808-loop-restart-archive/LOOP-STATE-iter31.md`. The stop
rule is now "no findings at Medium or above" (with an independent verification
pass before declaring done) — not a fixed iteration-30 target. See
`.github/skills/improve-codebase-loop/SKILL.md` and the repo-memory lessons file.

## How to resume

1. Read this file.
2. Read the repo-memory lessons file: `/memories/repo/improve-codebase-loop.md`.
3. `git log --oneline -10` + `git status --short` to confirm a clean tree.
4. Run the next iteration per `.github/skills/improve-codebase-loop/SKILL.md`.

## Iteration history (this run)

| Iter | Scope | Critical/High | Medium/Low | Outcome |
|------|-------|---------------|------------|---------|
| 1 | Broad whole-codebase (MCP+ext) | 0 | 3 remediated, 1 Low fixed, 1 Low carried | Fixed wave-count budget divergence (F1,F2), process.cwd fallback (F3), bare URL (F4). F5 (accepted-findings root) carried as by-design. |
| 2 | Broad whole-codebase (MCP+ext) via lean reviewer | 0 | 1 Medium remediated, 1 Low carried, 1 note, 1 rejected | Unified accepted-findings root resolution through one resolveWorkspaceRoot (G1) — closes the F5 divergence. G2 TOCTOU + G4 note carried; G3 redact-order claim rejected as factually wrong. |
| 3 | Independent flow-trace pass | 0 | 1 Medium remediated, 2 Low carried | Fixed extension agent LM tools ignoring the budget cap (H1). H2 (interactive path unbudgeted) + H3 (concurrent lost-update) carried as Low. |
| 4 | Independent data-flow pass | 0 | 1 Medium remediated, 2 Low carried | Fixed extension fix tool missing the duplicate-anchor guard via shared validateFixAnchor (I1). I2 (doc-size gate) + I3 (interactive spend unbudgeted) carried as Low. |
