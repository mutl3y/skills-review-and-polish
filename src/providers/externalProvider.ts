/**
 * External LLM provider implementations for OpenRouter and GitHub Models.
 *
 * These are used when `skillsReviewAndPolish.provider` is set to
 * `"openrouter"` or `"githubModels"` (requires an API key stored in VS Code
 * SecretStorage via the `setApiKey` command).
 */

import { LlmProvider, LlmRequest, LlmResponse } from '../core/types';

/** Shared option bag for both external providers. */
export interface ExternalProviderOptions {
  apiKey: string;
  /** Model identifier to use (e.g. "gpt-4o-mini", "openai/gpt-4o"). */
  model: string;
  /** Maximum tokens in the response (default 4096). */
  maxTokens?: number;
  /** Maximum retries on 429 / 5xx (default 2). */
  maxRetries?: number;
}

// --------------------------------------------------------------------------
// OpenRouter
// --------------------------------------------------------------------------

/**
 * Calls the OpenRouter chat-completions API.
 * https://openrouter.ai/docs
 */
export class OpenRouterProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly maxRetries: number;

  constructor(opts: ExternalProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'openai/gpt-4o-mini';
    this.maxTokens = opts.maxTokens ?? 4096;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.prompt },
      ],
      max_tokens: this.maxTokens,
    });

    return this.callWithRetry('https://openrouter.ai/api/v1/chat/completions', body);
  }

  private async callWithRetry(url: string, body: string): Promise<LlmResponse> {
    let lastError = '';
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential back-off: 1 s, 2 s
        await sleep(1000 * attempt);
      }
      try {
        const resp = await fetchJson(url, body, {
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'vscode://skills-review-and-polish',
          'X-Title': 'Skills Review and Polish',
        });
        const apiErr = getApiError(resp);
        if (apiErr) {
          lastError = String(apiErr.message ?? apiErr);
          if (!isRetryable(apiErr.code ?? apiErr.status)) break;
          continue;
        }
        const choices = resp['choices'] as Array<Record<string, unknown>> | undefined;
        const text: string = (choices?.[0]?.['message'] as Record<string, unknown> | undefined)?.['content'] as string ?? '';
        return { text };
      } catch (e) {
        lastError = String(e);
      }
    }
    return { text: '', error: lastError };
  }
}

// --------------------------------------------------------------------------
// GitHub Models
// --------------------------------------------------------------------------

/**
 * Calls the GitHub Models inference API (Azure AI endpoint).
 * https://github.com/marketplace/models
 */
export class GitHubModelsProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly maxRetries: number;
  private static readonly BASE_URL =
    'https://models.inference.ai.azure.com/chat/completions';

  constructor(opts: ExternalProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'gpt-4o-mini';
    this.maxTokens = opts.maxTokens ?? 4096;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.prompt },
      ],
      max_tokens: this.maxTokens,
    });

    let lastError = '';
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(1000 * attempt);
      try {
        const resp = await fetchJson(GitHubModelsProvider.BASE_URL, body, {
          Authorization: `Bearer ${this.apiKey}`,
        });
        const apiErr = getApiError(resp);
        if (apiErr) {
          lastError = String(apiErr.message ?? apiErr);
          if (!isRetryable(apiErr.code ?? apiErr.status)) break;
          continue;
        }
        const choices = resp['choices'] as Array<Record<string, unknown>> | undefined;
        const text: string = (choices?.[0]?.['message'] as Record<string, unknown> | undefined)?.['content'] as string ?? '';
        return { text };
      } catch (e) {
        lastError = String(e);
      }
    }
    return { text: '', error: lastError };
  }
}

// --------------------------------------------------------------------------
// Shared utilities
// --------------------------------------------------------------------------

async function fetchJson(
  url: string,
  body: string,
  extraHeaders: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body,
  });
  if (!response.ok && response.status !== 429) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

type ApiError = { message?: string; code?: number | string; status?: number | string };

function getApiError(resp: Record<string, unknown>): ApiError | undefined {
  return resp['error'] as ApiError | undefined;
}

function isRetryable(code: number | string | undefined): boolean {
  const n = Number(code);
  return n === 429 || n === 500 || n === 502 || n === 503 || n === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
