import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Engine, AnalysisResult } from './core';
import { scoreSkill, parseSkillType } from './core/scoring';
import { SurgicalFixer, SURGICAL_FIXABLE_CODES } from './core/fixer';
import { setLogLevel, setTransport } from './core/logger';
import { VsCodeLmProvider } from './providers/vscodeLmProvider';
import { OpenRouterProvider, GitHubModelsProvider } from './providers/externalProvider';
import { readConfig, isCustomizationPath } from './config';
import { acceptFinding } from './core/acceptedFindings';
import { createDiagnosticCollection, publishDiagnostics } from './ui/diagnostics';
import { StatusBarManager } from './ui/statusBar';
import { ScoreCodeLensProvider } from './ui/codeLens';
import { SkillsCodeActionProvider } from './ui/codeActions';
import { SuggestionHoverProvider } from './ui/hover';
import { createInlineRewriteProvider } from './ui/inlineRewrites';
import { inspectLMAPIs } from './test-api-inspection';
import { fetchPricing, formatPricing, normalizeModelName, ModelPricing } from './pricing';

/** Runtime field added by Copilot model provider — not in @types/vscode yet. */
interface PricedLanguageModelChat extends vscode.LanguageModelChat {
  pricing?: string;
}

// ---------------------------------------------------------------------------
// Extension-level state
// ---------------------------------------------------------------------------

let diagnostics: vscode.DiagnosticCollection;
let statusBar: StatusBarManager;
let codeLensProvider: ScoreCodeLensProvider;

/** Stored extension context — set once in activate(), used by buildEngine to access SecretStorage. */
let extensionContext: vscode.ExtensionContext;

/** Current VsCodeLmProvider instance — updated when buildEngine creates one, used for testing. */
let currentVsCodeLmProvider: VsCodeLmProvider | undefined;

/** Shared output channel — visible in the Output panel (dropdown: "Skills Review"). */
let out: vscode.LogOutputChannel;

/** Absolute path to the on-disk debug log — set in activate(), tailable via `tail -f`. */
let logFilePath: string | undefined;

