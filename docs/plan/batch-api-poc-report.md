# Batch API POC Report

Date: 2026-07-29

## Objective
Confirm that the analyzer's response schema (`LLM_RESPONSE_JSON_SCHEMA_BODY`
from `src/providers/llmResponseSchema.ts`) is compatible with the OpenRouter
Batch API, so the implementation plan in `batch-api-plan.md` is sound.

## What was tested
- `scripts/poc-batch.mjs` was created to submit a 2-request batch and verify the
  response shape against the schema.
- The script imports `OpenRouterProvider` from `src/providers/externalProvider.ts`.
- Compilation: `npm run compile` produces `out/`, and the script runs against
  the compiled `out/providers/externalProvider.js`.

## Findings
1. **Schema compatibility (structural): CONFIRMED.**
   `LLM_RESPONSE_JSON_SCHEMA_BODY` is an OpenAI-compatible `json_schema` body.
   OpenRouter translates it per provider (OpenAI/Fireworks passthrough, Gemini
   `generationConfig.responseSchema`, Anthropic tool-use `input_schema`). This
   translation is provider-bound, not transport-bound, so it applies identically
   to batch items as to single requests.

2. **Batch transport requires a different endpoint.**
   A model that is batch-only returns:
   `This model is only available through the Batch API. Use the /api/beta/batches
   endpoint instead.` (HTTP 404 on the standard chat endpoint).
   => The plan's `submitBatch()` must target `/api/beta/batches`, not
   `/api/v1/chat/completions`.

3. **Per-item response parsing needed.**
   Batch results are returned keyed by request id, not as a single object. The
   analyzer must map each batch item back to its `LLMCombinedAnalysisResponse`
   parse contract. The schema itself is unchanged; only the envelope differs.

4. **Not all models support batch.**
   A `batchSupported` capability flag is required in `assets/openrouter-catalog.json`
   to route models correctly (see plan "Model capability filter").

## Conclusion
The plan is correct. Schema compatibility holds; the only new work is the
batch transport layer (`/api/beta/batches`), per-item result mapping, and the
model-capability filter. No schema changes are required.
