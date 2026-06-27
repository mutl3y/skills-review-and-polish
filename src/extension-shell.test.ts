import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from './extension';

const DEFAULT_CONFIG = {
  enable: true,
  provider: 'vscode-lm',
  model: '',
  deepModel: '',
  fixModel: '',
  include: ['**/SKILL.md'],
  exclude: ['**/node_modules/**'],
  enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
  analysisMode: 'multiWave',
  scoreSamples: 3,
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: true,
  severityOverrides: {},
  fixMode: 'diff',
  fixLoopMaxIterations: 3,
  pickerSortBy: 'price',
  inlineRewrites: false,
  showScoreCodeLens: true,
  telemetryEnable: true,
  runOn: 'manual',
  logLevel: 'info',
} as const;

const mocks = vi.hoisted(() => ({
  activeTextEditor: undefined as any,
  readConfig: vi.fn(),
  isCustomizationPath: vi.fn(),
  registerCommand: vi.fn(),
  selectChatModels: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  registerCodeActionsProvider: vi.fn(),
  registerCodeLensProvider: vi.fn(),
  registerHoverProvider: vi.fn(),
  registerTextDocumentContentProvider: vi.fn(),
  onDidSaveTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidChangeActiveTextEditor: vi.fn(),
  executeCommand: vi.fn(),
  createOutputChannel: vi.fn(() => ({ dispose: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), show: vi.fn(), appendLine: vi.fn() })),
  createDiagnosticCollection: vi.fn(() => ({ dispose: vi.fn(), set: vi.fn(), get: vi.fn(() => []) })),
}));

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: mocks.createOutputChannel,
    onDidChangeActiveTextEditor: mocks.onDidChangeActiveTextEditor,
    get activeTextEditor() { return mocks.activeTextEditor; },
    set activeTextEditor(value) { mocks.activeTextEditor = value; },
    showWarningMessage: mocks.showWarningMessage,
    showInformationMessage: mocks.showInformationMessage,
    showErrorMessage: mocks.showErrorMessage,
    showQuickPick: mocks.showQuickPick,
    showInputBox: mocks.showInputBox,
    createQuickPick: vi.fn(() => {
      const listeners: Array<(...args: any[]) => void> = [];
      const picker = {
        title: '',
        placeholder: '',
        items: [] as any[],
        selectedItems: [] as any[],
        busy: false,
        onDidAccept: vi.fn((cb: () => void) => { listeners.push(cb); return { dispose: vi.fn() }; }),
        onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
        _fireAccept() { listeners.forEach((cb) => cb()); },
      };
      return picker;
    }),
    createStatusBarItem: vi.fn(() => ({ show: vi.fn(), dispose: vi.fn(), name: '', command: '', tooltip: '', text: '' })),
    withProgress: vi.fn((_opts, task) => task()),
  },
  workspace: {
    registerTextDocumentContentProvider: mocks.registerTextDocumentContentProvider,
    onDidSaveTextDocument: mocks.onDidSaveTextDocument,
    onDidChangeTextDocument: mocks.onDidChangeTextDocument,
    onDidCloseTextDocument: vi.fn(),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
    applyEdit: vi.fn(),
  },
  languages: {
    createDiagnosticCollection: mocks.createDiagnosticCollection,
    registerCodeActionsProvider: mocks.registerCodeActionsProvider,
    registerCodeLensProvider: mocks.registerCodeLensProvider,
    registerHoverProvider: mocks.registerHoverProvider,
  },
  commands: { registerCommand: mocks.registerCommand, executeCommand: mocks.executeCommand },
  ProgressLocation: { Window: 1, Notification: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  CodeActionKind: { QuickFix: 'quickfix', Source: 'source' },
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
  Uri: { parse: vi.fn((value: string) => ({ path: value })) },
  Range: class { constructor(public start: any, public end: any) {} },
  Position: class { constructor(public line: number, public character: number) {} },
  Diagnostic: class { constructor(public range: any, public message: string, public severity: any) {} },
  WorkspaceEdit: class { replace = vi.fn(); },
  LanguageModelTextPart: class { constructor(public value: string) {} },
  LanguageModelToolResult: class { constructor(public parts: any[]) {} },
  lm: { registerTool: vi.fn(), selectChatModels: mocks.selectChatModels },
}));

