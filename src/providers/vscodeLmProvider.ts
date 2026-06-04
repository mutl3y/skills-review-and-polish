import * as vscode from 'vscode';
import { LlmProvider, LlmRequest, LlmResponse } from '../core/types';

/**
 * Default provider — wraps VS Code's Language Model API (`vscode.lm`).
 * No API keys: uses the user's Copilot subscription.
 *
 * Notes for the port (from docs/plan/HANDOVER.md):
 *  - `selectChatModels` may return [] until the user is signed into Copilot or
 *    grants consent on first request — surface a friendly message in that case.
 *  - Prefer vendor 'copilot' over 'copilotcli' (the CLI vendor doesn't work in
 *    the extension host). See reference-engine/extension.legacy.ts selectModel().
 *  - Use a generous max_tokens (16384) to avoid mid-JSON truncation — this was a
 *    real noise source in the original engine.
 *  - modelTier 'deep' should map to `deepModel` setting when configured.
 */
export class VsCodeLmProvider implements LlmProvider {
  private cachedStandard?: vscode.LanguageModelChat;
  private cachedDeep?: vscode.LanguageModelChat;

  constructor(
    private readonly standardModelId: string,
    private readonly deepModelId: string,
    private readonly logFn?: (msg: string) => void,
  ) {}

  private log(msg: string): void {
    if (this.logFn) {
      this.logFn(msg);

    }
  }

  invalidate(): void {
    this.cachedStandard = undefined;
    this.cachedDeep = undefined;
  }

