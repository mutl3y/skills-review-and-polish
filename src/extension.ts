import * as vscode from 'vscode';
import * as fs from 'fs';
import { Engine, AnalysisResult } from './core';
import { scoreSkill, parseSkillType } from './core/scoring';
import { SurgicalFixer, SURGICAL_FIXABLE_CODES } from './core/fixer';
import { VsCodeLmProvider } from './providers/vscodeLmProvider';
import { OpenRouterProvider, GitHubModelsProvider } from './providers/externalProvider';
import { readConfig, isCustomizationPath } from './config';
import { createDiagnosticCollection, publishDiagnostics } from './ui/diagnostics';
import { StatusBarManager } from './ui/statusBar';
import { ScoreCodeLensProvider } from './ui/codeLens';
import { SkillsCodeActionProvider } from './ui/codeActions';
import { SuggestionHoverProvider } from './ui/hover';
import { createInlineRewriteProvider } from './ui/inlineRewrites';
import { inspectLMAPIs } from './test-api-inspection';

// ---------------------------------------------------------------------------
// Extension-level state
// ---------------------------------------------------------------------------

let diagnostics: vscode.DiagnosticCollection;
let statusBar: StatusBarManager;
let codeLensProvider: ScoreCodeLensProvider;

/** Current VsCodeLmProvider instance — updated when buildEngine creates one, used for testing. */
let currentVsCodeLmProvider: VsCodeLmProvider | undefined;

/** Shared output channel — visible in the Output panel (dropdown: "Skills Review"). */
let out: vscode.LogOutputChannel;

/** Absolute path to the on-disk debug log — set in activate(), tailable via `tail -f`. */
let logFilePath: string | undefined;

