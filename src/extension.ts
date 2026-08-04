import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { Engine, AnalysisResult, Analyzer, WaveName, ALL_WAVES, EngineConfig } from './core';
import { scoreSkill, parseSkillType } from './core/scoring';
import { SurgicalFixer, SURGICAL_FIXABLE_CODES } from './core/fixer';
import { setLogLevel, setTransport } from './core/logger';
import { VsCodeLmProvider } from './providers/vscodeLmProvider';
import { OpenRouterProvider, CopilotProvider } from './providers/externalProvider';
import { readConfig, isCustomizationPath, setupConfigWatcher } from './config';
import { acceptFinding } from './core/acceptedFindings';
import { createDiagnosticCollection, publishDiagnostics } from './ui/diagnostics';
import { StatusBarManager } from './ui/statusBar';
import { ScoreCodeLensProvider } from './ui/codeLens';
import { SkillsCodeActionProvider } from './ui/codeActions';
import { SuggestionHoverProvider } from './ui/hover';
import { createInlineRewriteProvider } from './ui/inlineRewrites';
import { fetchPricing, formatPricing, normalizeModelName, ModelPricing } from './pricing';
import { fetchContextLengths, formatContextLength, resolveContextLength } from './modelCatalog';

/** Runtime field added by Copilot model provider — not in @types/vscode yet. */
interface PricedLanguageModelChat extends vscode.LanguageModelChat {
  pricing?: string;
}

/**
 * Detect the correct provider for a given model ID.
 * Checks the vendor of the first matching vscode.lm model.
 * Returns 'vscode-lm' as fallback for Copilot/free-tier models.
 */
async function detectProviderForModel(modelId: string): Promise<'vscode-lm' | 'openrouter' | 'copilot'> {
  try {
    const models = await vscode.lm.selectChatModels({ id: modelId });
    if (models.length > 0) {
      const vendor = models[0].vendor;
      log('debug', `detectProviderForModel: modelId=${modelId} vendor=${vendor}`);
      // copilot vendor models work via VS Code LM
      if (vendor === 'copilot') return 'vscode-lm';
      // copilotcli and openrouter vendor models are available through VS Code LM
      // (they're OpenRouter models exposed via Copilot extension)
      if (vendor === 'copilotcli' || vendor === 'openrouter') return 'vscode-lm';
      // Non-Copilot vscode.lm models → treat as external (openrouter-compatible)
      return 'openrouter';
    }
  } catch { /* selectChatModels may not be available */ }
  // Default: keep current provider setting
  return readConfig().provider;
}

// ---------------------------------------------------------------------------
// Extension-level state — encapsulated in a class for testability.
// Each activate() call creates a fresh instance; deactivate() disposes it.
// Module-level functions reference `state` for mutable data.
// ---------------------------------------------------------------------------

const FIX_SCHEME = 'skills-review-fix';
const MAX_FIX_PREVIEW_ENTRIES = 20;
const FIX_PREVIEW_MAX_AGE_MS = 10 * 60 * 1000;

/** Translate technical skip reasons into user-friendly explanations. */
function humanizeSkipReason(reason: string): string {
  if (reason.includes('anchor not found')) return 'text not found in document';
  if (reason.includes('anchor too large')) return 'fragment too long for safe fix';
  if (reason.includes('anchor overlaps frontmatter')) return 'cannot fix frontmatter metadata';
  if (reason.includes('ambiguous anchor')) return 'multiple matches — unsafe to fix';
  if (reason.includes('expansion')) return 'fix would make text too long';
  if (reason.includes('shrinkage')) return 'fix would make text too short';
  if (reason.includes('obligation-drop')) return 'would remove obligation word';
  if (reason.includes('numeric-change')) return 'would change a number/value';
  if (reason.includes('concept-swap')) return 'would change meaning';
  if (reason.includes('identical output')) return 'no change needed';
  if (reason.includes('self-critique')) return 'added unverifiable fact';
  if (reason.includes('semantic-judge')) return 'would change obligation/scope';
  return reason;
}

class ExtensionState {
  diagnostics!: vscode.DiagnosticCollection;
  statusBar!: StatusBarManager;
  codeLensProvider!: ScoreCodeLensProvider;
  extensionContext!: vscode.ExtensionContext;
  currentVsCodeLmProvider: VsCodeLmProvider | undefined;
  out!: vscode.LogOutputChannel;
  logFilePath: string | undefined;
  lastResults = new Map<string, AnalysisResult[]>();
  analysisLocks = new Map<string, Promise<void>>();
  disposed = false;
  debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  fixPreviewContent = new Map<string, { text: string; ts: number }>();
  cachedEngine: Engine | undefined;
  cachedEngineConfigHash = '';

  dispose(): void {
    this.disposed = true;
    this.diagnostics?.dispose();
    this.statusBar?.dispose();
    this.codeLensProvider?.dispose();
    this.out?.dispose();
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    this.lastResults.clear();
    this.analysisLocks.clear();
    this.fixPreviewContent.clear();
    this.cachedEngine = undefined;
    Analyzer.clearHistory();
  }
}

/** Active extension state — set by activate(), cleared by deactivate(). */
let state: ExtensionState | undefined;

/** Append a timestamped line to both the VS Code output channel and the log file. */
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
  const cfg = readConfig();
  if (level === 'debug' && cfg.logLevel !== 'debug') return;

  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase().padEnd(5)}] ${message}`;
  if (level === 'error') state?.out?.error(message);
  else if (level === 'warn') state?.out?.warn(message);
  else if (level === 'debug') state?.out?.debug(message);
  else state?.out?.info(message);
  if (level === 'debug' && cfg.logLevel === 'debug' && state?.logFilePath) {
    try { fs.appendFileSync(state.logFilePath, line + '\n'); } catch { /* ignore */ }
  }
}

/**
 * Evict stale fix-preview entries: per-document old entries and entries
 * older than FIX_PREVIEW_MAX_AGE_MS (handles forced reloads gracefully).
 */
function evictStaleFixPreviews(docPath?: string): void {
  if (!state) return;
  const now = Date.now();
  for (const [key, entry] of state.fixPreviewContent) {
    const expired = now - entry.ts > FIX_PREVIEW_MAX_AGE_MS;
    const staleDoc = docPath && key.startsWith(docPath + '?');
    if (expired || staleDoc) state.fixPreviewContent.delete(key);
  }
}

/** Resolve the accepted-findings path from the workspace root (not process.cwd()). */
function getAcceptedFindingsPath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return path.join(folders[0].uri.fsPath, '.accepted-findings.json');
  }
  // Fallback: empty string signals caller to skip accepted-findings lookup
  return '';
}

/** Remove the accepted-findings file so each test session starts clean. */
async function clearAcceptedFindings(): Promise<void> {
  const findingsPath = getAcceptedFindingsPath();
  if (!findingsPath) {
    vscode.window.showWarningMessage('Skills Review: No workspace folder open.');
    return;
  }
  try {
    if (fs.existsSync(findingsPath)) {
      fs.unlinkSync(findingsPath);
      vscode.window.showInformationMessage('Skills Review: Accepted findings cleared.');
      log('info', 'clearAcceptedFindings: deleted ' + findingsPath);
    } else {
      vscode.window.showInformationMessage('Skills Review: No accepted findings file to clear.');
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Skills Review: Failed to clear accepted findings — ${err}`);
  }
}