  private async selectModel(modelId: string): Promise<vscode.LanguageModelChat | undefined> {
    this.log(`[selectModel] START: modelId="${modelId}"`);
    
    // Get all available models from VS Code API
    const allModels = await vscode.lm.selectChatModels();
    this.log(`[selectModel] allModels returned: ${allModels.length} models`);
    allModels.forEach((m, i) => {
      const pricing = (m as any).pricing;
      this.log(
        `[selectModel]   [${i}] id="${m.id}", name="${m.name}", ` +
          `vendor="${m.vendor}", pricing="${pricing || 'MISSING'}"`,
      );
    });

    if (allModels.length === 0) {
      this.log(`[selectModel] ERROR: No models available`);
      vscode.window.showErrorMessage(
        'No language models available. Please sign in to GitHub Copilot or configure a specific model in Settings.',
      );
      return undefined;
    }

    // Parse pricing from live models (format: "27x", "9x", "1x", "0.33x", etc.)
    this.log(`[selectModel] parsing pricing from ${allModels.length} models...`);
    const modelToMultiplier = this.parsePricingFromModels(allModels);
    this.log(`[selectModel] parsePricingFromModels returned ${modelToMultiplier.size} entries:`);
    modelToMultiplier.forEach((mult, id) => {
      this.log(`[selectModel]   "${id}" -> ${mult}x`);
    });

    // GUARD: Can't proceed without pricing data — don't silently fall back to expensive models
    if (modelToMultiplier.size === 0) {
      this.log(`[selectModel] ERROR: No pricing data parsed from any model`);
      vscode.window.showErrorMessage(
        'Cannot retrieve model pricing information. Refusing to auto-select models for safety. ' +
          'Please check your Copilot connection and try again.',
      );
      return undefined;
    }

    // Safe tier: models with multiplier ≤ 1x
    const safeTierIds = new Set(
      Array.from(modelToMultiplier.entries())
        .filter(([_, mult]) => mult <= 1)
        .map(([id, _]) => id),
    );
    this.log(`[selectModel] safe tier (≤1x): ${safeTierIds.size} models`);
    safeTierIds.forEach((id) => {
      const mult = modelToMultiplier.get(id);
      this.log(`[selectModel]   safe: "${id}" (${mult}x)`);
    });

    const trimmed = modelId.trim();
    this.log(`[selectModel] trimmed modelId="${trimmed}"`);

    if (trimmed) {
      this.log(`[selectModel] user requested specific model: "${trimmed}"`);
      // User explicitly requested a model — validate it exists and is in safe tier
      this.log(`[selectModel] calling selectChatModels({id: "${trimmed}"})`);  
      const byId = await vscode.lm.selectChatModels({ id: trimmed });
      this.log(`[selectModel] selectChatModels({id}) returned ${byId.length} models`);
      byId.forEach((m, i) => {
        this.log(`[selectModel]   [${i}] id="${m.id}", name="${m.name}", vendor="${m.vendor}"`);
      });

      if (byId.length > 0) {
        this.log(`[selectModel] found model by ID, checking pricing...`);
        // Verify model has valid pricing info
        if (!modelToMultiplier.has(trimmed)) {
          this.log(`[selectModel] ERROR: ${trimmed} has no pricing data in modelToMultiplier`);
          vscode.window.showErrorMessage(
            `Model "${trimmed}" does not have valid pricing information. ` +
              `This model may no longer be available. Please reconfigure in Settings.`,
          );
          return undefined;
        }

        // STOP if requested model is expensive — don't silently fall back
        const multiplier = modelToMultiplier.get(trimmed);
        this.log(`[selectModel] multiplier=${multiplier}x, safeTierIds.has=${safeTierIds.has(trimmed)}`);
        if (!safeTierIds.has(trimmed)) {
          this.log(`[selectModel] ERROR: model is expensive (${multiplier}x > 1x), REJECTING`);
          vscode.window.showErrorMessage(
            `Model "${trimmed}" is not in the safe tier (multiplier ${multiplier}x > 1x). ` +
              `Please select a model ≤1x in Settings.`,
          );
          return undefined;
        }

        this.log(`[selectModel] SUCCESS: found ${byId.length} instances of model id="${trimmed}"`);
        // ONLY accept 'copilot' vendor — never use 'copilotcli' (returns empty in extension host)
        const preferred = this.findPreferredCopilotModel(byId);
        if (!preferred) {
          this.log(`[selectModel] ERROR: model "${trimmed}" only available with copilotcli vendor, which doesn't work in extension host. REJECTING.`);
          vscode.window.showErrorMessage(
            `Model "${trimmed}" is only available via GitHub Copilot CLI (copilotcli vendor), which does not work in VS Code extensions. ` +
              `Please ensure the Copilot extension is installed and you are signed in to GitHub Copilot (copilot vendor).`,
          );
          return undefined;
        }
        this.log(`[selectModel] SUCCESS: returning model id="${trimmed}" vendor="${preferred.vendor}" name="${preferred.name}"`);
        return preferred;
      }

      // Model ID not found at all — stop, don't fall back
      this.log(`[selectModel] ERROR: selectChatModels({id}) returned empty, STOPPING`);
      vscode.window.showErrorMessage(`Requested model "${trimmed}" is not available. Please reconfigure in Settings.`);
      return undefined;
    }

    // Auto-select: only try models from safe tier (multiplier ≤ 1x)
    this.log(`[selectModel] auto-selecting from safe tier (${safeTierIds.size} models)...`);
    for (const [modelId, multiplier] of modelToMultiplier.entries()) {
      if (multiplier <= 1) {
        this.log(`[selectModel] trying safe model "${modelId}" (${multiplier}x)...`);
        const models = await vscode.lm.selectChatModels({ family: modelId });
        this.log(`[selectModel]   selectChatModels({family: "${modelId}"}) returned ${models.length} models`);
        models.forEach((m, i) => {
          this.log(`[selectModel]     [${i}] id="${m.id}", name="${m.name}", vendor="${m.vendor}"`);
        });

        if (models.length > 0) {
          // ONLY accept 'copilot' vendor — never use 'copilotcli' (returns empty in extension host)
          const preferred = this.findPreferredCopilotModel(models);
          if (preferred) {
            this.log(`[selectModel] selected model: id="${preferred.id}" name="${preferred.name}" vendor="${preferred.vendor}" (multiplier ${multiplier}x)`);
            return preferred;
          }
          // No copilot vendor available for this family, try next model
          this.log(`[selectModel]   skipping "${modelId}" — only copilotcli vendor available (won't work in extension host)`);
        }
      }
    }

    // No safe model found with copilot vendor — stop instead of falling back to expensive models or copilotcli
    this.log(`[selectModel] ERROR: no safe model with copilot vendor found after iterating all safe tier models`);
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
          partStr = 'value' in part ? String((part as any).value) : String(part);
        } else {
          partStr = String(part);
        }

