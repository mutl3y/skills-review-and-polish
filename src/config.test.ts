import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { DEFAULT_INCLUDE, isCustomizationPath, readConfig } from './config';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
  },
}));

describe('readConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the default configuration shape when settings are absent', () => {
    const get = vi.fn((key: string, fallback?: unknown) => fallback);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get } as any);

    const config = readConfig();

    expect(config.enable).toBe(true);
    expect(config.provider).toBe('vscode-lm');
    expect(config.include).toEqual(DEFAULT_INCLUDE);
    expect(config.exclude).toEqual(['**/node_modules/**']);
    expect(config.fixReferenceGrounding).toBe(true);
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
});
