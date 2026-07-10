# Model Pricing

> How the extension fetches and displays per-token model pricing in the model
> picker. **Read this before debugging "missing prices" or pricing regressions.**

## Overview

The model picker shows a cost hint (`💰 $X.XX/M in, $X.XX/M out`) next to each
model. Pricing comes from two independent sources that are merged into a single
`Map<string, ModelPricing>` by [`fetchPricing()`](../src/pricing.ts):

| Source | Endpoint | Auth | Notes |
|--------|----------|------|-------|
| **Copilot** | `https://github.com/features/copilot/plans` HTML table | None | Scraped from the public Copilot plans page. Includes cached-input pricing. |
| **OpenRouter** | `https://openrouter.ai/api/v1/models` | None (public) | Returns ~340 models with per-token USD pricing. |

Both sources are fetched in parallel via `Promise.allSettled` — if one fails,
the other is still used. No API key is required for either source.

## Data format

### Copilot pricing (HTML scrape)

The Copilot plans page contains a table with columns like `Model`, `Input`,
`Cached input`, `Output`. The scraper extracts each row into:

```ts
{ input: 0.25, output: 2.0, cached: 0.05, source: 'copilot' }
```

Prices are in **USD per million tokens**.

### OpenRouter pricing (JSON API)

The `/api/v1/models` endpoint returns:

```json
{
  "data": [
    {
      "id": "openai/gpt-4o-mini",
      "name": "OpenAI: GPT-4o Mini",
      "pricing": {
        "prompt": "0.00000015",
        "completion": "0.0000006"
      }
    }
  ]
}
```

Key fields:

- **`id`** — canonical model identifier (e.g. `openai/gpt-4o-mini`, `poolside/laguna-xs-2.1:free`)
- **`name`** — display name (e.g. `OpenAI: GPT-4o Mini`, `Poolside: Laguna XS 2.1 (free)`)
- **`pricing.prompt`** / **`pricing.completion`** — per-token USD cost as a **string**

> **⚠️ Per-token, not per-million.** OpenRouter returns per-token prices.
> The parser multiplies by `1_000_000` to convert to per-million-token for
> display consistency with the Copilot source. This conversion happens in
> `parseOpenRouterResponse()` in `src/pricing.ts`.

### OpenRouter edge cases

OpenRouter has several model name conventions that can trip up matching:

| Pattern | Example | Notes |
|---------|---------|-------|
| `:free` suffix in ID | `meta-llama/llama-3-8b:free` | The `:free` is part of the ID, not a separator. |
| `~` prefix in ID | `~anthropic/claude-fable-latest` | Tilde-prefixed IDs are aliases/redirects. |
| `:` in display name | `OpenAI: GPT-4o Mini` | Vendor prefix uses colon, not slash. |
| `(free)` suffix in name | `Llama 3 8B (free)` | Display name includes parenthetical. |
| Mixed-case vendor | `TheDrummer: Cydonia 24B V4.1` | Vendor prefix in name is camelCase, ID is lowercase. |
| Space in name (no colon) | `OpenAI GPT Mini Latest` | Some models omit the colon separator. |

The pricing lookup normalizes all of these — see "Model name matching" below.

## Model name matching

The extension uses [`pricingForModel()`](../src/extension.ts) to look up pricing
for a model given its `name` (as returned by `vscode.lm`). The lookup tries four
strategies in order:

1. **Exact match** on the full name (e.g. `OpenAI: GPT-4o Mini`)
2. **Normalized match** — lowercased, vendor prefix stripped (e.g. `gpt-4o mini`)
3. **ID-based match** — strips vendor prefix from the name and tries again
4. **Substring match** — normalizes separators (`:` `/` `_` `-` → space) and
   strips parentheticals like `(free)`, then checks if either string contains
   the other. Picks the **longest matching key** to prefer more specific matches.

`normalizeModelName()` in `src/pricing.ts` handles the normalization:

- Lowercases the input
- Strips vendor prefixes (`openai/`, `anthropic/`, `poolside/`, `nvidia/`, etc.) — note the `[\/:]` matches **both** slash and colon as separators
- Collapses whitespace

## Caching

Pricing data is cached to avoid hitting the network on every picker open.

| Cache | TTL | Location | Cleared by |
|-------|-----|----------|------------|
| In-memory | 1 hour | Module-level `Map` | Extension reload |
| Disk | 15 minutes | `os.tmpdir()/skills-review-and-polish-openrouter-pricing-cache-v1.json` | Manual delete / TTL expiry |

The disk cache uses a CRC-32 checksum to detect upstream payload changes.

## Troubleshooting

### "OpenRouter-only models show no pricing"

**Symptom:** Models that are also in Copilot show `💰 $X.XX/M in` correctly.
Models that exist *only* on OpenRouter show `❓ cost unknown`.

**Root cause — stale/corrupt disk cache.** The OpenRouter pricing fetch is
network-bound and cached to disk for 15 minutes. If the cache file was written
by a test run (which uses a mock that returns 1–2 models instead of ~340),
all subsequent fetches within the TTL will return the truncated dataset.

**Self-healing (v0.1.32+):** The extension now validates cache size on read
and refuses to load caches with fewer than 100 entries. Corrupt caches are
deleted automatically and a fresh network fetch is performed. You should
not need to manually delete the cache after v0.1.32.

**Manual diagnostic steps** (if self-healing doesn't trigger):

1. Check the cache file size and entry count:

   ```bash
   cat /tmp/skills-review-and-polish-openrouter-pricing-cache-v1.json | jq '.entries | length'
   ```

   A healthy cache has ~1000 entries (340 models × 3 keys each: ID, name, normalized name).
   A corrupt cache from test mocks has 3–6 entries.

2. Check the raw API response directly:

   ```bash
   curl -s https://openrouter.ai/api/v1/models | jq '.data | length'
   ```

   This should return ~340–350 models. All of them have a `pricing` object.

3. Check the extension logs for the pricing map size:

   ```text
   selectModel: fetched N pricing entries, M vscode.lm models, K external models
   ```

   A healthy `N` is ~1000+.

**Manual fix** (only needed if self-healing is somehow bypassed):

```bash
rm /tmp/skills-review-and-polish-openrouter-pricing-cache-v1.json
# Then: Ctrl+Shift+P → Developer: Reload Window
```

### "Model names have `:` vs `/` mismatches"

**Symptom:** Substring matching fails because OpenRouter IDs use `/` (e.g.
`poolside/laguna-xs-2.1:free`) but display names use `:` (e.g.
`Poolside: Laguna XS 2.1 (free)`).

**Already handled.** The substring matching normalizes all of `:`, `/`, `_`, `-`
to spaces before comparison. See `pricingForModel()` in `src/extension.ts`.

### "Free models show $0.00 pricing"

This is **correct behavior**. OpenRouter marks free models with
`"prompt": "0"`, `"completion": "0"`. The parser preserves these as
`{ input: 0, output: 0 }` and they display as `$0.00/M in, $0.00/M out`.

## Debug logging

The model picker logs useful diagnostics at `debug` level. Set
`skillsReviewAndPolish.logLevel` to `"debug"` in VS Code settings, then open
**Output > Skills Review** to see:

```text
selectModel: fetched 1029 pricing entries, 293 vscode.lm models, 0 external models
selectModel: filtered 275 models, dropped 18 models - dropped: ...
```

The `Skills Review: Inspect Models (Debug)` command dumps the raw model list
from `vscode.lm` (id, vendor, name) to the output channel — useful for
comparing what VS Code reports vs what the pricing data has.
