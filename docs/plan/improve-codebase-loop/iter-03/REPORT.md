# Iteration 3 — Findings Report (Independent Verification Pass)

Date: 2026-08-09
Reviewer: gilfoyle-code-review-lean (independent flow-trace pass — different
prompt from the loop's module-review lens)
Scope: user-facing flows traced end to end across MCP server + VS Code extension

## Findings

### Accepted & Remediated

### H1 — Medium, High confidence — extension agent LM tools ignore the budget cap setting

`src/extension.ts:2158,2208` (`registerLanguageModelTools` → `analyze`/`fix`)

- Both agent LM tools called `setSessionBudgetCap(resolveMaxTokensPerSession(undefined))`.
  `resolveMaxTokensPerSession(undefined)` honors only the `MCP_MAX_TOKENS` env
  var, then falls back to the 500K default — it never reads the user's
  `skillsReviewAndPolish.mcpMaxTokensPerSession` setting. The MCP door passes
  `cfg.maxTokensPerSession` (same value `syncMcpConfig` writes). So a user who
  sets a cost-control cap (or `0` to disable) has it silently ignored by the
  extension's own agent tools, while the MCP server obeys it. The code comment
  claimed "read from the same MCP_MAX_TOKENS / config source" — it wasn't.
- **Fix:** Both tools now pass `cfg.mcpMaxTokensPerSession` (the analyze tool
  reads `cfg` before the budget call). Two doors now read the same cap.
- **Confidence:** High. Corroborated by reading `extension.ts` call-sites,
  `sessionBudget.ts` (`resolveMaxTokensPerSession`), and `config.ts`
  (`mcpMaxTokensPerSession`).

### Recorded, not remediated

### H2 — Low, Medium confidence — interactive analyze path not budgeted

`src/extension.ts:942` (`analyzeDocument`) vs `src/core/sessionBudget.ts`

- The interactive manual analyze — the primary user-facing flow — never calls
  `budgetExhausted()` / `reserveTokens` / `chargeTokens`. Only the agent LM
  tools and the MCP server enforce the shared budget. Consequences: a heavy
  manual session runs unbounded while the agent path is capped, and manual
  analyses don't charge the shared `_sessionTokens`, so they don't consume the
  same budget that later blocks agent prompts. The "one shared budget" claim
  doesn't hold for the interactive door. Carried forward — remediating changes
  cost behavior and needs deliberate design (budget or document exemption).

### H3 — Low, Medium confidence — concurrent lost-update in accepted-findings store

`src/core/acceptedFindings.ts:165` (`saveAcceptedFindings`)

- The store is a read-modify-write of the whole file. Unique temp-name avoids
  temp-file collision, but two processes (MCP server + extension, both
  supported doors) can each load, append, and write; the last rename clobbers
  the other's entry. An agent accepting a finding while the user accepts
  another in the UI can drop one silently. Low probability but user-visible
  data loss in the dual-door scenario. Carried forward — needs a
  compare-and-swap / lock or merge-on-write.

## Verification (post H1 fix)

- `npm run compile` — PASS
- `npx vitest run --config tests/vitest.config.ts` — 636 passed, 16 skipped
- `npx eslint src/extension.ts` — clean
- `npm run lint:md` — 0 errors

## Artifact trail

- **Modified:** `src/extension.ts` (analyze/fix LM tools pass
  `mcpMaxTokensPerSession` to `setSessionBudgetCap`)
- **Symbols changed:** `registerLanguageModelTools` (analyze/fix invoke),
  `setSessionBudgetCap` (callers), `resolveMaxTokensPerSession` (callers)