        if (partNum <= 3) {
          this.log(`[collectStreamText] PART[${partNum}] (first 3 logged): "${partStr.substring(0, 100)}"`);
        }
        text += partStr;
      }
    } catch (iterErr) {
      const errMsg = iterErr instanceof Error ? iterErr.message : String(iterErr);
      this.log(`[collectStreamText] ERROR during iteration: ${errMsg}, textSoFar=${text.length}c`);
      return { text: '{}', error: `Failed to iterate response: ${errMsg}` };
    }

    if (!text) {
      this.log(`[collectStreamText] ERROR: text is empty after iteration (${partNum} parts received)`);
      return { text: '{}', error: 'Model returned empty text response' };
    }

    return { text };
  }

  private parsePricingFromModels(models: vscode.LanguageModelChat[]): Map<string, number> {
    this.log(`[parsePricingFromModels] START with ${models.length} models`);
    const multipliers = new Map<string, number>();
    for (const model of models) {
      // Access pricing field via any cast (field exists at runtime but not in type definitions)
      const pricing = (model as any).pricing;
      this.log(
        `[parsePricingFromModels] model id="${model.id}": ` +
          `pricing field type=${typeof pricing}, value="${pricing}"`,
      );

      if (pricing && typeof pricing === 'string') {
        // Parse pricing format: "27x", "9x", "1x", "0.33x", etc.
        const match = pricing.match(/^([\d.]+)x$/);
        this.log(`[parsePricingFromModels]   regex match: ${match ? JSON.stringify(match) : 'NO MATCH'}`);

        if (match) {
          const multiplier = parseFloat(match[1]);
          this.log(`[parsePricingFromModels]   parsed multiplier: ${multiplier}`);
          multipliers.set(model.id, multiplier);
        } else {
          this.log(`[parsePricingFromModels]   SKIPPED: pricing format doesn't match /^([\\d.]+)x$/`);
        }
      } else {
        this.log(
          `[parsePricingFromModels]   SKIPPED: ` +
            `pricing is falsy=${!pricing} or not string=${typeof pricing !== 'string'}`,
        );
      }
    }
    this.log(`[parsePricingFromModels] END: collected ${multipliers.size} entries`);
    return multipliers;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const isDeep = request.modelTier === 'deep';
    const tier = isDeep ? 'deep' : 'standard';
    const modelIdRequested = isDeep ? this.deepModelId || this.standardModelId : this.standardModelId;

    this.log(
      `[complete] START: tier="${tier}", modelIdRequested="${modelIdRequested}", ` +
        `prompt=${request.prompt.length}c, system=${request.systemPrompt.length}c`,
    );

    let model = isDeep ? this.cachedDeep : this.cachedStandard;
    if (!model) {
      this.log(`[complete] no cached model for tier="${tier}", calling selectModel("${modelIdRequested}")`);
      model = await this.selectModel(modelIdRequested);
      this.log(`[complete] selectModel returned: ${model ? `id="${model.id}"` : 'undefined'}`);
      if (isDeep) {
        this.cachedDeep = model;
      } else {
        this.cachedStandard = model;
      }
    } else {
      this.log(`[complete] using cached model for tier="${tier}": id="${model.id}"`);
    }

    if (!model) {
      this.log(`[complete] ERROR: model is undefined, returning error response`);
      return { text: '{}', error: 'No language models available — sign in to GitHub Copilot.' };
    }

    // Log the selected model on first use (cached after that).
    const modelLabel = `${model.vendor}/${model.family} (${model.name})`;
    this.log(
      `[complete] model ready: id="${model.id}", vendor="${model.vendor}", ` +
        `family="${model.family}", name="${model.name}"`,
    );

    const cts = new vscode.CancellationTokenSource();
    const timeout = setTimeout(() => cts.cancel(), 90_000);
    try {
      // Log the input prompts separately
      this.log(`[complete] INPUT VALIDATION:`);
      this.log(`[complete]   systemPrompt length: ${request.systemPrompt.length}c`);
      this.log(`[complete]   systemPrompt preview: ${request.systemPrompt.substring(0, 300)}`);
      this.log(`[complete]   prompt length: ${request.prompt.length}c`);
      this.log(`[complete]   prompt preview: ${request.prompt.substring(0, 300)}`);

      // vscode.lm doesn't support System message type, so combine into User message
      // Format: system instructions first, then user content
      const combinedPrompt = `${request.systemPrompt}\n\n${request.prompt}`;
      this.log(`[complete] combined prompt: ${combinedPrompt.length} chars (system=${request.systemPrompt.length}c + user=${request.prompt.length}c)`);
      
      // Basic validation: check if prompt contains obvious JSON structures
      const hasJsonBrackets = combinedPrompt.includes('{') || combinedPrompt.includes('[');
      const hasJsonKeywords = combinedPrompt.includes('"') && combinedPrompt.includes(':');
      this.log(`[complete] prompt structure: hasJsonBrackets=${hasJsonBrackets}, hasJsonKeywords=${hasJsonKeywords}`);
      
      const messages = [vscode.LanguageModelChatMessage.User(combinedPrompt)];

      this.log(`[complete] constructed messages[0] role=User, content length=${(messages[0] as any).content?.length ?? 'N/A'}`);
      this.log(`[complete] message[0] preview: ${String(combinedPrompt).substring(0, 200)}`);
      this.log(
        `[complete] calling model.sendRequest(): ` +
          `model="${model.id}", messages.length=${messages.length}, ` +
          `maxTokens=16384, timeout=90s`,
      );
      const response = await model.sendRequest(
        messages,
        { 
          modelOptions: { 
            max_tokens: 16384,
          }
        },
        cts.token,
      );

      this.log(
        `[complete] sendRequest returned: response type=${typeof response}, ` +
          `has .text=${!!response.text}, text type=${typeof response.text}`,
      );

      // Handle async iterable response
      if (!response.text) {
        this.log(
          `[complete] ERROR: response.text is falsy: ${response.text}, ` +
            `response keys=${Object.keys(response).join(',')}`,
        );
        return { text: '{}', error: 'Model returned empty response object' };
      }

      this.log(`[complete] iterating response.stream (structured parts)...`);
      const streamed = await this.collectStreamText(response as { stream: AsyncIterable<unknown>; text?: unknown });
      if (streamed.error) {
        this.log(`[complete] ERROR: ${streamed.error}`);
        return { text: streamed.text, error: streamed.error };
      }

      this.log(`[complete] RESPONSE CONTENT (first 500 chars):`);
      this.log(`[complete] ${streamed.text.substring(0, 500)}`);
      this.log(`[complete] SUCCESS: returning ${streamed.text.length} chars total`);
      return { text: streamed.text };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : '';
      this.log(`[complete] ERROR: outer catch: ${message}`);
      this.log(`[complete] stack: ${stack}`);
      return { text: '{}', error: `vscode.lm request failed: ${message}` };
    } finally {
      this.log(`[complete] finally: clearing timeout and disposing CTS`);
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

    this.log(`[testSimplePrompt] Testing model id="${model.id}" vendor="${model.vendor}" family="${model.family}" name="${model.name}" with minimal prompt (${combinedPrompt.length}c)`);

    const cts = new vscode.CancellationTokenSource();
    const timeout = setTimeout(() => cts.cancel(), 30_000);
    
    try {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(combinedPrompt)],
        {},
        cts.token,
      );

      // Check if response has an error before trying to iterate
      if ((response as any).error) {
        const errMsg = (response as any).error;
        this.log(`[testSimplePrompt] Response error before iteration: ${errMsg}`);
        throw new Error(errMsg);
      }

      let text = '';
      try {
        this.log(`[testSimplePrompt] Starting response iteration...`);
        for await (const part of response.text) {
          if (part) text += part;
        }
      } catch (iterErr) {
        const iterMsg = iterErr instanceof Error ? iterErr.message : String(iterErr);
        this.log(`[testSimplePrompt] Error during response iteration: ${iterMsg}`);
        this.log(`[testSimplePrompt] Partial response collected so far (${text.length}c): ${text.substring(0, 500)}`);
        throw iterErr;
      }

      this.log(`[testSimplePrompt] Response (full ${text.length}c): ${text.substring(0, 500)}`);

      // Check if response looks like valid JSON
      const isValidJSON = text.includes('{') && text.includes('}') && !text.includes('_') && !text.match(/[^\x20-\x7E\n\r]/);
      this.log(`[testSimplePrompt] isValidJSON: ${isValidJSON}`);

      return { success: isValidJSON, response: text.substring(0, 200), modelUsed: model.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[testSimplePrompt] CATCH: Error: ${msg}`);
      return { success: false, response: msg, modelUsed: model.id };
    } finally {
      clearTimeout(timeout);
      cts.dispose();
    }
  }
}
