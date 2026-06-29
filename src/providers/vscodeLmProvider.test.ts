/**
 * Unit tests for VsCodeLmProvider model selection
 *
 * These tests verify that:
 * 1. Auto-selection only picks from the safe tier (0x-1x multiplier)
 * 2. Never silently falls back to expensive models (>1x)
 * 3. Rejects user-configured expensive models with error
 * 4. Rejects unavailable configured models with error
 * 5. Parses pricing strings correctly from live API
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { VsCodeLmProvider } from './vscodeLmProvider';

// Mock vscode module
vi.mock('vscode', () => {
  const CancellationTokenSource = class {
    token = {};
    cancel = vi.fn();
    dispose = vi.fn();
  };

  return {
    window: {
      showErrorMessage: vi.fn(),
    },
    lm: {
      selectChatModels: vi.fn(),
    },
    CancellationTokenSource,
    LanguageModelChatMessage: {
      User: vi.fn((content) => ({
        role: 'user',
        content,
      })),
    },
  };
});

describe('VsCodeLmProvider.selectModel()', () => {
  let provider: VsCodeLmProvider;
  let selectChatModels: ReturnType<typeof vi.fn>;
  let showErrorMessage: ReturnType<typeof vi.fn>;

  // Mock models WITH pricing field (matching live API)
  const safeTierModels = [
    { id: 'gpt-5-mini', name: 'GPT-5 Mini', vendor: 'copilot', pricing: '0x' },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', vendor: 'copilot', pricing: '0.33x' },
    { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'copilot', pricing: '1x' },
    { id: 'gpt-5.2', name: 'GPT-5.2', vendor: 'copilot', pricing: '1x' },
  ];

  const expensiveModels = [
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', vendor: 'copilot', pricing: '3x' },
    { id: 'claude-opus-4.7', name: 'Claude Opus 4.7', vendor: 'copilot', pricing: '27x' },
    { id: 'gpt-5.5', name: 'GPT-5.5', vendor: 'copilot', pricing: '57x' },
  ];

  const allModels = [...safeTierModels, ...expensiveModels];

  beforeEach(() => {
    selectChatModels = vi.fn();
    showErrorMessage = vi.fn();

    (vi.mocked(vscode.lm).selectChatModels as any) = selectChatModels;
    (vi.mocked(vscode.window).showErrorMessage as any) = showErrorMessage;

    provider = new VsCodeLmProvider('gpt-5-mini', 'claude-sonnet-4.5');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('pricing field parsing', () => {
    it('parses pricing strings into multipliers correctly', () => {
      const models = [
        { id: 'model-1', pricing: '0x' },
        { id: 'model-2', pricing: '0.33x' },
        { id: 'model-3', pricing: '1x' },
        { id: 'model-4', pricing: '3x' },
        { id: 'model-5', pricing: '27x' },
      ] as any;

      const result = (provider as any).parsePricingFromModels(models);

      expect(result.get('model-1')).toBe(0);
      expect(result.get('model-2')).toBe(0.33);
      expect(result.get('model-3')).toBe(1);
      expect(result.get('model-4')).toBe(3);
      expect(result.get('model-5')).toBe(27);
    });

    it('ignores malformed pricing strings', () => {
      const models = [
        { id: 'model-1', pricing: 'invalid' },
        { id: 'model-2', pricing: '5y' }, // wrong suffix
        { id: 'model-3', pricing: '' },
        { id: 'model-4', pricing: '1x' }, // valid
      ] as any;

      const result = (provider as any).parsePricingFromModels(models);

      expect(result.get('model-1')).toBeUndefined();
      expect(result.get('model-2')).toBeUndefined();
      expect(result.get('model-3')).toBeUndefined();
      expect(result.get('model-4')).toBe(1);
    });

    it('handles missing pricing field', () => {
      const models = [
        { id: 'model-1', pricing: undefined },
        { id: 'model-2', pricing: null },
        { id: 'model-3', pricing: '1x' },
      ] as any;

      const result = (provider as any).parsePricingFromModels(models);

      expect(result.get('model-1')).toBeUndefined();
      expect(result.get('model-2')).toBeUndefined();
      expect(result.get('model-3')).toBe(1);
    });
  });

  describe('auto-selection (no modelId configured)', () => {
    it('selects from safe tier when models available', async () => {
      // Single selectChatModels() call returns all models; filter in-memory
      selectChatModels.mockResolvedValue(allModels);

      const result = await (provider as any).selectModel('');

      expect(result).toBeDefined();
      // First safe-tier copilot vendor model wins (gpt-5-mini at 0x)
      expect(result.id).toBe('gpt-5-mini');
      expect(showErrorMessage).not.toHaveBeenCalled();
    });

    it('prefers copilot vendor over copilotcli', async () => {
      const copilotModel = { ...safeTierModels[1], vendor: 'copilot' };
      const copilotcliModel = { ...safeTierModels[1], vendor: 'copilotcli' };

      // Return only the two models — copilotcli-first, copilot second
      selectChatModels.mockResolvedValue([copilotcliModel, copilotModel]);

      const result = await (provider as any).selectModel('');

      expect(result?.vendor).toBe('copilot');
    });

    it('errors when NO models available at all', async () => {
      selectChatModels.mockResolvedValue([]);

      const result = await (provider as any).selectModel('');

      expect(result).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('No language models available'),
      );
    });

    it('errors when all models lack pricing data (auto-select)', async () => {
      // Models available but NO pricing field — not in modelToMultiplier map, so
      // auto-select cannot find any safe tier models and errors out.
      const modelsWithoutPricing = [
        { id: 'model-1', name: 'Model 1', vendor: 'copilot' }, // no pricing field
        { id: 'model-2', name: 'Model 2', vendor: 'copilot' }, // no pricing field
      ] as any;

      selectChatModels.mockResolvedValue(modelsWithoutPricing);

      const result = await (provider as any).selectModel('');

      // Auto-select only considers models in modelToMultiplier — those without pricing
      // are invisible, resulting in no safe model found.
      expect(result).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('No low-cost model available'),
      );
    });

    it('errors when NO safe models available', async () => {
      // Only expensive models available
      selectChatModels.mockResolvedValue(expensiveModels);

      const result = await (provider as any).selectModel('');

      expect(result).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('No low-cost model available'),
      );
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('≤1x multiplier'),
      );
    });

    it('NEVER falls back to expensive models', async () => {
      // Return only expensive models — no safe-tier copilot models available
      selectChatModels.mockResolvedValue(expensiveModels);

      const result = await (provider as any).selectModel('');

      // Should NOT return expensive model, should error instead
      expect(result).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalled();
    });
  });

  describe('configured modelId selection', () => {
    it('accepts safe model when explicitly configured', async () => {
      selectChatModels.mockImplementation((opts) => {
        if (!opts) {
          return Promise.resolve(allModels);
        }
        if (opts?.id === 'claude-sonnet-4.5') {
          return Promise.resolve([safeTierModels[2]]);
        }
        return Promise.resolve([]);
      });

      const result = await (provider as any).selectModel('claude-sonnet-4.5');

      expect(result).toBeDefined();
      expect(result.id).toBe('claude-sonnet-4.5');
      expect(showErrorMessage).not.toHaveBeenCalled();
    });

    it('rejects expensive model with error (27x)', async () => {
      selectChatModels.mockImplementation((opts) => {
        if (!opts) {
          return Promise.resolve(allModels);
        }
        if (opts?.id === 'claude-opus-4.7') {
          return Promise.resolve([expensiveModels[1]]);
        }
        return Promise.resolve([]);
      });

      const result = await (provider as any).selectModel('claude-opus-4.7');

      expect(result).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('not in the safe tier'),
      );
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('27x'),
      );
    });

    it('rejects expensive model with error (57x)', async () => {
      selectChatModels.mockImplementation((opts) => {
        if (!opts) {
          return Promise.resolve(allModels);
        }
        if (opts?.id === 'gpt-5.5') {
          return Promise.resolve([expensiveModels[2]]);
        }
        return Promise.resolve([]);
      });

      const result = await (provider as any).selectModel('gpt-5.5');

      expect(result).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('57x'),
      );
    });

    it('rejects 3x expensive model (gpt-5.2-codex)', async () => {
      selectChatModels.mockImplementation((opts) => {
        if (!opts) {
          return Promise.resolve(allModels);
        }
        if (opts?.id === 'gpt-5.2-codex') {
          return Promise.resolve([expensiveModels[0]]);
        }
        return Promise.resolve([]);
      });

      const result = await (provider as any).selectModel('gpt-5.2-codex');

      expect(result).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('not in the safe tier'),
      );
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('3x'),
      );
    });

    it('allows configured model through when pricing info missing', async () => {
      selectChatModels.mockImplementation((opts) => {
        if (!opts) {
          // All models returned without pricing
          return Promise.resolve([
            { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'copilot' } as any,
          ]);
        }
        if (opts?.id === 'claude-sonnet-4.5') {
          return Promise.resolve([{ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'copilot' } as any]);
        }
        return Promise.resolve([]);
      });

      const result = await (provider as any).selectModel('claude-sonnet-4.5');

      // User explicitly configured this model — allow it through even without pricing
      expect(result).toBeDefined();
      expect(result.id).toBe('claude-sonnet-4.5');
      expect(showErrorMessage).not.toHaveBeenCalled();
    });

    it('STOPS (not blindly falls back) when configured model unavailable', async () => {
      selectChatModels.mockImplementation((opts) => {
        if (!opts) {
          return Promise.resolve(allModels);
        }
        if (opts?.id === 'claude-sonnet-4.5') {
          return Promise.resolve([]); // Not available
        }
        return Promise.resolve([]);
      });

      const result = await (provider as any).selectModel('claude-sonnet-4.5');

      expect(result).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('not available'),
      );
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('reconfigure in Settings'),
      );
    });

    it('rejects a configured model when only the CLI vendor is available', async () => {
      selectChatModels.mockImplementation((opts) => {
        if (!opts) {
          return Promise.resolve(allModels);
        }
        if (opts?.id === 'claude-haiku-4.5') {
          return Promise.resolve([{ id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', vendor: 'copilotcli' } as any]);
        }
        return Promise.resolve([]);
      });

      const result = await (provider as any).selectModel('claude-haiku-4.5');

      expect(result).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('copilotcli vendor'),
      );
    });
  });

  describe('provider helper boundaries', () => {
    it('finds the preferred copilot model when both copilot and copilotcli are present', () => {
      const copilotModel = { id: 'a', vendor: 'copilot' } as any;
      const cliModel = { id: 'b', vendor: 'copilotcli' } as any;

      const result = (provider as any).findPreferredCopilotModel([cliModel, copilotModel]);

      expect(result).toBe(copilotModel);
    });

    it('collects stream text from structured parts and reports iteration failures', async () => {
      const streamed = (provider as any).collectStreamText({
        stream: (async function* () {
          yield { value: '{"ok":' };
          yield 'true}';
        })(),
      });

      await expect(streamed).resolves.toEqual({ text: '{"ok":true}' });
    });
  });

  describe('cost multiplier enforcement', () => {
    it('safe tier boundary is exactly ≤1x (not ≤3x or other)', async () => {
      // Verify gpt-5.2-codex (3x) is NOT safe
      selectChatModels.mockImplementation((opts) => {
        if (!opts) {
          return Promise.resolve(allModels);
        }
        if (opts?.id === 'gpt-5.2-codex') {
          return Promise.resolve([expensiveModels[0]]);
        }
        return Promise.resolve([]);
      });

      const result = await (provider as any).selectModel('gpt-5.2-codex');

      expect(result).toBeUndefined();
      // Must show that 3x > 1x
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('3x'),
      );
    });

    it('handles decimal multipliers (0.33x)', async () => {
      // Return only the haiku model so it is the sole auto-select candidate
      selectChatModels.mockResolvedValue([safeTierModels[1]]);

      const result = await (provider as any).selectModel('');

      expect(result).toBeDefined();
      expect(result.id).toBe('claude-haiku-4.5');
    });
  });

  describe('real-world scenarios', () => {
    it('fresh pricing data adapts to new models without code changes', async () => {
      // Simulate a new model added to Copilot with updated pricing
      const updatedModels = [
        { id: 'claude-haiku-5', name: 'Claude Haiku 5', vendor: 'copilot', pricing: '0.5x' },
        ...safeTierModels,
        ...expensiveModels,
      ];

      selectChatModels.mockResolvedValue(updatedModels);

      const result = await (provider as any).selectModel('');

      // Should auto-select new model correctly without any code changes
      expect(result?.id).toBe('claude-haiku-5');
    });

    it('rejects user-configured model outside safe tier with cost info', async () => {
      selectChatModels.mockImplementation((opts) => {
        if (!opts) {
          return Promise.resolve(allModels);
        }
        if (opts?.id === 'claude-opus-4.7') {
          return Promise.resolve([expensiveModels[1]]);
        }
        return Promise.resolve([]);
      });

      const result = await (provider as any).selectModel('claude-opus-4.7');

      expect(result).toBeUndefined();
      // Error message must show the specific cost multiplier
      const calls = (showErrorMessage as any).mock.calls;
      const costMessage = calls.find((c: any[]) => c[0].includes('27x'));
      expect(costMessage).toBeDefined();
    });
  });

  describe('streaming response handling (response.stream)', () => {
    /**
     * CRITICAL TEST SUITE - Locks in the fix for JSON corruption bug (2026-06-03)
     * 
     * Issue: Using response.text caused JSON responses to be corrupted:
     * - Haiku: Responses started mid-word ("iguity_issues" instead of proper JSON)
     * - gpt-5-mini: Produced garbage with scrambled characters
     * 
     * Root cause: vscode.lm API's response.text applies internal filtering
     * that mangles the output. response.stream yields raw structured parts.
     * 
     * Solution: Always iterate response.stream, extract string values,
     * and concatenate directly (no text transformation).
     * 
     * NOTE: All tests use ONLY safe-tier models (≤1x multiplier) per cost guardrails.
     * safeTierModels = [gpt-5-mini (0x), claude-haiku-4.5 (0.33x), claude-sonnet-4.5 (1x)]
     */

    it('response.stream concatenates string parts into complete JSON', async () => {
      // Use safe-tier model: claude-sonnet-4.5 (1x)
      const mockModel = { ...safeTierModels[2] } as any;
      
      const jsonStr = '{"ambiguity_issues":[]}';
      mockModel.sendRequest = vi.fn().mockResolvedValue({
        text: jsonStr, // response.text property required by complete() validation
        stream: (async function* () {
          for (const part of jsonStr.match(/.{1,10}/g) || []) {
            yield part;
          }
        })(),
      });

      selectChatModels.mockImplementation((opts) => {
        if (!opts) return Promise.resolve(allModels);
        if (opts?.family === 'claude-sonnet-4.5') return Promise.resolve([mockModel]);
        if (opts?.id === 'claude-sonnet-4.5') return Promise.resolve([mockModel]);
        return Promise.resolve([]);
      });

      // Use fresh provider instance for this test
      const testProvider = new VsCodeLmProvider('claude-sonnet-4.5', 'claude-sonnet-4.5');

      const result = await testProvider.complete({
        systemPrompt: 'Test',
        prompt: 'Test',
        modelTier: 'standard',
      });

      expect(result.text).toBe(jsonStr);
      JSON.parse(result.text); // Verify it's valid JSON
    });

    it('response.stream handles LanguageModelTextPart objects with .value', async () => {
      // Use safe-tier model: claude-haiku-4.5 (0.33x)
      const mockModel = { ...safeTierModels[1] } as any;
      
      mockModel.sendRequest = vi.fn().mockResolvedValue({
        text: '{"test": true}', // response.text property required by complete() validation
        stream: (async function* () {
          yield { value: '{"test' };
          yield { value: '": true}' };
        })(),
      });

      selectChatModels.mockImplementation((opts) => {
        if (!opts) return Promise.resolve(allModels);
        if (opts?.family === 'claude-haiku-4.5') return Promise.resolve([mockModel]);
        if (opts?.id === 'claude-haiku-4.5') return Promise.resolve([mockModel]);
        return Promise.resolve([]);
      });

      // Use fresh provider instance for this test
      const testProvider2 = new VsCodeLmProvider('claude-haiku-4.5', 'claude-haiku-4.5');

      const result = await testProvider2.complete({
        systemPrompt: 'Test',
        prompt: 'Test',
        modelTier: 'standard',
      });

      expect(result.text).toBe('{"test": true}');
    });

    it('response.stream never uses response.text property (which causes corruption)', async () => {
      // Use safe-tier model: gpt-5-mini (0x)
      const mockModel = { ...safeTierModels[0] } as any;
      
      mockModel.sendRequest = vi.fn().mockResolvedValue({
        // response.text is corrupted - proves we're NOT using it
        text: 'CORRUPTED',
        // response.stream has the correct output - proves we use this
        stream: (async function* () {
          yield '{"clean": true}';
        })(),
      });

      selectChatModels.mockImplementation((opts) => {
        if (!opts) return Promise.resolve(allModels);
        if (opts?.family === 'gpt-5-mini') return Promise.resolve([mockModel]);
        if (opts?.id === 'gpt-5-mini') return Promise.resolve([mockModel]);
        return Promise.resolve([]);
      });

      // Use fresh provider instance for this test
      const testProvider3 = new VsCodeLmProvider('gpt-5-mini', 'gpt-5-mini');

      const result = await testProvider3.complete({
        systemPrompt: 'Test',
        prompt: 'Test',
        modelTier: 'standard',
      });

      // Verify we got clean output from response.stream, not corruption from response.text
      expect(result.text).toBe('{"clean": true}');
      expect(result.text).not.toContain('CORRUPTED');
    });

    it('returns an error when response.stream iteration fails', async () => {
      const mockModel = { ...safeTierModels[2] } as any;
      mockModel.sendRequest = vi.fn().mockResolvedValue({
        text: 'ignored',
        stream: (async function* () {
          yield 'partial';
          throw new Error('stream boom');
        })(),
      });

      selectChatModels.mockImplementation((opts) => {
        if (!opts) return Promise.resolve(allModels);
        if (opts?.family === 'claude-sonnet-4.5') return Promise.resolve([mockModel]);
        if (opts?.id === 'claude-sonnet-4.5') return Promise.resolve([mockModel]);
        return Promise.resolve([]);
      });

      const testProvider = new VsCodeLmProvider('claude-sonnet-4.5', 'claude-sonnet-4.5');
      const result = await testProvider.complete({ systemPrompt: 'Test', prompt: 'Test' });

      expect(result.error).toContain('Failed to iterate response: stream boom');
    });

    it('returns an error when the streamed text is empty', async () => {
      const mockModel = { ...safeTierModels[0] } as any;
      mockModel.sendRequest = vi.fn().mockResolvedValue({
        text: 'ignored',
        stream: (async function* () {
          yield '';
        })(),
      });

      selectChatModels.mockImplementation((opts) => {
        if (!opts) return Promise.resolve(allModels);
        if (opts?.family === 'gpt-5-mini') return Promise.resolve([mockModel]);
        if (opts?.id === 'gpt-5-mini') return Promise.resolve([mockModel]);
        return Promise.resolve([]);
      });

      const testProvider = new VsCodeLmProvider('gpt-5-mini', 'gpt-5-mini');
      const result = await testProvider.complete({ systemPrompt: 'Test', prompt: 'Test' });

      expect(result.error).toBe('Model returned empty text response');
    });

    it('returns an error when the model response object is empty', async () => {
      const mockModel = { ...safeTierModels[2], id: 'claude-sonnet-4.5' } as any;
      mockModel.sendRequest = vi.fn().mockResolvedValue({});

      const testProvider = new VsCodeLmProvider('claude-sonnet-4.5', 'claude-sonnet-4.5');
      (testProvider as any).cachedStandard = mockModel;

      const result = await testProvider.complete({ systemPrompt: 'Test', prompt: 'Test' });

      expect(result).toEqual({ text: '{}', error: 'Model returned empty response object', isRateLimit: false });
    });

    it('returns an error when the model request itself fails', async () => {
      const mockModel = { ...safeTierModels[2], id: 'claude-sonnet-4.5' } as any;
      mockModel.sendRequest = vi.fn().mockRejectedValue(new Error('network down'));

      const testProvider = new VsCodeLmProvider('claude-sonnet-4.5', 'claude-sonnet-4.5');
      (testProvider as any).cachedStandard = mockModel;

      const result = await testProvider.complete({ systemPrompt: 'Test', prompt: 'Test' });

      expect(result).toEqual({ text: '{}', error: expect.stringContaining('vscode.lm request failed'), isRateLimit: false });
    });

    it('uses a cached model without reselecting when complete() runs', async () => {
      const mockModel = { ...safeTierModels[1], id: 'claude-haiku-4.5' } as any;
      mockModel.sendRequest = vi.fn().mockResolvedValue({
        text: 'cached-response',
        stream: (async function* () {
          yield 'cached-response';
        })(),
      });

      const testProvider = new VsCodeLmProvider('claude-haiku-4.5', 'claude-haiku-4.5');
      (testProvider as any).cachedStandard = mockModel;

      const result = await testProvider.complete({ systemPrompt: 'Test', prompt: 'Test' });

      expect(result).toEqual({ text: 'cached-response' });
      expect(selectChatModels).not.toHaveBeenCalled();
      testProvider.invalidate();
      expect((testProvider as any).cachedStandard).toBeUndefined();
      expect((testProvider as any).cachedDeep).toBeUndefined();
    });

    it('uses the deep cache path when requested', async () => {
      const mockModel = { ...safeTierModels[2], id: 'claude-sonnet-4.5', vendor: 'copilot', family: 'claude' } as any;
      mockModel.sendRequest = vi.fn().mockResolvedValue({
        text: 'deep-response',
        stream: (async function* () {
          yield 'deep-response';
        })(),
      });

      const testProvider = new VsCodeLmProvider('gpt-5-mini', 'claude-sonnet-4.5');
      (testProvider as any).cachedDeep = mockModel;

      const result = await testProvider.complete({
        systemPrompt: 'Test',
        prompt: 'Test',
        modelTier: 'deep',
      });

      expect(result).toEqual({ text: 'deep-response' });
      expect(selectChatModels).not.toHaveBeenCalled();
    });

    it('reports testSimplePrompt failures when the model request throws', async () => {
      const mockModel = { ...safeTierModels[1], id: 'claude-haiku-4.5' } as any;
      mockModel.sendRequest = vi.fn().mockRejectedValue(new Error('network down'));

      const testProvider = new VsCodeLmProvider('claude-haiku-4.5', 'claude-haiku-4.5');
      (testProvider as any).cachedStandard = mockModel;

      const result = await testProvider.testSimplePrompt();

      expect(result.success).toBe(false);
      expect(result.response).toContain('network down');
      expect(result.modelUsed).toBe('claude-haiku-4.5');
    });

    it('reports testSimplePrompt success for valid JSON responses', async () => {
      const mockModel = { ...safeTierModels[0], id: 'gpt-5-mini' } as any;
      mockModel.sendRequest = vi.fn().mockResolvedValue({
        text: '{"ok":true}',
        stream: (async function* () {
          yield '{"ok":true}';
        })(),
      });

      const testProvider = new VsCodeLmProvider('gpt-5-mini', 'gpt-5-mini');
      (testProvider as any).cachedStandard = mockModel;

      const result = await testProvider.testSimplePrompt();

      expect(result.success).toBe(true);
      expect(result.modelUsed).toBe('gpt-5-mini');
      expect(result.response).toContain('{"ok":true}');
    });
  });

  /**
   * STREAMING RESPONSE HANDLING - Integration verified in production (2026-06-03)
   * 
   * The fix for JSON corruption uses response.stream instead of response.text.
   * All safe-tier models work correctly (≤1x multiplier).
   * 
   * COST GUARDRAIL: All model-based tests only use safe-tier models:
   * - gpt-5-mini (0x) ✓
   * - claude-haiku-4.5 (0.33x) ✓  
   * - claude-sonnet-4.5 (1x) ✓
   * 
   * Never test with expensive models (>1x).
   * See: docs/VSCODE-LM-STREAMING-FIX.md
   */
});

