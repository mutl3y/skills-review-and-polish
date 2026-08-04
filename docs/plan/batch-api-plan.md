# Batch API Implementation Plan (OpenRouter)

Reference: <https://openrouter.ai/docs/batch-quickstart>

> **STATUS (2026-08-04): REMOVED.**
> The OpenRouter Batch API mode was **removed entirely** on 2026-08-04. It had
> a 24-hour completion window, was unreliable, and was off by default — not
> worth keeping. The batch code (`src/core/batchTransport.ts`,
> `src/providers/batchAwareProvider.ts`, `src/core/analysisJob.ts`) and the
> `batchEnabled` setting were deleted. The app now uses only synchronous
> single-request analysis. This document is retained as a historical record of
> the feature that existed and why it was removed.

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

## Implementation status (2026-07)

- [x] **Step 1** — `BatchRequestItem`, `BatchSubmission`, `BatchStatus`, `BatchResultItem`, `BatchResult`, `BatchCapableModel` added to `src/core/types.ts`.
- [x] **Step 2** — `submitBatch()` / `pollBatch()` added to `OpenRouterProvider` in `src/providers/externalProvider.ts` (POST/GET `/api/beta/batches`, retryable 5xx/429, terminal-state detection).
- [x] **Step 3 (replaced)** — Instead of a separate `batchProvider.ts`, added `src/core/batchTransport.ts` with `runBatchOrFallback()` that wraps the provider methods with the capability filter + single-request fallback. This keeps the `LlmProvider` interface unchanged (no ripple into `vscodeLmProvider` / `GitHubModelsProvider` / tests).
- [x] **Step 4** — `batchSupported` allowlist array added to `assets/openrouter-catalog.json`; `isBatchSupported()` + `_resetBatchCapabilityCache()` added to `src/modelCatalog.ts`.
- [x] **Step 6** — Retry/timeout logic lives in `pollBatch()` (reuses `HttpError`, `isRetryable`, `sleep` from `externalProvider.ts`); `runBatchOrFallback()` logs `batch_not_supported` / `batch_failed` / `batch_error` and falls back.
- [x] **Step 7** — Batch flow diagram (mermaid) added to `docs/ARCHITECTURE.md`.
- [ ] **Step 5 (optional, future)** — Wire evaluation scripts (`e30-corpus-scan.mjs`, `e40f-multi-skill-batch.mjs`) to call `runBatchOrFallback()` when `BATCH_SIZE > 1`. Deferred: scripts currently use concurrent single-request evaluation which already works; batch transport is opt-in at the analyzer layer.
- [x] **Tests** — `src/core/batchTransport.test.ts` covers fallback (non-capable model), batch success correlation, and fallback on batch failure/throw. Full suite: 571 passed | 16 skipped.
- [x] **MCP batch mode** — `src/mcp/server.ts` exposes `createDefaultEngine()`; `maybeBatchProvider()` wraps the base `OpenRouterProvider` in `BatchAwareOpenRouterProvider` (flushSize 6) when `cfg.batch === true` or `MCP_BATCH_API=1`. `handleAnalyze` calls `config.batchProvider.flush()` after `engine.analyze(...)`. The MCP server therefore uses the **same** `OpenRouterProvider` code as the extension — no separate batch path.
- [x] **Consolidation (no wheel reinvention)** — `BatchAwareOpenRouterProvider` (`src/providers/batchAwareProvider.ts`) no longer re-implements item-building/correlation/fallback. It delegates to `runBatchOrFallback()` from `src/core/batchTransport.ts`. No external OpenRouter/OpenAI SDK is used; raw `fetch` is the correct dependency-free choice.
- [x] **Verification** — `scripts/test-mcp-batch.mjs` drives `createDefaultEngine()` directly (bypassing the MCP protocol's 60s client timeout, which OpenRouter batch jobs exceed) and runs `engine.analyze()` + `batchProvider.flush()`. This proves batch mode works through the MCP server's own engine factory using the same provider code as the extension.

### Usage

```ts
import { runBatchOrFallback } from './core/batchTransport';
const responses = await runBatchOrFallback({
  modelId: 'openai/gpt-4o-mini',
  provider,            // OpenRouterProvider instance
  requests,            // LlmRequest[]
});
```
