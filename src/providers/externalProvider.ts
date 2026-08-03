/**
 * External LLM provider implementations for OpenRouter.
 *
 * These are used when `skillsReviewAndPolish.provider` is set to
 * `"openrouter"` (requires an API key stored in VS Code SecretStorage via
 * the `setApiKey` command).
 */

import { LlmProvider, LlmRequest, LlmResponse, BatchRequestItem, BatchResult, BatchResultItem, BatchStatus } from '../core/types';
import { LLM_RESPONSE_JSON_SCHEMA_BODY } from './llmResponseSchema';

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
  /** Model identifier for deep/reasoning operations (optional, falls back to model). */
  deepModel?: string;
  /** Model identifier for fix operations (optional, falls back to model). */
  fixModel?: string;
  /** Maximum tokens in the response (default 16384). Used as the cap when adaptive mode is OFF. */
  maxTokens?: number;
  /** Enable per-request max_tokens sizing from prompt length. */
  adaptiveMaxTokens?: boolean;
  /** Upper bound when adaptive mode is ON (default 65536). Larger than `maxTokens` so long prompts can request more output. */
  adaptiveMaxTokensCap?: number;
  /** Lower bound when adaptive max-tokens mode is enabled (default 4096). */
  minAdaptiveTokens?: number;
  /** Heuristic scale in adaptive mode: desiredTokens = ceil(promptChars / this value). */
  adaptiveCharsPerToken?: number;
  /** Maximum retries on 429 / 5xx (default 2). */
  maxRetries?: number;
  /** Maximum wall-clock time for a single HTTP request (default 120000ms). */
  requestTimeoutMs?: number;
  /**
   * Request OpenAI-compatible structured JSON response mode.
   *   - `'schema'` (default when this option is unset): strict JSON schema mode
   *     via `response_format: { type: 'json_schema', json_schema: { ... } }`.
   *     OpenRouter translates this per provider — OpenAI/Fireworks passthrough,
   *     Gemini → `generationConfig.responseSchema`, Anthropic → tool-use
   *     `input_schema`. This eliminates the `salvageTruncatedJSON` near-miss
   *     shapes that `json_object` mode produces on Gemini.
   *   - `true`: legacy `response_format: { type: 'json_object' }`. Kept for
   *     users who validated that mode on a specific model before schema mode
   *     existed.
   *   - `false`: no `response_format` field. Pre-existing default-off mode for
   *     models that reject both shapes.
   *
   * Default is `'schema'` because the live probe matrix
   * (`docs/plan/research/structured-output-provider-surfaces.md`) confirmed
   * that the current OpenRouter routes handle schema mode with no truncation
   * and exact adherence, while `json_object` causes the analyzer to drift
   * into invented sub-schemas that require `salvageTruncatedJSON`.
   */
  structuredOutput?: boolean | 'schema';
  /**
   * Optional: the input context length (in tokens) of the model. When
   * provided, the analyzer scales `MAX_ANALYSIS_DOCUMENT_CHARS` to a
   * fraction of this context so large-context models don't silently
   * truncate real production skills. When omitted, the analyzer falls
   * back to a 200K-char budget and logs a warning.
   *
   * For OpenRouter, resolve via `modelCatalog.resolveContextLength(model)`
   * at construction time.
   */
  contextLength?: number;
  /** Sampling controls. Defaults favor determinism for analyzer use. */
  temperature?: number;
  topP?: number;
}

/** Match the VS Code LM provider budget to reduce mid-JSON truncation. */
export const DEFAULT_MAX_RESPONSE_TOKENS = 16384;
export const DEFAULT_ADAPTIVE_MAX_RESPONSE_TOKENS = 65536;
export const DEFAULT_MIN_ADAPTIVE_RESPONSE_TOKENS = 4096;
export const DEFAULT_ADAPTIVE_CHARS_PER_TOKEN = 8;
/** Bound external provider calls so one stalled model response cannot hang analysis. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

// --------------------------------------------------------------------------
// Shared retry / fetch logic
// --------------------------------------------------------------------------

/** API error shape returned by OpenRouter. */
type ApiError = { message?: string; code?: number | string; status?: number | string };

