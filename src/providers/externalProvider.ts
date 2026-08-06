/**
 * External LLM provider implementations for OpenRouter and GitHub Copilot.
 *
 * These are used when `skillsReviewAndPolish.provider` is set to
 * `"openrouter"` (requires an API key stored in VS Code SecretStorage via
 * the `setApiKey` command) or `"copilot"` (uses a GitHub token via the
 * Copilot API).
 */

import { LlmProvider, LlmRequest, LlmResponse } from '../core/types';
import { LLM_RESPONSE_JSON_SCHEMA_BODY } from './llmResponseSchema';
import { redactSecrets } from '../core/redact';
import { CHARS_PER_TOKEN } from '../core/tokenBudget';

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
  /**
   * Real editor version string for the Copilot `Editor-Version` header
   * (e.g. `vscode/1.90.0`). When omitted, falls back to the
   * `COPILOT_EDITOR_VERSION` env var, then a current default. Supplied by the
   * extension host from `vscode.version` so we don't spoof a version we don't
   * have.
   */
  editorVersion?: string;
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
        lastError = redactSecrets(String(apiErr.message ?? apiErr));
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
      lastError = redactSecrets(String(e));
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

  private resolveMaxTokens(prompt: string, multiplier = 1): number {
    return resolveMaxTokens({
      prompt,
      multiplier,
      adaptiveMaxTokens: this.adaptiveMaxTokens,
      adaptiveMaxTokensCap: this.adaptiveMaxTokensCap,
      adaptiveCharsPerToken: this.adaptiveCharsPerToken,
      minAdaptiveTokens: this.minAdaptiveTokens,
      maxTokens: this.maxTokens,
      contextLength: this.contextLength,
    });
  }
}

// --------------------------------------------------------------------------
// GitHub Copilot API
// --------------------------------------------------------------------------

/**
 * Calls the GitHub Copilot API (`api.githubcopilot.com`).
 *
 * This is the OpenAI-compatible endpoint that backs Copilot chat. It uses the
 * user's Copilot subscription — no separate API key or per-token billing. Auth
 * is a GitHub token (`GITHUB_TOKEN` env or `gh auth token`) sent as a Bearer
 * token, plus the `Copilot-Integration-Id` / `Editor-Version` headers Copilot
 * expects.
 *
 * Distinct from the discontinued GitHub Models endpoint
 * (`models.inference.ai.azure.com`). Model IDs are Copilot IDs (e.g.
 * `gpt-4o-mini`, `gpt-4.1`, `gpt-5-mini`, `claude-sonnet-4.5`).
 */
export class CopilotProvider implements LlmProvider {
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
  private readonly editorVersion: string;
  private static readonly BASE_URL = 'https://api.githubcopilot.com/chat/completions';