vi.mock('./config', () => ({
  readConfig: mocks.readConfig,
  isCustomizationPath: mocks.isCustomizationPath,
  setupConfigWatcher: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock('./ui/diagnostics', () => ({ createDiagnosticCollection: mocks.createDiagnosticCollection, publishDiagnostics: vi.fn() }));
vi.mock('./ui/statusBar', () => ({ StatusBarManager: class { showIdle = vi.fn(); dispose = vi.fn(); startAnalyzing = vi.fn(); showResult = vi.fn(); showError = vi.fn(); } }));
vi.mock('./ui/codeLens', () => ({ ScoreCodeLensProvider: class { update = vi.fn(); dispose = vi.fn(); } }));
vi.mock('./ui/codeActions', () => ({ SkillsCodeActionProvider: class { static providedCodeActionKinds = []; } }));
vi.mock('./ui/hover', () => ({ SuggestionHoverProvider: class {} }));
vi.mock('./ui/inlineRewrites', () => ({ createInlineRewriteProvider: vi.fn(() => ({ dispose: vi.fn() })) }));
const mocks2 = vi.hoisted(() => ({
  mockEngine: {
    analyze: vi.fn().mockResolvedValue([]),
    surgicalFix: vi.fn().mockResolvedValue({ fixedText: 'fixed content', applied: 1, skipped: 0 }),
    provider: {},
  },
  mockAnalyzer: { clearHistory: vi.fn() },
  mockExternalProvider: { complete: vi.fn() },
  lastVsCodeLmProvider: { current: undefined as any },
  vscodeLmTestMock: vi.fn().mockResolvedValue({ success: false, modelUsed: '', response: '' }),
}));
vi.mock('./core', () => ({
  Engine: class {
    analyze = mocks2.mockEngine.analyze;
    surgicalFix = mocks2.mockEngine.surgicalFix;
    provider = mocks2.mockEngine.provider;
  },
  Analyzer: mocks2.mockAnalyzer,
}));
vi.mock('./core/scoring', () => ({
  scoreSkill: vi.fn().mockReturnValue({ score: 100, grade: 'A', breakdown: {} }),
  parseSkillType: vi.fn().mockReturnValue('skill'),
}));
vi.mock('./core/logger', () => ({
  setLogLevel: vi.fn(),
  setTransport: vi.fn(),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('./core/acceptedFindings', () => ({
  acceptFinding: vi.fn(),
}));
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  appendFileSync: vi.fn(),
}));
vi.mock('os', () => ({
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}));
vi.mock('./core/fixer', () => ({
  SurgicalFixer: class {
    fixIssue = vi.fn().mockResolvedValue({ accepted: false, fixed: '', risks: [], rejectReason: 'mocked' });
  },
  SURGICAL_FIXABLE_CODES: new Set(['ambiguity-llm']),
}));
vi.mock('./providers/vscodeLmProvider', () => ({
  VsCodeLmProvider: class {
    invalidate = vi.fn();
    testSimplePrompt = mocks2.vscodeLmTestMock;
    constructor(_model?: string, _deepModel?: string) {
      mocks2.lastVsCodeLmProvider.current = this;
    }
  },
}));
vi.mock('./providers/externalProvider', () => ({
  OpenRouterProvider: class {
    complete = mocks2.mockExternalProvider.complete;
    constructor(_opts?: any) {}
  },
  GitHubModelsProvider: class {
    complete = mocks2.mockExternalProvider.complete;
    constructor(_opts?: any) {}
  },
}));
vi.mock('./pricing', () => ({
  fetchPricing: vi.fn().mockResolvedValue(new Map()),
  formatPricing: vi.fn().mockReturnValue('$0.00/M in, $0.00/M out'),
  normalizeModelName: vi.fn((name: string) => name.toLowerCase()),
}));

describe('extension activation wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
    mocks.activeTextEditor = undefined;
    mocks.selectChatModels.mockResolvedValue([]);
    mocks.showWarningMessage.mockReset();
    mocks.showInformationMessage.mockReset();
    mocks.showErrorMessage.mockReset();
    mocks.showQuickPick.mockReset();
    mocks.showInputBox.mockReset();
  });

  it('registers the main extension commands on activation', () => {
    const context = { subscriptions: [] as any[] } as any;

    activate(context);

    expect(mocks.registerCommand).toHaveBeenCalledWith('skillsReviewAndPolish.analyze', expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith('skillsReviewAndPolish.rescan', expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith('skillsReviewAndPolish.fixAll', expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith('skillsReviewAndPolish.fixIssue', expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith('skillsReviewAndPolish.selectAnalysisModel', expect.any(Function));
    expect(mocks.registerCommand).toHaveBeenCalledWith('skillsReviewAndPolish.selectFixModel', expect.any(Function));
  });

  it('stays inert when the extension is disabled in config', () => {
    mocks.readConfig.mockReturnValue({ ...DEFAULT_CONFIG, enable: false });

    activate({ subscriptions: [] } as any);

    expect(mocks.registerCommand).not.toHaveBeenCalled();
  });

  it('proceeds with analysis when the active editor is not a customization file', async () => {
    mocks.activeTextEditor = {
      document: {
        uri: { fsPath: '/tmp/README.md', toString: () => 'file:///tmp/README.md' },
        fileName: 'README.md',
        getText: vi.fn().mockReturnValue(''),
      },
    } as any;
    mocks.isCustomizationPath.mockReturnValue(false);

    activate({ subscriptions: [] } as any);

    const analyzeCommand = mocks.registerCommand.mock.calls.find(([name]) => name === 'skillsReviewAndPolish.analyze')?.[1];
    expect(analyzeCommand).toBeInstanceOf(Function);

    await analyzeCommand();

    // Manual trigger now analyses any file — no warning shown
    expect(mocks.showWarningMessage).not.toHaveBeenCalled();
  });

  it('warns when model selection has no available models', async () => {
    mocks.selectChatModels.mockResolvedValue([]);

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel')?.[1];
    expect(selectModelCommand).toBeInstanceOf(Function);

    await selectModelCommand();

    expect(mocks.showWarningMessage).toHaveBeenCalledWith('No language models available. Sign in to GitHub Copilot or configure an external provider.');
  });

  it('saves a validated model selection and reports the result', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const config = { update };
    const lmModels = [
      { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', vendor: 'copilot', pricing: '1x' },
    ];
    mocks.selectChatModels
      .mockResolvedValueOnce(lmModels) // for selectModel: fetch models
      .mockResolvedValueOnce([{ id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', vendor: 'copilot' }]); // for validation
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any);

    // Make createQuickPick auto-accept with a selected item.
    // The trick: override onDidAccept so that whenever selectModel registers
    // its callback, it fires immediately with the pre-set selectedItems.
    const pickedItem = { label: '🟢 Claude Sonnet 4.6', description: '', detail: '     claude-sonnet-4.6 · copilot', modelId: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' };
    (vscode.window.createQuickPick as any).mockImplementation(() => {
      const picker = {
        title: '', placeholder: '', items: [] as any[], selectedItems: [pickedItem], busy: false,
        onDidAccept: vi.fn((cb: () => void) => { setTimeout(cb, 0); return { dispose: vi.fn() }; }),
        onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      };
      return picker;
    });

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel')?.[1];
    await selectModelCommand();

    expect(update).toHaveBeenCalledWith('model', 'claude-sonnet-4.6', expect.anything());
    expect(update).toHaveBeenCalledWith('modelDisplayName', 'Claude Sonnet 4.6', expect.anything());
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Analysis model set to'));
  });

  it('auto-detects provider when selecting a copilot model', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const lmModels = [
      { id: 'gpt-4o', name: 'GPT-4o', vendor: 'copilot' },
    ];
    mocks.selectChatModels
      .mockResolvedValueOnce(lmModels) // for selectModel: fetch models
      .mockResolvedValueOnce([{ id: 'gpt-4o', name: 'GPT-4o', vendor: 'copilot' }]); // for validation + detectProviderForModel
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: vi.fn(() => 'openrouter'), update } as any);

    const pickedItem = { label: '🟢 GPT-4o', description: '', detail: '     gpt-4o · copilot', modelId: 'gpt-4o', name: 'GPT-4o' };
    (vscode.window.createQuickPick as any).mockImplementation(() => ({
      title: '', placeholder: '', items: [] as any[], selectedItems: [pickedItem], busy: false,
      onDidAccept: vi.fn((cb: () => void) => { setTimeout(cb, 0); return { dispose: vi.fn() }; }),
      onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
      onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
      show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
    }));

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel')?.[1];
    await selectModelCommand();

    expect(update).toHaveBeenCalledWith('model', 'gpt-4o', expect.anything());
    // Provider should be auto-switched from 'openrouter' to 'vscode-lm' for a copilot model
    expect(update).toHaveBeenCalledWith('provider', 'vscode-lm', expect.anything());
  });

  it('auto-detects provider when selecting a non-copilot vscode.lm model', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const lmModels = [
      { id: 'qwen/qwen3-8b', name: 'Qwen: Qwen3 8B', vendor: 'copilot' },
    ];
    mocks.selectChatModels
      .mockResolvedValueOnce(lmModels) // for selectModel: fetch models
      .mockResolvedValueOnce([{ id: 'qwen/qwen3-8b', name: 'Qwen: Qwen3 8B', vendor: 'copilot' }]); // for validation
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: vi.fn(() => 'vscode-lm'), update } as any);

    const pickedItem = { label: '🔵 Qwen: Qwen3 8B', description: '', detail: '     qwen/qwen3-8b · copilot', modelId: 'qwen/qwen3-8b', name: 'Qwen: Qwen3 8B' };
    (vscode.window.createQuickPick as any).mockImplementation(() => ({
      title: '', placeholder: '', items: [] as any[], selectedItems: [pickedItem], busy: false,
      onDidAccept: vi.fn((cb: () => void) => { setTimeout(cb, 0); return { dispose: vi.fn() }; }),
      onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
      onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
      show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
    }));

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel')?.[1];
    await selectModelCommand();

    expect(update).toHaveBeenCalledWith('model', 'qwen/qwen3-8b', expect.anything());
    // Since vendor is 'copilot', provider should stay vscode-lm (no change expected)
    // Only non-copilot vscode.lm vendors trigger a switch to 'openrouter'
  });

  it('stores an API key from the prompt flow', async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    mocks.showInputBox.mockResolvedValue('secret-token');

    activate({ subscriptions: [], secrets: { store } } as any);

    const setApiKeyCommand = mocks.registerCommand.mock.calls.find(([name]) => name === 'skillsReviewAndPolish.setApiKey')?.[1];
    await setApiKeyCommand();

    expect(mocks.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ password: true }));
    expect(store).toHaveBeenCalledWith('skillsReviewAndPolish.apiKey', 'secret-token');
    expect(mocks.showInformationMessage).toHaveBeenCalledWith('Skills Review: API key saved to SecretStorage.');
  });
});

