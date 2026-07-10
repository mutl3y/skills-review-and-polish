# Model Picker Analysis

## Issue Summary

When selecting `nvidia/nemotron-3-super-120b-a12b:free` as the fix model, the extension found the model but rejected it because it has `vendor: 'copilotcli'`.

## Log Analysis

```
2026-07-07 23:10:32.326 [info] selectModel: validating nvidia/nemotron-3-super-120b-a12b:free before saving
2026-07-07 23:10:32.512 [info] selectChatModels({id}) result {"count":1}
2026-07-07 23:10:32.512 [info] model rejected: copilotcli vendor only
2026-07-07 23:10:32.513 [info] complete: no model available {"tier":"fix"}
```

## Current Model Picker Logic (src/extension.ts)

### 1. Fetch Models
- `vscode.lm.selectChatModels()` returns all available models (Copilot + Copilot CLI + OpenRouter via Copilot)
- External models are fetched only when `lmModels.length === 0` AND an API key is configured

### 2. Filter Models
```typescript
const visibleModels = lmModels
  .filter((m) => m.vendor !== 'copilotcli' && !m.id.includes('auto') && !m.name.toLowerCase().includes('auto'))
```
- Filters OUT `copilotcli` vendor models from the picker
- But the validation step still uses `vscode.lm.selectChatModels({ id: picked.modelId })` which CAN find copilotcli models

### 3. Build Picker Items
- Uses `🟢` for `vendor: 'copilot'` models
- Uses `🔵` for other vendors (including OpenRouter models exposed via Copilot)

### 4. Validation
```typescript
const testModels = await vscode.lm.selectChatModels({ id: picked.modelId });
if (testModels.length === 0) { ... }
const preferred = this.findPreferredCopilotModel(byId);
if (!preferred) {
  // Model only available via copilotcli vendor - rejected
}
```

## Root Cause

VS Code's `vscode.lm` API exposes OpenRouter models through the Copilot CLI vendor (`copilotcli`). These models:
1. Appear in `selectChatModels()` results
2. Have no pricing field (or have `copilotcli` vendor)
3. Are filtered out of the picker UI
4. But can still be found during validation via `selectChatModels({ id: ... })`
5. Are rejected because `findPreferredCopilotModel()` only accepts `vendor: 'copilot'`

## Questions for Review

1. Should OpenRouter models exposed via Copilot CLI be supported?
2. If yes, how should they be handled differently from native Copilot models?
3. Should the picker show these models with a different indicator (e.g., `🔵 OpenRouter via Copilot CLI`)?
4. Should the validation step use a different method for OpenRouter models?

## Model List Structure

From `vscode.lm.selectChatModels()`:
- Copilot models: `vendor: 'copilot'`, have pricing field (e.g., `'1x'`, `'3x'`)
- Copilot CLI models: `vendor: 'copilotcli'`, no pricing field
- OpenRouter models via Copilot: `vendor: 'copilotcli'`, no pricing field

## Current Behavior

- Picker shows: Copilot models (🟢) + other non-copilotcli vendors (🔵)
- Validation rejects: Any model where `findPreferredCopilotModel()` returns undefined (i.e., no `vendor: 'copilot'` match)