function computeConfigHash(cfg: ReturnType<typeof readConfig>, apiKey?: string): string {
  // Hash full API key (SHA-256 truncated) for reliable change detection on key rotation.
  const apiKeyDiscriminator = apiKey
    ? crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 8)
    : '';
  // Include prompt file mtimes so edits to .prompt files invalidate the cache.
  // This prevents stale prompts from being reused after edits without extension restart.
  let promptMtimes = '';
  try {
    const promptsDir = path.join(path.dirname(require.resolve('./core/prompts')), 'prompts');
    const files = fs.readdirSync(promptsDir).filter(f => f.endsWith('.prompt'));
    promptMtimes = files.sort().map(f => {
      try { return `${f}:${fs.statSync(path.join(promptsDir, f)).mtimeMs}`; } catch { return f; }
    }).join(',');
  } catch { /* prompts dir not available — skip */ }
  return `${cfg.provider}:${cfg.model}:${cfg.deepModel}:${cfg.fixModel}:${cfg.externalStructuredOutput}:${cfg.externalMaxResponseTokens}:${cfg.externalAdaptiveMaxResponseTokens}:${cfg.externalAdaptiveResponseTokens}:${cfg.externalMinAdaptiveResponseTokens}:${cfg.externalAdaptiveCharsPerToken}:${cfg.externalRequestTimeoutMs}:${cfg.analysisMode}:${cfg.enabledWaves.join(',')}:${cfg.fixStrategy}:${cfg.fixSemanticCheck}:${cfg.fixSelfCritique}:${cfg.fixReferenceGrounding}:${JSON.stringify(cfg.severityOverrides)}:${apiKeyDiscriminator}:${promptMtimes}`;
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  state = new ExtensionState();
  state.extensionContext = context;
  const cfg = readConfig();

  if (!cfg.enable) {
    log('info', 'Extension disabled by configuration; skipping activation wiring.');
    return;
  }

  state.out = vscode.window.createOutputChannel('Skills Review', { log: true });
  state.diagnostics = createDiagnosticCollection();
  state.statusBar = new StatusBarManager();
  state.codeLensProvider = new ScoreCodeLensProvider();

  if (cfg.logLevel === 'debug' || cfg.logLevel === 'trace') {
    state.logFilePath = os.tmpdir() + '/skills-review-debug.log';
    try { fs.writeFileSync(state.logFilePath, `--- Skills Review debug log started ${new Date().toISOString()} ---\n`); } catch { /* ignore */ }
  }

  setLogLevel(cfg.logLevel === 'trace' ? 'trace' : cfg.logLevel === 'debug' ? 'debug' : 'info');
  setTransport((line) => {
    state?.out?.appendLine(line);
    if ((cfg.logLevel === 'debug' || cfg.logLevel === 'trace') && state?.logFilePath) {
      try { fs.appendFileSync(state.logFilePath, line + '\n'); } catch { /* ignore */ }
    }
  });

  context.subscriptions.push(state.out, state.diagnostics, state.statusBar, state.codeLensProvider);

  // Clear accepted findings on activation when running in test mode
  if (process.env.VSCODE_TEST_MODE) {
    clearAcceptedFindings();
  }

  context.subscriptions.push(setupConfigWatcher());
  // Propagate logLevel changes from settings to the logger at runtime (no restart needed).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('skillsReviewAndPolish.logLevel')) {
        const newCfg = readConfig();
        setLogLevel(newCfg.logLevel === 'trace' ? 'trace' : newCfg.logLevel === 'debug' ? 'debug' : 'info');
        log('info', `logLevel changed to ${newCfg.logLevel}`);
      }
    }),
  );
  const extVersion = context.extension?.packageJSON?.version ?? 'unknown';
  log('info', (cfg.logLevel === 'debug' || cfg.logLevel === 'trace')
    ? `Extension activated — version: ${extVersion}, log level: ${cfg.logLevel}, log file: ${state.logFilePath ?? '(none)'}`
    : `Extension activated — version: ${extVersion}, log level: ${cfg.logLevel}`);

  const docSelector: vscode.DocumentFilter[] = [{ language: 'markdown' }];

  const updateContext = (editor: vscode.TextEditor | undefined) => {
    const cfg = readConfig();
    const isCustomization =
      !!editor && isCustomizationPath(editor.document.uri.fsPath, cfg.include);
    const hasDiagnostics = !!editor && !!(state?.diagnostics.get(editor.document.uri)?.length);
    vscode.commands.executeCommand(
      'setContext',
      'skillsReviewAndPolish.isCustomization',
      isCustomization,
    );
    vscode.commands.executeCommand(
      'setContext',
      'skillsReviewAndPolish.hasDiagnostics',
      !!hasDiagnostics,
    );
    if (isCustomization) {
      state?.statusBar.showIdle();
    }
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateContext));
  updateContext(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.commands.registerCommand('skillsReviewAndPolish.analyze', () => runAnalyze(false)),
    vscode.commands.registerCommand('skillsReviewAndPolish.rescan', () => analyzeWithOptions()),
    vscode.commands.registerCommand('skillsReviewAndPolish.fixAll', runFixAll),
    vscode.commands.registerCommand('skillsReviewAndPolish.fixIssue', runFixIssue),
    vscode.commands.registerCommand('skillsReviewAndPolish.ignoreRule', runIgnoreRule),
    vscode.commands.registerCommand('skillsReviewAndPolish.acceptFinding', runAcceptFinding),
    vscode.commands.registerCommand('skillsReviewAndPolish.selectAnalysisModel', () =>
      selectModel('model'),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.selectFixModel', () =>
      selectModel('fixModel'),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.setPickerSortOrder', () =>
      selectPickerSortOrder(),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.setApiKey', () => setApiKey()),
    vscode.commands.registerCommand('skillsReviewAndPolish.testModelSimplePrompt', testModelSimplePrompt),
    vscode.commands.registerCommand('skillsReviewAndPolish.analyzeFolder', (uri?: vscode.Uri) =>
      runAnalyzeFolder(uri),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.analyzeFile', (uri?: vscode.Uri) =>
      analyzeFile(uri),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.analyzeWithOptions', (uri?: vscode.Uri) =>
      analyzeWithOptions(uri),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.selectProvider', () =>
      selectProvider(),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.toggleLogLevel', () =>
      toggleLogLevel(),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.clearAcceptedFindings', () =>
      clearAcceptedFindings(),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.analyzeCognitiveLoad', (uri?: vscode.Uri) =>
      analyzeCognitiveLoad(uri),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.syncMcpConfig', syncMcpConfig),
    vscode.commands.registerCommand('skillsReviewAndPolish.showFixRejectionReasons', showFixRejectionReasons),
    vscode.commands.registerCommand('skillsReviewAndPolish.inspectModels', inspectModels),
    vscode.commands.registerCommand('skillsReviewAndPolish.showAllFindings', showAllFindings),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(docSelector, new SkillsCodeActionProvider(), {
      providedCodeActionKinds: SkillsCodeActionProvider.providedCodeActionKinds,
    }),
    vscode.languages.registerCodeLensProvider(docSelector, state.codeLensProvider),
    vscode.languages.registerHoverProvider(docSelector, new SuggestionHoverProvider()),
  );

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(FIX_SCHEME, {
      provideTextDocumentContent(uri: vscode.Uri): string {
        const key = uri.query ? `${uri.path}?${uri.query}` : uri.path;
        return state?.fixPreviewContent.get(key)?.text ?? '';
      },
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const cfg = readConfig();
      if (
        cfg.enable &&
        cfg.runOn === 'onSave' &&
        isCustomizationPath(doc.uri.fsPath, cfg.include)
      ) {
        void analyzeDocument(doc, undefined, 'onSave');
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const cfg = readConfig();
      if (!cfg.enable || cfg.runOn !== 'onType') return;
      if (!isCustomizationPath(e.document.uri.fsPath, cfg.include)) return;
      const key = e.document.uri.toString();
      const existing = state?.debounceTimers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      state?.debounceTimers.set(
        key,
        setTimeout(() => {
          state?.debounceTimers.delete(key);
          void analyzeDocument(e.document, undefined, 'onType');
        }, 2000),
      );
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      state?.lastResults.delete(key);
      if (state) {
        for (const previewKey of state.fixPreviewContent.keys()) {
          if (previewKey.startsWith(doc.uri.path)) {
            state.fixPreviewContent.delete(previewKey);
          }
        }
      }
    }),
  );

  registerLanguageModelTools(context);

  {
    const cfg = readConfig();
    if (cfg.inlineRewrites) {
      context.subscriptions.push(
        createInlineRewriteProvider(
          () => buildEngine(),
          (uri) => state?.lastResults.get(uri.toString()) ?? [],
        ),
      );
    }
  }
}

export function deactivate(): void {
  log('info', 'Extension deactivating');
  state?.dispose();
  state = undefined;
}

// ---------------------------------------------------------------------------
// Engine builder
// ---------------------------------------------------------------------------

async function buildEngine(context?: vscode.ExtensionContext): Promise<Engine> {
  const ctx = context ?? state?.extensionContext;
  if (!ctx) {
    throw new Error('buildEngine: ExtensionContext is not available yet. Ensure activate() has completed.');
  }
  const cfg = readConfig();
  const apiKey = ctx.secrets ? await ctx.secrets.get('skillsReviewAndPolish.apiKey') : undefined;
  const hash = computeConfigHash(cfg, apiKey);
  if (state?.cachedEngine && state.cachedEngineConfigHash === hash) {
    log('debug', 'buildEngine: using cached engine');
    return state.cachedEngine;
  }

  log('info', `buildEngine: provider=${cfg.provider} standardModel=${cfg.model || '(auto)'} deepModel=${cfg.deepModel || '(none)'}`);

  if (cfg.provider === 'openrouter') {
    if (!apiKey) {
      log('warn', `buildEngine: ${cfg.provider} selected but no API key — aborting`);
      vscode.window.showErrorMessage(
        `Skills Review: provider is "${cfg.provider}" but no API key is stored. ` +
          'Run "Skills Review: Set API Key" first, or switch provider to "vscode-lm".',
      );
      throw new Error(`No API key configured for provider "${cfg.provider}"`);
    }
    // Resolve the model's real input context length so the analyzer scales its
    // document budget instead of falling back to the 200K-char default.
    const resolvedCtx = await resolveContextLength(cfg.model || '');
    const contextLength = resolvedCtx?.contextLength;

    const base = new OpenRouterProvider({
      apiKey,
      model: cfg.model || '',
      deepModel: cfg.deepModel || undefined,
      fixModel: cfg.fixModel || undefined,
      maxTokens: cfg.externalMaxResponseTokens,
      adaptiveMaxTokens: cfg.externalAdaptiveResponseTokens,
      adaptiveMaxTokensCap: cfg.externalAdaptiveMaxResponseTokens,
      minAdaptiveTokens: cfg.externalMinAdaptiveResponseTokens,
      adaptiveCharsPerToken: cfg.externalAdaptiveCharsPerToken,
      structuredOutput: cfg.externalStructuredOutput,
      requestTimeoutMs: cfg.externalRequestTimeoutMs,
      contextLength,
    });
    log('info', `buildEngine: using external provider ${cfg.provider} model=${cfg.model || '(auto)'} deepModel=${cfg.deepModel || '(same as model)'} fixModel=${cfg.fixModel || '(same as model)'}`);
    state!.currentVsCodeLmProvider = undefined;
    state!.cachedEngine = new Engine(base, cfg);
    state!.cachedEngineConfigHash = hash;
    return state!.cachedEngine;
  }

  if (cfg.provider === 'copilot') {
    // Copilot API provider: uses a GitHub token (GITHUB_TOKEN env or the
    // stored API key) against api.githubcopilot.com — no separate API key.
    const copilotToken = apiKey || process.env.GITHUB_TOKEN?.trim() || process.env.COPILOT_TOKEN?.trim();
    if (!copilotToken) {
      log('warn', `buildEngine: copilot selected but no token — aborting`);
      vscode.window.showErrorMessage(
        `Skills Review: provider is "copilot" but no GitHub token is available. ` +
          'Set GITHUB_TOKEN, or run "Skills Review: Set API Key".',
      );
      throw new Error('No GitHub token configured for the copilot provider');
    }
    const resolvedCtx = await resolveContextLength(cfg.model || '');
    const contextLength = resolvedCtx?.contextLength;
    const provider = new CopilotProvider({
      apiKey: copilotToken,
      model: cfg.model || '',
      deepModel: cfg.deepModel || undefined,
      fixModel: cfg.fixModel || undefined,
      maxTokens: cfg.externalMaxResponseTokens,
      adaptiveMaxTokens: cfg.externalAdaptiveResponseTokens,
      adaptiveMaxTokensCap: cfg.externalAdaptiveMaxResponseTokens,
      minAdaptiveTokens: cfg.externalMinAdaptiveResponseTokens,
      adaptiveCharsPerToken: cfg.externalAdaptiveCharsPerToken,
      structuredOutput: cfg.externalStructuredOutput,
      requestTimeoutMs: cfg.externalRequestTimeoutMs,
      contextLength,
    });
    log('info', `buildEngine: using copilot provider model=${cfg.model || '(auto)'} deepModel=${cfg.deepModel || '(same as model)'} fixModel=${cfg.fixModel || '(same as model)'}`);
    state!.currentVsCodeLmProvider = undefined;
    state!.cachedEngine = new Engine(provider, cfg);
    state!.cachedEngineConfigHash = hash;
    return state!.cachedEngine;
  }

  log('info', `buildEngine: using vscode-lm standardModel=${cfg.model || '(auto)'} deepModel=${cfg.deepModel || '(none)'} fixModel=${cfg.fixModel || '(same as standard)'}`);
  const vscodeLmProvider = new VsCodeLmProvider(
    cfg.model,
    cfg.deepModel || cfg.model,
    cfg.fixModel || undefined,
  );
  vscodeLmProvider.onModelSelected = (modelId: string) => {
    log('info', `buildEngine: vscode-lm selected model: ${modelId}`);
  };
  // Pre-warm model selection so provider.getContextLength() returns the real
  // maxInputTokens before the analyzer builds wave prompts. Without this the
  // first analyze() run builds every wave against the 200K-char fallback.
  await vscodeLmProvider.warmUp();
  state!.currentVsCodeLmProvider = vscodeLmProvider;
  state!.cachedEngine = new Engine(vscodeLmProvider, cfg);
  state!.cachedEngineConfigHash = hash;
  return state!.cachedEngine;
}

// ---------------------------------------------------------------------------
// Analyze
// ---------------------------------------------------------------------------

async function runAnalyze(_force: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const cfg = readConfig();
  const path = editor.document.uri.fsPath;

  // When triggered manually via command, analyse any file — the user explicitly asked for it.
  // The gate only applies to automatic triggers (onSave/onType) which call analyzeDocument directly.
  if (!isCustomizationPath(path, cfg.include)) {
    log('info', `runAnalyze: ${path} is not a standard customization file — analysing anyway (manual trigger).`);
  }

  // For vscode-lm provider, ensure a model is configured
  if (cfg.provider === 'vscode-lm' && !cfg.model) {
    const modelPick = await selectModel('model');
    if (!modelPick) return;
    await vscode.workspace.getConfiguration('skillsReviewAndPolish')
      .update('model', modelPick.modelId, vscode.ConfigurationTarget.Global);
  }

  await analyzeDocument(editor.document);
}

// ---------------------------------------------------------------------------
// Analyze File (right-click on editor tab)
// ---------------------------------------------------------------------------

async function analyzeFile(uri?: vscode.Uri): Promise<void> {
  // If invoked from context menu, uri is provided; otherwise use active editor
  if (!uri) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Skills Review: No file to analyze.');
      return;
    }
    uri = editor.document.uri;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const cfg = readConfig();
  if (!isCustomizationPath(doc.uri.fsPath, cfg.include)) {
    log('info', `analyzeFile: ${doc.uri.fsPath} is not a standard customization file — analysing anyway.`);
  }

  // For vscode-lm provider, ensure a model is configured
  if (cfg.provider === 'vscode-lm' && !cfg.model) {
    const modelPick = await selectModel('model');
    if (!modelPick) return;
    await vscode.workspace.getConfiguration('skillsReviewAndPolish')
      .update('model', modelPick.modelId, vscode.ConfigurationTarget.Global);
  }

  await analyzeDocument(doc);
}