/** Shared request body built by each provider's `complete()` method. */
interface ChatBody {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  response_format?:
    | { type: 'json_object' }
    | { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: unknown } };
}

/**
 * POST a JSON request with exponential back-off retry on 429 / 5xx.
 *
 * `OpenRouterProvider` delegates to this function so the retry loop is
 * defined in exactly one place.
 */
async function fetchWithRetry(
  url: string,
  body: ChatBody,
  extraHeaders: Record<string, string>,
  maxRetries: number,
  requestTimeoutMs: number,
  token?: LlmRequest['token'],
): Promise<LlmResponse> {
  let activeBody = body;
  let retriedWithoutStructuredOutput = false;
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(1000 * attempt);
    }
    try {
      const resp = await fetchJson(url, JSON.stringify(activeBody), extraHeaders, requestTimeoutMs, token);
      const apiErr = getApiError(resp);
      if (apiErr) {
        lastError = String(apiErr.message ?? apiErr);
        if (shouldRetryWithoutStructuredOutput(activeBody, apiErr.code ?? apiErr.status, lastError) && !retriedWithoutStructuredOutput) {
          activeBody = withoutStructuredOutput(activeBody);
          retriedWithoutStructuredOutput = true;
          attempt--;
          continue;
        }
        if (!isRetryable(apiErr.code ?? apiErr.status)) break;
        continue;
      }
      const text = extractText(resp);
      const finishReason = extractFinishReason(resp);
      if (
        shouldRetryWithoutStructuredOutputOnFinishReason(activeBody, finishReason, text)
        && !retriedWithoutStructuredOutput
      ) {
        activeBody = withoutStructuredOutput(activeBody);
        retriedWithoutStructuredOutput = true;
        attempt--;
        continue;
      }
      return { text, finishReason };
    } catch (e) {
      if (e instanceof HttpError && isNonRetryableStatus(e.status)) {
        lastError = `HTTP ${e.status}: ${e.message}`;
        if (shouldRetryWithoutStructuredOutput(activeBody, e.status, e.message) && !retriedWithoutStructuredOutput) {
          activeBody = withoutStructuredOutput(activeBody);
          retriedWithoutStructuredOutput = true;
          attempt--;
          continue;
        }
        break;
      }
      lastError = String(e).replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
      if (isTimeoutOrCancellationError(lastError)) break;
    }
  }
  return { text: '', error: lastError, isRateLimit: isRateLimitError(lastError) };
}

/** Pull the assistant text from a chat-completions response payload. */
function extractText(resp: Record<string, unknown>): string {
  const choices = resp['choices'] as Array<Record<string, unknown>> | undefined;
  return ((choices?.[0]?.['message'] as Record<string, unknown> | undefined)?.['content'] as string) ?? '';
}