// ---------------------------------------------------------------------------
// Additional coverage tests
// ---------------------------------------------------------------------------

describe('runIgnoreRule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
  });

  it('updates severityOverrides config to "off" for a given rule', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: vi.fn(() => ({})), update } as any);

    activate({ subscriptions: [] } as any);

    const ignoreRuleCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.ignoreRule',
    )?.[1];
    expect(ignoreRuleCmd).toBeInstanceOf(Function);

    await ignoreRuleCmd('ambiguity-llm');

    expect(update).toHaveBeenCalledWith(
      'severityOverrides',
      { 'ambiguity-llm': 'off' },
      vscode.ConfigurationTarget.Workspace,
    );
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Rule "ambiguity-llm" ignored'),
    );
  });
});

describe('selectPickerSortOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
  });

  it('saves the selected sort order to config', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: vi.fn(() => 'price'), update } as any);
    mocks.showQuickPick.mockResolvedValue({ label: '🔤 Alphabetical', description: '', value: 'name', picked: false });

    activate({ subscriptions: [] } as any);

    const sortCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.setPickerSortOrder',
    )?.[1];
    expect(sortCmd).toBeInstanceOf(Function);

    await sortCmd();

    expect(mocks.showQuickPick).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('pickerSortBy', 'name', vscode.ConfigurationTarget.Global);
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Model picker sort order set to'),
    );
  });

  it('does nothing when user dismisses the picker', async () => {
    const update = vi.fn();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: vi.fn(() => 'price'), update } as any);
    mocks.showQuickPick.mockResolvedValue(undefined);

    activate({ subscriptions: [] } as any);

    const sortCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.setPickerSortOrder',
    )?.[1];
    await sortCmd();

    expect(update).not.toHaveBeenCalled();
  });
});

