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
  provider: 'vscode-lm' | 'openrouter' | 'copilot';
  model: string;
  deepModel: string;
  fixModel: string;
  pickerSortBy: 'price' | 'multiplier' | 'name';
  externalStructuredOutput: boolean | 'schema';
  externalMaxResponseTokens: number;
  externalAdaptiveMaxResponseTokens: number;
  externalAdaptiveResponseTokens: boolean;
  externalMinAdaptiveResponseTokens: number;
  externalAdaptiveCharsPerToken: number;
  externalRequestTimeoutMs: number;
  /** Cumulative output-token budget for the MCP server per session. 0 disables the guard. */
  mcpMaxTokensPerSession: number;
  runOn: 'manual' | 'onSave';
  include: string[];
  exclude: string[];
  fixMode: 'diff' | 'loop';
  fixLoopMaxIterations: number;
  showScoreCodeLens: boolean;
  inlineRewrites: boolean;
  telemetryEnable: boolean;
  logLevel: 'info' | 'debug' | 'trace';
  fixGuardUpperBoundMultiplier: number;
  fixGuardLowerBoundMultiplier: number;
  fixGuardMaxAnchorChars: number;
  /** Max diagnostics rendered in the editor; overflow is summarized with a "show all" hint (plan item 5). */
  maxDiagnostics: number;
}

export function readConfig(): ExtensionConfig {
  if (cachedConfig) return cachedConfig;
  const c = vscode.workspace.getConfiguration(SECTION);
  const waves = c.get<string[]>('enabledWaves', ALL_WAVES) as WaveName[];
  const provider = c.get<string>('provider', 'vscode-lm');
  const pickerSortBy = c.get<string>('pickerSortBy', 'price');
  const logLevel = c.get<string>('logLevel', 'info');
  const requestTimeoutMs = c.get<number>('external.requestTimeoutMs', 120_000);
  const maxDiagnostics = c.get<number>('maxDiagnostics', 20);
  cachedConfig = {
    ...DEFAULT_ENGINE_CONFIG,
    enable: c.get('enable', true),
    // Validate against the union — a malformed value (e.g. "foo") would
    // otherwise be cast silently and fall through to the vscode-lm branch.
    provider: provider === 'openrouter' || provider === 'copilot' ? provider : 'vscode-lm',
    model: c.get('model', ''),
    deepModel: c.get('deepModel', ''),
    fixModel: c.get('fixModel', ''),
    pickerSortBy: pickerSortBy === 'multiplier' || pickerSortBy === 'name' ? pickerSortBy : 'price',
    externalStructuredOutput: readStructuredOutput(c.get('external.structuredOutput', 'schema')),
    externalMaxResponseTokens: c.get('external.maxResponseTokens', 16_384),
    externalAdaptiveMaxResponseTokens: c.get('external.adaptiveMaxResponseTokens', 65_536),
    externalAdaptiveResponseTokens: c.get('external.adaptiveResponseTokens', false),
    externalMinAdaptiveResponseTokens: c.get('external.minAdaptiveResponseTokens', 4_096),
    externalAdaptiveCharsPerToken: c.get('external.adaptiveCharsPerToken', 8),
    // Clamp to a sane minimum so a 0/negative value can't cause immediate
    // timeouts.
    externalRequestTimeoutMs: Number.isFinite(requestTimeoutMs) && requestTimeoutMs >= 1000 ? requestTimeoutMs : 120_000,
    mcpMaxTokensPerSession: c.get('mcpMaxTokensPerSession', 500_000),
    analysisMode: c.get('analysisMode', DEFAULT_ENGINE_CONFIG.analysisMode),
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
    telemetryEnable: c.get('telemetry.enable', false),
    logLevel: logLevel === 'debug' || logLevel === 'trace' ? logLevel : 'info',
    fixGuardUpperBoundMultiplier: c.get('fix.guard.upperBoundMultiplier', 1.5),
    fixGuardLowerBoundMultiplier: c.get('fix.guard.lowerBoundMultiplier', 0.5),
    fixGuardMaxAnchorChars: c.get('fix.guard.maxAnchorChars', 350),
    filterFindings: c.get('filterFindings', true),
    // Clamp so 0/negative can't silently suppress all diagnostics.
    maxDiagnostics: Number.isFinite(maxDiagnostics) && maxDiagnostics >= 1 ? Math.floor(maxDiagnostics) : 20,
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

/**
 * Read the `external.structuredOutput` setting into the 3-state value the
 * provider expects.
 *   - 'schema' (default): strict JSON schema response_format
 *   - true: legacy json_object response_format
 *   - false: no response_format
 *
 * Strings other than 'schema' collapse to either boolean true (legacy
 * opt-in) or false (off). Unknown values fall back to 'schema' to avoid
 * silently regressing users who typo'd.
 */
export function readStructuredOutput(raw: unknown): boolean | 'schema' {
  if (raw === 'schema') return 'schema';
  if (raw === true || raw === 'true' || raw === '1' || raw === 'on') return true;
  if (raw === false) return false;
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  // Unknown values fall back to 'schema' — see comment above.
  return 'schema';
}

/** Cheap path-based check for whether a document is an AI customization. */
export function isCustomizationPath(fsPath: string, include: string[]): boolean {
  return include.some((g) => simpleGlobMatch(g, fsPath));
}

/** Glob matcher — uses picomatch for full glob support including braces, ?, [abc]. */
function simpleGlobMatch(glob: string, filePath: string): boolean {
  try {
    return picomatch.isMatch(filePath, glob, { nocase: true, dot: true });
  } catch {
    // Malformed glob — treat as no match (report via settings validation instead)
    return false;
  }
}

/**
 * Whether a path matches the user's `exclude` patterns (plus node_modules).
 * Used on the onSave auto-analyze path and folder analyze so the exclude
 * setting is honored consistently — previously it was only applied in
 * runAnalyzeFolder, so an onSave on an excluded include-path still paid for
 * analysis.
 */
export function isExcludedPath(fsPath: string, exclude: string[]): boolean {
  const patterns = ['**/node_modules/**', ...(Array.isArray(exclude) ? exclude : [])];
  return patterns.some((g) => simpleGlobMatch(g, fsPath));
}
