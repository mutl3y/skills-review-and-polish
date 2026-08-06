---
name: gilfoyle-review-loop
description: 'Run the autonomous Gilfoyle code-review loop for this repo: review → remediate → test → commit → repeat until no critical/high findings, then release-gate and publish. Use when: continuing the review loop, resuming after compaction or a fresh session, running a review iteration, remediating findings, or checking loop state. Resumable via the loop state file.'
argument-hint: 'iteration number to run, or "status" to check state'
user-invocable: true
---

# Gilfoyle Review Loop

Autonomous security/quality loop for `skills-review-and-polish`: review the
codebase with the Gilfoyle agent, remediate findings, verify, commit, and
repeat until no critical/high findings remain — then release-gate and publish.

## When to Use

- Continue the review loop (target: iteration 30, then reassess)
- Resume after compaction or in a fresh session
- Run a single review iteration
- Remediate a set of findings
- Check loop state / where we left off

## Resumability (read this FIRST)

The loop is resumable across compaction and fresh sessions via a **state file**:

- **State file:** `docs/plan/archive/gilfoyle-reviews/LOOP-STATE.md`
- **Handover:** `docs/plan/archive/releases/20260805-gilfoyle-loop-to-iter20/HANDOVER.md`

**Always start by reading `LOOP-STATE.md`.** It records: current iteration,
last findings, next action, and any in-progress work.

**If `LOOP-STATE.md` is MISSING:** skip validation — go straight to recovery: create it from the git log and the latest handover doc, and log the recovery action.

**If `LOOP-STATE.md` is CORRUPTED (invalid format / missing required fields):** validate its structure, then attempt recovery from the git log and the latest handover doc. Log the recovery action in the state file. If recovery is impossible, halt and report — do not guess.

## Subsystem Rotation

Review one subsystem per iteration, rotating through this list (repeat as
needed). Include test infra (`tests/`, `vitest.config.ts`), CI config, and
release scripts (`release:gate`, `release-process.md`) at least once per full
cycle — they are valid review targets too.

1. `src/core/analyzer.ts` + `src/core/scoring.ts`
2. `src/providers/*` + `src/pricing.ts` + `src/modelCatalog.ts`
3. `src/mcp/server.ts` + `src/extension.ts` (TOGETHER — they share security logic)
4. `src/core/fixer.ts` + `src/core/acceptedFindings.ts`
5. `src/ui/*` + `src/config.ts`
6. Tests + CI + release scripts

**Cross-subsystem check:** every 3 iterations, run one joint review covering
provider→core data flow and extension→MCP shared logic, not just a single
subsystem. Also: when a finding references symbols in another subsystem (e.g.
`src/mcp/server.ts` calls `src/core/*`), flag it for joint review of both
sides of the interaction.

## Procedure

### 1. Check state
1. Read `docs/plan/archive/gilfoyle-reviews/LOOP-STATE.md`.
2. Read the latest handover in `docs/plan/archive/releases/`.
3. `git log --oneline -10` and `git status --short` to confirm clean state.
4. If the working tree is dirty, commit or stash before starting.

### 2. Run a review iteration
Use `runSubagent` with the **`Explore` agent** (NOT the broad Gilfoyle agent —
it gets stuck grepping the same symbols for hours; `runSubagent` has no
timeout). Use a **tightly-scoped, neutral prompt**:

- Scope to the current subsystem from the rotation list.
- Cap tool calls (e.g. "at most 15 reads/greps, then STOP").
- Forbid re-reading the same file or re-running the same search.
- Ask for a terse report: one line per finding (file:line, severity, one-line
  fix), capped to the **top 5 by severity**. No preamble or summary prose.
- Do NOT steer toward a verdict (no "this has converged" — that's confirmation
  bias; the independent review proved it misses real issues).

**If `runSubagent` is unavailable:** perform a manual scoped review of the same
subsystem using `grep` and `read_file` with the same constraints (cap reads,
no re-reads, neutral framing).

**If `runSubagent` FAILS (tool error):** log the error in `LOOP-STATE.md` and
retry once with a narrower scope. If it fails again, halt and report.

**If `runSubagent` returns NO FINDINGS:** treat it as a successful clean pass —
do NOT retry. Record it and proceed to the next subsystem.

### 3. Remediate findings
- Fix Critical → High → Medium → Low → Nit, in that order.
- **Severity definitions:**
  - **Critical:** exploitable security hole (path traversal, secret leak,
    prompt injection, cross-provider key routing) or data-corrupting bug.
  - **High:** security weakness or correctness bug with a realistic trigger.
  - **Medium:** partial guard / robustness gap; wrong in an edge case.
  - **Low:** cosmetic or minor; values agree but could drift.
  - **Nit:** style / naming only.