// ─── invalidate() ──────────────────────────────────────────────────────────

describe('VsCodeLmProvider.invalidate()', () => {
  let selectChatModels: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    selectChatModels = vi.mocked(vscode.lm.selectChatModels);
  });

  it('forces model re-selection on next complete() call', async () => {
    const model = {
      id: 'gpt-5-mini', name: 'GPT-5 Mini', vendor: 'copilot', pricing: '0x', family: 'gpt',
      sendRequest: vi.fn().mockResolvedValue({
        text: true,
        stream: (async function*() { yield '{}'; })(),
      }),
      dispose: vi.fn(),
    };
    selectChatModels.mockResolvedValue([model]);
    vi.mocked(vscode.LanguageModelChatMessage.User).mockReturnValue({} as any);

    const provider = new VsCodeLmProvider('gpt-5-mini', '');
    const req = { prompt: 'p', systemPrompt: 's', modelTier: 'standard' as const };

    await provider.complete(req);
    const firstCallCount = selectChatModels.mock.calls.length;

    // After invalidate(), selectChatModels should be called again
    provider.invalidate();
    await provider.complete(req);

    expect(selectChatModels.mock.calls.length).toBeGreaterThan(firstCallCount);
  });
});

// ─── complete() retry path ─────────────────────────────────────────────────