  constructor(opts: ExternalProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || 'gpt-4o-mini';
    this.deepModel = opts.deepModel;
    this.fixModel = opts.fixModel;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_RESPONSE_TOKENS;
    this.adaptiveMaxTokens = opts.adaptiveMaxTokens ?? false;
    this.adaptiveMaxTokensCap = opts.adaptiveMaxTokensCap ?? DEFAULT_ADAPTIVE_MAX_RESPONSE_TOKENS;
    this.minAdaptiveTokens = opts.minAdaptiveTokens ?? DEFAULT_MIN_ADAPTIVE_RESPONSE_TOKENS;
    this.adaptiveCharsPerToken = Math.max(1, opts.adaptiveCharsPerToken ?? DEFAULT_ADAPTIVE_CHARS_PER_TOKEN);
    this.maxRetries = opts.maxRetries ?? 2;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.structuredOutput = opts.structuredOutput ?? 'schema';
    this.contextLength = opts.contextLength;
    this.temperature = opts.temperature ?? 0;
    this.topP = opts.topP ?? 0;
    this.editorVersion = opts.editorVersion ?? process.env.COPILOT_EDITOR_VERSION ?? 'vscode/1.90.0';
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
      CopilotProvider.BASE_URL,
      this.buildBody(modelToUse, req),
      {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Copilot-Integration-Id': 'vscode-chat',
        // The Copilot API feature-gates on the editor version. Use the real
        // editor version from the extension host (or COPILOT_EDITOR_VERSION
        // override) rather than spoofing a fixed version.
        'Editor-Version': this.editorVersion,
      },
      this.maxRetries,
      this.requestTimeoutMs,
      req.token,
    );
  }

  private buildBody(model: string, req: LlmRequest): ChatBody {
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

  private resolveMaxTokens(prompt: string, multiplier = 1): number {
    return resolveMaxTokens({
      prompt,
      multiplier,
      adaptiveMaxTokens: this.adaptiveMaxTokens,
      adaptiveMaxTokensCap: this.adaptiveMaxTokensCap,
      adaptiveCharsPerToken: this.adaptiveCharsPerToken,
      minAdaptiveTokens: this.minAdaptiveTokens,
      maxTokens: this.maxTokens,
      contextLength: this.contextLength,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Shared output-token budget math for external providers (OpenRouter and
 * Copilot). Single source of truth so the two providers can't drift.
 *
 * When adaptive max-tokens is OFF, returns the fixed `maxTokens` cap (scaled
 * by the per-wave multiplier).
 *
 * When adaptive is ON, the output budget must reach the model's real
 * generation cap for large documents. Deriving `desired` purely from input
 * length under-sizes the budget: a 293K-char skill yields only ~73K output
 * tokens, but models like deepseek-v4-flash can emit up to 384K output
 * tokens. So we take the max of (input-derived estimate, the model's adaptive
 * cap) — the model stops early when the document is small, but large
 * documents get the full generation budget instead of being silently
 * truncated.
 *
 * The floor is scaled by the multiplier too, otherwise the fixed
 * minAdaptiveTokens floor (16384) overrides the per-wave multiplier for
 * small-prompt waves and silently caps output at 16K tokens (the
 * ambiguities/contradiction waves then truncate at ~17K regardless of
 * model). See plan item 4 follow-up / e61 deep-model investigation.
 */
function resolveMaxTokens(
  opts: {
    prompt: string;
    multiplier: number;
    adaptiveMaxTokens: boolean;
    adaptiveMaxTokensCap: number;
    adaptiveCharsPerToken: number;
    minAdaptiveTokens: number;
    maxTokens: number;
    /** Optional model context length (tokens). Bounds output so input + output fit the window. */
    contextLength?: number;
  },
): number {
  const { prompt, multiplier, adaptiveMaxTokens, adaptiveMaxTokensCap, adaptiveCharsPerToken, minAdaptiveTokens, maxTokens, contextLength } = opts;
  const scaledCap = Math.round(adaptiveMaxTokensCap * multiplier);
  let result: number;
  if (!adaptiveMaxTokens) {
    result = Math.round(maxTokens * multiplier);
  } else {
    const desired = Math.max(
      Math.ceil(prompt.length / adaptiveCharsPerToken) * multiplier,
      scaledCap,
    );
    const floor = Math.min(minAdaptiveTokens * multiplier, scaledCap);
    const cap = Math.max(maxTokens * multiplier, scaledCap);
    result = clamp(desired, floor, cap);
  }
  // Bound output by the model's context window so input + output fit, or the
  // provider returns a hard error / truncates. Reserve headroom for the system
  // prompt + framing. The bound is a hard ceiling: never send more than the
  // window allows, even if that means going below the adaptive floor (sending
  // an oversized max_tokens would error/truncate, which is worse than a small
  // response). Only apply when it meaningfully reduces the result. Applied in
  // BOTH adaptive and non-adaptive modes — a large multiplier on a small
  // context model can otherwise exceed the window.
  if (contextLength && contextLength > 0) {
    const inputTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN);
    const maxOutput = Math.max(1, contextLength - inputTokens - CONTEXT_HEADROOM_TOKENS);
    if (maxOutput < result) {
      result = Math.min(result, maxOutput);
    }
  }
  return result;
}

/** Headroom (tokens) reserved for system prompt + framing when bounding output by context. */
const CONTEXT_HEADROOM_TOKENS = 2048;

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
      const body = (await response.json()) as Record<string, unknown>;
      // If the body carries an `error` key, return it so fetchWithRetry can
      // inspect it (e.g. for the structured-output fallback). Otherwise the
      // response is a client error with no usable error payload — throw so it
      // is surfaced as a failure rather than silently treated as success.
      if (body && typeof body === 'object' && 'error' in body) {
        return body;
      }
      throw new HttpError(`HTTP ${response.status}`, response.status);
    } catch {
      throw new HttpError(`HTTP ${response.status}`, response.status);
    }
  }
  if (!response.ok && response.status !== 429) {
    // Don't include response body — it may contain session tokens, debug info,
    // or other sensitive data that would leak into user-visible error messages.
    throw new HttpError(`HTTP ${response.status}`, response.status);
  }
  // For 429 (and ok), parse the body defensively — a rate-limit response may
  // be a non-JSON HTML/plain-text page. Guard so a JSON parse error doesn't
  // mask the real rate-limit signal.
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    if (response.status === 429) {
      return { error: { message: 'Rate limited (HTTP 429)', code: 429 } };
    }
    throw new HttpError(`HTTP ${response.status}`, response.status);
  }
}

function getApiError(resp: Record<string, unknown>): ApiError | undefined {
  return resp['error'] as ApiError | undefined;
}

function isRetryable(code: number | string | undefined): boolean {
  const n = Number(code);
  if (n === 429 || n === 500 || n === 502 || n === 503 || n === 504) return true;
  // Some providers return a string code (e.g. "rate_limit_exceeded") that
  // Number() turns into NaN. Match the text so those rate limits are retried
  // instead of being treated as permanent failures.
  if (typeof code === 'string') {
    const lower = code.toLowerCase();
    return lower.includes('rate') || lower.includes('429') || lower.includes('timeout')
      || lower.includes('overloaded') || lower.includes('unavailable');
  }
  return false;
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
  // NOTE: bare 'exceeded' is intentionally NOT matched — "max_tokens exceeded"
  // or "context_length exceeded" are output-cap errors, not rate limits, and
  // misclassifying them would trigger wrong backoff/retry handling. Only
  // rate-limit-specific "exceeded" phrases count.
  return lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')
    || lower.includes('userconcurrentrequests') || lower.includes('userbymodelbyminute')
    || lower.includes('rate limit exceeded') || lower.includes('quota exceeded')
    || lower.includes('requests exceeded');
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