/** Append a timestamped line to both the VS Code output channel and the log file. */
function log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase().padEnd(5)}] ${message}`;
  if (level === 'error') out?.error(message);
  else if (level === 'warn') out?.warn(message);
  else if (level === 'debug') out?.debug(message);
  else out?.info(message);
  if (logFilePath) {
    try { fs.appendFileSync(logFilePath, line + '\n'); } catch { /* ignore */ }
  }
}

/** Maps URI strings to the last set of AnalysisResults so fixIssue can use them. */
const lastResults = new Map<string, AnalysisResult[]>();

/** onType debounce timers, keyed by URI string. */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Custom scheme for fix-preview diff documents. */
const FIX_SCHEME = 'skills-review-fix';
const fixPreviewContent = new Map<string, string>();

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  out = vscode.window.createOutputChannel('Skills Review', { log: true });
  diagnostics = createDiagnosticCollection();
  statusBar = new StatusBarManager();
  codeLensProvider = new ScoreCodeLensProvider();

  // Set up on-disk log file — use /tmp so it works even when the Extension
  // Development Host opens without a workspace folder.
  logFilePath = require('os').tmpdir() + '/skills-review-debug.log';
  try { fs.writeFileSync(logFilePath, `--- Skills Review debug log started ${new Date().toISOString()} ---\n`); } catch { /* ignore */ }

  context.subscriptions.push(out, diagnostics, statusBar, codeLensProvider);
  log('info', `Extension activated — log file: ${logFilePath ?? '(none)'}`);

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
    vscode.commands.registerCommand('skillsReviewAndPolish.selectAnalysisModel', () =>
      selectModel('model'),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.selectFixModel', () =>
      selectModel('fixModel'),
    ),
    vscode.commands.registerCommand('skillsReviewAndPolish.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand('skillsReviewAndPolish.inspectAPIs', async () => {
      await inspectLMAPIs();
      vscode.window.showInformationMessage('API inspection complete — check Debug Console output');
    }),
    vscode.commands.registerCommand('skillsReviewAndPolish.testModelSimplePrompt', testModelSimplePrompt),
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
        void analyzeDocument(doc);
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
          void analyzeDocument(e.document);
        }, 2000),
      );
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
}

// ---------------------------------------------------------------------------
// Engine builder
// ---------------------------------------------------------------------------

async function buildEngine(context?: vscode.ExtensionContext): Promise<Engine> {
  const cfg = readConfig();
  log('info', `buildEngine: provider=${cfg.provider} standardModel=${cfg.model || '(auto)'} deepModel=${cfg.deepModel || '(none)'}`);

  if (cfg.provider === 'openrouter' || cfg.provider === 'githubModels') {
    const apiKey = context ? await context.secrets.get('skillsReviewAndPolish.apiKey') : undefined;
    if (!apiKey) {
      log('warn', `buildEngine: ${cfg.provider} selected but no API key — falling back to vscode-lm`);
      vscode.window.showWarningMessage(
        `Skills Review: provider is "${cfg.provider}" but no API key is stored. ` +
          'Run "Skills Review: Set API Key" first, or switch provider to "vscode-lm".',
      );
      const vscodeLmProvider = new VsCodeLmProvider(cfg.model, cfg.deepModel || cfg.model, (msg) => log('debug', msg));
      currentVsCodeLmProvider = vscodeLmProvider;
      return new Engine(vscodeLmProvider, cfg);
    }
    const model = cfg.fixModel || cfg.model || '';
    const provider =
      cfg.provider === 'openrouter'
        ? new OpenRouterProvider({ apiKey, model })
        : new GitHubModelsProvider({ apiKey, model });
    log('info', `buildEngine: using external provider ${cfg.provider} model=${model}`);
    currentVsCodeLmProvider = undefined;
    return new Engine(provider, cfg);
  }

  log('info', 'buildEngine: using vscode-lm');
  const vscodeLmProvider = new VsCodeLmProvider(cfg.model, cfg.deepModel || cfg.model, (msg) => log('debug', msg));
  currentVsCodeLmProvider = vscodeLmProvider;
  return new Engine(vscodeLmProvider, cfg);
}

// ---------------------------------------------------------------------------
// Analyze
// ---------------------------------------------------------------------------

async function runAnalyze(_force: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const cfg = readConfig();
  const path = editor.document.uri.fsPath;
  if (!isCustomizationPath(path, cfg.include)) {
    log('warn', `runAnalyze: ${path} is not a recognised AI customization — skipping. Add it to skillsReviewAndPolish.include to override.`);
    vscode.window.showWarningMessage(
      `Skills Review: "${editor.document.fileName}" is not a recognised AI customization file (SKILL.md, *.prompt.md, *.agent.md, *.instructions.md, AGENTS.md). ` +
      'Add it to `skillsReviewAndPolish.include` in settings to analyse it.',
    );
    return;
  }
  await analyzeDocument(editor.document);
}

async function analyzeDocument(doc: vscode.TextDocument): Promise<void> {
  const cfg = readConfig();
  const filePath = doc.uri.fsPath;

  log('info', `analyzeDocument: START ${filePath} (${doc.getText().length} chars)`);
  out.show(false); // reveal output panel without stealing focus

  statusBar.startAnalyzing();
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Skills Review: Analyzing…' },
    async () => {
      try {
        const engine = await buildEngine();
        const text = doc.getText();
        log('info', `analyzeDocument: calling engine.analyze on ${text.length} chars`);
        const results = await engine.analyze({ text, filePath });
        log('info', `analyzeDocument: got ${results.length} results`);
        for (const r of results) {
          log('debug', `  [${r.severity}] ${r.code} L${(r.range?.start?.line ?? 0) + 1}: ${r.message.slice(0, 120)}`);
        }

        publishDiagnostics(diagnostics, doc.uri, results, cfg.severityOverrides);

        // Store for later fix commands
        lastResults.set(doc.uri.toString(), results);

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
        const fixedText = anchor && text.includes(anchor)
          ? text.replace(anchor, fixResult.fixed)
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
  // Get live models from Copilot with fresh pricing data
  const lmModels = await vscode.lm.selectChatModels();
  if (lmModels.length === 0) {
    vscode.window.showWarningMessage('No language models available. Sign in to GitHub Copilot.');
    return;
  }

  // Parse pricing from live model objects (pricing field: "27x", "1x", "0.33x", etc.)
  const modelToMultiplier = new Map<string, number>();
  for (const model of lmModels) {
    const pricing = (model as any).pricing;
    if (pricing && typeof pricing === 'string') {
      const match = pricing.match(/^([\d.]+)x$/);
      if (match) {
        const multiplier = parseFloat(match[1]);
        modelToMultiplier.set(model.id, multiplier);
      }
    }
  }

  // Safe tier: models with multiplier ≤ 1x
  const safeTierIds = new Set(
    Array.from(modelToMultiplier.entries())
      .filter(([_, mult]) => mult <= 1)
      .map(([id, _]) => id),
  );

  // Filter to ONLY copilot vendor and models with known pricing
  const visibleModels = lmModels
    .filter((m) => m.vendor === 'copilot' && modelToMultiplier.has(m.id))
    .sort((a, b) => {
      const multA = modelToMultiplier.get(a.id) ?? 999;
      const multB = modelToMultiplier.get(b.id) ?? 999;
      return multA - multB;
    });

  if (visibleModels.length === 0) {
    vscode.window.showWarningMessage(
      'No models with pricing available. Ensure you are signed in to GitHub Copilot.',
    );
    return;
  }

  // Create picker items with multiplier displayed
  const items = visibleModels.map((m) => {
    const multiplier = modelToMultiplier.get(m.id);
    let costHint = '';
    if (multiplier !== undefined) {
      const safe = multiplier <= 1;
      if (safe) {
        costHint = ` ✅ (${multiplier}x, safe ≤1x)`;
      } else {
        costHint = ` ⚠️ (${multiplier}x, expensive >1x)`;
      }
    }

    return {
      label: m.name + costHint,
      description: m.id,
      modelId: m.id,
      name: m.name,
    };
  });

  const pick = await vscode.window.showQuickPick(items, {
    title: `Select ${target === 'model' ? 'analysis' : 'fix'} model — recommend ✅ (≤1x) only`,
  });
  if (pick) {
    // Validate the model is actually callable before saving
    log('info', `selectModel: validating selected model ${pick.modelId} before saving to config`);
    try {
      const testModels = await vscode.lm.selectChatModels({ id: pick.modelId });
      if (testModels.length === 0) {
        vscode.window.showErrorMessage(
          `Selected model "${pick.modelId}" is not available. Please try again or select a different model.`,
        );
        log('error', `selectModel: validation failed - model ${pick.modelId} not found by CAPI`);
        return;
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to validate model "${pick.modelId}": ${err instanceof Error ? err.message : String(err)}`,
      );
      log('error', `selectModel: validation error for ${pick.modelId}: ${err}`);
      return;
    }

    const cfg = vscode.workspace.getConfiguration('skillsReviewAndPolish');
    await cfg.update(target, pick.modelId, vscode.ConfigurationTarget.Global);
    await cfg.update(`${target}DisplayName`, pick.name, vscode.ConfigurationTarget.Global);
    const label = target === 'model' ? 'Analysis model' : 'Fix model';
    const costWarning = !safeTierIds.has(pick.modelId) ? ' (⚠️ Warning: expensive model selected)' : '';
    vscode.window.showInformationMessage(
      `Skills Review: ${label} set to "${pick.modelId}" (${pick.name}).${costWarning}`,
    );
    log('info', `selectModel: ${target} = ${pick.modelId} (${pick.name}, multiplier: ${modelToMultiplier.get(pick.modelId)}x) — validated ✓`);
  }
}

