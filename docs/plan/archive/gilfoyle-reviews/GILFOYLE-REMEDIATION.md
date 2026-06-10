# Gilfoyle Code Review Remediation Plan

**Created:** 2026-06-09  
**Source:** Gilfoyle Code Review — `skills-review-and-polish`  
**Overall Grade:** B- (30 issues found)

## Wave 1 — Critical & High (9 issues)

| # | Severity | Issue | File | Fix |
|---|----------|-------|------|-----|
| 1 | 🔴 Critical | Dead code / redundant pricing data | `src/copilotPricing.ts` | Delete file, update any imports |
| 2 | 🔴 Critical | Module-level mutable state (8+ vars) | `src/extension.ts` | Extract into `ExtensionState` class |
| 3 | 🔴 Critical | `analysisHistory` static map — memory leak | `src/core/analyzer.ts` | Add LRU eviction / clear on deactivate |
| 4 | 🟠 High | Config cache via `setTimeout(…, 0)` fragile | `src/config.ts` | Use `onDidChangeConfiguration` |
| 5 | 🟠 High | `buildEngine()` cache doesn't invalidate on API key change | `src/extension.ts` | Include API key hash in config hash |
| 6 | 🟠 High | `findTextRange` naive substring matching | `src/core/analyzer.ts` | Improve with token-overlap scoring |
| 7 | 🟠 High | `loadReferenceGrounding` synchronous fs calls | `src/core/fixer.ts` | Convert to `fs.promises` |
| 8 | 🟠 High | HTML scraper fragile regex parsing | `src/pricing.ts` | Remove HTML scraping, use static data |
| 9 | 🟠 High | `createDefaultEngine` reads files synchronously | `src/mcp/server.ts` | Use `fs.promises.readFile` |

## Wave 2 — Medium (9 issues)

| # | Severity | Issue | File | Fix |
|---|----------|-------|------|-----|
| 10 | 🟡 Medium | `testModelSimplePrompt` 120+ lines untestable | `src/extension.ts` | Extract to separate module |
| 11 | 🟡 Medium | Duplicate analyze→score chain | `src/core/index.ts` | Remove redundant public `score()` |
| 12 | 🟡 Medium | `meaningPreservationReject` magic strings | `src/core/fixer.ts` | Use enum/discriminated union |
| 13 | 🟡 Medium | `salvageTruncatedJSON` hand-rolled parser | `src/core/analyzer.ts` | Add comment + tighten max_tokens |
| 14 | 🟡 Medium | `showFixDiff` race condition | `src/extension.ts` | Add file-level locking |
| 15 | 🟡 Medium | `waves` cast unchecked | `src/config.ts` | Validate against ALL_WAVES |
| 16 | 🟡 Medium | Empty response returns `'{}'` silently | `src/providers/vscodeLmProvider.ts` | Return empty string, let analyzer throw |
| 17 | 🟡 Medium | Levenshtein O(n×m) unoptimized | `src/core/analyzer.ts` | Use token Jaccard similarity |
| 18 | 🟡 Medium | Bearer token exposure in errors | `src/providers/externalProvider.ts` | Broaden sanitization |

## Wave 3 — Low & Nit (12 issues)

| # | Severity | Issue | File | Fix |
|---|----------|-------|------|-----|
| 19 | 🔵 Low | `console.error` as default logger transport | `src/core/logger.ts` | Document / add noop default |
| 20 | 🔵 Low | `LLMCombinedAnalysisResponse` god interface | `src/core/types.ts` | Split into per-wave types |
| 21 | 🔵 Low | Grade threshold naming confusing | `src/core/scoring.ts` | Rename `thresholdOffset` |
| 22 | 🔵 Low | `DEFAULT_ACCEPTED_FINDINGS_PATH` uses `process.cwd()` | `src/core/acceptedFindings.ts` | Fix to use workspace root |
| 23 | 🔵 Low | Non-atomic MCP config write | `src/extension.ts` | Validate same filesystem |
| 24 | 🔵 Low | `expandToParagraph` naive paragraph detection | `src/core/fixer.ts` | Handle markdown separators |
| 25 | 🔵 Low | MCP server hardcodes `additive: true` | `src/mcp/server.ts` | Read from config |
| 26 | 🔵 Nit | `extension.ts` 1200+ lines God Module | `src/extension.ts` | Extract modules (deferred) |
| 27 | 🔵 Nit | Tests access private methods via `as any` | `src/core/analyzer.test.ts` | Test via public API |
| 28 | 🔵 Nit | `__dirname` assumption in prompts.ts | `src/core/prompts.ts` | Use config-driven path |
| 29 | 🔵 Nit | `formatPerM` vs `formatPerMillion` inconsistency | `src/copilotPricing.ts` | Consolidate (done if #1 deletes file) |
| 30 | 🔵 Nit | MCP server default engine sync read | `src/mcp/server.ts` | (covered in #9) |

## Execution Status

- [ ] Wave 1 — Critical & High (9 issues)
- [ ] Wave 2 — Medium (9 issues)
- [ ] Wave 3 — Low & Nit (10 unique issues)

## Delegation

| Wave | Agent | Tasks |
|------|-------|-------|
| 1 | `gem-implementer` | #1–#9 (Critical + High) |
| 2 | `gem-implementer` | #10–#18 (Medium) |
| 3 | `gem-implementer` | #19–#30 (Low + Nit, deduplicated) |
| All | `gem-reviewer` | Review after each wave |