/** Append a timestamped line to both the VS Code output channel and the log file. */
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
  const cfg = readConfig();
  if (level === 'debug' && cfg.logLevel !== 'debug') return;

  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase().padEnd(5)}] ${message}`;
  if (level === 'error') out?.error(message);
  else if (level === 'warn') out?.warn(message);
  else if (level === 'debug') out?.debug(message);
  else out?.info(message);
  if (level === 'debug' && cfg.logLevel === 'debug' && logFilePath) {
    try { fs.appendFileSync(logFilePath, line + '\n'); } catch { /* ignore */ }
  }
}

/** Maps URI strings to the last set of AnalysisResults so fixIssue can use them. */
const lastResults = new Map<string, AnalysisResult[]>();

/** Serializes concurrent analyses for the same URI to prevent races on lastResults. */
const analysisLocks = new Map<string, Promise<void>>();

/** onType debounce timers, keyed by URI string. */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Custom scheme for fix-preview diff documents. */
const FIX_SCHEME = 'skills-review-fix';
const fixPreviewContent = new Map<string, string>();
/** Maximum entries in the fix-preview cache to prevent unbounded memory growth. */
const MAX_FIX_PREVIEW_ENTRIES = 20;

/** Resolve the accepted-findings path from the workspace root (not process.cwd()). */
function getAcceptedFindingsPath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return path.join(folders[0].uri.fsPath, '.accepted-findings.json');
  }
  // Fallback: empty string signals caller to skip accepted-findings lookup
  return '';
}

/** Cached engine — rebuilt only when config changes. */
let cachedEngine: Engine | undefined;
let cachedEngineConfigHash = '';

function computeConfigHash(cfg: ReturnType<typeof readConfig>): string {
  return `${cfg.provider}:${cfg.model}:${cfg.deepModel}:${cfg.fixModel}:${cfg.analysisMode}:${cfg.enabledWaves.join(',')}:${cfg.fixStrategy}:${cfg.fixSemanticCheck}:${cfg.fixSelfCritique}:${cfg.fixReferenceGrounding}:${JSON.stringify(cfg.severityOverrides)}`;
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  const cfg = readConfig();

  if (!cfg.enable) {
    log('info', 'Extension disabled by configuration; skipping activation wiring.');
    return;
  }

  out = vscode.window.createOutputChannel('Skills Review', { log: true });
  diagnostics = createDiagnosticCollection();
  statusBar = new StatusBarManager();
  codeLensProvider = new ScoreCodeLensProvider();

  if (cfg.logLevel === 'debug') {
    // Set up on-disk log file — use /tmp so it works even when the Extension
    // Development Host opens without a workspace folder.
    logFilePath = os.tmpdir() + '/skills-review-debug.log';
    try { fs.writeFileSync(logFilePath, `--- Skills Review debug log started ${new Date().toISOString()} ---\n`); } catch { /* ignore */ }
  }

  // Wire the core logger to the VS Code output channel + on-disk log file.
  // Note: cfg is captured once at activation. Log-level changes require reload.
  setLogLevel(cfg.logLevel === 'debug' ? 'debug' : 'info');
  setTransport((line) => {
    out?.appendLine(line);
    if (cfg.logLevel === 'debug' && logFilePath) {
      try { fs.appendFileSync(logFilePath, line + '\n'); } catch { /* ignore */ }
    }
  });

  context.subscriptions.push(out, diagnostics, statusBar, codeLensProvider);
  log('info', cfg.logLevel === 'debug'
    ? `Extension activated — log level: ${cfg.logLevel}, log file: ${logFilePath ?? '(none)'}`
    : `Extension activated — log level: ${cfg.logLevel}`);

  // Document selector for all AI customization file patterns
  const docSelector: vscode.DocumentFilter[] = [{ language: 'markdown' }];

  // --- Context keys ---
  const updateContext = (editor: vscode.TextEditor | undefined) => {
    const cfg = readConfig();
    const isCustomization =
      !!editor && isCustomizationPath(editor.document.uri.fsPath, cfg.include);
    const hasDiagnostics = !!editor && !!(diagnostics.get(editor.document.uri)?.length);
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
      statusBar.showIdle();
    }
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateContext));
  updateContext(vscode.window.activeTextEditor);

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('skillsReviewAndPolish.analyze', () => runAnalyze(false)),
    vscode.commands.registerCommand('skillsReviewAndPolish.rescan', () => runAnalyze(true)),
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
    vscode.commands.registerCommand('skillsReviewAndPolish.inspectAPIs', async () => {
      await inspectLMAPIs();
      vscode.window.showInformationMessage('API inspection complete — check Debug Console output');
    }),
    vscode.commands.registerCommand('skillsReviewAndPolish.testModelSimplePrompt', testModelSimplePrompt),
    vscode.commands.registerCommand('skillsReviewAndPolish.analyzeFolder', (uri?: vscode.Uri) =>
      runAnalyzeFolder(uri),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.syncMcpConfig', syncMcpConfig),
  );

  // --- Providers ---
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(docSelector, new SkillsCodeActionProvider(), {
      providedCodeActionKinds: SkillsCodeActionProvider.providedCodeActionKinds,
    }),
    vscode.languages.registerCodeLensProvider(docSelector, codeLensProvider),
    vscode.languages.registerHoverProvider(docSelector, new SuggestionHoverProvider()),
  );

  // --- Fix-preview virtual document provider ---
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(FIX_SCHEME, {
      provideTextDocumentContent(uri: vscode.Uri): string {
        // Reconstruct the full key including the query string (?before=… / ?after=…)
        // because uri.path strips the query component.
        const key = uri.query ? `${uri.path}?${uri.query}` : uri.path;
        return fixPreviewContent.get(key) ?? '';
      },
    }),
  );

  // --- Run-on-save ---
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

  // --- onType debounce ---
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const cfg = readConfig();
      if (!cfg.enable || cfg.runOn !== 'onType') return;
      if (!isCustomizationPath(e.document.uri.fsPath, cfg.include)) return;
      const key = e.document.uri.toString();
      const existing = debounceTimers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      debounceTimers.set(
        key,
        setTimeout(() => {
          debounceTimers.delete(key);
          void analyzeDocument(e.document, undefined, 'onType');
        }, 2000),
      );
    }),
  );

  // --- Evict stale state on document close ---
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      lastResults.delete(key);
      // Clean up fix preview entries for this document
      for (const previewKey of fixPreviewContent.keys()) {
        if (previewKey.startsWith(doc.uri.path)) {
          fixPreviewContent.delete(previewKey);
        }
      }
    }),
  );

  // --- Language model tools (Phase 5 — requires VS Code 1.95+) ---
  registerLanguageModelTools(context);

  // --- Experimental inline rewrites (Phase 6 — off by default) ---
  {
    const cfg = readConfig();
    if (cfg.inlineRewrites) {
      context.subscriptions.push(
        createInlineRewriteProvider(
          () => buildEngine(),
          (uri) => lastResults.get(uri.toString()) ?? [],
        ),
      );
    }
  }
}

export function deactivate(): void {
  log('info', 'Extension deactivating');
  diagnostics?.dispose();
  statusBar?.dispose();
  codeLensProvider?.dispose();
  out?.dispose();
  for (const t of debounceTimers.values()) clearTimeout(t);
  debounceTimers.clear();
  lastResults.clear();
  analysisLocks.clear();
  fixPreviewContent.clear();
  cachedEngine = undefined;
}

// ---------------------------------------------------------------------------
// Engine builder
// ---------------------------------------------------------------------------

async function buildEngine(): Promise<Engine> {
  const cfg = readConfig();
  const hash = computeConfigHash(cfg);
  if (cachedEngine && cachedEngineConfigHash === hash) {
    log('debug', 'buildEngine: using cached engine');
    return cachedEngine;
  }
  log('info', `buildEngine: provider=${cfg.provider} standardModel=${cfg.model || '(auto)'} deepModel=${cfg.deepModel || '(none)'}`);

  if (cfg.provider === 'openrouter' || cfg.provider === 'githubModels') {
    const apiKey = extensionContext ? await extensionContext.secrets.get('skillsReviewAndPolish.apiKey') : undefined;
    if (!apiKey) {
      log('warn', `buildEngine: ${cfg.provider} selected but no API key — falling back to vscode-lm`);
      vscode.window.showWarningMessage(
        `Skills Review: provider is "${cfg.provider}" but no API key is stored. ` +
          'Run "Skills Review: Set API Key" first, or switch provider to "vscode-lm".',
      );
      const vscodeLmProvider = new VsCodeLmProvider(
        cfg.model,
        cfg.deepModel || cfg.model,
      );
      currentVsCodeLmProvider = vscodeLmProvider;
      cachedEngine = new Engine(vscodeLmProvider, cfg);
      cachedEngineConfigHash = hash;
      return cachedEngine;
    }
    const model = cfg.fixModel || cfg.model || '';
    const provider =
      cfg.provider === 'openrouter'
        ? new OpenRouterProvider({ apiKey, model })
        : new GitHubModelsProvider({ apiKey, model });
    log('info', `buildEngine: using external provider ${cfg.provider} model=${model}`);
    currentVsCodeLmProvider = undefined;
    cachedEngine = new Engine(provider, cfg);
    cachedEngineConfigHash = hash;
    return cachedEngine;
  }

  log('info', 'buildEngine: using vscode-lm');
  const vscodeLmProvider = new VsCodeLmProvider(
    cfg.model,
    cfg.deepModel || cfg.model,
  );
  currentVsCodeLmProvider = vscodeLmProvider;
  cachedEngine = new Engine(vscodeLmProvider, cfg);
  cachedEngineConfigHash = hash;
  return cachedEngine;
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
  await analyzeDocument(editor.document);
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
  const fileSets = await Promise.all(
    allPatterns.map(p => vscode.workspace.findFiles(new vscode.RelativePattern(folderPath, p), '**/node_modules/**')),
  );
  // Deduplicate and filter to .md files only
  const seen = new Set<string>();
  const files: vscode.Uri[] = [];
  for (const set of fileSets) {
    for (const uri of set) {
      if (!seen.has(uri.toString()) && uri.fsPath.endsWith('.md')) {
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
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Skills Review: Analyzing ${files.length} file(s)…`, cancellable: true },
    async (progress, token) => {
      for (let i = 0; i < files.length; i++) {
        if (token.isCancellationRequested) break;
        const doc = await vscode.workspace.openTextDocument(files[i]);
        progress.report({ message: `${i + 1}/${files.length}: ${doc.fileName}`, increment: 100 / files.length });
        await analyzeDocument(doc, token);
      }
    },
  );

  vscode.window.showInformationMessage(`Skills Review: Finished analyzing ${files.length} file(s).`);
}

