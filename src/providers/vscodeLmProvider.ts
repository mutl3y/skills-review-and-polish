import * as vscode from 'vscode';
import { LlmProvider, LlmRequest, LlmResponse } from '../core/types';
import { createLogger, Logger } from '../core/logger';

/** Runtime field added by Copilot model provider — not in @types/vscode yet. */
interface PricedLanguageModelChat extends vscode.LanguageModelChat {
  pricing?: string;
}

/** Runtime stream part shape — may carry a `.value` property (not in @types/vscode). */
interface StreamPartWithValue {
  value?: unknown;
}

/** Runtime error property that may appear on a sendRequest response object. */
interface ErrorProneResponse {
  error?: string;
}

/** Check if an error message indicates rate limiting (Copilot or generic). */
function isRateLimitError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')
    || lower.includes('userconcurrentrequests') || lower.includes('userbymodelbyminute')
    || lower.includes('exceeded');
}

/**
 * Number of fresh-stream retries for a mid-stream transport failure (e.g.
 * "Server error. Stream terminated"). The Copilot stream is flaky enough that
 * a single retry is often insufficient, so we allow a few attempts with
 * backoff before surfacing the error to the analyzer's retry chain.
 */
const STREAM_RETRY_ATTEMPTS = 3;

/** Backoff between stream retries, scaled by attempt number (attempt * this). */
const STREAM_RETRY_BACKOFF_MS = 500;

/** Minimal promise-based sleep used for stream-retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Base max_tokens for vscode.lm requests. */
const BASE_MAX_TOKENS = 16384;

/**
 * Resolve the max_tokens for a vscode.lm request, honoring the analyzer's
 * per-wave `maxTokensMultiplier` (ambiguities/contradiction waves request
 * extra headroom so they don't truncate mid-JSON). The external providers
 * honor this via resolveMaxTokens; vscode.lm must too, or the default
 * provider silently truncates large waves.
 */
function resolveMaxTokens(multiplier: number | undefined): number {
  const m = multiplier && multiplier > 0 ? multiplier : 1;
  return Math.round(BASE_MAX_TOKENS * m);
}

/**
 * Default provider — wraps VS Code's Language Model API (`vscode.lm`).
 * No API keys: uses the user's Copilot subscription.
 *
 * Notes for the port (from docs/plan/HANDOVER.md):
 *  - `selectChatModels` may return [] until the user is signed into Copilot or
 *    grants consent on first request — surface a friendly message in that case.
 *  - Prefer vendor 'copilot' over 'copilotcli' (the CLI vendor doesn't work in
 *    the extension host).
 *  - Use a generous max_tokens (16384) to avoid mid-JSON truncation — this was a
 *    real noise source in the original engine.
 *  - modelTier 'deep' should map to `deepModel` setting when configured.
 */
export class VsCodeLmProvider implements LlmProvider {
  private cachedStandard?: vscode.LanguageModelChat;
  private cachedDeep?: vscode.LanguageModelChat;
  private cachedFix?: vscode.LanguageModelChat;
  private readonly log: Logger = createLogger('provider');

  /** Optional callback fired the first time a model is selected (for logging). */
  onModelSelected?: (modelId: string) => void;

  constructor(
    private readonly standardModelId: string,
    private readonly deepModelId: string,
    private readonly fixModelId?: string,
  ) {}

  invalidate(): void {
    this.cachedStandard = undefined;
    this.cachedDeep = undefined;
    this.cachedFix = undefined;
  }

  /** Get the model ID that was auto-selected (for logging fallback). */
  getSelectedModelId(): string | undefined {
    return this.cachedStandard?.id;
  }

  /**
   * The smallest input context length across the three configured tiers.
   * Returns the most conservative value so the analyzer's document budget
   * fits every model the provider might serve. When no tier has been
   * resolved yet (cold cache), returns `undefined`.
   */
  getContextLength(): number | undefined {
    const contexts = [this.cachedStandard, this.cachedDeep, this.cachedFix]
      .filter((m): m is vscode.LanguageModelChat => !!m && typeof m.maxInputTokens === 'number')
      .map(m => m.maxInputTokens);
    if (contexts.length === 0) return undefined;
    return Math.min(...contexts);
  }

