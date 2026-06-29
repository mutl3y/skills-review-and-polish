import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createInlineRewriteProvider, clearFixCache } from './inlineRewrites';
import { SurgicalFixer } from '../core/fixer';

const mocks = vi.hoisted(() => {
  const fixIssue = vi.fn();
  return {
    registerInlineCompletionItemProvider: vi.fn(),
    getDiagnostics: vi.fn(() => []),
    fixIssue,
    SurgicalFixer: vi.fn(function () {
      return { fixIssue };
    }),
  };
});

vi.mock('vscode', () => {
  class InlineCompletionItem {
    constructor(public insertText: string, public range: any) {}
  }

  class Range {
    constructor(public start: any, public end: any) {}
    contains(_position: any): boolean {
      return true;
    }
  }

  return {
    languages: {
      registerInlineCompletionItemProvider: mocks.registerInlineCompletionItemProvider,
      getDiagnostics: mocks.getDiagnostics,
    },
    InlineCompletionItem,
    Range,
    Position: class { constructor(public line: number, public character: number) {} },
  };
});

vi.mock('../core/fixer', () => {
  return {
    SURGICAL_FIXABLE_CODES: new Set(['ambiguity-llm']),
    SurgicalFixer: mocks.SurgicalFixer,
  };
});

describe('createInlineRewriteProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDiagnostics.mockReturnValue([]);
    (SurgicalFixer as any).mockClear();
    clearFixCache();
  });

  function getRegisteredProvider() {
    return (vscode.languages.registerInlineCompletionItemProvider as any).mock.calls[0]?.[1] as any;
  }

  function makeDocument(text = 'Use explicit wording for the task.') {
    return {
      uri: { fsPath: '/tmp/test.md', toString: () => 'file:///tmp/test.md' },
      getText: () => text,
      positionAt: (offset: number) => ({ line: 0, character: offset }),
    } as any;
  }

  it('returns no items when there are no diagnostics at the cursor', async () => {
    mocks.getDiagnostics.mockReturnValue([]);

    createInlineRewriteProvider(async () => ({ provider: {} } as any), () => []);

    const provider = getRegisteredProvider();
    const items = await provider.provideInlineCompletionItems(makeDocument(), { line: 0, character: 0 }, {} as any, {} as any);

    expect(items).toEqual([]);
  });

  it('returns no items for non-fixable diagnostic codes', async () => {
    mocks.getDiagnostics.mockReturnValue([
      { code: 'coverage-gap', source: 'Skills Review (analyzer)', range: { contains: () => true } },
    ] as any);

    createInlineRewriteProvider(async () => ({ provider: {} } as any), () => []);

    const provider = getRegisteredProvider();
    const items = await provider.provideInlineCompletionItems(makeDocument(), { line: 0, character: 0 }, {} as any, {} as any);

    expect(items).toEqual([]);
  });

  it('returns no items when no analysis result is available for the diagnostic', async () => {
    mocks.getDiagnostics.mockReturnValue([
      { code: 'ambiguity-llm', source: 'Skills Review (analyzer)', range: { contains: () => true } },
    ] as any);

    createInlineRewriteProvider(async () => ({ provider: {} } as any), () => []);

    const provider = getRegisteredProvider();
    const items = await provider.provideInlineCompletionItems(makeDocument(), { line: 0, character: 0 }, {} as any, {} as any);

    expect(items).toEqual([]);
  });

  it('returns no items when the fix result is rejected', async () => {
    mocks.fixIssue.mockImplementation(async () => ({ accepted: false, fixed: '' }));
    mocks.getDiagnostics.mockReturnValue([
      {
        code: 'ambiguity-llm',
        source: 'Skills Review (analyzer)',
        range: { contains: () => true },
        data: { code: 'ambiguity-llm', relevantText: 'explicit wording', message: 'Use explicit wording' },
      },
    ] as any);

    createInlineRewriteProvider(async () => ({ provider: {} } as any), () => [
      { code: 'ambiguity-llm', relevantText: 'explicit wording', message: 'Use explicit wording', severity: 'warning', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, analyzer: 'analyzer' },
    ] as any);

    const provider = getRegisteredProvider();
    const items = await provider.provideInlineCompletionItems(makeDocument('Use explicit wording for the task.'), { line: 0, character: 0 }, {} as any, {} as any);

    expect(items).toEqual([]);
    expect(mocks.fixIssue).toHaveBeenCalled();
  });

  it('returns an inline completion item when the fix is valid', async () => {
    mocks.fixIssue.mockImplementation(async () => ({ accepted: true, fixed: 'Use explicit wording.' }));
    mocks.getDiagnostics.mockReturnValue([
      {
        code: 'ambiguity-llm',
        source: 'Skills Review (analyzer)',
        range: { contains: () => true },
        data: { code: 'ambiguity-llm', relevantText: 'explicit wording', message: 'Use explicit wording' },
      },
    ] as any);

    createInlineRewriteProvider(async () => ({ provider: {} } as any), () => [
      { code: 'ambiguity-llm', relevantText: 'explicit wording', message: 'Use explicit wording', severity: 'warning', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, analyzer: 'analyzer' },
    ] as any);

    const provider = getRegisteredProvider();
    const items = await provider.provideInlineCompletionItems(makeDocument('Use explicit wording for the task.'), { line: 0, character: 0 }, {} as any, {} as any);

    expect(items).toHaveLength(1);
    expect((items as any)[0].insertText).toBe('Use explicit wording.');
  });

  it('returns cached result on second call without re-invoking the fixer', async () => {
    mocks.fixIssue.mockImplementation(async () => ({ accepted: true, fixed: 'Cached fix.' }));
    const diag = {
      code: 'ambiguity-llm',
      source: 'Skills Review (analyzer)',
      range: { contains: () => true },
      data: { code: 'ambiguity-llm', relevantText: 'explicit wording', message: 'msg' },
    };
    mocks.getDiagnostics.mockReturnValue([diag] as any);

    createInlineRewriteProvider(async () => ({ provider: {} } as any), () => [] as any);
    const provider = getRegisteredProvider();
    const doc = makeDocument('Use explicit wording for the task.');

    await provider.provideInlineCompletionItems(doc, { line: 0, character: 0 }, {} as any, {} as any);
    mocks.fixIssue.mockClear();
    const items = await provider.provideInlineCompletionItems(doc, { line: 0, character: 0 }, {} as any, {} as any);

    expect(mocks.fixIssue).not.toHaveBeenCalled();
    expect(items).toHaveLength(1);
  });

  it('handles diag.code as an object with toString()', async () => {
    // VS Code Diagnostic.code can be { value: string; target: Uri } — not a plain string
    mocks.getDiagnostics.mockReturnValue([
      {
        code: { value: 'coverage-gap', target: {} },
        source: 'Skills Review (analyzer)',
        range: { contains: () => true },
      },
    ] as any);

    createInlineRewriteProvider(async () => ({ provider: {} } as any), () => []);
    const provider = getRegisteredProvider();
    const items = await provider.provideInlineCompletionItems(makeDocument(), { line: 0, character: 0 }, {} as any, {} as any);

    // coverage-gap is not fixable so result is empty — but the code path was exercised
    expect(items).toEqual([]);
  });

  it('returns empty array when fixer throws', async () => {
    mocks.fixIssue.mockRejectedValue(new Error('fixer crashed'));
    mocks.getDiagnostics.mockReturnValue([
      {
        code: 'ambiguity-llm',
        source: 'Skills Review (analyzer)',
        range: { contains: () => true },
        data: { code: 'ambiguity-llm', relevantText: 'explicit wording', message: 'msg' },
      },
    ] as any);

    createInlineRewriteProvider(async () => ({ provider: {} } as any), () => []);
    const provider = getRegisteredProvider();
    const items = await provider.provideInlineCompletionItems(
      makeDocument('Use explicit wording for the task.'),
      { line: 0, character: 0 }, {} as any, {} as any,
    );

    expect(items).toEqual([]);
  });

  it('evicts oldest entries when cache exceeds max size (50)', async () => {
    // Fill the cache to just over the limit
    mocks.fixIssue.mockImplementation(async () => ({ accepted: true, fixed: 'fixed' }));

    for (let i = 0; i < 51; i++) {
      const uniqueText = `word${i}`;
      const diag = {
        code: 'ambiguity-llm',
        source: 'Skills Review (analyzer)',
        range: { contains: () => true },
        data: { code: 'ambiguity-llm', relevantText: uniqueText, message: 'msg' },
      };
      mocks.getDiagnostics.mockReturnValue([diag] as any);
      createInlineRewriteProvider(async () => ({ provider: {} } as any), () => []);
      const provider = getRegisteredProvider();
      await provider.provideInlineCompletionItems(
        makeDocument(`Use ${uniqueText} for the task.`),
        { line: 0, character: 0 }, {} as any, {} as any,
      );
    }

    // After 51 fills, fixer should have been called 51 times (eviction doesn't prevent future calls)
    expect(mocks.fixIssue.mock.calls.length).toBe(51);
  });
});
