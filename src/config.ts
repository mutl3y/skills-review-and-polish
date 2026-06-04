import * as vscode from 'vscode';
import {
  EngineConfig,
  Severity,
  WaveName,
  ALL_WAVES,
  DEFAULT_ENGINE_CONFIG,
} from './core/types';

const SECTION = 'skillsReviewAndPolish';

export interface ExtensionConfig extends EngineConfig {
  enable: boolean;
  provider: 'vscode-lm' | 'openrouter' | 'githubModels';
  model: string;
  deepModel: string;
  fixModel: string;
  runOn: 'manual' | 'onSave' | 'onType';
  include: string[];
  exclude: string[];
  fixMode: 'diff' | 'loop' | 'chat';
  fixLoopMaxIterations: number;
  showScoreCodeLens: boolean;
  inlineRewrites: boolean;
  telemetryEnable: boolean;
  logLevel: 'info' | 'debug';
}

export function readConfig(): ExtensionConfig {
  const c = vscode.workspace.getConfiguration(SECTION);
  const waves = c.get<string[]>('enabledWaves', ALL_WAVES) as WaveName[];
  return {
    ...DEFAULT_ENGINE_CONFIG,
    enable: c.get('enable', true),
    provider: c.get('provider', 'vscode-lm'),
    model: c.get('model', ''),
    deepModel: c.get('deepModel', ''),
    fixModel: c.get('fixModel', ''),
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
    logLevel: c.get('logLevel', 'info') as 'info' | 'debug',
  };
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
  const lower = fsPath.toLowerCase();
  return (
    lower.endsWith('/skill.md') ||
    lower.endsWith('.prompt.md') ||
    lower.endsWith('.agent.md') ||
    lower.endsWith('.instructions.md') ||
    lower.endsWith('/agents.md') ||
    include.some((g) => simpleGlobMatch(g, fsPath))
  );
}

/** Minimal glob matcher (placeholder — replace with vscode.RelativePattern at call sites). */
function simpleGlobMatch(glob: string, path: string): boolean {
  const re = new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*') +
      '$',
  );
  return re.test(path);
}
