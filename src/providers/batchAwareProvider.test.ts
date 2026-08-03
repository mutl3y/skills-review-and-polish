// /workspace/skills-review-and-polish/src/providers/batchAwareProvider.test.ts
//
// Validates the batch-aware provider wrapper: it buffers complete() calls and
// flushes them as a real batch job, falls back to single requests for
// non-batch-capable models, and correlates results back to callers.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchAwareOpenRouterProvider } from './batchAwareProvider.js';
import { OpenRouterProvider } from './externalProvider.js';
import { LlmRequest, LlmResponse, BatchRequestItem, BatchResultItem, BatchStatus } from '../core/types.js';
import { _resetBatchCapabilityCache, _resetFixtureCache } from '../modelCatalog.js';

function makeBaseProvider(overrides: Partial<OpenRouterProvider> = {}): OpenRouterProvider {
  return {
    complete: vi.fn(async (req: LlmRequest): Promise<LlmResponse> => ({ text: `single:${req.prompt}` })),
    getContextLength: () => 200000,
    submitBatch: vi.fn(async (_items: BatchRequestItem[]) => 'batch-1'),
    pollBatch: vi.fn(async () => ({
      id: 'batch-1',
      status: 'completed' as BatchStatus,
      results: [] as BatchResultItem[],
    })),
    ...overrides,
  } as unknown as OpenRouterProvider;
}

describe('BatchAwareOpenRouterProvider', () => {
  beforeEach(() => {
    _resetBatchCapabilityCache();
    _resetFixtureCache();
  });

  it('falls back to single requests for a non-batch-capable model', async () => {
    const base = makeBaseProvider();
    const provider = new BatchAwareOpenRouterProvider({ provider: base, modelId: 'unknown/model', flushSize: 6 });
    expect(provider.batchingEnabled).toBe(false);
    const res = await provider.complete({ prompt: 'a', systemPrompt: 's' });
    expect(res.text).toBe('single:a');
    expect(base.complete).toHaveBeenCalledOnce();
    expect(base.submitBatch).not.toHaveBeenCalled();
  });

  it('batches complete() calls into one batch job for a capable model', async () => {
    const submitBatch = vi.fn(async (_items: BatchRequestItem[]) => 'batch-1');
    const pollBatch = vi.fn(async (): Promise<{ id: string; status: BatchStatus; results?: BatchResultItem[] }> => ({
      id: 'batch-1',
      status: 'completed',
      results: [
        { custom_id: 'req-0', body: { choices: [{ message: { content: 'B0' } }] } },
        { custom_id: 'req-1', body: { choices: [{ message: { content: 'B1' } }] } },
      ],
    }));
    const base = makeBaseProvider({ submitBatch, pollBatch });
    const provider = new BatchAwareOpenRouterProvider({ provider: base, modelId: 'openai/gpt-4o-mini', flushSize: 2 });
    expect(provider.batchingEnabled).toBe(true);

    const [r0, r1] = await Promise.all([
      provider.complete({ prompt: 'a', systemPrompt: 's' }),
      provider.complete({ prompt: 'b', systemPrompt: 's' }),
    ]);
    expect(submitBatch).toHaveBeenCalledOnce();
    expect(pollBatch).toHaveBeenCalledOnce();
    expect(r0.text).toBe('B0');
    expect(r1.text).toBe('B1');
    expect(base.complete).not.toHaveBeenCalled();
  });

  it('flushes automatically when fewer than flushSize requests are made', async () => {
    const submitBatch = vi.fn(async () => 'batch-1');
    const pollBatch = vi.fn(async () => ({
      id: 'batch-1',
      status: 'completed' as BatchStatus,
      results: [{ custom_id: 'req-0', body: { choices: [{ message: { content: 'B0' } }] } }],
    }));
    const base = makeBaseProvider({ submitBatch, pollBatch });
    const provider = new BatchAwareOpenRouterProvider({ provider: base, modelId: 'openai/gpt-4o-mini', flushSize: 6 });
    const res = await provider.complete({ prompt: 'a', systemPrompt: 's' });
    // setTimeout(0) flush — await a tick to let it run.
    await new Promise((r) => setTimeout(r, 5));
    expect(submitBatch).toHaveBeenCalledOnce();
    expect(res.text).toBe('B0');
  });

  it('falls back to single requests when the batch fails', async () => {
    const submitBatch = vi.fn(async () => 'batch-1');
    const pollBatch = vi.fn(async () => ({ id: 'batch-1', status: 'failed' as BatchStatus, error: 'boom' }));
    const base = makeBaseProvider({ submitBatch, pollBatch });
    const provider = new BatchAwareOpenRouterProvider({ provider: base, modelId: 'openai/gpt-4o-mini', flushSize: 2 });
    const res = await provider.complete({ prompt: 'a', systemPrompt: 's' });
    await new Promise((r) => setTimeout(r, 5));
    expect(res.text).toBe('single:a');
    expect(base.complete).toHaveBeenCalledOnce();
  });
});
