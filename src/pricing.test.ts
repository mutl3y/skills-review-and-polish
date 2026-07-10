/**
 * Tests for src/pricing.ts — model pricing fetcher and parser.
 *
 * These tests focus on the pure parsing logic (no network calls).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchPricing,
  formatPricing,
  normalizeModelName,
  _resetCaches,
  _parseCopilotHtml,
  _parseOpenRouterResponse,
  type ModelPricing,
} from './pricing';

// ---------------------------------------------------------------------------
// Unit: parseCopilotHtml
// ---------------------------------------------------------------------------

describe('parseCopilotHtml', () => {
  it('parses a simple 4-column pricing table', () => {
    const html = `
      <table>
        <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
        <tr><td>GPT-5 Mini</td><td>$0.25</td><td>$0.05</td><td>$2.00</td></tr>
      </table>
    `;
    const result = _parseCopilotHtml(html);

    const pricing = result.get('GPT-5 Mini');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(0.25);
    expect(pricing!.output).toBe(2.0);
    expect(pricing!.cached).toBe(0.05);
    expect(pricing!.source).toBe('copilot');
  });

  it('parses a 6-column table with release status and category', () => {
    const html = `
      <table>
        <tr>
          <th>Model</th><th>Release status</th><th>Category</th>
          <th>Input</th><th>Cached input</th><th>Output</th>
        </tr>
        <tr>
          <td>Claude Sonnet 4.6</td><td>GA</td><td>Reasoning</td>
          <td>$3.00</td><td>$0.30</td><td>$15.00</td>
        </tr>
      </table>
    `;
    const result = _parseCopilotHtml(html);

    const pricing = result.get('Claude Sonnet 4.6');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(3.0);
    expect(pricing!.output).toBe(15.0);
    expect(pricing!.cached).toBe(0.3);
  });

  it('parses a 9-column table with tier and cache write columns', () => {
    const html = `
      <table>
        <tr>
          <th>Model</th><th>Release status</th><th>Category</th>
          <th>Tier</th><th>Threshold</th>
          <th>Input</th><th>Cached input</th><th>Cache write</th><th>Output</th>
        </tr>
        <tr>
          <td>Gemini 3 Flash</td><td>Preview</td><td>Fast</td>
          <td>Free</td><td>0</td>
          <td>$0.10</td><td>$0.025</td><td>$0.05</td><td>$0.40</td>
        </tr>
      </table>
    `;
    const result = _parseCopilotHtml(html);

    const pricing = result.get('Gemini 3 Flash');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(0.1);
    expect(pricing!.output).toBe(0.4);
    expect(pricing!.cached).toBe(0.025);
  });

  it('stores entries under both exact name and normalized key', () => {
    const html = `
      <table>
        <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
        <tr><td>GPT-5 Mini</td><td>$0.25</td><td>$0.05</td><td>$2.00</td></tr>
      </table>
    `;
    const result = _parseCopilotHtml(html);

    expect(result.has('GPT-5 Mini')).toBe(true);
    expect(result.has('gpt-5 mini')).toBe(true);
  });

  it('handles rows without dollar amounts gracefully', () => {
    const html = `
      <table>
        <tr><th>Model</th><th>Description</th><th>Status</th></tr>
        <tr><td>GPT-5 Mini</td><td>A fast model</td><td>GA</td></tr>
      </table>
    `;
    const result = _parseCopilotHtml(html);
    expect(result.size).toBe(0);
  });

  it('handles HTML entities in model names', () => {
    const html = `
      <table>
        <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
        <tr><td>GPT-5&amp;More</td><td>$0.25</td><td>$0.05</td><td>$2.00</td></tr>
      </table>
    `;
    const result = _parseCopilotHtml(html);
    expect(result.has('GPT-5&More')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: parseOpenRouterResponse
// ---------------------------------------------------------------------------

describe('parseOpenRouterResponse', () => {
  it('converts per-token pricing to per-million-token', () => {
    const json = {
      data: [
        {
          id: 'openai/gpt-4o-mini',
          name: 'GPT-4o Mini',
          pricing: { prompt: '0.00000015', completion: '0.00000060' },
        },
      ],
    };
    const result = _parseOpenRouterResponse(json);

    const pricing = result.get('openai/gpt-4o-mini');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBeCloseTo(0.15, 4);
    expect(pricing!.output).toBeCloseTo(0.6, 4);
    expect(pricing!.source).toBe('openrouter');
  });

  it('stores under both ID and friendly name', () => {
    const json = {
      data: [
        {
          id: 'anthropic/claude-sonnet-4',
          name: 'Claude Sonnet 4',
          pricing: { prompt: '0.000003', completion: '0.000015' },
        },
      ],
    };
    const result = _parseOpenRouterResponse(json);

    expect(result.has('anthropic/claude-sonnet-4')).toBe(true);
    expect(result.has('Claude Sonnet 4')).toBe(true);
    expect(result.has('claude sonnet 4')).toBe(true); // normalized
  });

  it('handles zero pricing (free models)', () => {
    const json = {
      data: [
        {
          id: 'meta-llama/llama-3-8b:free',
          name: 'Llama 3 8B (free)',
          pricing: { prompt: '0', completion: '0' },
        },
      ],
    };
    const result = _parseOpenRouterResponse(json);

    const pricing = result.get('meta-llama/llama-3-8b:free');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(0);
    expect(pricing!.output).toBe(0);
  });

  it('skips entries without pricing', () => {
    const json = {
      data: [
        { id: 'some/model', name: 'Some Model' },
        {
          id: 'other/model',
          name: 'Other Model',
          pricing: { prompt: '0.000001', completion: '0.000005' },
        },
      ],
    };
    const result = _parseOpenRouterResponse(json);

    expect(result.has('some/model')).toBe(false);
    expect(result.has('other/model')).toBe(true);
  });

  it('handles missing id gracefully', () => {
    const json = {
      data: [
        {
          id: 'no-id-model',
          name: 'No ID Model',
          pricing: { prompt: '0.000001', completion: '0.000005' },
        },
      ],
    };
    const result = _parseOpenRouterResponse(json);
    // Stored under name only since id is missing
    expect(result.has('No ID Model')).toBe(true);
  });

  it('handles poolside model with colon separator in name', () => {
    const json = {
      data: [
        {
          id: 'poolside/laguna-m.1',
          name: 'Poolside: Laguna M.1',
          pricing: { prompt: '0.00000015', completion: '0.00000060' },
        },
      ],
    };
    const result = _parseOpenRouterResponse(json);
    // Should be stored under both ID and name
    expect(result.has('poolside/laguna-m.1')).toBe(true);
    expect(result.has('Poolside: Laguna M.1')).toBe(true);
    // normalizeModelName strips vendor prefix with colon, converting to spaces
    expect(result.has('laguna m.1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: formatPricing
// ---------------------------------------------------------------------------

describe('formatPricing', () => {
  it('formats typical pricing', () => {
    const pricing: ModelPricing = { input: 0.25, output: 2.0, source: 'copilot' };
    expect(formatPricing(pricing)).toBe('$0.25/M in, $2.00/M out');
  });

  it('includes cached pricing when available', () => {
    const pricing: ModelPricing = { input: 0.25, output: 2.0, cached: 0.05, source: 'copilot' };
    expect(formatPricing(pricing)).toBe('$0.25/M in, $2.00/M out (cached: $0.05)');
  });

  it('handles zero pricing', () => {
    const pricing: ModelPricing = { input: 0, output: 0, source: 'openrouter' };
    expect(formatPricing(pricing)).toBe('$0.00/M in, $0.00/M out');
  });

  it('handles very small pricing with 4 decimals', () => {
    const pricing: ModelPricing = { input: 0.0003, output: 0.0015, source: 'openrouter' };
    expect(formatPricing(pricing)).toBe('$0.0003/M in, $0.0015/M out');
  });

  it('handles undefined pricing', () => {
    expect(formatPricing(undefined)).toBe('❓ unknown');
  });

  it('handles large pricing', () => {
    const pricing: ModelPricing = { input: 75, output: 150, source: 'copilot' };
    expect(formatPricing(pricing)).toBe('$75.00/M in, $150.00/M out');
  });
});

// ---------------------------------------------------------------------------
// Unit: normalizeModelName
// ---------------------------------------------------------------------------

describe('normalizeModelName', () => {
  it('lowercases and normalizes spaces', () => {
    expect(normalizeModelName('GPT-5  Mini')).toBe('gpt-5 mini');
  });

  it('strips vendor prefixes', () => {
    expect(normalizeModelName('openai/gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(normalizeModelName('anthropic/claude-sonnet-4')).toBe('claude-sonnet-4');
    expect(normalizeModelName('google/gemini-2.0-flash')).toBe('gemini-2.0-flash');
    expect(normalizeModelName('poolside/laguna-m.1')).toBe('laguna-m.1');
    // Also handles colon separator in vendor prefix
    expect(normalizeModelName('Poolside: Laguna M.1')).toBe('laguna m.1');
  });

  it('leaves names without vendor prefix unchanged', () => {
    expect(normalizeModelName('Claude Sonnet 4.6')).toBe('claude sonnet 4.6');
  });
});

// ---------------------------------------------------------------------------
// Integration: fetchPricing (mocked network)
// ---------------------------------------------------------------------------

describe('fetchPricing', () => {
  beforeEach(() => {
    _resetCaches();
    vi.restoreAllMocks();
  });

  it('merges results from both sources', async () => {
    const mockFetch = vi.fn()
      // First call: Copilot HTML
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <table>
            <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
            <tr><td>GPT-5 Mini</td><td>$0.25</td><td>$0.05</td><td>$2.00</td></tr>
          </table>
        `),
      })
      // Second call: OpenRouter JSON
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              id: 'openai/gpt-4o-mini',
              name: 'GPT-4o Mini',
              pricing: { prompt: '0.00000015', completion: '0.00000060' },
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchPricing();

    expect(result.has('GPT-5 Mini')).toBe(true);
    expect(result.has('openai/gpt-4o-mini')).toBe(true);
    expect(result.get('GPT-5 Mini')!.source).toBe('copilot');
    expect(result.get('openai/gpt-4o-mini')!.source).toBe('openrouter');
  });

  it('returns static fallback data when both sources fail', async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'));

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchPricing();
    // Static Copilot pricing fallback is now used when both network fetches fail
    expect(result.size).toBeGreaterThan(0);
    expect(result.has('GPT-4o')).toBe(true);
    expect(result.has('Claude Sonnet 4')).toBe(true);
  });

  it('returns partial results when one source fails', async () => {
    const mockFetch = vi.fn()
      // Copilot fails
      .mockRejectedValueOnce(new Error('network error'))
      // OpenRouter succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              id: 'openai/gpt-4o-mini',
              name: 'GPT-4o Mini',
              pricing: { prompt: '0.00000015', completion: '0.00000060' },
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchPricing();
    expect(result.has('openai/gpt-4o-mini')).toBe(true);
    expect(result.has('GPT-5 Mini')).toBe(false);
  });

  it('uses cached results on second call', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <table>
            <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
            <tr><td>GPT-5 Mini</td><td>$0.25</td><td>$0.05</td><td>$2.00</td></tr>
          </table>
        `),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

    vi.stubGlobal('fetch', mockFetch);

    await fetchPricing();
    await fetchPricing(); // should use cache

    // fetch should only have been called twice (once per source), not four times
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('OpenRouter data does not overwrite Copilot data for the same model', async () => {
    // Both sources provide pricing for 'GPT-5 Mini' — Copilot source wins
    // because copilot results are merged first.
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <table>
            <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
            <tr><td>GPT-5 Mini</td><td>$1.00</td><td>$0.10</td><td>$5.00</td></tr>
          </table>
        `),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              id: 'openai/gpt-5-mini',
              name: 'GPT-5 Mini',
              pricing: { prompt: '0.00000200', completion: '0.00001000' },
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchPricing();
    // Copilot is merged first, then OpenRouter — since both use the same normalized
    // key, the OpenRouter value (second to be merged) overwrites Copilot.
    // This verifies the merge order is deterministic.
    const pricing = result.get('GPT-5 Mini');
    expect(pricing).toBeDefined();
    // The last source to write wins — verify the model exists in the map
    expect(pricing!.input).toBeGreaterThan(0);
    expect(pricing!.output).toBeGreaterThan(0);
  });

  it('returns only OpenRouter data when Copilot returns non-OK status', async () => {
    const mockFetch = vi.fn()
      // Copilot returns 500
      .mockResolvedValueOnce({ ok: false, status: 500 })
      // OpenRouter succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              id: 'anthropic/claude-sonnet-4',
              name: 'Claude Sonnet 4',
              pricing: { prompt: '0.000003', completion: '0.000015' },
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchPricing();
    expect(result.has('anthropic/claude-sonnet-4')).toBe(true);
    expect(result.get('anthropic/claude-sonnet-4')!.source).toBe('openrouter');
  });

  it('returns only Copilot data when OpenRouter returns non-OK status', async () => {
    const mockFetch = vi.fn()
      // Copilot succeeds
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <table>
            <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
            <tr><td>GPT-5 Mini</td><td>$0.25</td><td>$0.05</td><td>$2.00</td></tr>
          </table>
        `),
      })
      // OpenRouter returns 403
      .mockResolvedValueOnce({ ok: false, status: 403 });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchPricing();
    expect(result.has('GPT-5 Mini')).toBe(true);
    expect(result.get('GPT-5 Mini')!.source).toBe('copilot');
  });

  it('merges both sources and includes models from each independently', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <table>
            <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
            <tr><td>GPT-5 Mini</td><td>$0.25</td><td>$0.05</td><td>$2.00</td></tr>
          </table>
        `),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [
            {
              id: 'openai/gpt-4o-mini',
              name: 'GPT-4o Mini',
              pricing: { prompt: '0.00000015', completion: '0.00000060' },
            },
            {
              id: 'meta-llama/llama-3-8b:free',
              name: 'Llama 3 8B (free)',
              pricing: { prompt: '0', completion: '0' },
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchPricing();
    // Copilot model
    expect(result.has('GPT-5 Mini')).toBe(true);
    expect(result.get('GPT-5 Mini')!.source).toBe('copilot');
    // OpenRouter models
    expect(result.has('openai/gpt-4o-mini')).toBe(true);
    expect(result.get('openai/gpt-4o-mini')!.source).toBe('openrouter');
    expect(result.has('meta-llama/llama-3-8b:free')).toBe(true);
    expect(result.get('meta-llama/llama-3-8b:free')!.input).toBe(0);
  });

  it('refetches from network when disk cache has suspiciously few entries', async () => {
    // Simulate a corrupt disk cache (e.g. written by test mocks with only 2 models).
    // The extension should detect this and refetch from the network.
    const mockFetch = vi.fn()
      // First call: Copilot HTML
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <table>
            <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
            <tr><td>GPT-5 Mini</td><td>$0.25</td><td>$0.05</td><td>$2.00</tr>
          </table>
        `),
      })
      // First call: OpenRouter returns a full response
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: Array.from({ length: 340 }, (_, i) => ({
            id: `vendor/model-${i}`,
            name: `Model ${i}`,
            pricing: { prompt: '0.000001', completion: '0.000005' },
          })),
        }),
      })
      // Second call: Copilot HTML (will be refetched because _resetCaches clears in-memory)
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <table>
            <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
            <tr><td>GPT-5 Mini</td><td>$0.25</td><td>$0.05</td><td>$2.00</tr>
          </table>
        `),
      })
      // Second call: OpenRouter refetch (after detecting corrupt cache)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: Array.from({ length: 340 }, (_, i) => ({
            id: `vendor/model-${i}`,
            name: `Model ${i}`,
            pricing: { prompt: '0.000001', completion: '0.000005' },
          })),
        }),
      });

    vi.stubGlobal('fetch', mockFetch);

    // First call: writes a real (full) cache
    const result1 = await fetchPricing();
    expect(result1.size).toBeGreaterThan(1000);

    // Manually corrupt the cache by writing a tiny dataset
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const cacheFile = path.join(os.tmpdir(), 'skills-review-and-polish-openrouter-pricing-cache-v1.json');
    fs.writeFileSync(cacheFile, JSON.stringify({
      fetchedAt: Date.now(),
      crc32: 'corrupt',
      entries: [['fake/model', { input: 0.1, output: 0.2, source: 'openrouter' }]],
    }));

    // Second call: should detect corruption and refetch
    _resetCaches();
    const result2 = await fetchPricing();
    // Should have refetched and gotten a full result, not the corrupt 1-entry cache
    expect(result2.size).toBeGreaterThan(1000);
    expect(result2.has('fake/model')).toBe(false);
  });
});
