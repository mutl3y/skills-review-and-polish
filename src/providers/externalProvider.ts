/**
 * External LLM provider implementations for OpenRouter and GitHub Models.
 *
 * These are used when `skillsReviewAndPolish.provider` is set to
 * `"openrouter"` or `"githubModels"` (requires an API key stored in VS Code
 * SecretStorage via the `setApiKey` command).
 */

import { LlmProvider, LlmRequest, LlmResponse } from '../core/types';

/**
 * HTTP error with status code — allows retry logic to distinguish
 * permanent client errors (4xx) from transient server errors (5xx).
 */
export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

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
// Shared retry / fetch logic
// --------------------------------------------------------------------------

/** API error shape returned by OpenRouter / GitHub Models / Azure. */
type ApiError = { message?: string; code?: number | string; status?: number | string };

/** Shared request body built by each provider's `complete()` method. */
interface ChatBody {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
}

/**
 * POST a JSON request with exponential back-off retry on 429 / 5xx.
 *
 * Both `OpenRouterProvider` and `GitHubModelsProvider` delegate to this
 * function so the retry loop is defined in exactly one place.
 */
async function fetchWithRetry(
  url: string,
  body: ChatBody,
  extraHeaders: Record<string, string>,
  maxRetries: number,
): Promise<LlmResponse> {
  const jsonBody = JSON.stringify(body);
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(1000 * attempt);
    }
    try {
      const resp = await fetchJson(url, jsonBody, extraHeaders);
      const apiErr = getApiError(resp);
      if (apiErr) {
        lastError = String(apiErr.message ?? apiErr);
        if (!isRetryable(apiErr.code ?? apiErr.status)) break;
        continue;
      }
      const text = extractText(resp);
      return { text };
    } catch (e) {
      if (e instanceof HttpError && isNonRetryableStatus(e.status)) {
        lastError = `HTTP ${e.status}: ${e.message}`;
        break;
      }
      lastError = String(e).replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
    }
  }
  return { text: '', error: lastError };
}

/** Pull the assistant text from a chat-completions response payload. */
function extractText(resp: Record<string, unknown>): string {
  const choices = resp['choices'] as Array<Record<string, unknown>> | undefined;
  return ((choices?.[0]?.['message'] as Record<string, unknown> | undefined)?.['content'] as string) ?? '';
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
    return fetchWithRetry(
      'https://openrouter.ai/api/v1/chat/completions',
      { model: this.model, messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.prompt },
      ], max_tokens: this.maxTokens },
      {
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'vscode://skills-review-and-polish',
        'X-Title': 'Skills Review and Polish',
      },
      this.maxRetries,
    );
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
    return fetchWithRetry(
      GitHubModelsProvider.BASE_URL,
      { model: this.model, messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.prompt },
      ], max_tokens: this.maxTokens },
      { Authorization: `Bearer ${this.apiKey}` },
      this.maxRetries,
    );
  }
}

// --------------------------------------------------------------------------
// HTTP / JSON utilities (low-level, no retry)
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
    // Don't include response body — it may contain session tokens, debug info,
    // or other sensitive data that would leak into user-visible error messages.
    throw new HttpError(`HTTP ${response.status}`, response.status);
  }
  return (await response.json()) as Record<string, unknown>;
}

function getApiError(resp: Record<string, unknown>): ApiError | undefined {
  return resp['error'] as ApiError | undefined;
}

function isRetryable(code: number | string | undefined): boolean {
  const n = Number(code);
  return n === 429 || n === 500 || n === 502 || n === 503 || n === 504;
}

/** Status codes that should never be retried — client errors are permanent. */
function isNonRetryableStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 422;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
