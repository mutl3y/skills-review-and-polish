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
});