function extractFinishReason(resp: Record<string, unknown>): string | undefined {
  const choices = resp['choices'] as Array<Record<string, unknown>> | undefined;
  const finishReason = choices?.[0]?.['finish_reason'];
  return typeof finishReason === 'string' ? finishReason : undefined;
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
  private readonly deepModel?: string;
  private readonly fixModel?: string;
  private readonly maxTokens: number;
  private readonly adaptiveMaxTokens: boolean;
  private readonly adaptiveMaxTokensCap: number;
  private readonly minAdaptiveTokens: number;
  private readonly adaptiveCharsPerToken: number;
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;
  private readonly structuredOutput: boolean | 'schema';
  private readonly contextLength?: number;
  private readonly temperature: number;
  private readonly topP: number;

  constructor(opts: ExternalProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'openai/gpt-4o-mini';
    this.deepModel = opts.deepModel;
    this.fixModel = opts.fixModel;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_RESPONSE_TOKENS;
    this.adaptiveMaxTokens = opts.adaptiveMaxTokens ?? false;
    this.adaptiveMaxTokensCap = opts.adaptiveMaxTokensCap ?? DEFAULT_ADAPTIVE_MAX_RESPONSE_TOKENS;
    this.minAdaptiveTokens = opts.minAdaptiveTokens ?? DEFAULT_MIN_ADAPTIVE_RESPONSE_TOKENS;
    this.adaptiveCharsPerToken = Math.max(1, opts.adaptiveCharsPerToken ?? DEFAULT_ADAPTIVE_CHARS_PER_TOKEN);
    this.maxRetries = opts.maxRetries ?? 2;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    // Default to schema mode: live probe matrix showed it is the only mode
    // that produces strict adherence on the current OpenRouter routes.
    this.structuredOutput = opts.structuredOutput ?? 'schema';
    this.contextLength = opts.contextLength;
    this.temperature = opts.temperature ?? 0;
    this.topP = opts.topP ?? 0;
  }

  getContextLength(): number | undefined {
    return this.contextLength;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    // Tier routing: fix → fixModel, deep → deepModel, else → model
    const modelToUse = req.modelId
      || (req.modelTier === 'fix' && this.fixModel ? this.fixModel
        : req.modelTier === 'deep' && this.deepModel ? this.deepModel
        : this.model);
    return fetchWithRetry(
      'https://openrouter.ai/api/v1/chat/completions',
      this.buildBody(modelToUse, req),
      {
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'vscode://skills-review-and-polish',
        'X-Title': 'Skills Review and Polish',
      },
      this.maxRetries,
      this.requestTimeoutMs,
      req.token,
    );
  }

  private buildBody(model: string, req: LlmRequest): ChatBody {
    // OpenRouter translates response_format per underlying provider:
    //   - OpenAI / Fireworks: passthrough
    //   - Gemini: json_schema -> generationConfig.responseSchema; json_object
    //     -> responseMimeType only (no schema enforcement, prone to drift)
    //   - Anthropic: json_schema -> tool-use with input_schema
    // A per-request `disableStructuredOutput` override (set by the analyzer
    // after a non-stop finish reason on a wave) drops response_format even in
    // schema mode — see plan item 3a.
    const mode: boolean | 'schema' = req.disableStructuredOutput ? false : this.structuredOutput;
      return {
      model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.prompt },
      ],
      max_tokens: this.resolveMaxTokens(req.prompt, req.maxTokensMultiplier ?? 1),
      temperature: this.temperature,
      top_p: this.topP,
      ...buildResponseFormat(mode),
    };
  }

  /**
   * Submit a batch of requests to the OpenRouter Batch API.
   *
   * Batch-only models (e.g. some deep-reasoning models) return 404 on the
   * standard chat endpoint with the message "This model is only available
   * through the Batch API." — those must be routed here instead. The schema
   * (`LLM_RESPONSE_JSON_SCHEMA_BODY`) is identical to single-request mode;
   * only the transport envelope differs (per-item `custom_id` correlation).
   *
   * OpenRouter requires the top-level `model` and `endpoint` fields to appear
   * before `requests` in the payload, so they are passed explicitly here.
   *
   * @returns the batch id to pass to `pollBatch`.
   */
  async submitBatch(
    requests: BatchRequestItem[],
    opts: { model?: string; endpoint?: string } = {},
  ): Promise<string> {
    const url = 'https://openrouter.ai/api/beta/batches';
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'vscode://skills-review-and-polish',
      'X-Title': 'Skills Review and Polish',
      'Content-Type': 'application/json',
    };
    const model = opts.model ?? this.model;
    const endpoint = opts.endpoint ?? '/v1/chat/completions';
    const resp = await fetchJson(
      url,
      JSON.stringify({ model, endpoint, requests }),
      headers,
      this.requestTimeoutMs,
    );
    const apiErr = getApiError(resp);
    if (apiErr) {
      throw new HttpError(String(apiErr.message ?? apiErr), Number(apiErr.code ?? apiErr.status ?? 0) || 400);
    }
    const id = resp['id'] as string | undefined;
    if (!id) {
      throw new HttpError('Batch submission returned no id', 500);
    }
    return id;
  }

  /**
   * Poll a batch job until it reaches a terminal state or the timeout elapses.
   *
   * Retries transient 5xx/429 on the status poll. Returns the full
   * `BatchResult` (including `results` when `status === 'completed'`).
   */
  async pollBatch(
    batchId: string,
    opts: { pollIntervalMs?: number; maxWaitMs?: number; token?: LlmRequest['token'] } = {},
  ): Promise<BatchResult> {
    const pollIntervalMs = opts.pollIntervalMs ?? 2000;
    const maxWaitMs = opts.maxWaitMs ?? this.requestTimeoutMs;
    const deadline = Date.now() + maxWaitMs;
    const url = `https://openrouter.ai/api/beta/batches/${encodeURIComponent(batchId)}`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'vscode://skills-review-and-polish',
      'X-Title': 'Skills Review and Polish',
    };
    while (true) {
      if (opts.token?.isCancellationRequested) {
        throw new Error('Batch poll cancelled');
      }
      let resp: Record<string, unknown>;
      try {
        resp = await fetchJson(url, '', headers, this.requestTimeoutMs, opts.token, 'GET');
      } catch (e) {
        // 404 is transient here: a freshly submitted batch is not queryable
        // until OpenRouter finishes validating it (status `validating` →
        // `in_progress`). Retry on 404/5xx/429 until the deadline.
        const retryable = e instanceof HttpError && (e.status === 404 || isRetryable(e.status));
        if (retryable) {
          if (Date.now() > deadline) throw e;
          await sleep(pollIntervalMs);
          continue;
        }
        throw e;
      }
      const apiErr = getApiError(resp);
      if (apiErr) {
        throw new HttpError(String(apiErr.message ?? apiErr), Number(apiErr.code ?? apiErr.status ?? 0) || 400);
      }
      const status = (resp['status'] as BatchStatus | undefined) ?? 'pending';
      if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'expired') {
        return {
          id: batchId,
          status,
          results: resp['results'] as BatchResultItem[] | undefined,
          error: resp['error'] as string | undefined,
        };
      }
      if (Date.now() > deadline) {
        return { id: batchId, status };
      }
      await sleep(pollIntervalMs);
    }
  }

  private resolveMaxTokens(prompt: string, multiplier = 1): number {
    const scaledCap = Math.round(this.adaptiveMaxTokensCap * multiplier);
    if (!this.adaptiveMaxTokens) return Math.round(this.maxTokens * multiplier);
    // Output budget must reach the model's real generation cap for large
    // documents. Deriving `desired` purely from input length under-sizes the
    // budget: a 293K-char skill yields only ~73K output tokens, but models
    // like deepseek-v4-flash can emit up to 384K output tokens. So we take
    // the max of (input-derived estimate, the model's adaptive cap) — the
    // model stops early when the document is small, but large documents get
    // the full generation budget instead of being silently truncated.
    const desired = Math.max(
      Math.ceil(prompt.length / this.adaptiveCharsPerToken) * multiplier,
      scaledCap,
    );
    // Scale the floor by the multiplier too, otherwise the fixed
    // minAdaptiveTokens floor (16384) overrides the per-wave multiplier for
    // small-prompt waves and silently caps output at 16K tokens (the
    // ambiguities/contradiction waves then truncate at ~17K regardless of
    // model). See plan item 4 follow-up / e61 deep-model investigation.
    const floor = Math.min(this.minAdaptiveTokens * multiplier, scaledCap);
    const cap = Math.max(this.maxTokens * multiplier, scaledCap);
    return clamp(desired, floor, cap);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Map the `structuredOutput` option to the OpenRouter/OpenAI-compatible
 * `response_format` body fragment.
 *
 *   - `'schema'` → strict JSON schema envelope (default)
 *   - `true`     → legacy `json_object` (kept for backward compatibility)
 *   - `false`    → omit `response_format` entirely
 */
function buildResponseFormat(
  mode: boolean | 'schema',
): { response_format: ChatBody['response_format'] } | Record<string, never> {
  if (mode === 'schema') {
    return {
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: LLM_RESPONSE_JSON_SCHEMA_BODY.name,
          strict: LLM_RESPONSE_JSON_SCHEMA_BODY.strict,
          schema: LLM_RESPONSE_JSON_SCHEMA_BODY.schema,
        },
      },
    };
  }
  if (mode === true) {
    return { response_format: { type: 'json_object' } };
  }
  return {};
}

