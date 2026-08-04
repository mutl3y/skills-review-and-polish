/**
 * Batch transport orchestration for the OpenRouter Batch API.
 *
 * Wraps `OpenRouterProvider.submitBatch` / `pollBatch` with a model-capability
 * filter and a single-request fallback so the analyzer can submit a wave's
 * requests as a batch when the model supports it, and transparently fall back
 * to concurrent single requests otherwise.
 *
 * Capability is decided by `modelCatalog.isBatchSupported(modelId)` (the
 * `batchSupported` allowlist in `assets/openrouter-catalog.json`). When a
 * model is not batch-capable — or when a batch submission fails in a way that
 * indicates the model is batch-only on the wrong endpoint — we fall back to
 * `provider.complete` per request and log `batch_not_supported`.
 *
 * @module batchTransport
 */

import { LlmProvider, LlmRequest, LlmResponse, BatchRequestItem, BatchResultItem } from './types';
import { isBatchSupported } from '../modelCatalog';

/**
 * Warning surfaced to models/users when batch (slow) mode is active.
 *
 * Critical: without this, a model sees "no result yet" and re-calls `analyze`,
 * submitting duplicate (paid) OpenRouter Batch jobs. The warning must fire
 * immediately on submission — before the wait — on both the MCP and UI
 * surfaces, and must tell the caller NOT to resubmit.
 */
export function batchModeWarning(modelId: string, estSec = 300): string {
  const who = modelId ? ` for ${modelId}` : '';
  return `Batch (slow) mode active${who}. OpenRouter Batch API jobs take ~${estSec}s to finalize — results are NOT ready yet. Do NOT re-call analyze (that submits a duplicate batch). Poll for completion.`;
}

/** Options for {@link runBatchOrFallback}. */
export interface BatchRunOptions {
  /** Model ID used for every request in the batch. */
  modelId: string;
  /** Provider instance (must expose submitBatch/pollBatch for batch path). */
  provider: OpenRouterBatchCapableProvider;
  /** Requests to run. */
  requests: LlmRequest[];
  /** Cancellation token, forwarded to provider calls. */
  token?: LlmRequest['token'];
  /** Poll interval for batch status (ms). Default 2000. */
  pollIntervalMs?: number;
  /** Max wait for batch completion (ms). Default 10 min. */
  maxWaitMs?: number;
  /** Optional logger (defaults to console). */
  log?: (msg: string) => void;
}

/**
 * A provider that can submit and poll batches. `OpenRouterProvider` satisfies
 * this; `vscodeLmProvider` does not, so it always takes the fallback path.
 */
export interface OpenRouterBatchCapableProvider extends LlmProvider {
  submitBatch?(requests: BatchRequestItem[], opts?: { model?: string; endpoint?: string }): Promise<string>;
  pollBatch?(
    batchId: string,
    opts?: { pollIntervalMs?: number; maxWaitMs?: number; token?: LlmRequest['token'] },
  ): Promise<{ id: string; status: string; results?: BatchResultItem[]; error?: string }>;
  /**
   * Build a single Batch API request item from an `LlmRequest`, reusing the
   * provider's own body construction (correct schema, max_tokens, temp 0).
   * Required for the batch path so batch output matches what the analyzer
   * parses.
   */
  buildBatchItem?(req: LlmRequest, index: number): BatchRequestItem;
}

/**
 * Run a set of LLM requests, using the Batch API when the model supports it
 * and falling back to concurrent single requests otherwise.
 *
 * @returns an array of `LlmResponse` aligned 1:1 with `requests`.
 */
export async function runBatchOrFallback(opts: BatchRunOptions): Promise<LlmResponse[]> {
  const { modelId, provider, requests, token, pollIntervalMs, maxWaitMs, log } = opts;
  const logger = log ?? ((m: string) => console.log(m));

  if (requests.length === 0) return [];

  const capable = isBatchSupported(modelId) && typeof provider.submitBatch === 'function' && typeof provider.pollBatch === 'function';
  if (!capable) {
    if (requests.length > 1) {
      logger(`batch_not_supported: model ${modelId} not batch-capable; using single-request fallback`);
    }
    return runFallback(provider, requests);
  }

  // Build batch items using the provider's own body construction (correct
  // schema, max_tokens, temp 0) so batch output matches what the analyzer
  // parses. Fall back to a conservative single-request path if the provider
  // doesn't expose buildBatchItem — never hand-roll a divergent schema.
  if (typeof provider.buildBatchItem !== 'function') {
    logger(`batch_not_supported: provider lacks buildBatchItem; using single-request fallback`);
    return runFallback(provider, requests);
  }
  const batchItems: BatchRequestItem[] = requests.map((req, i) => provider.buildBatchItem!(req, i));

  let batchId: string | undefined;
  try {
    batchId = await provider.submitBatch!(batchItems, { model: modelId });
    logger(`batch_submitted: id=${batchId} items=${batchItems.length}`);
    const result = await provider.pollBatch!(batchId, { pollIntervalMs, maxWaitMs, token });
    if (result.status !== 'completed' || !result.results) {
      logger(`batch_failed: status=${result.status}; falling back to single-request`);
      return runFallback(provider, requests);
    }
    return correlateResults(result.results, requests.length);
  } catch (e) {
    logger(`batch_error: ${(e as Error).message} (id=${batchId}); falling back to single-request`);
    return runFallback(provider, requests);
  }
}

/** Run requests concurrently via `provider.complete`. */
async function runFallback(provider: LlmProvider, requests: LlmRequest[]): Promise<LlmResponse[]> {
  return Promise.all(
    requests.map((req) => provider.complete(req).catch((e) => ({ text: '', error: (e as Error).message } as LlmResponse))),
  );
}

/** Map batch result items back to request order by custom_id index. */
function correlateResults(results: BatchResultItem[], expected: number): LlmResponse[] {
  const byIndex = new Map<number, LlmResponse>();
  for (const item of results) {
    const idx = Number(String(item.custom_id).replace(/^req-/, ''));
    if (Number.isNaN(idx)) continue;
    if (item.error) {
      const errMsg = typeof item.error === 'string' ? item.error : JSON.stringify(item.error);
      byIndex.set(idx, { text: '', error: errMsg });
    } else {
      const text = item.body?.choices?.[0]?.message?.content ?? '';
      byIndex.set(idx, { text });
    }
  }
  const out: LlmResponse[] = [];
  for (let i = 0; i < expected; i++) {
    out.push(byIndex.get(i) ?? { text: '', error: 'batch result missing for index ' + i });
  }
  return out;
}