  /**
   * Eagerly resolve the standard (and deep, if configured) model so that
   * `getContextLength()` returns a real value before the first analysis
   * wave builds its prompt. Without this, every wave's prompt is built
   * against the 200K-char fallback budget because model selection is lazy.
   * Failures are non-fatal — `complete()` will surface a user-facing error.
   */
  async warmUp(): Promise<void> {
    if (!this.cachedStandard) {
      this.cachedStandard = await this.selectModel(this.standardModelId);
      if (this.cachedStandard && this.onModelSelected) {
        this.onModelSelected(this.cachedStandard.id);
      }
    }
  }

  private async selectModel(modelId: string): Promise<vscode.LanguageModelChat | undefined> {
    const allModels = await vscode.lm.selectChatModels();
    this.log.debug('models available', { count: allModels.length, ids: allModels.map(m => m.id).join(', ') });
    this.log.debug('model vendors', { vendors: allModels.map(m => `${m.id}:${m.vendor}`).join(', ') });

    if (allModels.length === 0) {
      this.log.info('no models available');
      vscode.window.showErrorMessage(
        'No language models available. Please sign in to GitHub Copilot or configure a specific model in Settings.',
      );
      return undefined;
    }

    // Parse pricing from live models (format: "27x", "9x", "1x", "0.33x", etc.)
    // Only Copilot vendor models have this pricing field.
    const modelToMultiplier = this.parsePricingFromModels(allModels);
    this.log.debug('pricing parsed', { modelsWithPricing: modelToMultiplier.size });

    // Models without pricing data (OpenRouter, etc.) are treated as safe for selection.
    // The pricing guard only applies to Copilot models where we know the cost.
    const safeTierIds = new Set(
      Array.from(modelToMultiplier.entries())
        .filter(([_, mult]) => mult <= 1)
        .map(([id, _]) => id),
    );
    this.log.debug('safe tier', { count: safeTierIds.size, ids: [...safeTierIds].join(', ') });

    const trimmed = modelId.trim();

    if (trimmed) {
      this.log.debug('user requested specific model', { modelId: trimmed });
      const byId = await vscode.lm.selectChatModels({ id: trimmed });
      this.log.debug('selectChatModels({id}) result', { count: byId.length });

      if (byId.length > 0) {
        // Pricing guard only applies to Copilot models with known pricing.
        // Models without pricing data (OpenRouter, etc.) pass through — the user explicitly chose them.
        const multiplier = modelToMultiplier.get(trimmed);
        if (multiplier !== undefined && !safeTierIds.has(trimmed)) {
          this.log.info('model rejected: expensive', { modelId: trimmed, multiplier });
          vscode.window.showErrorMessage(
            `Model "${trimmed}" is not in the safe tier (multiplier ${multiplier}x > 1x). ` +
              `Please select a model ≤1x in Settings.`,
          );
          return undefined;
        }

        this.log.debug('found model instances', { modelId: trimmed, count: byId.length });
        const preferred = this.findPreferredCopilotModel(byId);
        if (!preferred) {
          this.log.info('model rejected: copilotcli vendor only', { modelId: trimmed });
          vscode.window.showErrorMessage(
            `Model "${trimmed}" is only available via GitHub Copilot CLI (copilotcli vendor), which does not work in VS Code extensions. ` +
              `Please select a Copilot or OpenRouter model.`,
          );
          return undefined;
        }
        this.log.debug('model selected', { modelId: trimmed, vendor: preferred.vendor, name: preferred.name });
        return preferred;
      }

      // Model ID not found at all — stop, don't fall back
      this.log.info('model not found', { modelId: trimmed });
      vscode.window.showErrorMessage(
        `Requested model "${trimmed}" is not available. ` +
          'Please select a model via "Skills Review: Select Analysis Model" command, ' +
          'or configure an OpenRouter API key for access to additional models.',
      );
      return undefined;
    }

    // No model specified — require explicit selection to prevent uncontrolled fallback
    this.log.info('no model specified - requiring explicit selection');
    vscode.window.showErrorMessage(
      'No model specified. Please run "Skills Review: Select Analysis Model" to choose a model. ' +
        'For OpenRouter models, configure an API key via "Skills Review: Set API Key".',
    );
    return undefined;
  }