// ---------------------------------------------------------------------------
// Analyze Cognitive Load — targeted structural + persona wave analysis
// ---------------------------------------------------------------------------

/**
 * Runs only the structural (cognitive-*) and persona waves using the
 * analysisWaves E21 API. Useful for focused cognitive-load reviews
 * without the cost of all 6 waves.
 */
async function analyzeCognitiveLoad(uri?: vscode.Uri): Promise<void> {
  if (!uri) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Skills Review: No file to analyze.');
      return;
    }
    uri = editor.document.uri;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await analyzeDocument(doc, undefined, 'manual', { analysisWaves: ['structural', 'persona'] });
}

// ---------------------------------------------------------------------------
// Analyze With Options — modal with wave/mode/provider selection
// ---------------------------------------------------------------------------

/**
 * Shows a modal with scan options (mode, waves, provider, model) and then
 * runs analysis with the selected configuration. This is the primary entry
 * point for customizable per-invocation analysis.
 */
async function analyzeWithOptions(uri?: vscode.Uri): Promise<void> {
  const cfg = readConfig();

  // ── Step 1: Mode selector (single quick-pick, not canPickMany) ─────────
  const MODE_ITEMS = [
    {
      label: '$(zap) Single Prompt',
      description: '1 LLM call — fastest & cheapest, lower recall',
      detail: 'All 6 categories in one pass. Good for quick checks.',
      mode: 'single' as const,
    },
    {
      label: '$(search) Focused (2 waves)',
      description: 'Contradictions + ambiguities only — good quality, faster',
      detail: 'High-signal waves only. Best when time-constrained.',
      mode: 'focused' as const,
    },
    {
      label: '$(beaker) Multi-Wave (Recommended)',
      description: '6 focused passes — best quality, customisable',
      detail: 'Full analysis. You can deselect waves in the next step.',
      mode: 'multiWave' as const,
    },
  ];

  const modePick = await vscode.window.showQuickPick(MODE_ITEMS, {
    title: 'Skills Review — Choose Analysis Mode (1 of 2)',
    placeHolder: 'Select a mode and press Enter',
  });
  if (!modePick) return;

  // ── Step 2: Wave selector (only for multiWave) ─────────────────────────
  let selectedWaves: WaveName[];

  if (modePick.mode === 'multiWave') {
    const waveItems = ALL_WAVES.map(w => ({
      label: w.charAt(0).toUpperCase() + w.slice(1),
      description: '',
      picked: cfg.enabledWaves.includes(w),
      value: w,
    }));

    const wavePick = await vscode.window.showQuickPick(waveItems, {
      title: 'Skills Review — Select Waves (2 of 2)',
      placeHolder: 'Space to toggle · Enter to confirm · Esc to cancel',
      canPickMany: true,
    });
    if (!wavePick) return;
    selectedWaves = wavePick.map(w => w.value);
    if (selectedWaves.length === 0) {
      vscode.window.showWarningMessage('Skills Review: At least one wave must be selected.');
      return;
    }
  } else if (modePick.mode === 'focused') {
    selectedWaves = ['contradictions', 'ambiguities'];
  } else {
    selectedWaves = [...ALL_WAVES]; // single-pass uses all — mode drives LLM prompt, not wave filter
  }

  // ── Step 3: Model picker (force explicit selection) ─────────────────────
  const modelPick = await selectModel('model');
  if (!modelPick) return;

  // ── Step 4: Run analysis ──────────────────────────────────────────────
  const document = uri
    ? await vscode.workspace.openTextDocument(uri)
    : vscode.window.activeTextEditor?.document;
  if (!document) {
    vscode.window.showWarningMessage('Skills Review: No file to analyze.');
    return;
  }

  const originalWaves = cfg.enabledWaves;
  const originalMode = cfg.analysisMode;
  await vscode.workspace.getConfiguration('skillsReviewAndPolish')
    .update('enabledWaves', selectedWaves, vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration('skillsReviewAndPolish')
    .update('analysisMode', modePick.mode, vscode.ConfigurationTarget.Global);

  try {
    await analyzeDocument(document);
  } finally {
    await vscode.workspace.getConfiguration('skillsReviewAndPolish')
      .update('enabledWaves', originalWaves, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration('skillsReviewAndPolish')
      .update('analysisMode', originalMode, vscode.ConfigurationTarget.Global);
  }
}

// ---------------------------------------------------------------------------
// Select Provider (command palette)
// ---------------------------------------------------------------------------

async function selectProvider(): Promise<void> {
  const cfg = readConfig();
  const current = cfg.provider;
  const items: Array<{ label: string; description: string; value: string; picked: boolean }> = [
    {
      label: '🟢 Copilot (vscode-lm)',
      description: 'Uses your Copilot subscription — no API key needed',
      value: 'vscode-lm',
      picked: current === 'vscode-lm',
    },
    {
      label: '🔵 OpenRouter',
      description: 'Requires API key — wide model selection',
      value: 'openrouter',
      picked: current === 'openrouter',
    },
    {
      label: '🟣 Copilot API',
      description: 'Uses api.githubcopilot.com with a GitHub token — no separate API key',
      value: 'copilot',
      picked: current === 'copilot',
    },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title: 'Skills Review — Select LLM Provider',
    placeHolder: `Current: ${current}`,
  });

  if (pick && pick.value !== current) {
    await vscode.workspace.getConfiguration('skillsReviewAndPolish')
      .update('provider', pick.value, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Skills Review: Provider set to "${pick.label}".`);
    log('info', `selectProvider: ${current} → ${pick.value}`);
  }
}

// ---------------------------------------------------------------------------
// Toggle Log Level (no restart required)
// ---------------------------------------------------------------------------

async function toggleLogLevel(): Promise<void> {
  const cfg = readConfig();
  // Cycle: info → debug → trace → info
  const newLevel: 'info' | 'debug' | 'trace' =
    cfg.logLevel === 'info' ? 'debug' : cfg.logLevel === 'debug' ? 'trace' : 'info';

  await vscode.workspace.getConfiguration('skillsReviewAndPolish')
    .update('logLevel', newLevel, vscode.ConfigurationTarget.Global);

  // Update the runtime transport immediately (no reload needed)
  setLogLevel(newLevel === 'trace' ? 'trace' : newLevel === 'debug' ? 'debug' : 'info');
  if ((newLevel === 'debug' || newLevel === 'trace') && !state?.logFilePath) {
    state!.logFilePath = os.tmpdir() + '/skills-review-debug.log';
    try { fs.writeFileSync(state!.logFilePath, `--- Skills Review debug log started ${new Date().toISOString()} ---\n`); } catch { /* ignore */ }
  }
  setTransport((line) => {
    state?.out?.appendLine(line);
    if ((newLevel === 'debug' || newLevel === 'trace') && state?.logFilePath) {
      try { fs.appendFileSync(state.logFilePath, line + '\n'); } catch { /* ignore */ }
    }
  });

  const msg = newLevel === 'trace'
    ? 'Skills Review: Trace logging enabled — raw LLM responses visible. Check Output panel or /tmp/skills-review-debug.log'
    : newLevel === 'debug'
    ? 'Skills Review: Debug logging enabled. Check Output panel or /tmp/skills-review-debug.log'
    : 'Skills Review: Debug logging disabled.';
  vscode.window.showInformationMessage(msg);
  log('info', `toggleLogLevel: → ${newLevel}`);
}

// ---------------------------------------------------------------------------
// Analyze Folder
// ---------------------------------------------------------------------------

async function runAnalyzeFolder(uri?: vscode.Uri): Promise<void> {
  const folderPath = uri?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folderPath) {
    vscode.window.showWarningMessage('Skills Review: No folder selected or workspace open.');
    return;
  }

  const cfg = readConfig();
  // Use configured include patterns + common prompt directory patterns + direct .md files.
  // findFiles doesn't support brace expansion {a,b} — query each pattern separately.
  const namePatterns = cfg.include.length ? cfg.include : [
    '**/SKILL.md', '**/*.prompt.md', '**/*.agent.md', '**/*.instructions.md', '**/AGENTS.md',
  ];
  // Catch .md files in common prompt directories AND directly in the selected folder
  const dirPatterns = [
    '*.md',
    '**/instructions/*.md',
    '**/agents/*.md',
    '**/prompts/*.md',
    '**/skills/**/*.md',
  ];
  const allPatterns = [...new Set([...namePatterns, ...dirPatterns])];
  // Exclude node_modules AND the user's configured exclude patterns so we
  // don't enumerate huge trees just to discard them.
  const excludePattern = ['**/node_modules/**', ...cfg.exclude];
  const fileSets = await Promise.all(
    allPatterns.map(p => vscode.workspace.findFiles(new vscode.RelativePattern(folderPath, p), `{${excludePattern.join(',')}}`)),
  );
  // Deduplicate and filter to .md files only
  const seen = new Set<string>();
  const files: vscode.Uri[] = [];
  for (const set of fileSets) {
    for (const uri of set) {
      if (!seen.has(uri.toString()) && uri.fsPath.endsWith('.md') &&
          isCustomizationPath(uri.fsPath, cfg.include)) {
        seen.add(uri.toString());
        files.push(uri);
      }
    }
  }

  if (files.length === 0) {
    vscode.window.showInformationMessage(`Skills Review: No customization files found in ${folderPath}.`);
    return;
  }

  log('info', `runAnalyzeFolder: found ${files.length} files in ${folderPath}`);

  // Folder scans always run synchronously (single-request analysis).
  const jobs: Array<{ doc: vscode.TextDocument; job: Promise<AnalysisResult[]> }> = [];

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Skills Review: Analyzing ${files.length} file(s)…`, cancellable: true },
    async (progress, token) => {
      for (let i = 0; i < files.length; i++) {
        if (token.isCancellationRequested) break;
        const doc = await vscode.workspace.openTextDocument(files[i]);
        progress.report({ message: `${i + 1}/${files.length}: ${doc.fileName}`, increment: 100 / files.length });
        const engine = await buildEngine(state?.extensionContext);
        const job = engine.analyze(
          { text: doc.getText(), filePath: doc.uri.fsPath, acceptedFindingsPath: getAcceptedFindingsPath(), token },
        );
        jobs.push({ doc, job });
      }
    },
  );

  // Publish results as each job completes (fire-and-forget; non-blocking).
  for (const { doc, job } of jobs) {
    void job.then((results) => {
      if (!results) return;
      publishDiagnostics(state!.diagnostics, doc.uri, results, cfg.severityOverrides, cfg.maxDiagnostics);
      state?.lastResults.set(doc.uri.toString(), results);
      const lineCount = doc.getText().split('\n').length;
      const score = scoreSkill(results, lineCount, parseSkillType(doc.getText()));
      if (cfg.showScoreCodeLens) state?.codeLensProvider.update(doc.uri, score, results.length);
    });
  }

  vscode.window.showInformationMessage(`Skills Review: Finished analyzing ${files.length} file(s).`);
}

type TriggerSource = 'manual' | 'onSave' | 'onType';

async function analyzeDocument(
  doc: vscode.TextDocument,
  token?: vscode.CancellationToken,
  triggerSource: TriggerSource = 'manual',
  configOverride?: Partial<EngineConfig>,
): Promise<void> {
  const cfg = readConfig();
  const filePath = doc.uri.fsPath;
  const uriKey = doc.uri.toString();

  // Serialize concurrent analyses for the same URI to prevent races on lastResults.
  const prev = state?.analysisLocks.get(uriKey);
  if (prev) {
    log('debug', `analyzeDocument: waiting for in-flight analysis of ${filePath}`);
    await prev;
  }

  let resolveLock!: () => void;
  const lock = new Promise<void>((resolve) => { resolveLock = resolve; });
  state!.analysisLocks.set(uriKey, lock);

  try {
    if (state?.disposed) {
      log('debug', `analyzeDocument: skipping ${filePath} — extension disposed`);
      return;
    }
    log('info', `analyzeDocument: START ${filePath} (${doc.getText().length} chars)`);
    // Only reveal output panel for manual triggers — onType/onSave should not steal focus or cause layout flicker.
    if (triggerSource === 'manual') {
      state?.out?.show(false);
    }

    state?.statusBar.startAnalyzing();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Skills Review: Analyzing…', cancellable: true },
      async (progress, progressToken) => {
        try {
          const engine = await buildEngine(state?.extensionContext);
          const text = doc.getText();
          const effectiveToken = token ?? progressToken;
          if (effectiveToken?.isCancellationRequested) return;
          log('info', `analyzeDocument: calling engine.analyze on ${text.length} chars`);
          const results = await engine.analyze({ text, filePath, acceptedFindingsPath: getAcceptedFindingsPath(), token: effectiveToken }, undefined, undefined, configOverride);
          if (token?.isCancellationRequested) return;
          log('info', `analyzeDocument: got ${results.length} results`);
          for (const r of results) {
            log('debug', `  [${r.severity}] ${r.code} L${(r.range?.start?.line ?? 0) + 1}: ${r.message.slice(0, 120)}`);
          }

          publishDiagnostics(state!.diagnostics, doc.uri, results, cfg.severityOverrides, cfg.maxDiagnostics);

          // Store for later fix commands
          state?.lastResults.set(uriKey, results);

          // Compute score inline (avoids a redundant second engine.analyze() call)
          const lineCount = text.split('\n').length;
          const skillType = parseSkillType(text);
          const score = scoreSkill(results, lineCount, skillType);
          log('info', `analyzeDocument: score=${score.score} grade=${score.grade} type=${skillType}`);

          if (cfg.showScoreCodeLens) {
            state?.codeLensProvider.update(doc.uri, score, results.length);
          }

          state?.statusBar.showResult(score.grade, results.length);

          vscode.commands.executeCommand(
            'setContext',
            'skillsReviewAndPolish.isCustomization',
            isCustomizationPath(filePath, cfg.include),
          );
          vscode.commands.executeCommand(
            'setContext',
            'skillsReviewAndPolish.hasDiagnostics',
            results.length > 0,
          );

          const issueLabel =
            results.length === 0
              ? 'No issues found.'
              : `${results.length} issue${results.length === 1 ? '' : 's'} found (grade ${score.grade}).`;
          log('info', `analyzeDocument: DONE — ${issueLabel}`);

          // Check for incomplete analysis — rate limits or failed waves.
          // Both mean the finding set is partial; the grade is Ungraded and
          // the user should know results may be missing.
          const failedWaveCount = score.infraErrorCount;
          if (score.rateLimitedWaveCount > 0) {
            const choice = await vscode.window.showWarningMessage(
              `Skills Review: Hit rate limits on ${score.rateLimitedWaveCount} wave(s). Some results may be incomplete (grade: ${score.grade}).`,
              'Switch to Single Prompt',
              'Dismiss',
            );
            if (choice === 'Switch to Single Prompt') {
              await vscode.workspace.getConfiguration('skillsReviewAndPolish').update(
                'analysisMode', 'single', vscode.ConfigurationTarget.Global,
              );
              vscode.window.showInformationMessage(
                'Skills Review: Switched to single-prompt mode. Re-analyze to use fewer API calls (results may be less accurate).',
              );
            }
          } else if (failedWaveCount > 0) {
            const failedWaves = results
              .filter(r => r.code === 'llm-error')
              .map(r => r.message.match(/\[(.+?)\]/)?.[1])
              .filter(Boolean)
              .join(', ');
            vscode.window.showWarningMessage(
              `Skills Review: ${failedWaveCount} analysis wave(s) failed${failedWaves ? ` (${failedWaves})` : ''} after retry. Results are incomplete — re-analyze to retry (grade: ${score.grade}).`,
            );
          } else {
            vscode.window.showInformationMessage(`Skills Review: ${issueLabel}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log('error', `analyzeDocument: ERROR — ${message}`);
          state?.statusBar.showError(message);
          vscode.window.showWarningMessage(`Skills Review: ${message}`);
        }
      },
    );
  } finally {
    resolveLock();
    state?.analysisLocks.delete(uriKey);
  }
}

// ---------------------------------------------------------------------------
// Fix All
// ---------------------------------------------------------------------------

async function runFixAll(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    log('warn', 'runFixAll: no active editor');
    vscode.window.showWarningMessage('Skills Review: Open a customization file first.');
    return;
  }
  const doc = editor.document;
  const cfg = readConfig();
  // Guard: ensure the active document is a customization file
  if (!isCustomizationPath(doc.uri.fsPath, cfg.include)) {
    log('warn', `runFixAll: ${doc.uri.fsPath} is not a customization file`);
    vscode.window.showWarningMessage('Skills Review: Open a customization file first.');
    return;
  }
  const results = state?.lastResults.get(doc.uri.toString()) ?? [];
  const fixable = results.filter((r) => SURGICAL_FIXABLE_CODES.has(r.code ?? ''));
  if (fixable.length === 0) {
    log('info', `runFixAll: no fixable issues in ${doc.uri.fsPath}`);
    vscode.window.showInformationMessage('Skills Review: No auto-fixable issues in this file.');
    return;
  }

  log('info', `runFixAll: starting fix mode=${cfg.fixMode} for ${fixable.length} issues`);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Skills Review: Computing ${fixable.length} fix(es)…`,
      cancellable: false,
    },
    async () => {
      try {
        const engine = await buildEngine();
        const text = doc.getText();
        log('info', `runFixAll: ${fixable.length} fixable issues on ${doc.uri.fsPath}`);
        const { fixedText, applied, skipped, skippedReasons } = await engine.surgicalFix(
          { text, filePath: doc.uri.fsPath },
          fixable,
        );
        log('info', `runFixAll: applied=${applied} skipped=${skipped} originalLen=${text.length} fixedLen=${fixedText.length}`);
        if (skippedReasons.length > 0) {
          log('info', `runFixAll: skipped reasons: ${skippedReasons.join('; ')}`);
        }

        if (applied === 0) {
          log('info', `runFixAll: no fixes accepted (all ${skipped} skipped by safety guards)`);
          const humanReasons = skippedReasons.map(humanizeSkipReason).slice(0, 3).join('; ');
          vscode.window.showInformationMessage(
            `Skills Review: No fixes accepted (${skipped} skipped). ${humanReasons ? `Reasons: ${humanReasons}` : ''}`,
          );
          return;
        }

        if (cfg.fixMode === 'diff') {
          log('info', `runFixAll: showing diff preview for ${applied} fixes`);
          await showFixDiff(doc, fixedText, `Fix All — ${applied} change(s)`);
        } else {
          log('info', `runFixAll: applying ${applied} fixes directly`);
          await applyFixToDocument(doc, text, fixedText);
          const humanReasons = skippedReasons.map(humanizeSkipReason).slice(0, 2).join('; ');
          vscode.window.showInformationMessage(
            `Skills Review: Applied ${applied} fix(es)${skipped ? `. ${skipped} skipped: ${humanReasons}` : ''}.`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log('error', `runFixAll: ERROR — ${message}`);
        vscode.window.showErrorMessage(`Skills Review fix error: ${message}`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Fix single issue
// ---------------------------------------------------------------------------

async function runFixIssue(
  uri: vscode.Uri,
  resultOrDiag: AnalysisResult | vscode.Diagnostic,
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const cfg = readConfig();
  // Guard: ensure the document is a customization file
  if (!isCustomizationPath(doc.uri.fsPath, cfg.include)) {
    log('warn', `runFixIssue: ${doc.uri.fsPath} is not a customization file`);
    return;
  }
  log('info', `runFixIssue: starting fix mode=${cfg.fixMode} for ${uri.fsPath}`);

  // Coerce to AnalysisResult
  let result: AnalysisResult;
  if ('analyzer' in resultOrDiag) {
    result = resultOrDiag as AnalysisResult;
  } else {
    const diag = resultOrDiag as vscode.Diagnostic;
    const attached = (diag as vscode.Diagnostic & { data?: AnalysisResult }).data;
    if (attached) {
      result = attached;
    } else {
      const code =
        typeof diag.code === 'string' ? diag.code : diag.code?.toString() ?? '';
      result = {
        code,
        message: diag.message,
        severity: 'warning',
        range: {
          start: { line: diag.range.start.line, character: diag.range.start.character },
          end: { line: diag.range.end.line, character: diag.range.end.character },
        },
        analyzer: 'diagnostic',
      };
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Skills Review: Fixing "${result.code}"…`,
    },
    async () => {
      try {
        const engine = await buildEngine(state?.extensionContext);
        const text = doc.getText();

        // Staleness check: verify the diagnostic's relevantText still exists in the current document.
        const anchor = result.relevantText ?? '';
        if (anchor && !text.includes(anchor)) {
          log('warn', `runFixIssue: relevantText not found in current document — document may have changed`);
          const reanalyze = await vscode.window.showWarningMessage(
            'Skills Review: The flagged text was not found in the current document. It may have been edited. Re-analyze to get fresh results?',
            'Re-analyze',
            'Cancel',
          );
          if (reanalyze === 'Re-analyze') {
            await analyzeDocument(doc, undefined, 'manual');
          }
          return;
        }

        const fixer = new SurgicalFixer(engine.provider);
        const fixResult = await fixer.fixIssue(text, doc.uri.fsPath, result, {
          additive: cfg.fixStrategy === 'additive',
          semanticCheck: cfg.fixSemanticCheck,
          selfCritique: cfg.fixSelfCritique,
          referenceGrounding: cfg.fixReferenceGrounding,
          guardUpperBoundMultiplier: cfg.fixGuardUpperBoundMultiplier,
          guardLowerBoundMultiplier: cfg.fixGuardLowerBoundMultiplier,
          guardMaxAnchorChars: cfg.fixGuardMaxAnchorChars,
        });

        if (!fixResult.accepted) {
          const humanReason = humanizeSkipReason(fixResult.rejectReason ?? 'guard triggered');
          log('warn', `runFixIssue: fix rejected — ${fixResult.rejectReason ?? 'guard triggered'}`);
          vscode.window.showWarningMessage(
            `Skills Review: Fix not accepted — ${humanReason}.`,
          );
          return;
        }

        // Count occurrences to avoid replacing the wrong instance.
        const anchorCount = anchor ? text.split(anchor).length - 1 : 0;
        if (anchor && anchorCount !== 1) {
          log('warn', `runFixIssue: anchor appears ${anchorCount} times — refusing to apply ambiguous fix`);
          vscode.window.showWarningMessage(
            `Skills Review: The flagged text appears ${anchorCount} times in the document, so the fix could not be applied safely. Re-analyze or fix a more specific fragment.`,
          );
          return;
        }
        const fixedText = anchor && anchorCount === 1
          ? text.replace(anchor, () => fixResult.fixed)
          : text;

        if (fixedText === text) {
          log('info', 'runFixIssue: no change produced');
          vscode.window.showWarningMessage('Skills Review: No change produced.');
          return;
        }

        log('info', `runFixIssue: code=${result.code} anchor=${(result.relevantText ?? '').slice(0, 60)} risks=[${fixResult.risks.join(', ')}]`);
        log('info', `runFixIssue: originalLen=${text.length} fixedLen=${fixedText.length}`);

        if (cfg.fixMode === 'diff') {
          log('info', `runFixIssue: showing diff preview`);
          const riskNote =
            fixResult.risks.length > 0 ? ` [${fixResult.risks.join('; ')}]` : '';
          await showFixDiff(doc, fixedText, `Fix "${result.code}"${riskNote}`);
        } else {
          log('info', `runFixIssue: applying fix directly`);
          await applyFixToDocument(doc, text, fixedText);
          if (fixResult.risks.length > 0) {
            vscode.window.showWarningMessage(
              `Skills Review: Fix applied with risks: ${fixResult.risks.join('; ')}`,
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log('error', `runFixIssue: ERROR — ${message}`);
        vscode.window.showErrorMessage(`Skills Review fix error: ${message}`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Ignore rule
// ---------------------------------------------------------------------------

async function runAcceptFinding(
  uri: vscode.Uri,
  resultOrDiag: AnalysisResult | vscode.Diagnostic,
): Promise<void> {
  let result: AnalysisResult;
  if ('analyzer' in resultOrDiag) {
    result = resultOrDiag as AnalysisResult;
  } else {
    const diag = resultOrDiag as vscode.Diagnostic;
    const attached = (diag as vscode.Diagnostic & { data?: AnalysisResult }).data;
    if (attached) {
      result = attached;
    } else {
      const code = typeof diag.code === 'string' ? diag.code : diag.code?.toString() ?? '';
      result = {
        code,
        message: diag.message,
        severity: 'warning',
        range: {
          start: { line: diag.range.start.line, character: diag.range.start.character },
          end: { line: diag.range.end.line, character: diag.range.end.character },
        },
        analyzer: 'diagnostic',
      };
    }
  }

  const fileName = uri.fsPath;
  const acceptedFindingsPath = getAcceptedFindingsPath();
  if (!acceptedFindingsPath) {
    vscode.window.showWarningMessage('Skills Review: No workspace folder open — cannot persist accepted findings.');
    return;
  }
  acceptFinding(acceptedFindingsPath, fileName, {
    code: result.code,
    textPattern: result.relevantText ?? result.message,
    acceptedAt: new Date().toISOString(),
  });

  log('info', `runAcceptFinding: accepted "${result.code}" for ${fileName}`);
  vscode.window.showInformationMessage(
    `Skills Review: Finding accepted for ${fileName.split('/').pop() ?? fileName}`,
  );

  // Re-analyze to remove the suppressed finding
  const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
  if (editor) {
    await analyzeDocument(editor.document);
  }
}

async function runIgnoreRule(code: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('skillsReviewAndPolish');
  const overrides = config.get<Record<string, string>>('severityOverrides', {});
  const updated = { ...overrides, [code]: 'off' };
  await config.update('severityOverrides', updated, vscode.ConfigurationTarget.Workspace);
  vscode.window.showInformationMessage(
    `Skills Review: Rule "${code}" ignored. Edit settings to restore.`,
  );
}

// ---------------------------------------------------------------------------
// Show fix rejection reasons
// ---------------------------------------------------------------------------

const FIX_REJECTION_REASONS = `
## Why Fixes Are Rejected

When a fix is skipped, the log shows the reason. Here's what each means:

| Reason | User-Friendly Explanation |
| ------ | ------------------------ |
| anchor not found | The flagged text was not found in the document - it may have been edited |
| anchor too large | Fragment exceeds the max anchor chars limit - too risky to fix automatically |
| anchor overlaps frontmatter | Cannot fix YAML metadata (name, description, etc.) |
| ambiguous anchor | Text appears multiple times - unsafe to fix without knowing which instance |
| expansion | Fix would make the text more than the upper bound multiplier allows |
| shrinkage | Fix would make the text less than the lower bound multiplier allows |
| obligation-drop:WORD | Fix would remove an obligation word like "should" or "consider" |
| numeric-change | Fix would change a number or version value |
| concept-swap | Fix would change the meaning by swapping concepts |
| fence-injection | Fix would add code fences (\\\`\\\`) - potential injection attack |
| line-deletion | Fix would delete lines - too destructive |
| identical output | LLM returned the same text - no fix needed |
| self-critique:REASON | LLM detected the fix added unverifiable facts |
| semantic-judge:REASON | LLM detected obligation/scope change |

### Guard Settings

- \`fix.guard.upperBoundMultiplier\` (default: 1.5) - Maximum growth factor for fix output
- \`fix.guard.lowerBoundMultiplier\` (default: 0.5) - Minimum size factor for fix output
- \`fix.guard.maxAnchorChars\` (default: 350) - Maximum anchor text length

See docs/FIX-GUARDS.md for full documentation.
`;

async function showFixRejectionReasons(): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: FIX_REJECTION_REASONS,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

/**
 * Re-publish every cached finding for the active document, bypassing the
 * `maxDiagnostics` cap (plan item 5). The cap keeps the editor responsive on
 * large skills; this command lets the user expand the full list on demand.
 */
async function showAllFindings(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !state?.diagnostics) return;
  const uri = editor.document.uri;
  const results = state.lastResults.get(uri.toString()) ?? [];
  if (results.length === 0) {
    vscode.window.showInformationMessage('Skills Review: no findings to show for this file.');
    return;
  }
  const cfg = readConfig();
  // Pass a very high cap so publishDiagnostics renders every finding and
  // suppresses the "show all" summary diagnostic.
  publishDiagnostics(state.diagnostics, uri, results, cfg.severityOverrides, Number.MAX_SAFE_INTEGER);
  vscode.window.showInformationMessage(`Skills Review: showing all ${results.length} findings.`);
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

async function showFixDiff(
  originalDoc: vscode.TextDocument,
  fixedText: string,
  title: string,
): Promise<void> {
  const ts = Date.now();
  // Use virtual URIs for BOTH sides so the live document is never opened as
  // editable in the diff view (accidental keystrokes would otherwise modify the
  // real file through the left panel).
  const beforeKey = `${originalDoc.uri.path}?before=${ts}`;
  const afterKey  = `${originalDoc.uri.path}?after=${ts}`;

  // Evict entries older than FIX_PREVIEW_MAX_AGE_MS and per-document stale entries
  const docPath = originalDoc.uri.path;
  evictStaleFixPreviews(docPath);
  // Enforce max cache size — evict oldest entries (Map preserves insertion order)
  while (state!.fixPreviewContent.size > MAX_FIX_PREVIEW_ENTRIES) {
    const oldest = state!.fixPreviewContent.keys().next().value;
    if (oldest !== undefined) state!.fixPreviewContent.delete(oldest);
  }

  state!.fixPreviewContent.set(beforeKey, { text: originalDoc.getText(), ts: Date.now() });
  state!.fixPreviewContent.set(afterKey, { text: fixedText, ts: Date.now() });
  const beforeUri = vscode.Uri.parse(`${FIX_SCHEME}:${beforeKey}`);
  const afterUri  = vscode.Uri.parse(`${FIX_SCHEME}:${afterKey}`);
  log('info', `showFixDiff: opening diff view "${title}"`);
  await vscode.commands.executeCommand(
    'vscode.diff',
    beforeUri,
    afterUri,
    `Skills Review: ${title} (read-only preview — use "Apply Fix" to save)`,
    { preview: true },
  );
  // Offer a one-click "Apply" button in an info message so the user has a
  // deliberate path to writing the change to disk.
  const choice = await vscode.window.showInformationMessage(
    `Skills Review: Review the diff above, then apply if satisfied.`,
    'Apply Fix',
    'Discard',
  );
  if (choice === 'Apply Fix') {
    await applyFixToDocument(originalDoc, originalDoc.getText(), fixedText);
  } else {
    log('info', 'showFixDiff: user discarded the fix');
  }
}

/**
 * Writes `fixedText` to the document via WorkspaceEdit.
 * Includes safety guards that refuse to apply if the result is empty or
 * suspiciously short relative to the original.
 */
async function applyFixToDocument(
  doc: vscode.TextDocument,
  originalText: string,
  fixedText: string,
): Promise<void> {
  // Staleness check: the fix was computed from a snapshot. If the document has
  // changed since (user edited between analysis and apply), applying the full
  // replacement would silently destroy those edits. Refuse and ask to re-run.
  const currentText = doc.getText();
  if (currentText !== originalText) {
    const msg = 'Fix refused: the document changed since this fix was computed. Re-analyze to get a fresh fix.';
    log('warn', `applyFixToDocument: ${msg}`);
    vscode.window.showWarningMessage(`Skills Review: ${msg}`);
    return;
  }
  // Safety guard: refuse to overwrite with empty content.
  if (fixedText.trim().length === 0) {
    const msg = 'Fix refused: proposed result is empty.';
    log('error', `applyFixToDocument: ${msg}`);
    vscode.window.showErrorMessage(`Skills Review: ${msg}`);
    return;
  }
  // Safety guard: refuse if the result is less than 30% of the original length
  // (catches cases where the LLM accidentally collapsed the whole document).
  const ratio = fixedText.length / Math.max(originalText.length, 1);
  if (ratio < 0.3) {
    const msg = `Fix refused: proposed result is only ${Math.round(ratio * 100)}% of original length (${fixedText.length} vs ${originalText.length} chars).`;
    log('error', `applyFixToDocument: ${msg}`);
    vscode.window.showErrorMessage(`Skills Review: ${msg}`);
    return;
  }
  log('info', `applyFixToDocument: applying ${fixedText.length} chars to ${doc.uri.fsPath}`);
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length),
  );
  edit.replace(doc.uri, fullRange, fixedText);
  await vscode.workspace.applyEdit(edit);
  log('info', 'applyFixToDocument: edit applied successfully');
}

// ---------------------------------------------------------------------------
// Model selection + API key
// ---------------------------------------------------------------------------

async function selectModel(target: 'model' | 'fixModel'): Promise<{ modelId: string; name: string } | undefined> {
  const targetLabel = target === 'model' ? 'analysis' : 'fix';

  // Show the picker immediately with a loading placeholder
  const picker = vscode.window.createQuickPick();
  picker.title = `Select ${targetLabel} model`;
  picker.placeholder = 'Fetching models and pricing…';
  picker.busy = true;
  picker.items = [{ label: '$(sync~spin) Loading model pricing…', description: '', alwaysShow: true }];
  picker.show();

  // Fetch models, pricing, and context-length catalog in parallel while the picker is visible
  const cfg = readConfig();
  const [lmModels, pricingMap, contextMap] = await Promise.all([
    vscode.lm.selectChatModels(),
    fetchPricing(),
    fetchContextLengths().catch(() => new Map<string, number>()),
  ]);

  // If Copilot returned 0 models (not signed in) but we have an active
  // external provider with an API key, fetch models from that provider
  // so the picker always shows something useful.
  let externalModels: Array<{ id: string; name: string }> = [];
  if (lmModels.length === 0 && state?.extensionContext?.secrets) {
    const apiKey = await state.extensionContext.secrets.get('skillsReviewAndPolish.apiKey');
    if (apiKey && cfg.provider === 'openrouter') {
      try {
        const models = await fetchExternalModels(cfg.provider, apiKey);
        externalModels = models;
        log('info', `selectModel: fetched ${externalModels.length} models from ${cfg.provider}`);
      } catch (err) {
        log('error', `selectModel: failed to fetch ${cfg.provider} models: ${err}`);
      }
    }
  }

  picker.busy = false;
  log('debug', `selectModel: fetched ${pricingMap.size} pricing entries, ${lmModels.length} vscode.lm models, ${externalModels.length} external models`);

  if (lmModels.length === 0 && externalModels.length === 0) {
    picker.hide();
    vscode.window.showWarningMessage('No language models available. Sign in to GitHub Copilot or configure an external provider.');
    return;
  }

  // Parse Copilot multiplier from live model objects
  const modelToMultiplier = new Map<string, number>();
  for (const model of lmModels) {
    const pricing = (model as PricedLanguageModelChat).pricing;
    if (pricing && typeof pricing === 'string') {
      const match = pricing.match(/^([\d.]+)x$/);
      if (match) {
        modelToMultiplier.set(model.id, parseFloat(match[1]));
      }
    }
  }

  // Sort and filter models
  const filteredModels = lmModels.filter((m) => m.vendor !== 'copilotcli' && !m.id.includes('auto') && !m.name.toLowerCase().includes('auto'));
  const droppedModels = lmModels.filter((m) => m.vendor === 'copilotcli' || m.id.includes('auto') || m.name.toLowerCase().includes('auto'));
  log('debug', `selectModel: filtered ${filteredModels.length} models, dropped ${droppedModels.length} models - dropped: ${droppedModels.map(m => `${m.id}:${m.vendor}`).join(', ')}`);
  const visibleModels = filteredModels
    .sort((a, b) => {
      if (cfg.pickerSortBy === 'multiplier') {
        const multA = modelToMultiplier.get(a.id) ?? 999;
        const multB = modelToMultiplier.get(b.id) ?? 999;
        return multA - multB;
      }
      if (cfg.pickerSortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      const priceA = pricingForModel(a.name, pricingMap)?.input ?? 999;
      const priceB = pricingForModel(b.name, pricingMap)?.input ?? 999;
      return priceA - priceB;
    });

  // Build picker items — prefer vscode.lm models, fall back to external
  const hasVscodeModels = visibleModels.length > 0;
  let items: Array<vscode.QuickPickItem & { modelId: string; name: string }>;

  if (hasVscodeModels) {
    items = visibleModels.map((m) => {
      const pricing = pricingForModel(m.name, pricingMap);
      const multiplier = m.vendor === 'copilot' ? modelToMultiplier.get(m.id) : undefined;
      const vendor = m.vendor === 'copilot' ? '🟢' : '🔵';
      
      let costHint = '';
      if (pricing && multiplier !== undefined) {
        costHint = `  💰 ${formatPricing(pricing)} · ${multiplier}x`;
      } else if (pricing) {
        costHint = `  💰 ${formatPricing(pricing)}`;
      } else if (multiplier !== undefined) {
        costHint = `  ${multiplier}x`;
      } else {
        costHint = '  ❓ cost unknown';
      }

      const ctxTokens = contextLengthForModel(m.id, m.name, contextMap);
      const ctxHint = ` · ctx=${formatContextLength(ctxTokens)}`;

      return {
        label: `${vendor} ${m.name}`,
        description: costHint,
        detail: `     ${m.id} · ${m.vendor}${ctxHint}`,
        modelId: m.id,
        name: m.name,
      } as vscode.QuickPickItem & { modelId: string; name: string };
    });
  } else if (externalModels.length > 0) {
    // Show external models with pricing from the pricing map
    // E56 (2026-07-13) corpus-scan winner — recommended for OpenRouter.
    // Starred as "best overall" + "deep wave"; matches the package.json
    // markdownDescription and the docs/USER-GUIDE.md recommendation table.
    const RECOMMENDED_MODELS = new Set([
      'google/gemini-2.5-flash-lite',
    ]);
    const RECOMMENDED_DEEP_MODELS = new Set([
      'deepseek/deepseek-chat-v3',
    ]);
    items = externalModels.map((m) => {
      // Use pricingForModel for substring matching (handles variations like "Poolside: Laguna M.1" vs "poolside/laguna-m.1")
      const pricing = pricingForModel(m.name, pricingMap);
      const costHint = pricing ? `  💰 ${formatPricing(pricing)}` : '  ❓ cost unknown';
      const isRecommended = RECOMMENDED_MODELS.has(m.id);
      const isDeepRecommended = RECOMMENDED_DEEP_MODELS.has(m.id);
      const ctxTokens = contextLengthForModel(m.id, m.name, contextMap);
      const ctxHint = ` · ctx=${formatContextLength(ctxTokens)}`;
      const recommendedTag = isRecommended
        ? '  (recommended for model)'
        : isDeepRecommended
          ? '  (recommended for deepModel)'
          : '';
      return {
        label: isRecommended ? `🔵⭐ ${m.name}` : isDeepRecommended ? `🔵⭐ ${m.name}` : `🔵 ${m.name}`,
        description: `${costHint}${recommendedTag}`,
        detail: `     ${m.id} · ${cfg.provider}${ctxHint}`,
        modelId: m.id,
        name: m.name,
      } as vscode.QuickPickItem & { modelId: string; name: string };
    });
  } else {
    picker.hide();
    vscode.window.showWarningMessage(
      'No models available. Ensure you are signed in to GitHub Copilot or have configured an external provider.',
    );
    return;
  }

  const sortLabel = cfg.pickerSortBy === 'multiplier' ? 'by multiplier' : cfg.pickerSortBy === 'name' ? 'alphabetical' : 'by cost';
  picker.title = `Select ${targetLabel} model (${sortLabel})`;
  picker.items = items;

  // Wait for user selection
  const picked = await new Promise<(typeof items)[number] | undefined>((resolve) => {
    picker.onDidAccept(() => resolve(picker.selectedItems[0] as (typeof items)[number]));
    picker.onDidHide(() => resolve(undefined));
  });
  picker.dispose();

  if (!picked) return undefined;

  // Validate the model is callable
  log('info', `selectModel: validating ${picked.modelId} before saving`);
  try {
    const testModels = await vscode.lm.selectChatModels({ id: picked.modelId });
    if (testModels.length === 0) {
      vscode.window.showErrorMessage(
        `Selected model "${picked.modelId}" is not available. Please try again.`,
      );
      log('error', `selectModel: validation failed - ${picked.modelId} not found`);
      return undefined;
    }
    log('debug', `selectModel: validated model ${picked.modelId} vendor=${testModels[0].vendor}`);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to validate model "${picked.modelId}": ${err instanceof Error ? err.message : String(err)}`,
    );
    log('error', `selectModel: validation error for ${picked.modelId}: ${err}`);
    return undefined;
  }

  const wsCfg = vscode.workspace.getConfiguration('skillsReviewAndPolish');
  await wsCfg.update(target, picked.modelId, vscode.ConfigurationTarget.Global);
  // DisplayName is optional - ignore errors for backward compatibility
  void wsCfg.update(`${target}DisplayName`, picked.name, vscode.ConfigurationTarget.Global);

  // Auto-detect and update provider when selecting the analysis or fix model.
  // Read current provider from the actual vscode config (not the mock) to avoid test breakage.
  if (target === 'model' || target === 'fixModel') {
    const detectedProvider = await detectProviderForModel(picked.modelId);
    let currentProvider = 'vscode-lm';
    try {
      currentProvider = vscode.workspace.getConfiguration('skillsReviewAndPolish').get('provider', 'vscode-lm');
    } catch { /* mock may not have get() — safe fallback */ }
    if (detectedProvider !== currentProvider) {
      await wsCfg.update('provider', detectedProvider, vscode.ConfigurationTarget.Global);
      log('info', `selectModel: auto-switched provider from ${currentProvider} to ${detectedProvider}`);
    }

    // Warn if selecting an openrouter vendor model without API key (needed for MCP)
    const modelVendor = (await vscode.lm.selectChatModels({ id: picked.modelId }))[0]?.vendor;
    if (modelVendor === 'openrouter' && state?.extensionContext?.secrets) {
      const apiKey = await state.extensionContext.secrets.get('skillsReviewAndPolish.apiKey');
      log('debug', `selectModel: API key check for openrouter model - hasApiKey=${!!apiKey}, targetLabel=${targetLabel}`);
      if (!apiKey) {
        vscode.window.showWarningMessage(
          `Selected ${targetLabel} model "${picked.modelId}" is an OpenRouter model. ` +
          `It will work in VS Code, but MCP server usage requires an API key. ` +
          `Run "Skills Review: Set API Key" to configure it.`,
        );
      }
    }
  }

  const label = target === 'model' ? 'Analysis model' : 'Fix model';
  const pricing = pricingForModel(picked.name, pricingMap);
  const costInfo = pricing ? ` (${formatPricing(pricing)})` : '';
  vscode.window.showInformationMessage(
    `Skills Review: ${label} set to "${picked.modelId}" (${picked.name}).${costInfo}`,
  );
  log('info', `selectModel: ${target} = ${picked.modelId} (${picked.name}) — validated ✓`);

  // Keep .skills-review.json in sync so the MCP server immediately sees the
  // new model without requiring a manual 'Sync MCP Config' command.
  syncMcpConfig(true).catch((err) => log('warn', `selectModel: syncMcpConfig failed silently: ${err}`));

  return { modelId: picked.modelId, name: picked.name };
}

// ---------------------------------------------------------------------------
// Picker sort order
// ---------------------------------------------------------------------------

async function selectPickerSortOrder(): Promise<void> {
  const current = vscode.workspace.getConfiguration('skillsReviewAndPolish').get<string>('pickerSortBy', 'price');
  const items = [
    { label: '💰 Per-M Token Price', description: 'cheapest first ($/M input)', value: 'price', picked: current === 'price' },
    { label: '⚡ Copilot Multiplier', description: 'premium requests (Nx — lowest first)', value: 'multiplier', picked: current === 'multiplier' },
    { label: '🔤 Alphabetical', description: 'by model name A→Z', value: 'name', picked: current === 'name' },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: 'Model Picker Sort Order',
    placeHolder: 'Choose how models are sorted in the model picker',
  });
  if (pick) {
    await vscode.workspace.getConfiguration('skillsReviewAndPolish').update('pickerSortBy', pick.value, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Skills Review: Model picker sort order set to "${pick.label}".`);
    log('info', `selectPickerSortOrder: set to ${pick.value}`);
  }
}

// ---------------------------------------------------------------------------
// MCP Config Sync
// ---------------------------------------------------------------------------

async function syncMcpConfig(silent = false): Promise<void> {
  const cfg = readConfig();
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    if (!silent) vscode.window.showWarningMessage('Skills Review: No workspace folder open — cannot write .skills-review.json.');
    return;
  }
  const configPath = path.join(folders[0].uri.fsPath, '.skills-review.json');
  const mcpConfig = {
    provider: cfg.provider,
    model: cfg.model,
    deepModel: cfg.deepModel,
    fixModel: cfg.fixModel,
    structuredOutput: cfg.externalStructuredOutput,
    requestTimeoutMs: cfg.externalRequestTimeoutMs,
    analysisMode: cfg.analysisMode,
    logLevel: cfg.logLevel,
    maxOutputTokensPerSession: cfg.mcpMaxOutputTokensPerSession,
  };
  // Atomic write: write to temp file first, then rename to avoid corruption
  // on crash/disk-full.  Node's rename(2) is atomic on the same filesystem.
  const tmpPath = configPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, configPath);
    if (!silent) vscode.window.showInformationMessage(`Skills Review: MCP config synced to ${configPath}`);
    log('info', `syncMcpConfig: wrote ${configPath}`);
  } catch (err) {
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    vscode.window.showErrorMessage(`Skills Review: Failed to sync MCP config — ${err instanceof Error ? err.message : err}`);
    log('error', `syncMcpConfig: failed to write ${configPath}: ${err}`);
  }
}

/** Look up pricing for a model by display name or ID — tries exact, normalised, and substring match. */
function pricingForModel(name: string, pricingMap: Map<string, ModelPricing>): ModelPricing | undefined {
  // Exact match by name
  let p = pricingMap.get(name);
  if (p) return p;
  // Normalised match
  const normalized = normalizeModelName(name);
  p = pricingMap.get(normalized);
  if (p) return p;
  // Also try matching by model ID (for OpenRouter models like "openai/gpt-4o-mini")
  // Strip vendor prefix and normalize
  const idNormalized = normalizeModelName(name.replace(/^[^/]+\//, ''));
  p = pricingMap.get(idNormalized);
  if (p) return p;
  // Substring match — check both directions to handle variations like "GPT-4o mini" vs "gpt-4o-mini"
  const lower = normalized.toLowerCase();
  let bestMatch: ModelPricing | undefined;
  let bestKeyLen = 0;
  for (const [key, val] of pricingMap) {
    const keyLower = key.toLowerCase();
    // Normalize separators for comparison (handle "Poolside: Laguna M.1" vs "poolside/laguna-m.1")
    // Also strip parenthetical suffixes like "(free)" for matching
    // Also strip vendor prefixes from pricing keys for better matching
    const keyNormalized = normalizeModelName(keyLower).replace(/[:/_-]/g, ' ').replace(/\s+/g, ' ').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const lowerNormalized = lower.replace(/[:/_-]/g, ' ').replace(/\s+/g, ' ').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    // Check if model name contains pricing key OR pricing key contains model name
    if ((lowerNormalized.includes(keyNormalized) || keyNormalized.includes(lowerNormalized)) && keyNormalized.length > bestKeyLen) {
      bestMatch = val;
      bestKeyLen = keyNormalized.length;
    }
  }
  // Log if no match found for debugging
  if (!bestMatch) {
    log('debug', `pricingForModel: no match found for "${name}" (normalized: "${normalized}")`);
  }
  return bestMatch;
}

/**
 * Look up the input context length (in tokens) for a model.
 * Tries the catalog directly by id, then by normalized id, then by
 * normalized name. Returns `undefined` when no match is found — callers
 * display `❓ ctx` rather than fabricating a value.
 */
function contextLengthForModel(
  id: string,
  name: string,
  contextMap: Map<string, number>,
): number | undefined {
  if (!id && !name) return undefined;
  if (contextMap.size === 0) return undefined;
  // Exact id
  if (id) {
    const hit = contextMap.get(id);
    if (hit) return hit;
    const normalizedId = id.replace(/^[^/]+\//, '').toLowerCase().replace(/[-_./]+/g, ' ').replace(/\s+/g, ' ').trim();
    const hitNorm = contextMap.get(normalizedId);
    if (hitNorm) return hitNorm;
  }
  // Substring fallback on name (best-effort)
  if (name) {
    const lower = name.toLowerCase();
    let bestMatch: number | undefined;
    let bestKeyLen = 0;
    for (const [key, val] of contextMap) {
      const keyLower = key.toLowerCase();
      if ((lower.includes(keyLower) || keyLower.includes(lower)) && keyLower.length > bestKeyLen) {
        bestMatch = val;
        bestKeyLen = keyLower.length;
      }
    }
    if (bestMatch) return bestMatch;
  }
  return undefined;
}

async function testModelSimplePrompt(): Promise<void> {
  log('info', 'testModelSimplePrompt: Starting simple prompt test...');
  
  const cfg = readConfig();

  if (cfg.provider !== 'vscode-lm') {
    // External provider — test directly via the provider's API
    const apiKey = state?.extensionContext ? await state.extensionContext.secrets.get('skillsReviewAndPolish.apiKey') : undefined;
    if (!apiKey) {
      vscode.window.showErrorMessage(
        `Cannot test "${cfg.provider}" provider — no API key stored. Run "Skills Review: Set API Key" first.`,
      );
      return;
    }
    const model = cfg.model || '';
    const provider = new OpenRouterProvider({
      apiKey,
      model,
      structuredOutput: cfg.externalStructuredOutput,
      requestTimeoutMs: cfg.externalRequestTimeoutMs,
    });

    vscode.window.showInformationMessage(`Testing ${cfg.provider} model "${model}" with simple JSON prompt…`);
    try {
      const result = await provider.complete({
        prompt: 'Respond with valid JSON: {"greeting":"hello","number":42}',
        systemPrompt: 'You are a helpful assistant. Respond only with valid JSON.',
      });
      if (result.error) {
        vscode.window.showErrorMessage(`❌ Provider error: ${result.error}`);
        return;
      }
      // Try parsing the response as JSON
      let parsed = false;
      try {
        const text = result.text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        JSON.parse(text);
        parsed = true;
      } catch { /* not valid JSON */ }
      const statusMsg = parsed
        ? `✅ Model "${model}" (${cfg.provider}) returned valid JSON: ${result.text.substring(0, 80)}…`
        : `❌ Model "${model}" (${cfg.provider}) returned non-JSON: ${result.text.substring(0, 80)}…`;
      log('info', `testModelSimplePrompt: ${statusMsg}`);
      vscode.window.showInformationMessage(statusMsg);
    } catch (err) {
      log('error', `testModelSimplePrompt error: ${err}`);
      vscode.window.showErrorMessage(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // vscode-lm provider
  let provider = state?.currentVsCodeLmProvider;
  
  // If no provider cached, create one using current config
  if (!provider) {
    log('info', 'testModelSimplePrompt: creating provider on-the-fly for test');
    provider = new VsCodeLmProvider(
      cfg.model,
      cfg.deepModel || cfg.model,
    );
  }

  vscode.window.showInformationMessage('Testing current model with simple JSON prompt... (check Debug Console)');
  
  try {
    // Always use current config model (user may have changed settings since provider was created)
    const result = await provider.testSimplePrompt(cfg.model);
    log('info', `testModelSimplePrompt: result=${JSON.stringify(result)}`);
    
    const statusMsg = result.success 
      ? `✅ Model "${result.modelUsed}" returned valid JSON: ${result.response.substring(0, 50)}...`
      : `❌ Model "${result.modelUsed}" returned garbled/invalid output: ${result.response.substring(0, 50)}...`;
    
    vscode.window.showInformationMessage(statusMsg);
  } catch (err) {
    log('error', `testModelSimplePrompt error: ${err}`);
    vscode.window.showErrorMessage(`Test failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function inspectModels(): Promise<void> {
  try {
    const models = await vscode.lm.selectChatModels();
    log('info', `inspectModels: Found ${models.length} models`);
    for (const model of models) {
      log('info', `inspectModels: ${model.id} - vendor=${model.vendor} - name=${model.name}`);
    }
    vscode.window.showInformationMessage(`Found ${models.length} models - check Output > Skills Review for details`);
  } catch (err) {
    log('error', `inspectModels error: ${err}`);
    vscode.window.showErrorMessage(`Inspect failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function setApiKey(): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'API key for external provider',
    password: true,
    ignoreFocusOut: true,
    prompt: 'Stored in VS Code SecretStorage (never written to settings).',
  });
  if (key) {
    await state!.extensionContext.secrets.store('skillsReviewAndPolish.apiKey', key);
    vscode.window.showInformationMessage('Skills Review: API key saved to SecretStorage.');
  }
}

// ---------------------------------------------------------------------------
// Language model tools (Phase 5 — requires VS Code 1.95+)
// ---------------------------------------------------------------------------

interface AnalyzeToolInput {
  text: string;
  filePath?: string;
}

interface FixToolInput {
  text: string;
  filePath?: string;
  diagnosticCode: string;
  relevantText: string;
}

/**
 * Fetch models from an external provider's API for the model picker.
 * Returns model entries that can be displayed in the quick-pick.
 */
async function fetchExternalModels(
  provider: 'openrouter',
  apiKey: string,
): Promise<Array<{ id: string; name: string }>> {
  if (provider === 'openrouter') {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = (await resp.json()) as { data?: Array<{ id: string; name?: string }> };
    return (json.data ?? []).map(m => ({ id: m.id, name: m.name ?? m.id }));
  }
  return [];
}

export function registerLanguageModelTools(
  context: vscode.ExtensionContext,
  deps: {
    buildEngine?: () => Promise<Engine>;
    readConfig?: () => ReturnType<typeof readConfig>;
  } = {},
): void {
  if (typeof vscode.lm.registerTool !== 'function') return;

  const buildEngineFn = deps.buildEngine ?? buildEngine;
  const readConfigFn = deps.readConfig ?? readConfig;

  context.subscriptions.push(
    vscode.lm.registerTool<AnalyzeToolInput>('skills-review-and-polish_analyze', {
      async invoke(options, _token) {
        const { text, filePath } = options.input;
        try {
          const engine = await buildEngineFn();
          const results = await engine.analyze({ text, filePath, acceptedFindingsPath: getAcceptedFindingsPath(), token: _token });
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(results, null, 2)),
          ]);
        } catch (e) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({ error: String(e) })),
          ]);
        }
      },
    }),
  );

  context.subscriptions.push(
    vscode.lm.registerTool<FixToolInput>('skills-review-and-polish_fix', {
      async invoke(options, _token) {
        const { text, filePath = '', diagnosticCode, relevantText } = options.input;
        try {
          const cfg = readConfigFn();
          const engine = await buildEngineFn();
          const syntheticDiag: AnalysisResult = {
            code: diagnosticCode,
            message: relevantText,
            severity: 'warning',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            analyzer: 'tool',
            relevantText,
          };
          const fixer = new SurgicalFixer(engine.provider);
          const result = await fixer.fixIssue(text, filePath, syntheticDiag, {
            additive: cfg.fixStrategy === 'additive',
            semanticCheck: cfg.fixSemanticCheck,
            selfCritique: cfg.fixSelfCritique,
            referenceGrounding: cfg.fixReferenceGrounding,
            guardUpperBoundMultiplier: cfg.fixGuardUpperBoundMultiplier,
            guardLowerBoundMultiplier: cfg.fixGuardLowerBoundMultiplier,
            guardMaxAnchorChars: cfg.fixGuardMaxAnchorChars,
          });
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
          ]);
        } catch (e) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({ error: String(e) })),
          ]);
        }
      },
    }),
  );
}