- **Shared logic rule:** the MCP server (`src/mcp/server.ts`) and extension
  (`src/extension.ts`) are two doors onto one engine. Logic both need MUST live
  in ONE `src/core/*.ts` module imported by both — never copy-pasted. Shared
  modules: `providerKeys`, `pathSafety`, `modelNames`, `llmText`,
  `tokenBudget`, `redact`. Consolidate any duplication you find.
- **Recurrence guard:** track findings by file:line + symptom in the full
  recurrence map in `LOOP-STATE.md` (ALL prior iterations, not just the
  previous one). If the same finding recurs 3 times total, escalate to a
  different fix strategy. If the root cause is unclear, flag for manual
  investigation instead of re-applying the same remediation.
- **False positives:** if a finding from the subagent is later deemed a false
  positive during verification, note it in `LOOP-STATE.md` and adjust the next
  review prompt/scope to reduce noise.
- After each fix: `npm run compile`, then run the affected tests.

### 4. Verify (in this order)
1. `npm run compile`
2. `npx vitest run --config tests/vitest.config.ts`
3. `npm run lint` (0 errors; pre-existing warnings OK)
4. `npm run lint:md`

**If any verify step fails:** fix the failure before committing. Do not commit
a broken state.

### 5. Commit
- Commit each iteration with a clear message (`fix(iterN): ...`).
- Update `LOOP-STATE.md` with the new iteration number, findings, next action,
  and the recurrence map.

### 6. Continue or stop
- **Autonomous continuation:** if the user asked to run the loop autonomously,
  do NOT stop after one iteration. Immediately proceed to the next subsystem
  in the rotation and run the next iteration. Only stop when a stopping rule
  below is met.
- **User halt:** check for a `STOP` file at the repo root (or a `halt`
  argument to the skill) before each iteration. If present, stop cleanly and
  record the state.
- **Stopping rules:**
  - The review found **no critical/high findings** → run one independent
    verification pass on the highest-risk subsystems with a different scoped
    prompt (to catch false negatives). If still clean, record convergence and
    stop (or ask the user).
  - Iteration 30 reached with critical/high findings still remaining → stop,
    record the remaining findings in `LOOP-STATE.md`, and flag for manual
    review. Do not continue without user direction.

### 7. Release gate + publish (only when the user asks to ship)
1. `npm run release:gate`
2. Bump version, update README status + CHANGELOG, commit.
3. Publish per `docs/plan/LEARNINGS.md` / repo memory (`release-process.md`).

**If `npm run release:gate` fails:** halt the release, record the gate failure
in `LOOP-STATE.md`, and report the specific gate check that failed. Do not
proceed to version bump or publish.

## Loop State File Format

`LOOP-STATE.md` should contain:

```markdown
# Loop State
- Current iteration: N
- Target: 30
- Last review scope: <subsystem>
- Last findings: <critical/high count + summary>
- Next action: <what to do next>
- In-progress work: <any uncommitted changes or partial fixes>
- Last commit: <sha>
- Recurrence map: <file:line → symptom → iterations seen>
```

## Key Lessons (do not repeat)

1. **Broad "review the entire codebase" prompts get the subagent stuck** — it
   greps the same 2-3 symbols for hours. Use bounded, scoped reviews with the
   `Explore` agent.
2. **Don't steer the reviewer.** Neutral prompts only. A "converged" prompt
   caused a false all-clear; an independent neutral review found real issues.
3. **MCP + extension must be reviewed together** — they share security logic
   and diverge if reviewed separately (a real divergence was found this way).
4. **Consolidate duplicated logic** — it's a maintenance burden and attack
   surface. See the shared-logic rule above.

## Token Efficiency

The loop is long-running; keep context lean so it survives many iterations.

- **Offload context to files, not the conversation.** Findings, state, and
  iteration history live in `LOOP-STATE.md` and the handover docs — do NOT
  restate them in chat. Read the file, act, update the file.
- **Request concise subagent output.** One line per finding, capped to the top
  5 by severity.
- **Read files in large chunks, not many small reads.** Prefer one
  `read_file` of a big range over several small ones.
- **Don't re-read what's already in context.** If a file's content is already
  loaded, don't re-fetch it.
- **Prefer `grep`/`file_search` over full reads** when you only need to locate
  a symbol or confirm a pattern exists.
- **Commit early, commit often.** A clean tree + a fresh `LOOP-STATE.md` is the
  cheapest resume point — it lets a compacted/fresh session pick up without
  replaying the whole conversation.
- **Scheduled compaction is fine.** Because state is on disk, compaction or a
  fresh session loses nothing: read `LOOP-STATE.md` and continue. Do not keep
  the whole loop in one context window.