  private findPreferredCopilotModel(models: readonly vscode.LanguageModelChat[]): vscode.LanguageModelChat | undefined {
    // Prefer copilot vendor, but accept openrouter vendor models as they work via VS Code LM
    return models.find((model) => model.vendor === 'copilot' || model.vendor === 'openrouter');
  }

  private async collectStreamText(response: { stream: AsyncIterable<unknown>; text?: unknown }): Promise<{ text: string; error?: string; isRateLimit?: boolean }> {
    let text = '';
    let partNum = 0;

    try {
      for await (const part of response.stream) {
        partNum++;
        let partStr = '';
        if (typeof part === 'string') {
          partStr = part;
        } else if (part && typeof part === 'object') {
          partStr = 'value' in part ? String((part as StreamPartWithValue).value) : String(part);
        } else {
          partStr = String(part);
        }

        if (partNum <= 3) {
          this.log.trace('stream part received', { partNum, preview: partStr.substring(0, 100) });
        }
        text += partStr;
      }
    } catch (iterErr) {
      const errMsg = iterErr instanceof Error ? iterErr.message : String(iterErr);
      this.log.info('stream iteration error', { error: errMsg, textSoFar: text.length });
      return { text: '{}', error: `Failed to iterate response: ${errMsg}`, isRateLimit: isRateLimitError(errMsg) };
    }

    if (!text) {
      this.log.info('empty response after iteration', { partsReceived: partNum });
      return { text: '{}', error: 'Model returned empty text response', isRateLimit: false };
    }

    return { text };
  }