type TriggerSource = 'manual' | 'onSave' | 'onType';

async function analyzeDocument(
  doc: vscode.TextDocument,
  token?: vscode.CancellationToken,
  triggerSource: TriggerSource = 'manual',
): Promise<void> {
  const cfg = readConfig();
  const filePath = doc.uri.fsPath;
  const uriKey = doc.uri.toString();

  // Serialize concurrent analyses for the same URI to prevent races on lastResults.
  const prev = analysisLocks.get(uriKey);
  if (prev) {
    log('debug', `analyzeDocument: waiting for in-flight analysis of ${filePath}`);
    await prev;
  }

  let resolveLock!: () => void;
  const lock = new Promise<void>((resolve) => { resolveLock = resolve; });
  analysisLocks.set(uriKey, lock);

  try {
    log('info', `analyzeDocument: START ${filePath} (${doc.getText().length} chars)`);
    // Only reveal output panel for manual triggers — onType/onSave should not steal focus or cause layout flicker.
    if (triggerSource === 'manual') {
      out.show(false);
    }

    statusBar.startAnalyzing();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Skills Review: Analyzing…' },
      async () => {
        try {
          const engine = await buildEngine();
          const text = doc.getText();
          if (token?.isCancellationRequested) return;
          log('info', `analyzeDocument: calling engine.analyze on ${text.length} chars`);
          const results = await engine.analyze({ text, filePath, acceptedFindingsPath: getAcceptedFindingsPath() });
          if (token?.isCancellationRequested) return;
          log('info', `analyzeDocument: got ${results.length} results`);
          for (const r of results) {
            log('debug', `  [${r.severity}] ${r.code} L${(r.range?.start?.line ?? 0) + 1}: ${r.message.slice(0, 120)}`);
          }

          publishDiagnostics(diagnostics, doc.uri, results, cfg.severityOverrides);

          // Store for later fix commands
          lastResults.set(uriKey, results);

          // Compute score inline (avoids a redundant second engine.analyze() call)
          const lineCount = text.split('\n').length;
          const skillType = parseSkillType(text);
          const score = scoreSkill(results, lineCount, skillType);
          log('info', `analyzeDocument: score=${score.score} grade=${score.grade} type=${skillType}`);

          if (cfg.showScoreCodeLens) {
            codeLensProvider.update(doc.uri, score, results.length);
          }

          statusBar.showResult(score.grade, results.length);

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
          vscode.window.showInformationMessage(`Skills Review: ${issueLabel}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log('error', `analyzeDocument: ERROR — ${message}`);
          statusBar.showError(message);
          vscode.window.showWarningMessage(`Skills Review: ${message}`);
        }
      },
    );
  } finally {
    resolveLock();
    analysisLocks.delete(uriKey);
  }
}

// ---------------------------------------------------------------------------
// Fix All
// ---------------------------------------------------------------------------

async function runFixAll(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Skills Review: Open a customization file first.');
    return;
  }
  const doc = editor.document;
  const cfg = readConfig();
  const results = lastResults.get(doc.uri.toString()) ?? [];
  const fixable = results.filter((r) => SURGICAL_FIXABLE_CODES.has(r.code ?? ''));
  if (fixable.length === 0) {
    vscode.window.showInformationMessage('Skills Review: No auto-fixable issues in this file.');
    return;
  }

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
        const { fixedText, applied, skipped } = await engine.surgicalFix(
          { text, filePath: doc.uri.fsPath },
          fixable,
        );
        log('info', `runFixAll: applied=${applied} skipped=${skipped} originalLen=${text.length} fixedLen=${fixedText.length}`);

        if (applied === 0) {
          vscode.window.showInformationMessage(
            `Skills Review: No fixes accepted (${skipped} skipped by safety guards).`,
          );
          return;
        }

        if (cfg.fixMode === 'diff') {
          await showFixDiff(doc, fixedText, `Fix All — ${applied} change(s)`);
        } else {
          await applyFixToDocument(doc, text, fixedText);
          vscode.window.showInformationMessage(
            `Skills Review: Applied ${applied} fix(es)${skipped ? `, ${skipped} skipped` : ''}.`,
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
        const engine = await buildEngine();
        const text = doc.getText();
        const fixer = new SurgicalFixer(engine.provider);
        const fixResult = await fixer.fixIssue(text, doc.uri.fsPath, result, {
          additive: cfg.fixStrategy === 'additive',
          semanticCheck: cfg.fixSemanticCheck,
          selfCritique: cfg.fixSelfCritique,
          referenceGrounding: cfg.fixReferenceGrounding,
        });

        if (!fixResult.accepted) {
          vscode.window.showWarningMessage(
            `Skills Review: Fix not accepted — ${fixResult.rejectReason ?? 'guard triggered'}.`,
          );
          return;
        }

        const anchor = result.relevantText ?? '';
        // Count occurrences to avoid replacing the wrong instance.
        const anchorCount = anchor ? text.split(anchor).length - 1 : 0;
        const fixedText = anchor && anchorCount === 1
          ? text.replace(anchor, () => fixResult.fixed)
          : text;

        if (fixedText === text) {
          vscode.window.showWarningMessage('Skills Review: No change produced.');
          return;
        }

        log('info', `runFixIssue: code=${result.code} anchor=${(result.relevantText ?? '').slice(0, 60)} risks=[${fixResult.risks.join(', ')}]`);
        log('info', `runFixIssue: originalLen=${text.length} fixedLen=${fixedText.length}`);

        if (cfg.fixMode === 'diff') {
          const riskNote =
            fixResult.risks.length > 0 ? ` [${fixResult.risks.join('; ')}]` : '';
          await showFixDiff(doc, fixedText, `Fix "${result.code}"${riskNote}`);
        } else {
          await applyFixToDocument(doc, text, fixedText);
          if (fixResult.risks.length > 0) {
            vscode.window.showWarningMessage(
              `Skills Review: Fix applied with risks: ${fixResult.risks.join('; ')}`,
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
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

  // Evict any previous preview entries for the same document to prevent
  // unbounded memory growth on repeated fixes.
  const docPath = originalDoc.uri.path;
  for (const key of fixPreviewContent.keys()) {
    if (key.startsWith(docPath + '?')) {
      fixPreviewContent.delete(key);
    }
  }
  // Enforce max cache size — evict oldest entries (Map preserves insertion order)
  while (fixPreviewContent.size > MAX_FIX_PREVIEW_ENTRIES) {
    const oldest = fixPreviewContent.keys().next().value;
    if (oldest !== undefined) fixPreviewContent.delete(oldest);
  }

  fixPreviewContent.set(beforeKey, originalDoc.getText());
  fixPreviewContent.set(afterKey, fixedText);
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

async function selectModel(target: 'model' | 'fixModel'): Promise<void> {
  const targetLabel = target === 'model' ? 'analysis' : 'fix';

  // Show the picker immediately with a loading placeholder
  const picker = vscode.window.createQuickPick();
  picker.title = `Select ${targetLabel} model`;
  picker.placeholder = 'Fetching models and pricing…';
  picker.busy = true;
  picker.items = [{ label: '$(sync~spin) Loading model pricing…', description: '', alwaysShow: true }];
  picker.show();

  // Fetch models and pricing in parallel while the picker is visible
  const [lmModels, pricingMap] = await Promise.all([
    vscode.lm.selectChatModels(),
    fetchPricing(),
  ]);

  picker.busy = false;
  log('debug', `selectModel: fetched ${pricingMap.size} pricing entries, ${lmModels.length} models`);

  if (lmModels.length === 0) {
    picker.hide();
    vscode.window.showWarningMessage('No language models available. Sign in to GitHub Copilot.');
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
  const cfg = readConfig();
  const visibleModels = lmModels
    .filter((m) => m.vendor !== 'copilotcli')
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

  if (visibleModels.length === 0) {
    picker.hide();
    vscode.window.showWarningMessage(
      'No models available. Ensure you are signed in to GitHub Copilot or have configured an external provider.',
    );
    return;
  }

  // Build picker items with pricing annotations
  const items = visibleModels.map((m) => {
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

    return {
      label: `${vendor} ${m.name}`,
      description: costHint,
      detail: `     ${m.id} · ${m.vendor}`,
      modelId: m.id,
      name: m.name,
    } as vscode.QuickPickItem & { modelId: string; name: string };
  });

  const sortLabel = cfg.pickerSortBy === 'multiplier' ? 'by multiplier' : cfg.pickerSortBy === 'name' ? 'alphabetical' : 'by cost';
  picker.title = `Select ${targetLabel} model (${sortLabel})`;
  picker.items = items;

  // Wait for user selection
  const picked = await new Promise<(typeof items)[number] | undefined>((resolve) => {
    picker.onDidAccept(() => resolve(picker.selectedItems[0] as (typeof items)[number]));
    picker.onDidHide(() => resolve(undefined));
  });
  picker.dispose();

  if (!picked) return;

  // Validate the model is callable
  log('info', `selectModel: validating ${picked.modelId} before saving`);
  try {
    const testModels = await vscode.lm.selectChatModels({ id: picked.modelId });
    if (testModels.length === 0) {
      vscode.window.showErrorMessage(
        `Selected model "${picked.modelId}" is not available. Please try again.`,
      );
      log('error', `selectModel: validation failed - ${picked.modelId} not found`);
      return;
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to validate model "${picked.modelId}": ${err instanceof Error ? err.message : String(err)}`,
    );
    log('error', `selectModel: validation error for ${picked.modelId}: ${err}`);
    return;
  }

  const wsCfg = vscode.workspace.getConfiguration('skillsReviewAndPolish');
  await wsCfg.update(target, picked.modelId, vscode.ConfigurationTarget.Global);
  await wsCfg.update(`${target}DisplayName`, picked.name, vscode.ConfigurationTarget.Global);
  const label = target === 'model' ? 'Analysis model' : 'Fix model';
  const pricing = pricingForModel(picked.name, pricingMap);
  const costInfo = pricing ? ` (${formatPricing(pricing)})` : '';
  vscode.window.showInformationMessage(
    `Skills Review: ${label} set to "${picked.modelId}" (${picked.name}).${costInfo}`,
  );
  log('info', `selectModel: ${target} = ${picked.modelId} (${picked.name}) — validated ✓`);
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

async function syncMcpConfig(): Promise<void> {
  const cfg = readConfig();
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('Skills Review: No workspace folder open — cannot write .skills-review.json.');
    return;
  }
  const configPath = path.join(folders[0].uri.fsPath, '.skills-review.json');
  const mcpConfig = {
    provider: cfg.provider,
    model: cfg.model,
    deepModel: cfg.deepModel,
    fixModel: cfg.fixModel,
    analysisMode: cfg.analysisMode,
    logLevel: cfg.logLevel,
  };
  // Atomic write: write to temp file first, then rename to avoid corruption
  // on crash/disk-full.  Node's rename(2) is atomic on the same filesystem.
  const tmpPath = configPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, configPath);
    vscode.window.showInformationMessage(`Skills Review: MCP config synced to ${configPath}`);
    log('info', `syncMcpConfig: wrote ${configPath}`);
  } catch (err) {
    // Clean up temp file if rename failed
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    vscode.window.showErrorMessage(`Skills Review: Failed to sync MCP config — ${err instanceof Error ? err.message : err}`);
    log('error', `syncMcpConfig: failed to write ${configPath}: ${err}`);
  }
}

