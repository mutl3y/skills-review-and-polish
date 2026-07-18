import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { DEFAULT_INCLUDE, isCustomizationPath, readConfig, clearConfigCache, readStructuredOutput } from './config';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
}));

describe('readConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearConfigCache();
  });

  it('returns the default configuration shape when settings are absent', () => {
    const get = vi.fn((key: string, fallback?: unknown) => fallback);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as any);

    const config = readConfig();

    expect(config.enable).toBe(true);
    expect(config.provider).toBe('vscode-lm');
    expect(config.include).toEqual(DEFAULT_INCLUDE);
    expect(config.exclude).toEqual(['**/node_modules/**']);
    expect(config.analysisMode).toBe('multiWave');
    expect(config.fixReferenceGrounding).toBe(true);
    expect(config.externalStructuredOutput).toBe('schema');
    expect(config.externalMaxResponseTokens).toBe(16_384);
    expect(config.externalAdaptiveResponseTokens).toBe(false);
    expect(config.externalMinAdaptiveResponseTokens).toBe(4_096);
    expect(config.externalAdaptiveCharsPerToken).toBe(8);
    expect(config.externalRequestTimeoutMs).toBe(120_000);
    expect(config.telemetryEnable).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  it('uses stored values when they are present', () => {
    const get = vi.fn((key: string, fallback?: unknown) => {
      const values: Record<string, unknown> = {
        enable: false,
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
        deepModel: 'deep-model',
        fixModel: 'fix-model',
        'external.structuredOutput': true,
        'external.maxResponseTokens': 32_768,
        'external.adaptiveResponseTokens': true,
        'external.adaptiveMaxResponseTokens': 96_000,
        'external.minAdaptiveResponseTokens': 8_192,
        'external.adaptiveCharsPerToken': 6,
        'external.requestTimeoutMs': 45_000,
        analysisMode: 'multiWave',
        enabledWaves: ['contradictions', 'coverage'],
        scoreSamples: 5,
        runOn: 'onSave',
        include: ['**/custom.md'],
        exclude: ['**/dist/**'],
        severityOverrides: { 'ambiguity-llm': 'off' },
        fixMode: 'chat',
        fixStrategy: 'additive',
        fixLoopMaxIterations: 7,
        'fix.semanticCheck': true,
        'fix.selfCritique': true,
        'fix.referenceGrounding': false,
        showScoreCodeLens: false,
        'experimental.inlineRewrites': true,
        'telemetry.enable': false,
        logLevel: 'debug',
      };
      return values[key] ?? fallback;
    });

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as any);

    const config = readConfig();

    expect(config.enable).toBe(false);
    expect(config.provider).toBe('openrouter');
    expect(config.model).toBe('openai/gpt-4o-mini');
    expect(config.enabledWaves).toEqual(['contradictions', 'coverage']);
    expect(config.include).toEqual(['**/custom.md']);
    expect(config.fixSemanticCheck).toBe(true);
    expect(config.inlineRewrites).toBe(true);
    expect(config.externalStructuredOutput).toBe(true);
    expect(config.externalMaxResponseTokens).toBe(32_768);
    expect(config.externalAdaptiveResponseTokens).toBe(true);
    expect(config.externalAdaptiveMaxResponseTokens).toBe(96_000);
    expect(config.externalMinAdaptiveResponseTokens).toBe(8_192);
    expect(config.externalAdaptiveCharsPerToken).toBe(6);
    expect(config.externalRequestTimeoutMs).toBe(45_000);
    expect(config.telemetryEnable).toBe(false);
    expect(config.logLevel).toBe('debug');
  });
});

describe('isCustomizationPath', () => {
  it('recognizes the standard customization file names', () => {
    expect(isCustomizationPath('/tmp/skill.md', DEFAULT_INCLUDE)).toBe(true);
    expect(isCustomizationPath('/tmp/example.prompt.md', DEFAULT_INCLUDE)).toBe(true);
    expect(isCustomizationPath('/tmp/example.agent.md', DEFAULT_INCLUDE)).toBe(true);
    expect(isCustomizationPath('/tmp/example.instructions.md', DEFAULT_INCLUDE)).toBe(true);
    expect(isCustomizationPath('/tmp/AGENTS.md', DEFAULT_INCLUDE)).toBe(true);
  });

  it('supports custom include globs', () => {
    expect(isCustomizationPath('/tmp/notes/anything.md', ['**/notes/*.md'])).toBe(true);
    expect(isCustomizationPath('/tmp/notes/anything.txt', ['**/notes/*.md'])).toBe(false);
  });

  it('returns false for non-matching paths', () => {
    expect(isCustomizationPath('/tmp/README.md', DEFAULT_INCLUDE)).toBe(false);
    expect(isCustomizationPath('/tmp/index.ts', DEFAULT_INCLUDE)).toBe(false);
  });

  it('matches files in dot-prefixed directories (e.g., .github/skills/)', () => {
    expect(isCustomizationPath('.github/skills/github-actions-efficiency/SKILL.md', DEFAULT_INCLUDE)).toBe(true);
    expect(isCustomizationPath('.github/skills/test/SKILL.md', DEFAULT_INCLUDE)).toBe(true);
    expect(isCustomizationPath('.github/prompts/test.prompt.md', DEFAULT_INCLUDE)).toBe(true);
  });

  it('returns false (no match) for a malformed glob without throwing', () => {
    // picomatch throws on '[invalid' — the catch branch must return false
    expect(() => isCustomizationPath('/tmp/SKILL.md', ['[invalid'])).not.toThrow();
    expect(isCustomizationPath('/tmp/SKILL.md', ['[invalid'])).toBe(false);
  });
});

describe('readStructuredOutput', () => {
  it.each([
    ['schema', 'schema'],
    [true, true],
    [false, false],
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['on', true],
    ['off', false],
  ] as const)('maps %p to %p', (input, expected) => {
    expect(readStructuredOutput(input)).toBe(expected);
  });

  it('falls back to schema for unknown values', () => {
    expect(readStructuredOutput('gibberish')).toBe('schema');
    expect(readStructuredOutput(42)).toBe('schema');
  });
});

describe('readConfig — branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearConfigCache();
  });

  it('falls back to ALL_WAVES when enabledWaves is an empty array', () => {
    const get = vi.fn((key: string, fallback?: unknown) => {
      if (key === 'enabledWaves') return [];
      return fallback;
    });
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as any);
    const config = readConfig();
    expect(config.enabledWaves.length).toBeGreaterThan(0);
  });

  it('returns cached config on second call without re-reading settings', () => {
    const get = vi.fn((key: string, fallback?: unknown) => fallback);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as any);
    readConfig();
    readConfig();
    // getConfiguration should only be called once (cache hit on second call)
    expect(vi.mocked(vscode.workspace.getConfiguration)).toHaveBeenCalledTimes(1);
  });

  it('re-reads settings after clearConfigCache()', () => {
    const get = vi.fn((key: string, fallback?: unknown) => fallback);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as any);
    readConfig();
    clearConfigCache();
    readConfig();
    expect(vi.mocked(vscode.workspace.getConfiguration)).toHaveBeenCalledTimes(2);
  });
});