  private parsePricingFromModels(models: vscode.LanguageModelChat[]): Map<string, number> {
    const multipliers = new Map<string, number>();
    for (const model of models) {
      const pricing = (model as PricedLanguageModelChat).pricing;
      if (pricing && typeof pricing === 'string') {
        const match = pricing.match(/^([\d.]+)x$/);
        if (match) {
          multipliers.set(model.id, parseFloat(match[1]));
        }
      }
    }
    this.log.debug('pricing parsed from models', { withPricing: multipliers.size, total: models.length });
    // Only log models without pricing at trace level to avoid noise
    const withoutPricing = models.filter(m => !multipliers.has(m.id));
    if (withoutPricing.length > 0) {
      this.log.trace('models without Copilot pricing (will be treated as safe for selection)', {
        count: withoutPricing.length,
        ids: withoutPricing.map(m => `${m.id} (${m.vendor})`).join(', '),
      });
    }
    return multipliers;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    // Priority: explicit modelId > fix tier > deep tier > standard
    const isFix = request.modelTier === 'fix';
    const isDeep = request.modelTier === 'deep';
    const tier = isFix ? 'fix' : isDeep ? 'deep' : 'standard';
    const modelIdRequested = request.modelId
      || (isFix ? this.fixModelId : undefined)
      || (isDeep ? this.deepModelId : undefined)
      || this.standardModelId;

    this.log.debug('complete: starting', { tier, promptLen: request.prompt.length, systemLen: request.systemPrompt.length });

    let model: vscode.LanguageModelChat | undefined;
    if (isFix) {
      model = this.cachedFix;
      if (!model) {
        model = await this.selectModel(modelIdRequested);
        this.cachedFix = model;
      }
    } else if (isDeep) {
      model = this.cachedDeep;
      if (!model) {
        model = await this.selectModel(modelIdRequested);
        this.cachedDeep = model;
      }
    } else {
      model = this.cachedStandard;
      if (!model) {
        model = await this.selectModel(modelIdRequested);
        this.cachedStandard = model;
        if (model && this.onModelSelected) {
          this.onModelSelected(model.id);
        }
      }
    }

    if (!model) {
      this.log.info('complete: no model available', { tier });
      return { text: '{}', error: 'No language models available — sign in to GitHub Copilot.', isRateLimit: false };
    }

    this.log.debug('complete: using model', { vendor: model.vendor, family: model.family, name: model.name });

    const cts = new vscode.CancellationTokenSource();
    // Compose the caller's cancellation token with our internal timeout.
    // If either fires, the request is aborted.
    if (request.token) {
      request.token.onCancellationRequested(() => cts.cancel());
    }
    const timeout = setTimeout(() => cts.cancel(), 90_000);

    // vscode.lm doesn't support System message type, so combine into User message
    const combinedPrompt = `${request.systemPrompt}\n\n${request.prompt}`;
    const messages = [vscode.LanguageModelChatMessage.User(combinedPrompt)];

    try {
      this.log.debug('complete: sending request', { combinedLen: combinedPrompt.length });
      const response = await model.sendRequest(
        messages,
        { 
          modelOptions: { 
            max_tokens: resolveMaxTokens(request.maxTokensMultiplier),
          }
        },
        cts.token,
      );

      // Handle async iterable response
      if (!response.text) {
        this.log.info('complete: response.text is falsy');
        return { text: '{}', error: 'Model returned empty response object', isRateLimit: false };
      }

      const streamed = await this.collectStreamText(response as { stream: AsyncIterable<unknown>; text?: unknown });
      if (streamed.error) {
        // Stream-iteration failures (e.g. "network request aborted" /
        // "Server error. Stream terminated" mid-stream) are transient transport
        // errors, not model errors — the request itself succeeded. Retry with a
        // fresh stream up to STREAM_RETRY_ATTEMPTS times with a short backoff.
        // This path previously returned the error directly, so a single network
        // hiccup failed the whole analysis wave with no retry (rate limits, by
        // contrast, get a full retry chain). The Copilot stream is flaky enough
        // that one retry is often not enough, so we allow a few attempts.
        let lastStreamed = streamed;
        for (let attempt = 1; attempt <= STREAM_RETRY_ATTEMPTS; attempt++) {
          this.log.info('complete: stream error — retrying with fresh stream', { attempt, error: lastStreamed.error });
          const retryCts = new vscode.CancellationTokenSource();
          if (request.token) {
            request.token.onCancellationRequested(() => retryCts.cancel());
          }
          const retryTimeout = setTimeout(() => retryCts.cancel(), 90_000);
          try {
            await sleep(STREAM_RETRY_BACKOFF_MS * attempt);
            const retryResponse = await model.sendRequest(messages, { modelOptions: { max_tokens: resolveMaxTokens(request.maxTokensMultiplier) } }, retryCts.token);
            if (!retryResponse.text) {
              return { text: lastStreamed.text, error: lastStreamed.error };
            }
            const retryStreamed = await this.collectStreamText(retryResponse as { stream: AsyncIterable<unknown>; text?: unknown });
            if (retryStreamed.error) {
              lastStreamed = retryStreamed;
              continue;
            }
            this.log.debug('complete: stream retry success', { attempt, textLen: retryStreamed.text.length });
            return { text: retryStreamed.text };
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            this.log.info('complete: stream retry also failed', { attempt, error: retryMsg });
            return { text: lastStreamed.text, error: lastStreamed.error, isRateLimit: isRateLimitError(retryMsg) };
          } finally {
            clearTimeout(retryTimeout);
            retryCts.dispose();
          }
        }
        return { text: lastStreamed.text, error: `Stream failed ${STREAM_RETRY_ATTEMPTS + 1} times: ${lastStreamed.error}` };
      }

      this.log.debug('complete: success', { textLen: streamed.text.length });
      return { text: streamed.text };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.info('complete: request failed, invalidating cache and retrying', { error: message });

      // Dispose the stale model reference before releasing it — VS Code language
      // model objects may hold native resources that need explicit cleanup.
      try { (model as any).dispose?.(); } catch (disposalErr) {
        this.log.info('[WARN] model.dispose() failed during retry', { error: disposalErr instanceof Error ? disposalErr.message : String(disposalErr) });
      }

      // Invalidate the cached model — it may be stale or disconnected
      if (isDeep) {
        this.cachedDeep = undefined;
      } else {
        this.cachedStandard = undefined;
      }

      // Retry once with a fresh model selection
      try {
        const freshModel = await this.selectModel(modelIdRequested);
        if (!freshModel) {
          return { text: '{}', error: `Retry failed: no model available after cache invalidation. Original: ${message}`, isRateLimit: isRateLimitError(message) };
        }

        this.log.debug('complete: retrying with fresh model', { vendor: freshModel.vendor, name: freshModel.name });
        const retryCts = new vscode.CancellationTokenSource();
        const retryTimeout = setTimeout(() => retryCts.cancel(), 90_000);
        try {
          const retryResponse = await freshModel.sendRequest(
            messages,
            { modelOptions: { max_tokens: resolveMaxTokens(request.maxTokensMultiplier) } },
            retryCts.token,
          );
          if (!retryResponse.text) {
            return { text: '{}', error: 'Retry: model returned empty response object', isRateLimit: false };
          }
          const retryStreamed = await this.collectStreamText(retryResponse as { stream: AsyncIterable<unknown>; text?: unknown });
          if (retryStreamed.error) {
            return { text: retryStreamed.text, error: `Retry failed: ${retryStreamed.error}` };
          }
          this.log.debug('complete: retry success', { textLen: retryStreamed.text.length });
          return { text: retryStreamed.text };
        } finally {
          clearTimeout(retryTimeout);
          retryCts.dispose();
        }
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        this.log.info('complete: retry also failed', { error: retryMsg });
        return { text: '{}', error: `vscode.lm request failed (after retry): ${retryMsg}`, isRateLimit: isRateLimitError(retryMsg) };
      }
    } finally {
      clearTimeout(timeout);
      cts.dispose();
    }
  }

