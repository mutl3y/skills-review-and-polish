import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { SkillsCodeActionProvider } from './codeActions';
import { ScoreCodeLensProvider } from './codeLens';
import { SuggestionHoverProvider } from './hover';

vi.mock('vscode', () => {
  class CodeAction {
    title: string;
    kind: any;
    diagnostics?: any[];
    isPreferred?: boolean;
    command?: any;
    constructor(title: string, kind: any) {
      this.title = title;
      this.kind = kind;
    }
  }

  class CodeLens {
    range: any;
    command?: any;
    constructor(range: any, command: any) {
      this.range = range;
      this.command = command;
    }
  }

  class MarkdownString {
    value: string;
    isTrusted = false;
    constructor(value: string, isTrusted = false) {
      this.value = value;
      this.isTrusted = isTrusted;
    }
    appendMarkdown(text: string) {
      this.value += text;
    }
  }

  class EventEmitter<T> {
    event = vi.fn();
    fire = vi.fn();
  }

  class Hover {
    contents: any[];
    constructor(...contents: any[]) {
      this.contents = contents;
    }
  }

  const CodeActionKind = { QuickFix: 'quickfix', Source: 'source' };
  const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

  return {
    CodeAction,
    CodeLens,
    MarkdownString,
    Hover,
    EventEmitter,
    CodeActionKind,
    DiagnosticSeverity,
    Range: class { constructor(public start: any, public end: any) {} },
    Position: class { constructor(public line: number, public character: number) {} },
    languages: {
      getDiagnostics: vi.fn(() => []),
    },
    window: {},
  };
});

describe('UI action and hover helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates fix and ignore actions for Skills Review diagnostics', () => {
    const provider = new SkillsCodeActionProvider();
    const result = provider.provideCodeActions({ uri: { fsPath: '/tmp/test.md' } } as any, {} as any, {
      diagnostics: [
        {
          source: 'Skills Review (analyzer)',
          code: 'ambiguity-llm',
          message: 'Ambiguous wording',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          data: { code: 'ambiguity-llm', message: 'Ambiguous wording', analyzer: 'analyzer' },
        },
      ],
    } as any);

    expect(result).toHaveLength(3);
    expect(result[0].title).toContain('Fix');
    expect(result[1].title).toContain('Ignore');
    expect(result[2].title).toContain('Accept finding');
  });

  it('updates code lens metadata and renders issue labels', () => {
    const provider = new ScoreCodeLensProvider();
    provider.update({ toString: () => 'file:///tmp/test.md' } as any, { grade: 'A', score: 92 } as any, 2);

    const lenses = provider.provideCodeLenses({ uri: { toString: () => 'file:///tmp/test.md' } } as any);
    expect(lenses).toHaveLength(2);
    expect(lenses[0].command).toEqual(expect.objectContaining({ command: 'skillsReviewAndPolish.rescan' }));
    expect(lenses[0].command?.tooltip).toContain('Quality score: 92/100');
  });

  it('clears code lens data when the file is closed', () => {
    const provider = new ScoreCodeLensProvider();
    const uri = { toString: () => 'file:///tmp/test.md' } as any;

    provider.update(uri, { grade: 'B', score: 80 } as any, 1);
    provider.clear(uri);

    expect(provider.provideCodeLenses({ uri } as any)).toEqual([]);
  });

  it('returns a hover with attached suggestion text', () => {
    const hover = new SuggestionHoverProvider();
    const diag = {
      source: 'Skills Review (analyzer)',
      range: {
        contains: () => true,
      },
      message: 'Use explicit terms. Suggestion: Replace vague wording with exact wording.',
      data: { suggestion: 'Replace vague wording with exact wording.' },
    };

    vi.mocked(vscode.languages.getDiagnostics).mockReturnValue([diag as any]);

    const result = hover.provideHover({ uri: { toString: () => 'file:///tmp/test.md' } } as any, { line: 0, character: 0 } as any);
    expect(result).toBeDefined();
    expect((result as any).contents[0].value).toContain('Replace vague wording');
  });

  it('falls back to the diagnostic message when no attached suggestion exists', () => {
    const hover = new SuggestionHoverProvider();
    const diag = {
      source: 'Skills Review (analyzer)',
      range: { contains: () => true },
      message: 'Use explicit terms. Suggestion: Replace vague wording with exact wording.',
      data: undefined,
    };

    vi.mocked(vscode.languages.getDiagnostics).mockReturnValue([diag as any]);

    const result = hover.provideHover({ uri: { toString: () => 'file:///tmp/test.md' } } as any, { line: 0, character: 0 } as any);

    expect(result).toBeDefined();
    expect((result as any).contents[0].value).toContain('Use explicit terms');
    expect((result as any).contents[0].value).toContain('Replace vague wording');
  });

  it('only creates the fix action for fixable diagnostic codes', () => {
    const provider = new SkillsCodeActionProvider();
    const result = provider.provideCodeActions({ uri: { fsPath: '/tmp/test.md' } } as any, {} as any, {
      diagnostics: [
        {
          source: 'Skills Review (analyzer)',
          code: 'coverage-gap',
          message: 'Add coverage for edge cases',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          data: { code: 'coverage-gap', message: 'Add coverage for edge cases' },
        },
      ],
    } as any);

    expect(result).toHaveLength(2);
    expect(result[0].title).toContain('Ignore rule');
    expect(result[0].title).not.toContain('Fix');
    expect(result[1].title).toContain('Accept finding');
  });
});
