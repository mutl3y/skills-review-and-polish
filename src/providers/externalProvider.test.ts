import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubModelsProvider, OpenRouterProvider } from './externalProvider';

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
      json: async () => ({ choices: [{ message: { content: 'hello from openrouter' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider({ apiKey: 'token', model: 'openai/gpt-4o-mini' });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: 'hello from openrouter' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('returns model text from GitHub Models responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello from github models' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new GitHubModelsProvider({ apiKey: 'token', model: 'gpt-4o-mini' });
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

    expect(result).toEqual({ text: 'hello from github models' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