async function testModelSimplePrompt(): Promise<void> {
  log('info', 'testModelSimplePrompt: Starting simple prompt test...');
  
  const cfg = readConfig();
  if (cfg.provider !== 'vscode-lm') {
    vscode.window.showErrorMessage(`Cannot test with external provider "${cfg.provider}" — switch to "vscode-lm" via Settings or Select Analysis Model command`);
    return;
  }

  let provider = currentVsCodeLmProvider;
  
  // If no provider cached, create one using current config
  if (!provider) {
    log('info', 'testModelSimplePrompt: creating provider on-the-fly for test');
    provider = new VsCodeLmProvider(cfg.model, cfg.deepModel || cfg.model, (msg) => log('debug', msg));
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

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: 'API key for external provider',
    password: true,
    ignoreFocusOut: true,
    prompt: 'Stored in VS Code SecretStorage (never written to settings).',
  });
  if (key) {
    await context.secrets.store('skillsReviewAndPolish.apiKey', key);
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

function registerLanguageModelTools(context: vscode.ExtensionContext): void {
  if (typeof vscode.lm.registerTool !== 'function') return;

  context.subscriptions.push(
    vscode.lm.registerTool<AnalyzeToolInput>('skills-review-and-polish_analyze', {
      async invoke(options, _token) {
        const { text, filePath } = options.input;
        try {
          const engine = await buildEngine();
          const results = await engine.analyze({ text, filePath });
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
          const cfg = readConfig();
          const engine = await buildEngine();
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

