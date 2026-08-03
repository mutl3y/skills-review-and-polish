/**
 * Batch-aware OpenRouter provider wrapper.
 *
 * The analyzer calls `provider.complete()` once per wave, sequentially. To
 * genuinely exercise the OpenRouter Batch API through the existing analyzer
 * (without refactoring its wave loop), this wrapper buffers `complete()` calls
 * and flushes them as a single real batch job (`/api/beta/batches`) once the
 * buffer reaches `flushSize` or `flush()` is called.
 *
 * This is the integration point for plan step 5 (eval scripts) and the MCP
 * `batch` option: construct the analyzer with a `BatchAwareOpenRouterProvider`
 * instead of a plain `OpenRouterProvider` and the 6 waves of a scan are
 * submitted as one batch job rather than 6 sequential chat completions.
 *
 * Capability is gated by `modelCatalog.isBatchSupported(modelId)` — when the
 * model is not batch-capable, every `complete()` falls through to the
 * underlying single-request provider (no batching), so callers get correct
 * results regardless.
 *
 * @module batchAwareProvider
 */

import { LlmProvider, LlmRequest, LlmResponse } from '../core/types';
import { OpenRouterProvider } from './externalProvider';
import { isBatchSupported } from '../modelCatalog';
import { runBatchOrFallback } from '../core/batchTransport';

interface PendingRequest {
  req: LlmRequest;
  resolve: (r: LlmResponse) => void;
  reject: (e: unknown) => void;
}

export interface BatchAwareOptions {
  /** Underlying OpenRouter provider whose submitBatch/pollBatch we use. */
  provider: OpenRouterProvider;
  /** Model id used for every buffered request. */
  modelId: string;
  /** Flush the buffer once it reaches this size (default 6 = one full wave set). */
  flushSize?: number;
  /** Max wait for a batch job to complete before falling back (ms, default 10 min). */
  maxWaitMs?: number;
  /** Poll interval while waiting on a batch job (ms, default 2000). */
  pollIntervalMs?: number;
  /** Optional logger. */
  log?: (msg: string) => void;
}

/**
 * A provider that batches `complete()` calls into OpenRouter Batch API jobs.
 * Implements `LlmProvider` so it can be dropped into the `Engine` unchanged.
 */
export class BatchAwareOpenRouterProvider implements LlmProvider {
  private readonly provider: OpenRouterProvider;
  private readonly modelId: string;
  private readonly flushSize: number;
  private readonly maxWaitMs: number;
  private readonly pollIntervalMs: number;
  private readonly log: (msg: string) => void;
  private readonly buffer: PendingRequest[] = [];
  private flushing: Promise<void> | null = null;

  constructor(opts: BatchAwareOptions) {
    this.provider = opts.provider;
    this.modelId = opts.modelId;
    this.flushSize = opts.flushSize ?? 6;
    this.maxWaitMs = opts.maxWaitMs ?? 10 * 60_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.log = opts.log ?? ((m: string) => console.log(m));
  }

  getContextLength(): number | undefined {
    return this.provider.getContextLength();
  }

  /** Whether batching is actually active for the configured model. */
  get batchingEnabled(): boolean {
    return isBatchSupported(this.modelId);
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.batchingEnabled) {
      // Safe path: model not batch-capable → single request.
      return this.provider.complete(req);
    }
    return new Promise<LlmResponse>((resolve, reject) => {
      this.buffer.push({ req, resolve, reject });
      if (this.buffer.length >= this.flushSize) {
        void this.flush();
      } else if (this.buffer.length === 1) {
        // The analyzer runs waves sequentially; if the total number of waves
        // is fewer than flushSize (e.g. a focused single-wave run), schedule a
        // flush on the next macrotask so buffered requests are still submitted
        // as a batch rather than stalling until the next call.
        setTimeout(() => { void this.flush(); }, 0);
      }
    });
  }

  /** Flush any buffered requests as a batch job (idempotent / serialized). */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  private async doFlush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    const requests = batch.map((p) => p.req);
    try {
      const responses = await runBatchOrFallback({
        modelId: this.modelId,
        provider: this.provider,
        requests,
        pollIntervalMs: this.pollIntervalMs,
        maxWaitMs: this.maxWaitMs,
        log: this.log,
      });
      batch.forEach((p, i) => p.resolve(responses[i]));
    } catch (e) {
      this.log(`batch_error: ${(e as Error).message}; falling back to single-request`);
      await Promise.all(
        batch.map((p) => this.provider.complete(p.req).then(p.resolve).catch(p.reject)),
      );
    }
  }
}
