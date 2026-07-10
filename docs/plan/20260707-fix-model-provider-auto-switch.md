# Fix Model Provider Auto-Switch Plan

## Problem

When selecting `poolside/laguna-m.1` (Poolside: Laguna M.1) as the fix model:
1. The provider auto-switched from `vscode-lm` to `openrouter` (correct behavior)
2. But when fix is called, it fails because no API key is configured for OpenRouter
3. The fix operation shows "no model available" and "all 2 skipped by safety guards"

## Log Analysis

```
2026-07-07 23:24:30.685 [info] selectModel: auto-switched provider from vscode-lm to openrouter
2026-07-07 23:24:30.685 [info] selectModel: model = poolside/laguna-m.1 (Poolside: Laguna M.1) — validated ✓
2026-07-07 23:24:45.770 [info] buildEngine: provider=openrouter standardModel=poolside/laguna-m.1 deepModel=(none)
2026-07-07 23:24:45.770 [warning] buildEngine: openrouter selected but no API key — aborting
2026-07-07 23:24:45.771 [error] analyzeDocument: ERROR — No API key configured for provider "openrouter"
```

## Root Cause

1. **Auto-switch works correctly** - `poolside/laguna-m.1` triggered provider switch to `openrouter`
2. **But no API key warning** - The model selection succeeded without warning about missing API key
3. **Fix fails silently** - When fix is called, `buildEngine` throws because no API key

## Key Questions

1. **Why did `nvidia/nemotron-3-super-120b-a12b:free` get rejected as copilotcli?**
   - This model appeared in the picker but has `vendor: 'copilotcli'`
   - The picker filter `.filter((m) => m.vendor !== 'copilotcli')` should have excluded it
   - Was this a different selection attempt?

2. **Should we warn at selection time when auto-switching to openrouter without API key?**
   - Currently: Model is saved, provider is switched, but no warning
   - Proposed: Show warning "Switched to OpenRouter provider - please configure API key"

3. **Should we fall back to the analysis model when fix model fails?**
   - If fix model selection fails, should we use the analysis model instead?
   - This would allow the fix to proceed with a working model

## Proposed Solution

### Phase 1: Warn at Selection Time
When auto-switching to `openrouter` but no API key is configured:
- Show a warning message after model selection
- Still save the model (for MCP sync)
- Let user know they need to configure API key

### Phase 2: Fall Back to Analysis Model for Fix
When fix model fails to resolve:
- Fall back to using the analysis model
- Log the fallback for debugging
- This ensures fix can proceed if analysis model works

### Phase 3: Handle copilotcli Models in Picker
Investigate why `nvidia/nemotron-3-super-120b-a12b:free` appeared in picker:
- Check if vendor detection is correct
- Consider showing copilotcli models with clear indicator
- Or ensure they are properly filtered

## Files to Review

1. `src/extension.ts` - Auto-switch logic (line ~1415)
2. `src/extension.ts` - Model picker filtering (line ~1330)
3. `src/extension.ts` - `syncMcpConfig` writes fixModel to `.skills-review.json`
4. `src/providers/vscodeLmProvider.ts` - Model validation and selection
5. `src/core/fixer.ts` - Fix model tier handling

## Test Coverage Needed

1. Fix model auto-switch to openrouter provider
2. Fix model auto-switch to vscode-lm provider
3. Warning message when switching to openrouter without API key