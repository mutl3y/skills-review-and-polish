import * as vscode from 'vscode';
import picomatch from 'picomatch';
import {
  EngineConfig,
  Severity,
  WaveName,
  ALL_WAVES,
  DEFAULT_ENGINE_CONFIG,
} from './core/types';

const SECTION = 'skillsReviewAndPolish';

/** Module-level config cache — invalidated by onDidChangeConfiguration. */
let cachedConfig: ExtensionConfig | null = null;

/**
 * Invalidate the cached config so the next readConfig() call re-reads from
 * VS Code settings.  Exported for tests that mock getConfiguration.
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Register a `vscode.workspace.onDidChangeConfiguration` listener for the
 * `skillsReviewAndPolish` section.  When settings change the cache is
 * immediately invalidated so the next `readConfig()` call picks up fresh
 * values.
 *
 * Call once from `activate()` — the returned disposable should be added to
 * `context.subscriptions`.
 */
export function setupConfigWatcher(): { dispose(): void } {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      cachedConfig = null;
    }
  });
}

export interface ExtensionConfig extends EngineConfig {
  enable: boolean;
  provider: 'vscode-lm' | 'openrouter' | 'githubModels';
  model: string;
  deepModel: string;
  fixModel: string;
  pickerSortBy: 'price' | 'multiplier' | 'name';
  runOn: 'manual' | 'onSave' | 'onType';
  include: string[];
  exclude: string[];
  fixMode: 'diff' | 'loop' | 'chat';
  fixLoopMaxIterations: number;
  showScoreCodeLens: boolean;
  inlineRewrites: boolean;
  telemetryEnable: boolean;
  logLevel: 'info' | 'debug' | 'trace';
}

export function readConfig(): ExtensionConfig {
  if (cachedConfig) return cachedConfig;
  const c = vscode.workspace.getConfiguration(SECTION);
  const waves = c.get<string[]>('enabledWaves', ALL_WAVES) as WaveName[];
  cachedConfig = {
    ...DEFAULT_ENGINE_CONFIG,
    enable: c.get('enable', true),
    provider: c.get('provider', 'vscode-lm'),
    model: c.get('model', ''),
    deepModel: c.get('deepModel', ''),
    fixModel: c.get('fixModel', ''),
    pickerSortBy: c.get('pickerSortBy', 'price'),
    analysisMode: c.get('analysisMode', 'single'),
    enabledWaves: waves.length ? waves : [...ALL_WAVES],
    scoreSamples: c.get('scoreSamples', 3),
    runOn: c.get('runOn', 'manual'),
    include: c.get('include', DEFAULT_INCLUDE),
    exclude: c.get('exclude', ['**/node_modules/**']),
    severityOverrides: c.get('severityOverrides', {}) as Record<string, Severity | 'off'>,
    fixMode: c.get('fixMode', 'diff'),
    fixStrategy: c.get('fixStrategy', 'subtractive'),
    fixLoopMaxIterations: c.get('fixLoopMaxIterations', 3),
    fixSemanticCheck: c.get('fix.semanticCheck', false),
    fixSelfCritique: c.get('fix.selfCritique', false),
    fixReferenceGrounding: c.get('fix.referenceGrounding', true),
    showScoreCodeLens: c.get('showScoreCodeLens', true),
    inlineRewrites: c.get('experimental.inlineRewrites', false),
    telemetryEnable: c.get('telemetry.enable', true),
    logLevel: c.get('logLevel', 'info') as 'info' | 'debug' | 'trace',
  };
  return cachedConfig;
}

export const DEFAULT_INCLUDE = [
  '**/SKILL.md',
  '**/*.prompt.md',
  '**/*.agent.md',
  '**/*.instructions.md',
  '**/AGENTS.md',
];

/** Cheap path-based check for whether a document is an AI customization. */
export function isCustomizationPath(fsPath: string, include: string[]): boolean {
  return include.some((g) => simpleGlobMatch(g, fsPath));
}

/** Glob matcher — uses picomatch for full glob support including braces, ?, [abc]. */
function simpleGlobMatch(glob: string, filePath: string): boolean {
  try {
    return picomatch.isMatch(filePath, glob, { nocase: true });
  } catch {
    // Malformed glob — treat as no match (report via settings validation instead)
    return false;
  }
}
