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
  private readonly log: Logger = createLogger('provider');

  constructor(
    private readonly standardModelId: string,
    private readonly deepModelId: string,
  ) {}

  invalidate(): void {
    this.cachedStandard = undefined;
    this.cachedDeep = undefined;
  }

  private async selectModel(modelId: string): Promise<vscode.LanguageModelChat | undefined> {
    const allModels = await vscode.lm.selectChatModels();
    this.log.debug('models available', { count: allModels.length, ids: allModels.map(m => m.id).join(', ') });

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
              `Please ensure the Copilot extension is installed and you are signed in to GitHub Copilot (copilot vendor).`,
          );
          return undefined;
        }
        this.log.debug('model selected', { modelId: trimmed, vendor: preferred.vendor, name: preferred.name });
        return preferred;
      }

      // Model ID not found at all — stop, don't fall back
      this.log.info('model not found', { modelId: trimmed });
      vscode.window.showErrorMessage(`Requested model "${trimmed}" is not available. Please reconfigure in Settings.`);
      return undefined;
    }

    // Auto-select: only try models from safe tier (multiplier ≤ 1x)
    // Single selectChatModels() call — filter in-memory to avoid N+1 async calls
    const safeModels = allModels.filter((m) => {
      const multiplier = modelToMultiplier.get(m.id);
      return multiplier !== undefined && multiplier <= 1;
    });
    for (const model of safeModels) {
      if (model.vendor === 'copilot') {
        this.log.debug('auto-selected model', { modelId: model.id, multiplier: modelToMultiplier.get(model.id) });
        return model;
      }
    }

    this.log.info('no safe model with copilot vendor found');
    vscode.window.showErrorMessage(
      'No low-cost model available (≤1x multiplier) with GitHub Copilot vendor. ' +
        'Please ensure the GitHub Copilot extension is installed and you are signed in to GitHub Copilot. ' +
        'Or configure a specific model in Settings.',
    );
    return undefined;
  }

  private findPreferredCopilotModel(models: readonly vscode.LanguageModelChat[]): vscode.LanguageModelChat | undefined {
    return models.find((model) => model.vendor === 'copilot');
  }

  private async collectStreamText(response: { stream: AsyncIterable<unknown>; text?: unknown }): Promise<{ text: string; error?: string }> {
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
      return { text: '{}', error: `Failed to iterate response: ${errMsg}` };
    }

    if (!text) {
      this.log.info('empty response after iteration', { partsReceived: partNum });
      return { text: '{}', error: 'Model returned empty text response' };
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
    const isDeep = request.modelTier === 'deep';
    const tier = isDeep ? 'deep' : 'standard';
    const modelIdRequested = isDeep ? this.deepModelId || this.standardModelId : this.standardModelId;

    this.log.debug('complete: starting', { tier, promptLen: request.prompt.length, systemLen: request.systemPrompt.length });

    let model = isDeep ? this.cachedDeep : this.cachedStandard;
    if (!model) {
      model = await this.selectModel(modelIdRequested);
      if (isDeep) {
        this.cachedDeep = model;
      } else {
        this.cachedStandard = model;
      }
    }

    if (!model) {
      this.log.info('complete: no model available', { tier });
      return { text: '{}', error: 'No language models available — sign in to GitHub Copilot.' };
    }

    this.log.debug('complete: using model', { vendor: model.vendor, family: model.family, name: model.name });

    const cts = new vscode.CancellationTokenSource();
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
            max_tokens: 16384,
          }
        },
        cts.token,
      );

      // Handle async iterable response
      if (!response.text) {
        this.log.info('complete: response.text is falsy');
        return { text: '{}', error: 'Model returned empty response object' };
      }

      const streamed = await this.collectStreamText(response as { stream: AsyncIterable<unknown>; text?: unknown });
      if (streamed.error) {
        this.log.info('complete: stream error', { error: streamed.error });
        return { text: streamed.text, error: streamed.error };
      }

      this.log.debug('complete: success', { textLen: streamed.text.length });
      return { text: streamed.text };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.info('complete: request failed, invalidating cache and retrying', { error: message });

      // Dispose the stale model reference before releasing it — VS Code language
      // model objects may hold native resources that need explicit cleanup.
      try {   (model as any).dispose?.(); } catch { /* best-effort */ }

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
          return { text: '{}', error: `Retry failed: no model available after cache invalidation. Original: ${message}` };
        }

        this.log.debug('complete: retrying with fresh model', { vendor: freshModel.vendor, name: freshModel.name });
        const retryCts = new vscode.CancellationTokenSource();
        const retryTimeout = setTimeout(() => retryCts.cancel(), 90_000);
        try {
          const retryResponse = await freshModel.sendRequest(
            messages,
            { modelOptions: { max_tokens: 16384 } },
            retryCts.token,
          );
          if (!retryResponse.text) {
            return { text: '{}', error: 'Retry: model returned empty response object' };
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
        return { text: '{}', error: `vscode.lm request failed (after retry): ${retryMsg}` };
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

      const isValidJSON = text.includes('{') && text.includes('}') && !text.includes('_') && !text.match(/[^\x20-\x7E\n\r]/);
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
