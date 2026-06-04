import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  readConfig: vi.fn(),
  isCustomizationPath: vi.fn(),
  registerCommand: vi.fn(),
  registerCodeActionsProvider: vi.fn(),
  registerCodeLensProvider: vi.fn(),
  registerHoverProvider: vi.fn(),
  registerTextDocumentContentProvider: vi.fn(),
  onDidSaveTextDocument: vi.fn(),
  onDidChangeTextDocument: vi.fn(),
  onDidChangeActiveTextEditor: vi.fn(),
  executeCommand: vi.fn(),
  createOutputChannel: vi.fn(() => ({ dispose: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  createDiagnosticCollection: vi.fn(() => ({ dispose: vi.fn(), set: vi.fn() })),
}));

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: mocks.createOutputChannel,
    onDidChangeActiveTextEditor: mocks.onDidChangeActiveTextEditor,
    activeTextEditor: undefined,
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createStatusBarItem: vi.fn(() => ({ show: vi.fn(), dispose: vi.fn(), name: '', command: '', tooltip: '', text: '' })),
  },
  workspace: {
    registerTextDocumentContentProvider: mocks.registerTextDocumentContentProvider,
    onDidSaveTextDocument: mocks.onDidSaveTextDocument,
    onDidChangeTextDocument: mocks.onDidChangeTextDocument,
    getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
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
  CodeActionKind: { QuickFix: 'quickfix', Source: 'source' },
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
  Uri: { parse: vi.fn((value: string) => ({ path: value })) },
  Range: class { constructor(public start: any, public end: any) {} },
  Position: class { constructor(public line: number, public character: number) {} },
  Diagnostic: class { constructor(public range: any, public message: string, public severity: any) {} },
  WorkspaceEdit: class { replace = vi.fn(); },
  LanguageModelTextPart: class { constructor(public value: string) {} },
  LanguageModelToolResult: class { constructor(public parts: any[]) {} },
  lm: { registerTool: vi.fn(), selectChatModels: vi.fn(async () => []) },
}));

vi.mock('./config', () => ({
  readConfig: mocks.readConfig,
  isCustomizationPath: mocks.isCustomizationPath,
}));

vi.mock('./ui/diagnostics', () => ({ createDiagnosticCollection: vi.fn(() => ({ dispose: vi.fn(), set: vi.fn() })), publishDiagnostics: vi.fn() }));
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
});
