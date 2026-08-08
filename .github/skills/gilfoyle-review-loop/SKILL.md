---
name: gilfoyle-review-loop
description: 'Run the autonomous improvement loop for THIS repo (skills-review-and-polish): scan → remediate → verify → repeat until no findings Medium or above. Use when continuing/resuming the loop, running an iteration, or checking state. Resumable via the state file.'
argument-hint: 'optional: "status" to check state'
user-invocable: true
---

# Gilfoyle Review Loop (this repo)

Autonomous improvement loop for `skills-review-and-polish`. The loop is the
**top-level container** — you keep iterating until the stop rule is met. You
do NOT run this once and stop.

```
┌──────────────────────────────────────────────────────────┐
│  LOOP (repeat until stop rule met):                        │
│                                                             │
│  1. Check stop rule → if met, declare done and STOP.        │
│  2. REVIEW: scan the codebase for issues.                   │
│  3. REMEDIATE: fix findings, most severe first.             │
│  4. VERIFY: run the project's checks/tests.                 │
│  5. Record state, then LOOP back to step 1.                 │
└──────────────────────────────────────────────────────────┘
```

**After each iteration you loop back to step 1 and continue — that is the
default.** Stopping is the exception, and it only happens when the stop rule
is actually met (checked at the top of every iteration).

## Setup (read this first)

1. Read the repo-memory lessons file: `/memories/repo/improve-codebase-loop.md`
   — apply its rules (shared-logic, cross-call-site checks, review framing).
   Keep it current: write back new lessons as the loop runs (see Step 5).
2. Read the state file: `docs/plan/improve-codebase-loop/LOOP-STATE.md` —
   records findings, next action, last commit.
3. `git log --oneline -10` and `git status --short` to confirm a clean tree.
   If dirty, commit or stash before starting.

## Config (this repo)

| Setting | Value |
| --- | --- |
| State dir | `docs/plan/improve-codebase-loop/` |
| Verify commands | `npm run compile` → `npx vitest run --config tests/vitest.config.ts` → `npm run lint` → `npm run lint:md` |
| Stop rule | no findings at **Medium** severity or above |
| Scope fallback | used ONLY if the broad review gets stuck (see below) |

> **NOTE: this skill is being retired.** It is superseded by the consolidated
> `improve-codebase-loop` skill. The repo's live loop now uses
> `improve-codebase-loop` and its state lives in
> `docs/plan/improve-codebase-loop/`. Delete this skill once the migration is
> confirmed.

## Procedure

Repeated until the stop rule is met.

### Step 1 — Check the stop rule

At the **top of every iteration**, check the stop rule. If it is met, run the
independent verification pass (below), then declare done and STOP.

**Stop rule:** no findings remain at **Medium** severity or above.

A single clean scan is NOT the stop rule. Before declaring done:

1. Run **one independent verification pass** with a DIFFERENT prompt than the
   loop's — e.g. "trace the user-facing flows end to end" rather than "review
   the modules". This catches false negatives and correctness/UX gaps the
   loop's lens under-weights.
2. If the independent pass also finds nothing at or above the stop threshold,
   record convergence and stop (or ask the user if they want to continue at a
   lower threshold).
3. If the independent pass finds new findings, remediate them and loop again.

### Step 2 — Review

Scan the codebase for issues.

- Prefer launching a **broad, whole-codebase review**. Give the reviewer a
  neutral, outcome-blind prompt — do NOT steer toward a verdict (no "this
  looks converged"). Ask for a terse report: one line per finding with
  file:line, severity, and a one-line fix, capped to the top 5 by severity.
- Ask the reviewer to check **cross-file consistency**: when a pattern/bug is
  found in one file, check whether every call site handles it the same way.
- Cap the reviewer's tool usage (e.g. "at most 15 reads/greps, then STOP") so
  it cannot get stuck re-reading the same symbols.
- **If the broad review gets stuck or fails**: fall back to a narrow scope,
  one area at a time from this list:
  1. `src/core/analyzer.ts` + `src/core/scoring.ts`
  2. `src/providers/*` + `src/pricing.ts` + `src/modelCatalog.ts`
  3. `src/mcp/server.ts` + `src/extension.ts` (TOGETHER — they share security logic)
  4. `src/core/fixer.ts` + `src/core/acceptedFindings.ts`
  5. `src/ui/*` + `src/config.ts`
  6. Tests + CI + release scripts
  If a narrow retry also fails, halt and report — do not keep guessing.

If the review returns no findings, that is a clean pass — record it and move
to the independent verification pass via the stop rule (Step 1).

### Step 3 — Remediate

Fix findings in severity order: **Critical → High → Medium → Low → Nit**.

- **Critical:** exploitable security hole (path traversal, secret leak,
  injection, cross-provider key routing) or data-corrupting bug.
- **High:** security weakness or correctness bug with a realistic trigger.
- **Medium:** partial guard / robustness gap; wrong in an edge case.
- **Low:** cosmetic or minor; values agree but could drift.
- **Nit:** style or naming only.

General rules:

- **Shared logic:** the MCP server (`src/mcp/server.ts`) and extension
  (`src/extension.ts`) are two doors onto one engine. Logic both need MUST
  live in ONE `src/core/*.ts` module imported by both — never copy-pasted.
  Shared modules: `providerKeys`, `pathSafety`, `modelNames`, `llmText`,
  `tokenBudget`, `redact`. Consolidate any duplication you find.
- **Every call site:** when a finding references symbols used in more than one
  place (e.g. `runFixIssue` vs `fixDocument`, `onSave`, `setApiKey`,
  `syncMcpConfig`), verify the fix at EVERY call site, not just the one found.
- After each fix, run `npm run compile`, then the affected tests.

### Step 4 — Verify

Run, in order:

1. `npm run compile`
2. `npx vitest run --config tests/vitest.config.ts`
3. `npm run lint` (0 errors; pre-existing warnings OK)
4. `npm run lint:md`

If any verification step fails, fix the failure before proceeding. Do not
commit a broken state.

### Step 5 — Record state, then loop

- Update `LOOP-STATE.md` with what was reviewed, what was fixed, remaining
  findings, and next action.
- **Update the lessons file** (`/memories/repo/improve-codebase-loop.md`) with
  any new lessons learned this iteration — e.g. a recurring bug class, a
  review prompt that worked or failed, a pattern that keeps getting missed.
  Keep it concise; do not duplicate what is already there.
- Commit each iteration with a clear message (`fix(iterN): ...`).
- **Loop back to Step 1 and run the next iteration.** Continuation is the
  default. Do not stop here unless the stop rule is met.

## Example (2 iterations — this is how the loop behaves)

**Iteration 1:** Review finds a High (a bug) and a Medium (a guard gap). Fix
both. Verify. Record. → Loop.

**Iteration 2:** Check stop rule — a Low remains. Review again: no new
findings at Medium+. Run the independent pass (different prompt) — it finds a
Medium. Fix it, verify, record. → Loop.

**Iteration 3:** Check stop rule — nothing remains at Medium+. Independent pass
is clean. Record convergence and stop.

## Token Efficiency

The loop is long-running; keep context lean so it survives many iterations.

- **Offload context to files, not the conversation.** Findings, state, and
  iteration history live in `LOOP-STATE.md` — do NOT restate them in chat.
- **Request concise reviewer output.** One line per finding, capped to the top
  5 by severity.
- **Read files in large chunks, not many small reads.**
- **Don't re-read what's already in context.**
- **Prefer grep/file_search over full reads** when locating symbols.
- **Commit early, commit often.** A clean tree + updated `LOOP-STATE.md` is the
  cheapest resume point.
