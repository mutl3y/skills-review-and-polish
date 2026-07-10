import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerLanguageModelTools } from './extension';

const mocks = vi.hoisted(() => ({
  registerTool: vi.fn(),
  fixIssue: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn(() => ({ dispose: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    onDidChangeActiveTextEditor: vi.fn(),
    activeTextEditor: undefined,
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createStatusBarItem: vi.fn(() => ({ show: vi.fn(), dispose: vi.fn(), name: '', command: '', tooltip: '', text: '' })),
  },
  workspace: {
    registerTextDocumentContentProvider: vi.fn(),
    onDidSaveTextDocument: vi.fn(),
    onDidChangeTextDocument: vi.fn(),
    getConfiguration: vi.fn(() => ({ get: vi.fn() })),
  },
  languages: {
    createDiagnosticCollection: vi.fn(() => ({ dispose: vi.fn(), set: vi.fn() })),
    registerCodeActionsProvider: vi.fn(),
    registerCodeLensProvider: vi.fn(),
    registerHoverProvider: vi.fn(),
    registerInlineCompletionItemProvider: vi.fn(),
    getDiagnostics: vi.fn(() => []),
  },
  commands: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn(),
  },
  ProgressLocation: { Window: 1, Notification: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  CodeActionKind: { QuickFix: 'quickfix', Source: 'source' },
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
  Uri: { parse: vi.fn((value: string) => ({ path: value })) },
  Range: class { constructor(public start: any, public end: any) {} },
  Position: class { constructor(public line: number, public character: number) {} },
  Diagnostic: class { constructor(public range: any, public message: string, public severity: any) {} },
  WorkspaceEdit: class { replace = vi.fn(); },
  LanguageModelToolResult: class { constructor(public parts: any[]) {} },
  LanguageModelTextPart: class { constructor(public value: string) {} },
  StatusBarAlignment: { Left: 1 },
  lm: { registerTool: mocks.registerTool, selectChatModels: vi.fn(async () => []) },
}));

vi.mock('./core/fixer', () => ({
  SurgicalFixer: vi.fn(function () {
    return { fixIssue: mocks.fixIssue };
  }),
  SURGICAL_FIXABLE_CODES: new Set(['ambiguity-llm']),
}));

describe('registerLanguageModelTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the analyze and fix tools, and the analyze tool returns engine output', async () => {
    const subscriptions: unknown[] = [];
    const context = { subscriptions } as any;
    const analyze = vi.fn(async () => [{ code: 'ambiguity-llm' }]);
    const buildEngine = vi.fn(async () => ({ analyze, provider: {} })) as any;

    const tools: any[] = [];
    mocks.registerTool.mockImplementation((_name: string, spec: any) => {
      tools.push(spec);
      return { dispose: vi.fn() };
    });

    registerLanguageModelTools(context, { buildEngine, readConfig: () => ({ fixStrategy: 'additive', fixSemanticCheck: false, fixSelfCritique: false, fixReferenceGrounding: true }) as any });

    expect(mocks.registerTool).toHaveBeenCalledTimes(2);

    const result = await tools[0].invoke({ input: { text: 'Use explicit wording.' } }, {} as any);
    expect(analyze).toHaveBeenCalled();
    const firstCall = analyze.mock.calls[0];
    expect(firstCall[0]).toEqual(expect.objectContaining({ text: 'Use explicit wording.', filePath: undefined }));
    expect(result.parts[0].value).toContain('ambiguity-llm');
  });

  it('returns tool error payloads when the engine or fixer fails', async () => {
    const subscriptions: unknown[] = [];
    const context = { subscriptions } as any;
    const analyze = vi.fn(async () => { throw new Error('boom'); });
    const buildEngine = vi.fn(async () => ({ analyze, provider: {} })) as any;
    mocks.fixIssue.mockRejectedValue(new Error('fix failed'));

    const tools: any[] = [];
    mocks.registerTool.mockImplementation((_name: string, spec: any) => {
      tools.push(spec);
      return { dispose: vi.fn() };
    });

    registerLanguageModelTools(context, { buildEngine, readConfig: () => ({ fixStrategy: 'additive', fixSemanticCheck: false, fixSelfCritique: false, fixReferenceGrounding: true }) as any });

    const analyzeResult = await tools[0].invoke({ input: { text: 'bad' } }, {} as any);
    expect(JSON.parse(analyzeResult.parts[0].value)).toEqual({ error: 'Error: boom' });

    const fixResult = await tools[1].invoke({ input: { text: 'bad', diagnosticCode: 'ambiguity-llm', relevantText: 'vague' } }, {} as any);
    expect(JSON.parse(fixResult.parts[0].value)).toEqual({ error: 'Error: fix failed' });
  });
});
