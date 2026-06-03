# Accessing Model Multipliers

## Quick Reference

### Public API (Recommended)
```typescript
const models = await vscode.lm.getLanguageModels('copilot');
for (const model of models) {
  console.log(`${model.name}: ${model.multiplierNumeric}x`);
  // gpt-5-mini: 0x
  // claude-haiku-4.5: 0.33x
  // gpt-4o-mini: 0x
  // claude-sonnet-4.5: 1x
  // gpt-5: 57x (expensive)
}
```

### Pricing Fields Available
```typescript
model.multiplierNumeric       // 0, 0.33, 1, 57, 27, etc.
model.inputCost               // Per million tokens
model.outputCost              // Per million tokens
model.cacheCost               // Per million cached tokens
model.priceCategory           // Category name
```

## Within Copilot Extension (Internal)

If you're extending the Copilot extension:

```typescript
// Inject IEndpointProvider
const endpoints = await endpointProvider.getAllChatEndpoints();
endpoints.forEach(ep => {
  console.log(`${ep.name}: ${ep.multiplier}x`);
  console.log(`Input: $${ep.tokenPricing?.inputPrice}`);
});
```

## Safe-Tier Models for Testing

Always use these in tests (multiplier ≤ 1x):
- **gpt-5-mini** (0x) — Safe
- **claude-haiku-4.5** (0.33x) — Safe
- **claude-sonnet-4.5** (1x) — Safe

Never use in tests (multiplier > 1x):
- gpt-5 (57x)
- claude-opus (27x)
- gpt-4.1 (3x)

## Data Source

Multipliers come from the Copilot `/models` API endpoint:
```json
{
  "billing": {
    "multiplier": 0.33,
    "token_prices": {
      "input_price": 0.75,
      "output_price": 3.0,
      "cache_price": 0.15
    }
  }
}
```

## Cost Guard Pattern

```typescript
// Never select expensive models in tests
const models = await vscode.lm.selectChatModels({family: 'gpt-4o-mini'});
// Always verify model is safe-tier before using
if (model.multiplierNumeric !== undefined && model.multiplierNumeric > 1) {
  throw new Error(`Attempted to use expensive model: ${model.name} (${model.multiplierNumeric}x)`);
}
```

---

**See:** [DEVELOPMENT-STANDARDS.md](DEVELOPMENT-STANDARDS.md#cost-guardrails) for cost guardrail patterns in testing.
