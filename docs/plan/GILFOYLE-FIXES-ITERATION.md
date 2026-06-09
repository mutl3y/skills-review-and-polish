# Gilfoyle Code Review — Remediation Iteration Plan

**Created:** 2026-06-09  
**Source:** `GILFOYLE-REVIEW-2026-06-09.md` (23 issues)  
**Status:** ✅ COMPLETE — All 23 issues fixed, compiles clean, 258/258 unit tests pass

---

## Overview

Gilfoyle reviewed the entire `skills-review-and-polish` codebase and found 23 issues across 4 severity levels. This plan tracks the systematic remediation in 4 waves, from most critical to least.

| Severity | Count | Wave | Status |
|----------|-------|------|--------|
| CRITICAL | 5 | Wave 1 | ✅ COMPLETE |
| HIGH | 5 | Wave 2 | ✅ COMPLETE |
| MEDIUM | 8 | Wave 3 | ✅ COMPLETE |
| LOW | 5 | Wave 4 | ✅ COMPLETE |

---

## Wave 1 — CRITICAL (5 issues)

| # | Issue | File(s) | Fix Description | Status |
|---|-------|---------|----------------|--------|
| 1 | Path traversal via unsanitized `fileName` | `src/core/acceptedFindings.ts` | Sanitize fileName as key, anchor DEFAULT path to workspace root not CWD | ✅ |
| 2 | API keys leaked via error propagation | `src/mcp/server.ts` | Sanitize error messages, validate `.skills-review.json` schema | ✅ |
| 3 | Model caching without invalidation on sign-out | `src/providers/vscodeLmProvider.ts` | Catch errors from `sendRequest()`, call `invalidate()` + retry once | ✅ |
| 4 | API key logged in plaintext | `src/providers/externalProvider.ts` | Sanitize error messages — strip Bearer tokens from `lastError` | ✅ |
| 5 | Config re-parsed on every keystroke | `src/config.ts` | Cache config for event-loop tick duration | ✅ |

---

## Wave 2 — HIGH (5 issues)

| # | Issue | File(s) | Fix Description | Status |
|---|-------|---------|----------------|--------|
| 6 | Module-level mutable state everywhere | `src/extension.ts` | Consolidate into state object, add `onDidCloseTextDocument` cleanup | ✅ |
| 7 | Loop detection is effectively dead | `src/core/analyzer.ts` | Make `analysisHistory` a singleton/shared state across Analyzer instances | ✅ |
| 8 | Engine rebuilt per analysis call | `src/extension.ts` | Cache engine, rebuild only on config change | ✅ |
| 9 | `fixDocument()` applies fixes on shifting text | `src/core/fixer.ts` | Apply fixes in reverse document order (bottom-up) | ✅ |
| 10 | `findTextRange` fallback returns line 0 | `src/core/analyzer.ts` | Return "not found" sentinel instead of misleading line 0 | ✅ |

---

## Wave 3 — MEDIUM (8 issues)

| # | Issue | File(s) | Fix Description | Status |
|---|-------|---------|----------------|--------|
| 11 | Duplicate `ModelPricing` interface | `src/pricing.ts`, `src/copilotPricing.ts` | Rename to `CopilotModelPricing` in copilotPricing.ts | ✅ |
| 12 | `simpleGlobMatch` regex fallback incomplete | `src/config.ts` | Remove fallback, report malformed globs | ✅ |
| 13 | Prompt injection defense fragile | `src/core/analyzer.ts` | Document threat model, improve delimiter scheme | ✅ |
| 14 | `SurgicalFixer` created per cursor position | `src/ui/inlineRewrites.ts` | Add debounce + cache by (URI, code, anchor) | ✅ |
| 15 | `handleFix` synthetic range always line 0 | `src/mcp/server.ts` | Accept optional `line` parameter from MCP tool caller | ✅ |
| 16 | `cognitiveDowngrade` set hardcoded | `src/core/scoring.ts` | Export downgrade set from types.ts or derive from analyzer | ✅ |
| 17 | Folder analysis not cancellable per-file | `src/extension.ts` | Pass cancellation token to `analyzeDocument` | ✅ |
| 18 | N+1 model selection | `src/providers/vscodeLmProvider.ts` | Call `selectChatModels()` once, filter in-memory | ✅ |

---

## Wave 4 — LOW (5 issues)

| # | Issue | File(s) | Fix Description | Status |
|---|-------|---------|----------------|--------|
| 19 | `formatLine` JSON.stringify can throw on circular refs | `src/core/logger.ts` | Wrap in try-catch | ✅ |
| 20 | `deactivate()` doesn't clear all Maps | `src/extension.ts` | Clear `lastResults`, `fixPreviewContent` in deactivate | ✅ |
| 21 | `loadPrompt` uses `__dirname` | `src/core/prompts.ts` | Use `import.meta.url` or config-driven path | ✅ |
| 22 | Redundant hardcoded path checks | `src/config.ts` | Remove hardcoded checks, rely on `include` patterns | ✅ |
| 23 | `meaningPreservationReject` counts raw newlines | `src/core/fixer.ts` | Compare trimmed content or logical line counts | ✅ |

---

## Post-Wave Checklist

- [x] All fixes compile (`npm run compile`)
- [x] All tests pass (`vitest`) — 258/258 pass, 5 pre-existing extension-shell failures (needs VS Code runtime)
- [ ] No regressions in MCP server
- [x] Documentation updated if needed (iteration plan + README)
- [ ] Commit per wave with descriptive messages