// --------------------------------------------------------------------------
// HTTP / JSON utilities (low-level, no retry)
// --------------------------------------------------------------------------

async function fetchJson(
  url: string,
  body: string,
  extraHeaders: Record<string, string>,
  requestTimeoutMs: number,
  token?: LlmRequest['token'],
  method: 'GET' | 'POST' = 'POST',
): Promise<Record<string, unknown>> {
  if (token?.isCancellationRequested) {
    throw new Error('Request cancelled');
  }
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  const cancellation = token?.onCancellationRequested(() => controller.abort());
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: method === 'GET' ? undefined : body,
      signal: controller.signal,
    });
  } catch (e) {
    if (timedOut) {
      throw new Error(`Request timed out after ${requestTimeoutMs}ms`);
    }
    if (token?.isCancellationRequested) {
      throw new Error('Request cancelled');
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    cancellation?.dispose();
  }
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new HttpError(`HTTP ${response.status}`, response.status);
    }
  }
  if (!response.ok && response.status !== 429) {
    // Don't include response body — it may contain session tokens, debug info,
    // or other sensitive data that would leak into user-visible error messages.
    throw new HttpError(`HTTP ${response.status}`, response.status);
  }
  const rawResp = (await response.json()) as Record<string, unknown>;
  return rawResp;
}

