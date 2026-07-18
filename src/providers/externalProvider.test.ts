import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubModelsProvider, OpenRouterProvider } from './externalProvider';

async function callBody(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): Promise<any> {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body);
}

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns the provider text from the OpenRouter response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello from openrouter' }, finish_reason: 'stop' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'openai/gpt-4o-mini' });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: 'hello from openrouter', finishReason: 'stop' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes deep and fix tiers to their configured models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({
      apiKey: 'token',
      model: 'standard-model',
      deepModel: 'deep-model',
      fixModel: 'fix-model',
    });

    await provider.complete({ prompt: 'p', systemPrompt: 's', modelTier: 'deep' });
    await provider.complete({ prompt: 'p', systemPrompt: 's', modelTier: 'fix' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('deep-model');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('fix-model');
  });

  it('uses a 16384 token response budget by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model' });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(16384);
  });

  it('defaults to strict json_schema response_format when structuredOutput is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model' });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    const body = await callBody(fetchMock);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.name).toBe('llm_analysis_response');
    expect(body.response_format.json_schema.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining([
        'contradictions', 'ambiguity_issues', 'persona_issues',
        'cognitive_load', 'coverage_analysis', 'hygiene_issues',
        'custom_diagnostics', 'conflicts',
      ]),
    });
    expect(body.temperature).toBe(0);
    expect(body.top_p).toBe(0);
  });

  it('explicit structuredOutput:"schema" emits the json_schema envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model', structuredOutput: 'schema' });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    const body = await callBody(fetchMock);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    // The schema is round-tripped through JSON serialization so we check
    // structural shape rather than referential equality.
    expect(body.response_format.json_schema.name).toBe('llm_analysis_response');
    expect(body.response_format.json_schema.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining([
        'contradictions', 'ambiguity_issues', 'persona_issues',
        'cognitive_load', 'coverage_analysis', 'hygiene_issues',
        'custom_diagnostics', 'conflicts',
      ]),
    });
  });

  it('structuredOutput:true keeps the legacy json_object shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model', structuredOutput: true });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect((await callBody(fetchMock)).response_format).toEqual({ type: 'json_object' });
  });

  it('structuredOutput:false omits response_format entirely', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model', structuredOutput: false });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect((await callBody(fetchMock)).response_format).toBeUndefined();
  });

  it('retries once without structured output when OpenRouter rejects response_format', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 400, message: 'response_format not supported' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model', maxRetries: 0, structuredOutput: true });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: '{"ok":true}' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
  });

  it('retries once without structured output when OpenRouter rejects json_schema', async () => {
    // Confirms the fallback chain: schema → no format (not schema → json_object).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 400, message: 'json_schema is not supported for this model' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model', maxRetries: 0, structuredOutput: 'schema' });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: '{"ok":true}' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.response_format.type).toBe('json_schema');
    expect(secondBody.response_format).toBeUndefined();
  });

  it('retries once without structured output when schema mode returns finish_reason:error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"partial":true}' }, finish_reason: 'error' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model', maxRetries: 0, structuredOutput: 'schema' });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: '{"ok":true}', finishReason: 'stop' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.response_format.type).toBe('json_schema');
    expect(secondBody.response_format).toBeUndefined();
  });

  it('retries once without structured output when OpenRouter rejects response_format', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 400, message: 'response_format not supported' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model', maxRetries: 0, structuredOutput: true });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: '{"ok":true}' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
  });

  it('honors an explicit maxTokens override', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model', maxTokens: 2048 });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(2048);
  });

  it('scales max_tokens from prompt length when adaptive mode is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({
      apiKey: 'token',
      model: 'standard-model',
      maxTokens: 20_000,
      adaptiveMaxTokens: true,
      // Cap the adaptive budget low so the input-derived estimate is the
      // binding constraint (desired = max(inputDerived, scaledCap)).
      adaptiveMaxTokensCap: 5_000,
      minAdaptiveTokens: 4_096,
      adaptiveCharsPerToken: 8,
    });
    await provider.complete({ prompt: 'x'.repeat(80_000), systemPrompt: 's' });

    // desired = max(ceil(80000 / 8), 5000) = max(10000, 5000) = 10000
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(10_000);
  });

  it('clamps adaptive max_tokens to min and max bounds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({
      apiKey: 'token',
      model: 'standard-model',
      maxTokens: 12_000,
      adaptiveMaxTokens: true,
      adaptiveMaxTokensCap: 24_000,
      minAdaptiveTokens: 4_096,
      adaptiveCharsPerToken: 8,
    });

    await provider.complete({ prompt: 'tiny', systemPrompt: 's' });
    await provider.complete({ prompt: 'x'.repeat(400_000), systemPrompt: 's' });

    // desired = max(inputDerived, scaledCap). For a tiny prompt inputDerived
    // is ~0, so the model's adaptive cap (24000) wins; for a huge prompt
    // inputDerived is also below the cap, so the cap still wins. The output
    // budget reaches the model's generation cap rather than being derived
    // from input length (which under-sized large documents).
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(24_000);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_tokens).toBe(24_000);
  });

  it('lets adaptive mode exceed maxTokens when adaptiveMaxTokensCap is higher', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    // maxTokens = 16384 (fixed-mode default). adaptiveMaxTokensCap = 65536.
    // With adaptive mode ON, a 600K-char prompt should be allowed to grow
    // beyond the fixed 16384 ceiling (this is the whole point of the cap).
    const provider = new OpenRouterProvider({
      apiKey: 'token',
      model: 'standard-model',
      maxTokens: 16_384,
      adaptiveMaxTokens: true,
      minAdaptiveTokens: 4_096,
      adaptiveCharsPerToken: 8,
    });

    await provider.complete({ prompt: 'x'.repeat(600_000), systemPrompt: 's' });

    const wire = JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens;
    expect(wire).toBeGreaterThan(16_384);
    expect(wire).toBeLessThanOrEqual(65_536);
  });

  it('returns an error message when the API reports a retryable failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'openai/gpt-4o-mini', maxRetries: 0 });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result.text).toBe('');
    expect(result.error).toContain('HTTP 503');
  });

  it('stops retrying when the API returns a non-retryable error payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { code: 400, message: 'bad request' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'openai/gpt-4o-mini', maxRetries: 2 });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: '', error: 'bad request', isRateLimit: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable OpenRouter failure and succeeds on the next attempt', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'recovered' } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'openai/gpt-4o-mini', maxRetries: 1 });
    const promise = provider.complete({ prompt: 'p', systemPrompt: 's' });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ text: 'recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out a stalled OpenRouter request without retrying it', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({
      apiKey: 'token',
      model: 'openai/gpt-4o-mini',
      maxRetries: 2,
      requestTimeoutMs: 5,
    });
    const promise = provider.complete({ prompt: 'p', systemPrompt: 's' });

    await vi.advanceTimersByTimeAsync(5);

    await expect(promise).resolves.toMatchObject({
      text: '',
      error: 'Error: Request timed out after 5ms',
      isRateLimit: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('GitHubModelsProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('defaults to strict json_schema response_format when structuredOutput is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'standard-model' });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    const body = await callBody(fetchMock);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it('structuredOutput:false omits response_format on GitHub Models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'standard-model', structuredOutput: false });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect((await callBody(fetchMock)).response_format).toBeUndefined();
  });

  it('structuredOutput:true keeps the legacy json_object shape on GitHub Models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'standard-model', structuredOutput: true });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect((await callBody(fetchMock)).response_format).toEqual({ type: 'json_object' });
  });

  it('returns model text from GitHub Models responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello from github models' }, finish_reason: 'length' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'gpt-4o-mini' });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: 'hello from github models', finishReason: 'length' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes deep and fix tiers to their configured models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({
      apiKey: 'token',
      model: 'standard-model',
      deepModel: 'deep-model',
      fixModel: 'fix-model',
    });

    await provider.complete({ prompt: 'p', systemPrompt: 's', modelTier: 'deep' });
    await provider.complete({ prompt: 'p', systemPrompt: 's', modelTier: 'fix' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('deep-model');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('fix-model');
  });

  it('uses a 16384 token response budget by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'standard-model' });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(16384);
  });

  it('does not request JSON object mode by default on GitHub Models', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'standard-model' });
    await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect((await callBody(fetchMock)).response_format).not.toBeUndefined();
    expect((await callBody(fetchMock)).response_format.type).toBe('json_schema');
  });

  it('returns an error payload when GitHub Models rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
      json: async () => ({ error: { message: 'rate limited' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'gpt-4o-mini', maxRetries: 0 });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result.text).toBe('');
    expect(result.error).toContain('rate limited');
  });

  it('stops retrying when GitHub Models returns a non-retryable error payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { code: 400, message: 'invalid model' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'gpt-4o-mini', maxRetries: 2 });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: '', error: 'invalid model', isRateLimit: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a GitHub Models API error and succeeds on the next attempt', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: { code: 503, message: 'temporary outage' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'github recovered' } }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'gpt-4o-mini', maxRetries: 1 });
    const promise = provider.complete({ prompt: 'p', systemPrompt: 's' });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ text: 'github recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