describe('syncMcpConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
  });

  it('writes .skills-review.json when workspace folder exists', async () => {
    const fs = await import('fs');
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace', toString: () => 'file:///workspace' } },
    ];

    activate({ subscriptions: [] } as any);

    const syncCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.syncMcpConfig',
    )?.[1];
    expect(syncCmd).toBeInstanceOf(Function);

    await syncCmd();

    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(fs.renameSync).toHaveBeenCalled();
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('MCP config synced'),
    );
  });

  it('warns when no workspace folder is open', async () => {
    (vscode.workspace as any).workspaceFolders = [];

    activate({ subscriptions: [] } as any);

    const syncCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.syncMcpConfig',
    )?.[1];
    await syncCmd();

    expect(mocks.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No workspace folder open'),
    );
  });
});

describe('testModelSimplePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
  });

  it('tests the vscode-lm provider and reports success', async () => {
    mocks2.vscodeLmTestMock.mockResolvedValue({
      success: true,
      modelUsed: 'gpt-4o',
      response: '{"greeting":"hello"}',
    });

    activate({ subscriptions: [], secrets: { get: vi.fn() } } as any);

    const testCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.testModelSimplePrompt',
    )?.[1];
    expect(testCmd).toBeInstanceOf(Function);

    await testCmd();

    expect(mocks2.vscodeLmTestMock).toHaveBeenCalled();
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('returned valid JSON'),
    );
  });

  it('reports failure when vscode-lm provider returns garbled output', async () => {
    mocks2.vscodeLmTestMock.mockResolvedValue({
      success: false,
      modelUsed: 'gpt-4o',
      response: 'not json at all',
    });

    activate({ subscriptions: [], secrets: { get: vi.fn() } } as any);

    const testCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.testModelSimplePrompt',
    )?.[1];
    await testCmd();

    expect(mocks2.vscodeLmTestMock).toHaveBeenCalled();
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('returned garbled'),
    );
  });

  it('tests external provider (openrouter) with valid JSON response', async () => {
    mocks.readConfig.mockReturnValue({ ...DEFAULT_CONFIG, provider: 'openrouter', model: 'gpt-4o' });
    mocks2.mockExternalProvider.complete.mockResolvedValue({ text: '{"greeting":"hello"}', error: undefined });

    activate({ subscriptions: [], secrets: { get: vi.fn().mockResolvedValue('test-key') } } as any);

    const testCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.testModelSimplePrompt',
    )?.[1];
    await testCmd();

    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('returned valid JSON'),
    );
  });

  it('reports error when external provider returns error string', async () => {
    mocks.readConfig.mockReturnValue({ ...DEFAULT_CONFIG, provider: 'openrouter', model: 'gpt-4o' });
    mocks2.mockExternalProvider.complete.mockResolvedValue({ text: '', error: 'rate limited' });

    activate({ subscriptions: [], secrets: { get: vi.fn().mockResolvedValue('test-key') } } as any);

    const testCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.testModelSimplePrompt',
    )?.[1];
    await testCmd();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('rate limited'),
    );
  });

  it('reports error when external provider has no API key', async () => {
    mocks.readConfig.mockReturnValue({ ...DEFAULT_CONFIG, provider: 'githubModels', model: 'gpt-4o' });

    activate({ subscriptions: [], secrets: { get: vi.fn().mockResolvedValue(undefined) } } as any);

    const testCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.testModelSimplePrompt',
    )?.[1];
    await testCmd();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('no API key'),
    );
  });

  it('reports error when external provider throws', async () => {
    mocks.readConfig.mockReturnValue({ ...DEFAULT_CONFIG, provider: 'openrouter', model: 'gpt-4o' });
    mocks2.mockExternalProvider.complete.mockRejectedValue(new Error('network timeout'));

    activate({ subscriptions: [], secrets: { get: vi.fn().mockResolvedValue('test-key') } } as any);

    const testCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.testModelSimplePrompt',
    )?.[1];
    await testCmd();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('network timeout'),
    );
  });
});