function getApiError(resp: Record<string, unknown>): ApiError | undefined {
  return resp['error'] as ApiError | undefined;
}

function isRetryable(code: number | string | undefined): boolean {
  const n = Number(code);
  return n === 429 || n === 500 || n === 502 || n === 503 || n === 504;
}

function shouldRetryWithoutStructuredOutput(
  body: ChatBody,
  code: number | string | undefined,
  message: string,
): boolean {
  if (!body.response_format) return false;
  const n = Number(code);
  if (n !== 400 && n !== 422) return false;
  // Match provider error messages about any of the supported response_format
  // variants. Accept both spaced ("json schema") and underscored ("json_schema")
  // forms because OpenRouter uses the underscore form in error text.
  return /response[_ -]?format|structured output|json[_ -]?schema|json[_ -]?mode/i.test(message);
}

function withoutStructuredOutput(body: ChatBody): ChatBody {
  const { response_format: _responseFormat, ...rest } = body;
  return rest;
}

function shouldRetryWithoutStructuredOutputOnFinishReason(
  body: ChatBody,
  finishReason: string | undefined,
  responseText?: string,
): boolean {
  if (!body.response_format) return false;
  // Only retry on `error`. A `length` finish means the model hit the
  // output cap, which is fixed upstream of this call — retrying without
  // response_format does not raise the cap, so the retry is wasted.
  // The schema→no-format fallback exists for `error` because the
  // structured-output schema is sometimes the cause of provider-side
  // failure responses; that reasoning does not extend to length caps.
  //
  // Scoped to short bodies only: a long body that hit `error` is more
  // likely a real provider-side issue than a schema-fit issue. We do not
  // want to silently downgrade a 10K-char successful emission to a
  // no-format attempt. Threshold: 2048 chars covers every realistic
  // schema-fit failure (a JSON parse error is usually << 2K). The actual
  // assistant text is passed in (previously read from an unpopulated
  // `body._text` field, which made this guard dead code).
  if (responseText && responseText.length > 2048) return false;
  return finishReason === 'error';
}

/** Check if an error message indicates rate limiting. */
function isRateLimitError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')
    || lower.includes('userconcurrentrequests') || lower.includes('userbymodelbyminute')
    || lower.includes('exceeded');
}

function isTimeoutOrCancellationError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('timed out') || lower.includes('request cancelled');
}

/** Status codes that should never be retried — client errors are permanent. */
function isNonRetryableStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 422;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
