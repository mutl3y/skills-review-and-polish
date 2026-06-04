import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { activate } from './extension';

const DEFAULT_CONFIG = {
  enable: true,
  provider: 'vscode-lm',
  include: ['**/SKILL.md'],
  exclude: ['**/node_modules/**'],
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: true,
  inlineRewrites: false,
  runOn: 'manual',
  logLevel: 'info',
  severityOverrides: {},
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
  createOutputChannel: vi.fn(() => ({ dispose: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
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
    createStatusBarItem: vi.fn(() => ({ show: vi.fn(), dispose: vi.fn(), name: '', command: '', tooltip: '', text: '' })),
  },
  workspace: {
    registerTextDocumentContentProvider: mocks.registerTextDocumentContentProvider,
    onDidSaveTextDocument: mocks.onDidSaveTextDocument,
    onDidChangeTextDocument: mocks.onDidChangeTextDocument,
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
}));

vi.mock('./ui/diagnostics', () => ({ createDiagnosticCollection: mocks.createDiagnosticCollection, publishDiagnostics: vi.fn() }));
vi.mock('./ui/statusBar', () => ({ StatusBarManager: class { showIdle = vi.fn(); dispose = vi.fn(); startAnalyzing = vi.fn(); showResult = vi.fn(); showError = vi.fn(); } }));
vi.mock('./ui/codeLens', () => ({ ScoreCodeLensProvider: class { update = vi.fn(); dispose = vi.fn(); } }));
vi.mock('./ui/codeActions', () => ({ SkillsCodeActionProvider: class { static providedCodeActionKinds = []; } }));
vi.mock('./ui/hover', () => ({ SuggestionHoverProvider: class {} }));
vi.mock('./ui/inlineRewrites', () => ({ createInlineRewriteProvider: vi.fn(() => ({ dispose: vi.fn() })) }));
vi.mock('./test-api-inspection', () => ({ inspectLMAPIs: vi.fn() }));

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

  it('warns and skips analyze when the active editor is not a customization file', async () => {
    mocks.activeTextEditor = {
      document: {
        uri: { fsPath: '/tmp/README.md', toString: () => 'file:///tmp/README.md' },
        fileName: 'README.md',
      },
    } as any;
    mocks.isCustomizationPath.mockReturnValue(false);

    activate({ subscriptions: [] } as any);

    const analyzeCommand = mocks.registerCommand.mock.calls.find(([name]) => name === 'skillsReviewAndPolish.analyze')?.[1];
    expect(analyzeCommand).toBeInstanceOf(Function);

    await analyzeCommand();

    expect(mocks.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('not a recognised AI customization file'));
  });

  it('warns when model selection has no available models', async () => {
    mocks.selectChatModels.mockResolvedValue([]);

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel')?.[1];
    expect(selectModelCommand).toBeInstanceOf(Function);

    await selectModelCommand();

    expect(mocks.showWarningMessage).toHaveBeenCalledWith('No language models available. Sign in to GitHub Copilot.');
  });

  it('saves a validated model selection and reports the result', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const config = { update };
    mocks.selectChatModels
      .mockResolvedValueOnce([
        { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', vendor: 'copilot', pricing: '1x' },
      ])
      .mockResolvedValueOnce([
        { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', vendor: 'copilot' },
      ]);
    mocks.showQuickPick.mockResolvedValue({ modelId: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6' });
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any);

    activate({ subscriptions: [] } as any);

    const selectModelCommand = mocks.registerCommand.mock.calls.find(([name]) => name === 'skillsReviewAndPolish.selectAnalysisModel')?.[1];
    await selectModelCommand();

    expect(update).toHaveBeenCalledWith('model', 'claude-sonnet-4.6', expect.anything());
    expect(update).toHaveBeenCalledWith('modelDisplayName', 'Claude Sonnet 4.6', expect.anything());
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Analysis model set to'));
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
