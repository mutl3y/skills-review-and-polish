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
last findings, next action, and any in-progress work. If it does not exist,
create it from the handover doc and the git log.

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

- Scope to a specific subsystem or cross-cutting surface (e.g. MCP + extension
  together, since they share security logic and must not diverge).
- Cap tool calls (e.g. "at most 15 reads/greps, then STOP").
- Forbid re-reading the same file or re-running the same search.
- Do NOT steer toward a verdict (no "this has converged" — that's confirmation
  bias; the independent review proved it misses real issues).

### 3. Remediate findings
- Fix Critical → High → Medium → Low → Nit, in that order.
- **Shared logic rule:** the MCP server (`src/mcp/server.ts`) and extension
  (`src/extension.ts`) are two doors onto one engine. Logic both need MUST live
  in ONE `src/core/*.ts` module imported by both — never copy-pasted. Shared
  modules: `providerKeys`, `pathSafety`, `modelNames`, `llmText`,
  `tokenBudget`, `redact`. Consolidate any duplication you find.
- After each fix: `npm run compile`, then run the affected tests.

### 4. Verify
- `npm run compile`
- `npx vitest run --config tests/vitest.config.ts`
- `npm run lint` (0 errors; pre-existing warnings OK)
- `npm run lint:md`

### 5. Commit
- Commit each iteration with a clear message (`fix(iterN): ...`).
- Update `LOOP-STATE.md` with the new iteration number, findings, and next action.

### 6. Decide to continue or stop
- If the review found **no critical/high findings**, the loop has converged for
  that surface. Record it and either rotate to another subsystem or stop.
- Target: iteration 30, then reassess with the user.

### 7. Release gate + publish (only when the user asks to ship)
- `npm run release:gate`
- Bump version, update README status + CHANGELOG, commit.
- Publish per `docs/plan/LEARNINGS.md` / repo memory (`release-process.md`).

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
- **Request concise subagent output.** In every review prompt, ask for a
  terse report: "one line per finding, file:line, severity, one-line fix. No
  preamble or summary prose." Cap findings to the top N by severity.
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
  fresh session loses nothing: read `LOOP-STATE.md` and continue. Do not try to
  keep the whole loop in one context window.

