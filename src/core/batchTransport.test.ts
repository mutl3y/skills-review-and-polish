// /workspace/skills-review-and-polish/src/core/batchTransport.test.ts
//
// Validates the batch transport orchestration: capability filter, batch
// success correlation, and single-request fallback on any batch failure.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBatchOrFallback, OpenRouterBatchCapableProvider } from './batchTransport.js';
import { LlmRequest, LlmResponse, BatchRequestItem, BatchResultItem, BatchStatus } from './types.js';
import { _resetBatchCapabilityCache, _resetFixtureCache } from '../modelCatalog.js';

function makeProvider(overrides: Partial<OpenRouterBatchCapableProvider> = {}): OpenRouterBatchCapableProvider {
  return {
    complete: vi.fn(async (req: LlmRequest): Promise<LlmResponse> => ({ text: `ok:${req.prompt}` })),
    getContextLength: () => 200000,
    ...overrides,
  };
}

const requests: LlmRequest[] = [
  { prompt: 'a', systemPrompt: 's' },
  { prompt: 'b', systemPrompt: 's' },
];

describe('runBatchOrFallback', () => {
  beforeEach(() => {
    _resetBatchCapabilityCache();
    _resetFixtureCache();
  });

  it('falls back to single requests for a non-batch-capable model', async () => {
    const provider = makeProvider();
    const res = await runBatchOrFallback({ modelId: 'unknown/model', provider, requests });
    expect(res).toHaveLength(2);
    expect(res[0].text).toBe('ok:a');
    expect(res[1].text).toBe('ok:b');
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('uses batch transport when the model is batch-capable', async () => {
    const submitBatch = vi.fn(async (_items: BatchRequestItem[]) => 'batch-123');
    const pollBatch = vi.fn(async (): Promise<{ id: string; status: BatchStatus; results?: BatchResultItem[] }> => ({
      id: 'batch-123',
      status: 'completed',
      results: [
        { custom_id: 'req-0', body: { choices: [{ message: { content: 'B0' } }] } },
        { custom_id: 'req-1', body: { choices: [{ message: { content: 'B1' } }] } },
      ],
    }));
    const provider = makeProvider({ submitBatch, pollBatch });
    const res = await runBatchOrFallback({ modelId: 'openai/gpt-4o-mini', provider, requests });
    expect(submitBatch).toHaveBeenCalledOnce();
    expect(pollBatch).toHaveBeenCalledOnce();
    expect(res[0].text).toBe('B0');
    expect(res[1].text).toBe('B1');
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('falls back to single requests when the batch fails to complete', async () => {
    const submitBatch = vi.fn(async () => 'batch-123');
    const pollBatch = vi.fn(async () => ({ id: 'batch-123', status: 'failed' as BatchStatus, error: 'boom' }));
    const provider = makeProvider({ submitBatch, pollBatch });
    const res = await runBatchOrFallback({ modelId: 'openai/gpt-4o-mini', provider, requests });
    expect(res).toHaveLength(2);
    expect(res[0].text).toBe('ok:a');
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('falls back when submitBatch throws', async () => {
    const submitBatch = vi.fn(async () => { throw new Error('network'); });
    const provider = makeProvider({ submitBatch });
    const res = await runBatchOrFallback({ modelId: 'openai/gpt-4o-mini', provider, requests });
    expect(res[0].text).toBe('ok:a');
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });
});