  /**
   * Test method: Send a minimal prompt to verify model capability
   * Returns true if model returns valid JSON, false if garbled/corrupted
   */
  async testSimplePrompt(modelId?: string): Promise<{ success: boolean; response: string; modelUsed: string }> {
    const model = modelId ? await this.selectModel(modelId) : this.cachedStandard || (await this.selectModel(this.standardModelId));
    if (!model) {
      return { success: false, response: 'No model available', modelUsed: 'none' };
    }

    const simpleSystemPrompt = 'You are a helpful assistant. Respond only with valid JSON.';
    const simpleUserPrompt = 'Respond with exactly this JSON object: {"test": "hello", "status": "ok"}';
    const combinedPrompt = `${simpleSystemPrompt}\n\n${simpleUserPrompt}`;

    this.log.debug('testSimplePrompt: starting', { modelId: model.id, vendor: model.vendor });

    const cts = new vscode.CancellationTokenSource();
    const timeout = setTimeout(() => cts.cancel(), 30_000);
    
    try {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(combinedPrompt)],
        {},
        cts.token,
      );

      if ((response as ErrorProneResponse).error) {
        const errMsg = (response as ErrorProneResponse).error!;
        this.log.info('testSimplePrompt: error', { error: errMsg });
        throw new Error(errMsg);
      }

      let text = '';
      try {
        for await (const part of response.text) {
          if (part) text += part;
        }
      } catch (iterErr) {
        const iterMsg = iterErr instanceof Error ? iterErr.message : String(iterErr);
        this.log.info('testSimplePrompt: iteration error', { error: iterMsg, textLen: text.length });
        throw iterErr;
      }

      // Validate JSON properly — strip code fences then JSON.parse. The old
      // heuristic (has braces, no underscores) rejected valid JSON like
      // {"a_b":1} and accepted garbage like "this is { not } json".
      let isValidJSON = false;
      try {
        const cleaned = text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        JSON.parse(cleaned);
        isValidJSON = true;
      } catch { /* not valid JSON */ }
      this.log.debug('testSimplePrompt: result', { textLen: text.length, validJSON: isValidJSON });

      return { success: isValidJSON, response: text.substring(0, 200), modelUsed: model.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.info('testSimplePrompt: failed', { error: msg });
      return { success: false, response: msg, modelUsed: model.id };
    } finally {
      clearTimeout(timeout);
      cts.dispose();
    }
  }
}
