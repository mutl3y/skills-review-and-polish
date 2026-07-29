# Batch API Implementation Plan (OpenRouter)

Reference: https://openrouter.ai/docs/batch-quickstart

## What exists today
- `assets/openrouter-catalog.json` — static model catalog (75 models)
- `src/providers/externalProvider.ts` — OpenRouterProvider (single-request HTTP)
- `scripts/e*.mjs` — evaluation scripts use `BATCH_SIZE` for concurrent evaluation batches (not OpenRouter batch endpoint)
- No batch endpoint usage; all calls are synchronous single-request

## What OpenRouter Batch API provides
- Submit batch jobs (multiple requests in one payload)
- Async processing with status polling
- Results retrieved by batch ID
- Cost/time savings for bulk analysis

## Implementation plan (future expansion)
1. Add `BatchRequest` / `BatchResponse` types in `src/core/types.ts`
2. Extend `OpenRouterProvider` with `submitBatch()` and `pollBatch()` methods
3. Create `src/providers/batchProvider.ts` wrapper (optional)
4. Update `assets/openrouter-catalog.json` with batch-capable model flags
5. Modify evaluation scripts (`e30-corpus-scan.mjs`, `e40f-multi-skill-batch.mjs`) to use batch endpoint when `BATCH_SIZE > 1`
6. Add retry / timeout logic for batch polling (reuse `HttpError` from `externalProvider.ts`)
7. Update docs (`docs/ARCHITECTURE.md`) with batch flow diagram

## Blockers / prerequisites
- `OPENROUTER_API_KEY` must support batch endpoint (check OpenRouter docs for tier requirements)
- Batch results format may differ from single-request JSON schema; verify `LLM_RESPONSE_JSON_SCHEMA_BODY` compatibility
- No current user request to implement; this is a planning document for later expansion

## Model capability filter
Not all OpenRouter models support batch mode. Before submitting:
- Filter `assets/openrouter-catalog.json` by a `batchSupported` flag (to be added). Use `/api/beta/batches` endpoint (per error: `This model is only available through the Batch API`).
- For models without batch support, fall back to single-request (`OpenRouterProvider`) or concurrent evaluation (`BATCH_SIZE` in scripts).
- Log skipped models with reason: `batch_not_supported`.
