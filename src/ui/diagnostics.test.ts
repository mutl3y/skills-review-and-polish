import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { publishDiagnostics, createDiagnosticCollection } from './diagnostics';

vi.mock('vscode', () => {
  class Diagnostic {
    range: any;
    message: string;
    severity: any;
    code?: string;
    source?: string;
    data?: unknown;

    constructor(range: any, message: string, severity: any) {
      this.range = range;
      this.message = message;
      this.severity = severity;
    }
  }

  class Range {
    constructor(public start: any, public end: any) {}
  }

  const DiagnosticSeverity = {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  };

  return {
    Diagnostic,
    Range,
    DiagnosticSeverity,
    languages: { createDiagnosticCollection: vi.fn(() => ({ set: vi.fn(), dispose: vi.fn() })) },
  };
});

describe('publishDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes diagnostics with severity overrides and attached analysis data', () => {
    const set = vi.fn();
    const collection = { set } as any;

    publishDiagnostics(collection, { fsPath: '/tmp/skill.md' } as any, [
      {
        code: 'ambiguity-llm',
        message: 'Avoid vague wording',
        severity: 'warning',
        analyzer: 'analyzer',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        suggestion: 'Use explicit terms',
      },
    ], { 'ambiguity-llm': 'error' });

    expect(set).toHaveBeenCalledTimes(1);
    const [uri, diags] = set.mock.calls[0];
    expect(uri.fsPath).toBe('/tmp/skill.md');
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('ambiguity-llm');
    expect(diags[0].source).toBe('Skills Review (analyzer)');
    expect(diags[0].severity).toBe(vscode.DiagnosticSeverity.Error);
    expect((diags[0] as any).data.code).toBe('ambiguity-llm');
  });

  it('drops diagnostics when the override is set to off', () => {
    const set = vi.fn();
    const collection = { set } as any;

    publishDiagnostics(collection, { fsPath: '/tmp/skill.md' } as any, [
      {
        code: 'hygiene',
        message: 'Redundant instruction',
        severity: 'info',
        analyzer: 'analyzer',
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      },
    ], { hygiene: 'off' });

    expect(set).toHaveBeenCalledWith(expect.anything(), []);
  });

  it('falls back to warning severity for unknown override values', () => {
    const set = vi.fn();
    const collection = { set } as any;

    publishDiagnostics(collection, { fsPath: '/tmp/skill.md' } as any, [
      {
        code: 'unknown-code',
        message: 'Fallback warning',
        severity: 'unknown' as any,
        analyzer: 'analyzer',
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 6 } },
      },
    ], {});

    const [_, diags] = set.mock.calls[0];
    expect(diags[0].severity).toBe(vscode.DiagnosticSeverity.Warning);
  });
});

describe('publishDiagnostics — additional severity branches', () => {
  it('maps hint severity to DiagnosticSeverity.Hint', () => {
    const set = vi.fn();
    publishDiagnostics({ set } as any, { fsPath: '/tmp/skill.md' } as any, [{
      code: 'x', message: 'msg', severity: 'hint', analyzer: 'a',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    }], {});
    const diags = set.mock.calls[0][1];
    expect(diags[0].severity).toBe(vscode.DiagnosticSeverity.Hint);
  });

  it('maps info severity to DiagnosticSeverity.Information', () => {
    const set = vi.fn();
    publishDiagnostics({ set } as any, { fsPath: '/tmp/skill.md' } as any, [{
      code: 'x', message: 'msg', severity: 'info', analyzer: 'a',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    }]);
    const diags = set.mock.calls[0][1];
    expect(diags[0].severity).toBe(vscode.DiagnosticSeverity.Information);
  });
});

describe('publishDiagnostics — maxDiagnostics cap (plan item 5)', () => {
  const makeResults = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      code: `code-${i}`,
      message: `msg ${i}`,
      severity: 'warning' as const,
      analyzer: 'a',
      range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } },
    }));

  it('renders all findings when under the cap', () => {
    const set = vi.fn();
    publishDiagnostics({ set } as any, { fsPath: '/tmp/skill.md' } as any, makeResults(5), {}, 20);
    expect(set.mock.calls[0][1]).toHaveLength(5);
  });

  it('caps at maxDiagnostics and appends a "show all" summary diagnostic', () => {
    const set = vi.fn();
    publishDiagnostics({ set } as any, { fsPath: '/tmp/skill.md' } as any, makeResults(31), {}, 20);
    const diags = set.mock.calls[0][1];
    expect(diags).toHaveLength(21); // 20 capped + 1 summary
    const summary = diags[20];
    expect(summary.code).toBe('findings-truncated');
    expect(summary.severity).toBe(vscode.DiagnosticSeverity.Information);
    expect(summary.message).toContain('11 more finding(s) hidden');
  });

  it('renders everything when maxDiagnostics is very high', () => {
    const set = vi.fn();
    publishDiagnostics({ set } as any, { fsPath: '/tmp/skill.md' } as any, makeResults(31), {}, Number.MAX_SAFE_INTEGER);
    expect(set.mock.calls[0][1]).toHaveLength(31);
  });

  it('keeps the most severe findings when over the cap (plan item 5)', () => {
    const set = vi.fn();
    // 2 errors at the end, 19 warnings, then 10 hints — total 31.
    const results = [
      ...Array.from({ length: 19 }, (_, i) => ({ code: `w-${i}`, message: `w${i}`, severity: 'warning' as const, analyzer: 'a', range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } } })),
      ...Array.from({ length: 10 }, (_, i) => ({ code: `h-${i}`, message: `h${i}`, severity: 'hint' as const, analyzer: 'a', range: { start: { line: 100 + i, character: 0 }, end: { line: 100 + i, character: 1 } } })),
      { code: 'e-1', message: 'err1', severity: 'error' as const, analyzer: 'a', range: { start: { line: 200, character: 0 }, end: { line: 200, character: 1 } } },
      { code: 'e-2', message: 'err2', severity: 'error' as const, analyzer: 'a', range: { start: { line: 201, character: 0 }, end: { line: 201, character: 1 } } },
    ];
    publishDiagnostics({ set } as any, { fsPath: '/tmp/skill.md' } as any, results, {}, 20);
    const diags = set.mock.calls[0][1];
    // 20 capped + 1 summary = 21; both errors must be in the capped set.
    expect(diags).toHaveLength(21);
    const cappedCodes = diags.slice(0, 20).map((d: any) => d.code);
    expect(cappedCodes).toContain('e-1');
    expect(cappedCodes).toContain('e-2');
    // The 10 hints (lowest severity) must all be in the hidden overflow.
    expect(cappedCodes.filter((c: string) => c.startsWith('h-'))).toHaveLength(0);
  });
});

describe('createDiagnosticCollection', () => {
  it('delegates to vscode.languages.createDiagnosticCollection', () => {
    const mockCollection = { set: vi.fn(), dispose: vi.fn() };
    vi.mocked(vscode.languages.createDiagnosticCollection).mockReturnValue(mockCollection as any);
    const result = createDiagnosticCollection();
    expect(vscode.languages.createDiagnosticCollection).toHaveBeenCalledWith('skillsReviewAndPolish');
    expect(result).toBe(mockCollection);
  });
});
