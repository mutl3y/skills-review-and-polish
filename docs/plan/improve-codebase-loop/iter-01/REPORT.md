# Iteration 1 — Findings Report

Date: 2026-08-08
Reviewer: gilfoyle-code-review (broad whole-codebase scan)
Scope: MCP server + VS Code extension reviewed together (shared security logic)

## Findings

### Accepted & Remediated

**F1 — Medium/High, High confidence — `src/extension.ts` `fix` LM tool under-counts waves for additive ambiguity fixes**
- The extension computed `fixWaves = 1 + (fixSemanticCheck?1:0) + (fixSelfCritique?1:0)`, but the fixer forces self-critique for additive `ambiguity-llm` fixes regardless of config (`src/core/fixer.ts`). The MCP `handleFix` accounted for this; the extension did not, so the two doors charged the shared session budget differently for the same operation.
- **Fix:** Added shared `estimateFixWaveCount()` in `src/core/waveCount.ts`; both `src/mcp/server.ts` and `src/extension.ts` now use it.

**F2 — Medium/High, High confidence — `src/extension.ts` `analyze` LM tool hardcodes `ALL_WAVES.length` (6) for budget**
- The MCP `handleAnalyze` uses `estimateWaveCount()` (1 for single, 2 for focused, else enabledWaves.length). The extension always reserved/charged 6 waves regardless of `analysisMode`, over-charging the shared budget up to 6× in single-pass mode.
- **Fix:** Added shared `estimateWaveCount()` in `src/core/waveCount.ts` (moved from MCP server's local copy); the extension's `analyze` tool now uses it.

**F3 — Medium, Medium confidence — `src/extension.ts:201` `workspaceFolderForPath` falls back to `process.cwd()`**
- `safeResolveFilePathShared(vscode.workspace.rootPath || process.cwd(), filePath)` — in multi-root, `rootPath` is undefined so containment resolved against an unrelated cwd, contradicting the fail-closed philosophy in `safeResolveFilePathForTools`.
- **Fix:** Resolve against each workspace folder's own root; fail closed (return undefined) when the path escapes every root.

**F4 — Low, Medium confidence — `.github/copilot-instructions.md` bare URL (MD034)**
- Surfaced by `npm run lint:md` during verification. Pre-existing in baseline commit.
- **Fix:** Wrapped URL in angle brackets.

### Recorded, not remediated

**F5 — Low, Medium confidence — accepted-findings path roots differ between MCP and extension by design**
- MCP resolves `.accepted-findings.json` under `MCP_SERVER_WORKSPACE || process.cwd()`; extension resolves under the workspace folder. Different trust boundaries — divergence is intentional. Reviewer flagged it as "not a defect per se". Carried forward as a documentation note; not remediated this iteration.

## Verification

- `npm run compile` — PASS
- `npx vitest run --config tests/vitest.config.ts` — 636 passed, 16 skipped
- `npm run lint` — 0 errors (6 pre-existing warnings, none in changed files)
- `npm run lint:md` — 0 errors (fixed the one pre-existing MD034)

## Artifact trail

- **Created:** `src/core/waveCount.ts` (estimateWaveCount, estimateFixWaveCount), `src/core/waveCount.test.ts`
- **Modified:** `src/core/index.ts` (export waveCount), `src/mcp/server.ts` (use shared estimators, remove local estimateWaveCount), `src/extension.ts` (use shared estimators in analyze/fix LM tools; fail-closed workspaceFolderForPath), `src/mcp/server.test.ts` (add estimateWaveCount/estimateFixWaveCount to core mock), `.github/copilot-instructions.md` (bare URL fix)
- **Symbols changed:** `estimateWaveCount`, `estimateFixWaveCount`, `workspaceFolderForPath`, `safeResolveFilePathForTools` (callers), `handleFix`, `handleAnalyze`