/** Look up pricing for a model by display name — tries exact, normalised, and substring match. */
function pricingForModel(name: string, pricingMap: Map<string, ModelPricing>): ModelPricing | undefined {
  // Exact match
  let p = pricingMap.get(name);
  if (p) return p;
  // Normalised match
  const normalized = normalizeModelName(name);
  p = pricingMap.get(normalized);
  if (p) return p;
  // Substring match — prefer the LONGEST key to avoid "GPT-4o" matching "GPT-4o mini"
  const lower = normalized.toLowerCase();
  let bestMatch: ModelPricing | undefined;
  let bestKeyLen = 0;
  for (const [key, val] of pricingMap) {
    const keyLower = key.toLowerCase();
    if (lower.includes(keyLower) && keyLower.length > bestKeyLen) {
      bestMatch = val;
      bestKeyLen = keyLower.length;
    }
  }
  return bestMatch;
}

async function testModelSimplePrompt(): Promise<void> {
  log('info', 'testModelSimplePrompt: Starting simple prompt test...');
  
  const cfg = readConfig();

  if (cfg.provider !== 'vscode-lm') {
    // External provider — test directly via the provider's API
    const apiKey = extensionContext ? await extensionContext.secrets.get('skillsReviewAndPolish.apiKey') : undefined;
    if (!apiKey) {
      vscode.window.showErrorMessage(
        `Cannot test "${cfg.provider}" provider — no API key stored. Run "Skills Review: Set API Key" first.`,
      );
      return;
    }
    const model = cfg.model || '';
    const provider =
      cfg.provider === 'openrouter'
        ? new OpenRouterProvider({ apiKey, model })
        : new GitHubModelsProvider({ apiKey, model });

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
  let provider = currentVsCodeLmProvider;
  
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

async function setApiKey(): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'API key for external provider',
    password: true,
    ignoreFocusOut: true,
    prompt: 'Stored in VS Code SecretStorage (never written to settings).',
  });
  if (key) {
    await extensionContext.secrets.store('skillsReviewAndPolish.apiKey', key);
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
          const results = await engine.analyze({ text, filePath, acceptedFindingsPath: getAcceptedFindingsPath() });
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