describe('VsCodeLmProvider.complete() retry path', () => {
  let selectChatModels: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    selectChatModels = vi.mocked(vscode.lm.selectChatModels);
    vi.mocked(vscode.LanguageModelChatMessage.User).mockReturnValue({} as any);
  });

  function makeModel(sendRequest: ReturnType<typeof vi.fn>) {
    return {
      id: 'gpt-5-mini', name: 'GPT-5 Mini', vendor: 'copilot', pricing: '0x', family: 'gpt',
      sendRequest,
      dispose: vi.fn(),
    };
  }

  it('retries with a fresh model when first sendRequest throws', async () => {
    const freshResponse = {
      text: true,
      stream: (async function*() { yield '{"ok":true}'; })(),
    };
    const sendRequestFirst = vi.fn().mockRejectedValueOnce(new Error('connection reset'));
    const sendRequestFresh = vi.fn().mockResolvedValue(freshResponse);
    const stalModel = makeModel(sendRequestFirst);
    const freshModel = makeModel(sendRequestFresh);

    // First selectChatModels call (cache miss) returns stale model
    // Second call (after cache invalidation) returns fresh model
    selectChatModels
      .mockResolvedValueOnce([stalModel])
      .mockResolvedValueOnce([stalModel])   // first call in selectModel (all models)
      .mockResolvedValueOnce([freshModel])  // retry: all models
      .mockResolvedValueOnce([freshModel]); // retry: specific model id

    const provider = new VsCodeLmProvider('gpt-5-mini', '');
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's', modelTier: 'standard' });

    expect(sendRequestFresh).toHaveBeenCalled();
    expect(result.error).toBeUndefined();
  });

  it('returns error when retry also fails to find a fresh model', async () => {
    const sendRequest = vi.fn().mockRejectedValue(new Error('network down'));
    const model = makeModel(sendRequest);

    // selectModel('gpt-5-mini') makes TWO selectChatModels calls:
    //   1. selectChatModels()          → all models
    //   2. selectChatModels({ id })    → specific model
    // On retry, only the first call fires (returns empty → selectModel returns undefined)
    selectChatModels
      .mockResolvedValueOnce([model])  // initial: all models
      .mockResolvedValueOnce([model])  // initial: specific model
      .mockResolvedValueOnce([]);       // retry: no models → undefined

    const provider = new VsCodeLmProvider('gpt-5-mini', '');
    const result = await provider.complete({ prompt: 'p', systemPrompt: 's', modelTier: 'standard' });

    expect(result.error).toContain('Retry failed');
    expect(result.text).toBe('{}');
  });
});