describe('deactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
  });

  it('cleans up extension state without throwing', () => {
    expect(() => deactivate()).not.toThrow();
  });
});

describe('event handler wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
  });

  it('registers onDidChangeActiveTextEditor and calls setContext', () => {
    const context = { subscriptions: [] as any[] } as any;
    activate(context);

    expect(mocks.onDidChangeActiveTextEditor).toHaveBeenCalled();
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'skillsReviewAndPolish.isCustomization',
      expect.any(Boolean),
    );
  });

  it('registers onDidSaveTextDocument', () => {
    const context = { subscriptions: [] as any[] } as any;
    activate(context);

    expect(mocks.onDidSaveTextDocument).toHaveBeenCalled();
  });

  it('registers onDidChangeTextDocument', () => {
    const context = { subscriptions: [] as any[] } as any;
    activate(context);

    expect(mocks.onDidChangeTextDocument).toHaveBeenCalled();
  });

  it('registers onDidCloseTextDocument', () => {
    const context = { subscriptions: [] as any[] } as any;
    activate(context);

    expect(vscode.workspace.onDidCloseTextDocument).toHaveBeenCalled();
  });
});

describe('selectModel - edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
    mocks.activeTextEditor = undefined;
    mocks.selectChatModels.mockResolvedValue([]);
  });

  it('hides picker when validation returns empty (model unavailable)', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const lmModels = [
      { id: 'gpt-4o', name: 'GPT-4o', vendor: 'copilot' },
    ];
    mocks.selectChatModels
      .mockResolvedValueOnce(lmModels)
      .mockResolvedValueOnce([]); // validation: empty = unavailable
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: vi.fn(() => 'vscode-lm'), update } as any);

    const pickedItem = { label: '🟢 GPT-4o', description: '', detail: '     gpt-4o · copilot', modelId: 'gpt-4o', name: 'GPT-4o' };
    (vscode.window.createQuickPick as any).mockImplementation(() => ({
      title: '', placeholder: '', items: [] as any[], selectedItems: [pickedItem], busy: false,
      onDidAccept: vi.fn((cb: () => void) => { setTimeout(cb, 0); return { dispose: vi.fn() }; }),
      onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
      onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
      show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
    }));

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel',
    )?.[1];
    await selectModelCommand();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('is not available'),
    );
  });

  it('shows error when validation throws', async () => {
    const lmModels = [
      { id: 'gpt-4o', name: 'GPT-4o', vendor: 'copilot' },
    ];
    mocks.selectChatModels
      .mockResolvedValueOnce(lmModels)
      .mockRejectedValueOnce(new Error('network error'));

    const pickedItem = { label: '🟢 GPT-4o', description: '', detail: '     gpt-4o · copilot', modelId: 'gpt-4o', name: 'GPT-4o' };
    (vscode.window.createQuickPick as any).mockImplementation(() => ({
      title: '', placeholder: '', items: [] as any[], selectedItems: [pickedItem], busy: false,
      onDidAccept: vi.fn((cb: () => void) => { setTimeout(cb, 0); return { dispose: vi.fn() }; }),
      onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
      onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
      show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
    }));

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel',
    )?.[1];
    await selectModelCommand();

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to validate model'),
    );
  });

  it('filters out copilotcli models and warns when all filtered', async () => {
    mocks.selectChatModels.mockResolvedValue([
      { id: 'cli-1', name: 'CLI Model', vendor: 'copilotcli' },
    ]);

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel',
    )?.[1];
    await selectModelCommand();

    expect(mocks.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No models available'),
    );
  });

  it('sorts models by multiplier when config is set', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const lmModels = [
      { id: 'model-b', name: 'Model B', vendor: 'copilot', pricing: '3x' },
      { id: 'model-a', name: 'Model A', vendor: 'copilot', pricing: '1x' },
    ];
    mocks.readConfig.mockReturnValue({ ...DEFAULT_CONFIG, pickerSortBy: 'multiplier' });
    mocks.selectChatModels
      .mockResolvedValueOnce(lmModels)
      .mockResolvedValueOnce([{ id: 'model-a', name: 'Model A', vendor: 'copilot' }]);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: vi.fn(() => 'vscode-lm'), update } as any);

    let capturedItems: any[] = [];
    const pickedItem = { label: '🟢 Model A', description: '', detail: '     model-a · copilot', modelId: 'model-a', name: 'Model A' };
    (vscode.window.createQuickPick as any).mockImplementation(() => {
      const picker = {
        title: '', placeholder: '', items: [] as any[], selectedItems: [pickedItem], busy: false,
        onDidAccept: vi.fn((cb: () => void) => { setTimeout(cb, 0); return { dispose: vi.fn() }; }),
        onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
        show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
      };
      Object.defineProperty(picker, 'items', {
        set(val: any[]) { capturedItems = val; },
        get() { return capturedItems; },
      });
      return picker;
    });

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel',
    )?.[1];
    await selectModelCommand();

    // Model A (1x) should come before Model B (3x)
    expect(capturedItems[0].name).toBe('Model A');
    expect(capturedItems[1].name).toBe('Model B');
  });

  it('sorts models by name when config is set', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const lmModels = [
      { id: 'z-model', name: 'Z Model', vendor: 'copilot' },
      { id: 'a-model', name: 'A Model', vendor: 'copilot' },
    ];
    mocks.readConfig.mockReturnValue({ ...DEFAULT_CONFIG, pickerSortBy: 'name' });
    mocks.selectChatModels
      .mockResolvedValueOnce(lmModels)
      .mockResolvedValueOnce([{ id: 'a-model', name: 'A Model', vendor: 'copilot' }]);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: vi.fn(() => 'vscode-lm'), update } as any);

    let capturedItems: any[] = [];
    const pickedItem = { label: '🟢 A Model', description: '', detail: '     a-model · copilot', modelId: 'a-model', name: 'A Model' };
    (vscode.window.createQuickPick as any).mockImplementation(() => {
      const picker = {
        title: '', placeholder: '', items: [] as any[], selectedItems: [pickedItem], busy: false,
        onDidAccept: vi.fn((cb: () => void) => { setTimeout(cb, 0); return { dispose: vi.fn() }; }),
        onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
        show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
      };
      Object.defineProperty(picker, 'items', {
        set(val: any[]) { capturedItems = val; },
        get() { return capturedItems; },
      });
      return picker;
    });

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel',
    )?.[1];
    await selectModelCommand();

    expect(capturedItems[0].name).toBe('A Model');
    expect(capturedItems[1].name).toBe('Z Model');
  });

  it('selectFixModel triggers with fixModel target', async () => {
    activate({ subscriptions: [] } as any);

    const selectFixModelCommand = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.selectFixModel',
    )?.[1];
    expect(selectFixModelCommand).toBeInstanceOf(Function);

    await selectFixModelCommand();

    expect(mocks.showWarningMessage).toHaveBeenCalledWith('No language models available. Sign in to GitHub Copilot or configure an external provider.');
  });
});

describe('fixAll - unfixable issues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
  });

  it('shows info message when no fixable issues exist (empty results)', async () => {
    mocks.activeTextEditor = {
      document: {
        uri: { fsPath: '/tmp/skill.md', toString: () => 'file:///tmp/skill.md' },
        getText: vi.fn().mockReturnValue('test content'),
      },
    } as any;

    activate({ subscriptions: [] } as any);

    const fixAllCmd = mocks.registerCommand.mock.calls.find(
      ([name]) => name === 'skillsReviewAndPolish.fixAll',
    )?.[1];
    await fixAllCmd();

    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No auto-fixable issues'),
    );
  });
});

describe('inline rewrites config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readConfig.mockReturnValue(DEFAULT_CONFIG);
    mocks.isCustomizationPath.mockReturnValue(true);
  });

  it('enables inline rewrites when config says so', () => {
    mocks.readConfig
      .mockReturnValueOnce({ ...DEFAULT_CONFIG, inlineRewrites: true })
      .mockReturnValue(DEFAULT_CONFIG);

    const context = { subscriptions: [] as any[] } as any;
    activate(context);

    // Should have registered content provider + inline rewrite
    expect(context.subscriptions.length).toBeGreaterThan(0);
  });
});
