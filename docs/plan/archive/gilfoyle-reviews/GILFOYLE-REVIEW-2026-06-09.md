# Gilfoyle Code Review — 2026-06-09

## CRITICAL (5 issues)

### #1: Path traversal via unsanitized `fileName` — `src/core/acceptedFindings.ts:99-120`

- `acceptFinding()` and `filterAcceptedResults()` use `fileName` as JSON key with zero sanitization
- `DEFAULT_ACCEPTED_FINDINGS_PATH` hardcoded to `process.cwd()` — wrong in MCP server context
- **Fix:** Use document URI's relative path, anchor to workspace root

### #2: API keys leaked via error propagation — `src/mcp/server.ts:155-210`

- `createDefaultEngine()` reads env vars for API keys, no redaction in error messages
- `.skills-review.json` parser has no schema validation
- **Fix:** Sanitize error messages, validate config schema

### #3: Model caching without invalidation on sign-out — `src/providers/vscodeLmProvider.ts:29-31`

- `cachedStandard` and `cachedDeep` never invalidated when user signs out
- `invalidate()` exists but never called from extension
- **Fix:** Catch errors from `model.sendRequest()` and call `invalidate()` + retry once

### #4: API key logged in plaintext — `src/providers/externalProvider.ts:47-65`

- `fetchWithRetry` stores `lastError = String(e)` — can include Bearer token echo from proxies
- **Fix:** Sanitize error messages, strip Bearer tokens

### #5: Config re-parsed on every keystroke — `src/config.ts:30`

- `readConfig()` called twice per keystroke, re-parses entire config each time
- **Fix:** Cache config for duration of event loop tick

## HIGH (5 issues)

### #6: Module-level mutable state everywhere — `src/extension.ts:50-62`

- `lastResults`, `debounceTimers`, `fixPreviewContent` etc. — junk drawer
- No cleanup of `fixPreviewContent`, `lastResults` grows unboundedly
- **Fix:** Use a class or single state object, add `onDidCloseTextDocument` handler

### #7: Loop detection is effectively dead — `src/core/analyzer.ts:77`

- `analysisHistory` is per-instance, but new `Analyzer` created per `buildEngine()` call
- History always empty → loop detection never works
- **Fix:** Make `analysisHistory` a singleton/shared state

### #8: Engine rebuilt per analysis — `src/extension.ts:295-330`

- `analyzeDocument()` creates new Engine per call (model selection + 6 LLM waves)
- **Fix:** Cache engine, only rebuild when config changes

### #9: `fixDocument()` applies fixes sequentially on shifting text — `src/core/fixer.ts:820-845`

- Sequential `.replace()` means earlier fixes displace later anchors
- **Fix:** Apply in reverse document order (bottom-up)

### #10: `findTextRange` fallback returns line 0 — `src/core/analyzer.ts`

- When LLM returns non-existent `relevant_text`, fallback highlights line 0
- **Fix:** Return "not found" sentinel, let caller decide

## MEDIUM (8 issues)

### #11: Duplicate `ModelPricing` interface — `src/pricing.ts:25` vs `src/copilotPricing.ts:12`

- Two different shapes with same name
- **Fix:** Rename to `CopilotModelPricing`

### #12: `simpleGlobMatch` regex fallback is incomplete — `src/config.ts:86-97`

- **Fix:** Remove the fallback, report malformed globs

### #13: Prompt injection defense is fragile — `src/core/analyzer.ts`

- Tag stripping doesn't prevent crafted content
- **Fix:** Document threat model, consider better delimiter scheme

### #14: `SurgicalFixer` created on every cursor position — `src/ui/inlineRewrites.ts`

- No dedup, no cache, no debounce → dozens of LLM calls
- **Fix:** Add debounce, cache by (URI, code, anchor)

### #15: `handleFix` synthetic range always line 0 — `src/mcp/server.ts:58-72`

- **Fix:** Accept optional `line` parameter

### #16: `cognitiveDowngrade` set hardcoded — `src/core/scoring.ts:92-96`

- Drifts from analyzer's code generation
- **Fix:** Export from types.ts or derive from analyzer

### #17: Folder analysis not cancellable per-file — `src/extension.ts`

- **Fix:** Pass cancellation token to `analyzeDocument`

### #18: N+1 model selection — `src/providers/vscodeLmProvider.ts`

- **Fix:** Call `selectChatModels()` once, filter in-memory

## LOW (5 issues)

### #19: `formatLine` JSON.stringify can throw on circular refs — `src/core/logger.ts`

- **Fix:** Wrap in try-catch

### #20: `deactivate()` doesn't clear all Maps — `src/extension.ts`

- **Fix:** Clear all Maps

### #21: `loadPrompt` uses `__dirname` — `src/core/prompts.ts:6`

- **Fix:** Use `import.meta.url`

### #22: Redundant path checks — `src/config.ts`

- **Fix:** Remove hardcoded checks or document

### #23: `meaningPreservationReject` counts raw newlines — `src/core/fixer.ts`

- **Fix:** Compare trimmed content
