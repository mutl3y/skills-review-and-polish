# Gilfoyle Code Review — 2026-06-09 (Fresh Review)

**Review Date:** 2026-06-09
**Reviewer:** Gilfoyle Code Review Mode
**Status:** COMPLETE

---

## CRITICAL (3 issues)

### 1. `String.replace()` Used as Anchored Text Replacement — Silent Data Corruption

**File:** `src/core/fixer.ts:812-814`, `src/extension.ts:595`

`String.replace()` with a string first argument replaces only the **first occurrence**. If the anchor text appears multiple times, you corrupt the document by replacing the wrong instance. Additionally, `$` characters in replacement text (`$&`, `$'`, `` $` ``) are interpreted as replacement patterns, silently corrupting output.

**Fix:** Use `replaceAll()` with exact anchor, or compute character offsets. Escape replacement strings or use a function as the second arg.

### 2. `loadPrompt()` — No Error Handling on Critical File I/O at Module Load Time

**File:** `src/core/prompts.ts:20`

Prompts loaded at module import time via `const` declarations. If any `.md` file is missing, malformed, or path is wrong after bundling, the entire module throws and the extension refuses to activate.

**Fix:** Lazy-load prompts on first use with graceful fallback to built-in defaults. Wrap in try/catch.

### 3. Extension-Level Mutable State — No Protection Against Concurrent Analyses

**File:** `src/extension.ts:64-71`

Module-level mutable state (`lastResults`, `debounceTimers`, `fixPreviewContent`) with zero locking. Concurrent analyses for the same URI cause race conditions — second call overwrites `lastResults` mid-fix.

**Fix:** Add per-URI analysis locks (e.g., `Map<string, Promise>`) to serialize concurrent analyses.

---

## HIGH (7 issues)

### 4. `DEFAULT_ACCEPTED_FINDINGS_PATH` Uses `process.cwd()` — Wrong Path in Extension Host

**File:** `src/core/acceptedFindings.ts:38`

In the VS Code extension host, `process.cwd()` is the Electron binary directory, not the workspace root.

**Fix:** Pass workspace root URI from `vscode.workspace.workspaceFolders[0].uri.fsPath`.

### 5. `fixPreviewContent` Map — Memory Leak on Large Documents

**File:** `src/extension.ts:71, 705-706`

Entire original and fixed document text stored per diff. Old entries never evicted. Cleanup uses path prefix match that could delete wrong entries.

**Fix:** LRU cache with max size, or clear all entries for URI before storing new ones.

### 6. `SurgicalFixer.fixIssue()` — `$` Replacement Pattern Corruption

**File:** `src/extension.ts:589-595`

`fixResult.fixed` containing `$` characters is interpreted as replacement patterns by `String.replace()`.

**Fix:** Use function as second argument: `text.replace(anchor, () => fixResult.fixed)`.

### 7. `VsCodeLmProvider` — Model Reference Not Disposed on Retry

**File:** `src/providers/vscodeLmProvider.ts:240-302`

On retry path, old model reference is never released — no `model.dispose()` call. VS Code language model objects may hold native resources.

### 8. `syncMcpConfig()` — Race Condition on Config File Write

**File:** `src/extension.ts:948-949`

`writeFileSync` + `renameSync` is not atomic across filesystems. Multiple VS Code windows race on the same `.skills-review.json` file.

### 9. `loadReferenceGrounding()` — Path Traversal via `references/` Directory

**File:** `src/core/fixer.ts:155-195`

`readdirSync` + `readFileSync` reads any file in `references/` directory. Symlinks could point to sensitive files, fed to LLM as context.

**Fix:** Validate resolved paths stay within expected directory boundary. Reject symlinks.

### 10. MCP Server — `DEFAULT_ACCEPTED_FINDINGS_PATH` Resolves to Wrong Location

**File:** `src/mcp/server.ts:93`

MCP server's `DEFAULT_ACCEPTED_FINDINGS_PATH` uses `process.cwd()`, not workspace root.

**Fix:** Use `MCP_SERVER_WORKSPACE` env var for the path.

---

## MEDIUM (9 issues)

### 11. `EngineConfig` Interface Defined Twice — Divergence Risk

**Files:** `src/core/types.ts` and `src/mcp/server.ts:15-19`

Two different `EngineConfig` interfaces — someone will import the wrong one.

### 12. `analyzeDocument()` Calls `out.show(false)` — Output Panel Steals Focus

**File:** `src/extension.ts:411`

Resizes editor to make room for output panel, causing flicker during onType analysis.

### 13. `readConfig()` Called Repeatedly Without Caching

**File:** `src/extension.ts` (multiple locations)

Config read on every keystroke, save, command, and multiple times within `analyzeDocument()`.

### 14. `findTextRange()` — Trivially Wrong Fallback for Empty Search

**File:** `src/core/analyzer.ts:644-646`

Empty `relevantText` pins diagnostic to entire first line — actively harmful.

**Fix:** Return `null` instead of fallback range.

### 15. `salvageTruncatedJSON()` — Only Handles First Array Key

**File:** `src/core/analyzer.ts:680-720`

Only recovers first array from truncated JSON. 30-40% of results silently dropped.

### 16. `parseCopilotHtml()` — HTML Scraping as Pricing Source is Fragile

**File:** `src/pricing.ts:130-200`

Any CSS class change breaks pricing silently.

### 17. `expandToParagraph()` — Whitespace-Normalized Match Can Match Wrong Location

**File:** `src/core/fixer.ts:222-260`

Regex collapses all spaces to `\s+`, can match wrong paragraph on large documents.

### 18. `computeConfigHash()` — Incomplete Hash

**File:** `src/extension.ts:78-80`

Missing: `analysisMode`, `enabledWaves`, `fixStrategy`, `fixSemanticCheck`, etc. Changing these won't rebuild engine.

### 19. `testModelSimplePrompt()` — External Provider Not Tested

**File:** `src/extension.ts:988-998`

Test function only works with `vscode-lm`. External providers can't be tested.

---

## LOW (6 issues)

### 20. Duplicate Comment Block in `analyzer.ts`

**File:** `src/core/analyzer.ts:86-91`

Copy-paste artifact — two identical comment blocks.

### 21. Duplicate Pricing Data

**Files:** `src/copilotPricing.ts` and `src/pricing.ts`

Same data in two files — will drift.

### 22. `tokenPresent()` — Regex Word Boundary Issue

**File:** `src/core/fixer.ts:44-47`

`\b` doesn't work correctly with tokens containing non-word characters.

### 23. `isFindingAccepted()` — Bi-Directional Matching Too Permissive

**File:** `src/core/acceptedFindings.ts:113-125`

Short accepted patterns suppress virtually everything.

### 24. `statusBar.showError()` — Raw Error Message in Tooltip

**File:** `src/ui/statusBar.ts:43-45`

API keys/bearer tokens could appear in tooltip.

### 25. `inlineRewrites.ts` — Fix Cache Never Evicts by Size

**File:** `src/ui/inlineRewrites.ts:22`

TTL-based eviction only; entries never accessed again stay forever.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH | 7 |
| MEDIUM | 9 |
| LOW | 6 |
| **Total** | **25** |
