/**
 * Tests for the accepted findings system.
 * @module acceptedFindings.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadAcceptedFindings,
  saveAcceptedFindings,
  acceptFinding,
  filterAcceptedResults,
  isFindingAccepted,
  sanitizeFileName,
  validateRelevantText,
  AcceptedFindingsStore,
  AcceptedFinding,
} from './acceptedFindings';
import { AnalysisResult } from './types';

const tmpDir = path.join(os.tmpdir(), 'accepted-findings-test');

function tmpStorePath(): string {
  return path.join(tmpDir, `store-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  // Cleanup
  try {
    const files = fs.readdirSync(tmpDir);
    for (const f of files) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
    fs.rmdirSync(tmpDir);
  } catch { /* ignore */ }
});

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    code: 'ambiguity-llm',
    message: 'Test message',
    severity: 'warning',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
    analyzer: 'test',
    relevantText: 'some relevant text',
    ...overrides,
  };
}

describe('loadAcceptedFindings', () => {
  it('returns empty store for missing file', () => {
    const store = loadAcceptedFindings('/nonexistent/path/.accepted-findings.json');
    expect(store).toEqual({ entries: {} });
  });

  it('loads valid store from disk', () => {
    const storePath = tmpStorePath();
    const store: AcceptedFindingsStore = {
      entries: {
        '/test/file.md': [
          { code: 'ambiguity-llm', textPattern: 'vague', acceptedAt: '2026-06-08', reason: 'known' },
        ],
      },
    };
    fs.writeFileSync(storePath, JSON.stringify(store), 'utf8');
    const loaded = loadAcceptedFindings(storePath);
    expect(loaded.entries['/test/file.md']).toHaveLength(1);
    expect(loaded.entries['/test/file.md'][0].code).toBe('ambiguity-llm');
  });

  it('returns empty store for malformed JSON', () => {
    const storePath = tmpStorePath();
    fs.writeFileSync(storePath, 'not json', 'utf8');
    const store = loadAcceptedFindings(storePath);
    expect(store).toEqual({ entries: {} });
  });
});

describe('acceptFinding', () => {
  it('creates file and adds entry', () => {
    const storePath = tmpStorePath();
    expect(fs.existsSync(storePath)).toBe(false);

    acceptFinding(storePath, '/test/file.md', {
      code: 'coverage-gap',
      textPattern: 'missing error handling',
      acceptedAt: '2026-06-08',
    });

    expect(fs.existsSync(storePath)).toBe(true);
    const store = loadAcceptedFindings(storePath);
    expect(store.entries['/test/file.md']).toHaveLength(1);
    expect(store.entries['/test/file.md'][0].code).toBe('coverage-gap');
  });

  it('does not duplicate entries', () => {
    const storePath = tmpStorePath();
    const finding: AcceptedFinding = {
      code: 'ambiguity-llm',
      textPattern: 'vague or underspecified',
      acceptedAt: '2026-06-08',
    };

    acceptFinding(storePath, '/test/file.md', finding);
    acceptFinding(storePath, '/test/file.md', finding);

    const store = loadAcceptedFindings(storePath);
    expect(store.entries['/test/file.md']).toHaveLength(1);
  });
});

describe('isFindingAccepted', () => {
  it('matches on exact code + substring containment', () => {
    const result = makeResult({
      code: 'ambiguity-llm',
      relevantText: 'You should be helpful, vague or underspecified instructions where different interpretations are possible',
    });
    const accepted: AcceptedFinding[] = [
      { code: 'ambiguity-llm', textPattern: 'vague or underspecified', acceptedAt: '2026-06-08' },
    ];
    expect(isFindingAccepted(result, accepted)).toBe(true);
  });

  it('does not match wrong code', () => {
    const result = makeResult({
      code: 'coverage-gap',
      relevantText: 'vague or underspecified instructions',
    });
    const accepted: AcceptedFinding[] = [
      { code: 'ambiguity-llm', textPattern: 'vague or underspecified', acceptedAt: '2026-06-08' },
    ];
    expect(isFindingAccepted(result, accepted)).toBe(false);
  });

  it('does not match non-matching text', () => {
    const result = makeResult({
      code: 'ambiguity-llm',
      relevantText: 'completely different text about something else',
    });
    const accepted: AcceptedFinding[] = [
      { code: 'ambiguity-llm', textPattern: 'vague or underspecified', acceptedAt: '2026-06-08' },
    ];
    expect(isFindingAccepted(result, accepted)).toBe(false);
  });

  it('normalizes case and whitespace', () => {
    const result = makeResult({
      code: 'ambiguity-llm',
      relevantText: '  Vague   Or   Underspecified   Instructions  ',
    });
    const accepted: AcceptedFinding[] = [
      { code: 'ambiguity-llm', textPattern: 'vague or underspecified', acceptedAt: '2026-06-08' },
    ];
    expect(isFindingAccepted(result, accepted)).toBe(true);
  });

  it('returns false with empty accepted array', () => {
    const result = makeResult();
    expect(isFindingAccepted(result, [])).toBe(false);
  });
});

describe('filterAcceptedResults', () => {
  it('removes matching findings', () => {
    const storePath = tmpStorePath();
    acceptFinding(storePath, '/test/file.md', {
      code: 'ambiguity-llm',
      textPattern: 'vague or underspecified',
      acceptedAt: '2026-06-08',
    });

    const results = [
      makeResult({
        code: 'ambiguity-llm',
        relevantText: 'vague or underspecified instructions where different interpretations are possible',
      }),
      makeResult({
        code: 'coverage-gap',
        relevantText: 'missing error handling for edge cases',
      }),
    ];

    const filtered = filterAcceptedResults(results, '/test/file.md', storePath);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].code).toBe('coverage-gap');
  });

  it('keeps non-matching findings', () => {
    const storePath = tmpStorePath();
    acceptFinding(storePath, '/test/file.md', {
      code: 'ambiguity-llm',
      textPattern: 'completely unrelated pattern',
      acceptedAt: '2026-06-08',
    });

    const results = [
      makeResult({
        code: 'ambiguity-llm',
        relevantText: 'vague or underspecified instructions',
      }),
      makeResult({
        code: 'coverage-gap',
        relevantText: 'missing error handling',
      }),
    ];

    const filtered = filterAcceptedResults(results, '/test/file.md', storePath);
    expect(filtered).toHaveLength(2);
  });

  it('returns all results when no entries exist for file', () => {
    const storePath = tmpStorePath();
    const results = [
      makeResult({ code: 'ambiguity-llm' }),
      makeResult({ code: 'coverage-gap' }),
    ];

    const filtered = filterAcceptedResults(results, '/test/file.md', storePath);
    expect(filtered).toHaveLength(2);
  });

  it('fuzzy matching: pattern is substring of result text', () => {
    const storePath = tmpStorePath();
    acceptFinding(storePath, '/test/file.md', {
      code: 'ambiguity-llm',
      textPattern: 'vague or underspecified',
      acceptedAt: '2026-06-08',
    });

    const results = [
      makeResult({
        code: 'ambiguity-llm',
        relevantText: 'vague or underspecified instructions where different interpretations are possible',
      }),
    ];

    const filtered = filterAcceptedResults(results, '/test/file.md', storePath);
    expect(filtered).toHaveLength(0);
  });

  // Regression: when nothing is suppressed, filterAcceptedResults returns the
  // *same* array reference as the input.  Callers must not do
  // `results.length = 0; results.push(...filtered)` without snapshotting first
  // or they will wipe both arrays simultaneously.
  it('returns the same array reference when no entries exist for the file', () => {
    const storePath = tmpStorePath();
    const results = [makeResult(), makeResult({ code: 'coverage-gap' })];
    const filtered = filterAcceptedResults(results, '/test/file.md', storePath);
    expect(filtered).toBe(results);
  });

  it('returns the same array reference when storePath is empty', () => {
    const results = [makeResult()];
    const filtered = filterAcceptedResults(results, '/test/file.md', '');
    expect(filtered).toBe(results);
  });

  it('returns a new array reference when at least one finding is suppressed', () => {
    const storePath = tmpStorePath();
    // Match against relevantText (isFindingAccepted uses relevantText ?? message)
    acceptFinding(storePath, '/test/file.md', {
      code: 'ambiguity-llm',
      textPattern: 'some relevant text',
      acceptedAt: '2026-06-08',
    });
    const results = [
      makeResult(),                          // code: ambiguity-llm — suppressed
      makeResult({ code: 'coverage-gap' }),  // different code — kept
    ];
    const filtered = filterAcceptedResults(results, '/test/file.md', storePath);
    expect(filtered).not.toBe(results);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].code).toBe('coverage-gap');
  });
});

// ─── sanitizeFileName ─────────────────────────────────────────────────────────

describe('sanitizeFileName', () => {
  it('normalizes Windows backslashes to forward slashes', () => {
    expect(sanitizeFileName('C:\\Users\\foo\\bar.md')).toBe('/Users/foo/bar.md');
  });

  it('strips Windows drive letter prefix', () => {
    expect(sanitizeFileName('C:/workspace/SKILL.md')).toBe('/workspace/SKILL.md');
  });

  it('strips tilde prefix', () => {
    expect(sanitizeFileName('~/projects/SKILL.md')).toBe('/projects/SKILL.md');
  });

  it('passes through already-normalized paths unchanged', () => {
    expect(sanitizeFileName('/workspace/SKILL.md')).toBe('/workspace/SKILL.md');
  });
});

// ─── saveAcceptedFindings ─────────────────────────────────────────────────────

describe('saveAcceptedFindings', () => {
  it('creates missing parent directories', () => {
    const nested = path.join(tmpDir, 'deep', 'nested', 'store.json');
    const store = { entries: { '/file.md': [{ code: 'x', textPattern: 'y', acceptedAt: '2026' }] } };
    expect(() => saveAcceptedFindings(nested, store)).not.toThrow();
    expect(fs.existsSync(nested)).toBe(true);
    fs.rmSync(path.join(tmpDir, 'deep'), { recursive: true, force: true });
  });

  it('round-trips store data correctly', () => {
    const storePath = tmpStorePath();
    const store = { entries: { '/test.md': [{ code: 'ambiguity-llm', textPattern: 'foo', acceptedAt: '2026-06-01' }] } };
    saveAcceptedFindings(storePath, store);
    const loaded = loadAcceptedFindings(storePath);
    expect(loaded.entries['/test.md']).toHaveLength(1);
    expect(loaded.entries['/test.md'][0].code).toBe('ambiguity-llm');
  });
});

// ─── loadAcceptedFindings edge cases ─────────────────────────────────────────

describe('loadAcceptedFindings edge cases', () => {
  it('returns empty store for a file with valid JSON but wrong structure', () => {
    const storePath = tmpStorePath();
    fs.writeFileSync(storePath, JSON.stringify({ wrong: 'shape' }), 'utf8');
    expect(loadAcceptedFindings(storePath)).toEqual({ entries: {} });
  });

  it('returns empty store for a file with no entries field', () => {
    const storePath = tmpStorePath();
    fs.writeFileSync(storePath, JSON.stringify([1, 2, 3]), 'utf8');
    expect(loadAcceptedFindings(storePath)).toEqual({ entries: {} });
  });

  it('drops malformed entries (missing textPattern) instead of crashing', () => {
    const storePath = tmpStorePath();
    // A hand-edited/corrupted store with an entry missing textPattern would
    // make normalize(entry.textPattern) throw inside isFindingAccepted.
    fs.writeFileSync(storePath, JSON.stringify({
      entries: {
        '/test.md': [
          { code: 'ambiguity-llm', textPattern: 'valid pattern here', acceptedAt: '2026-06-01' },
          { code: 'coverage-gap', acceptedAt: '2026-06-01' }, // malformed — no textPattern
          'not-an-object',
        ],
      },
    }), 'utf8');
    const store = loadAcceptedFindings(storePath);
    expect(store.entries['/test.md']).toHaveLength(1);
    expect(store.entries['/test.md'][0].code).toBe('ambiguity-llm');
  });
});

// ─── acceptFinding — duplicate prevention ────────────────────────────────────

describe('acceptFinding — duplicate prevention', () => {
  it('does not add the same code+textPattern twice', () => {
    const storePath = tmpStorePath();
    const finding = { code: 'ambiguity-llm', textPattern: 'foo bar baz', acceptedAt: '2026-06-01' };
    acceptFinding(storePath, '/test.md', finding);
    acceptFinding(storePath, '/test.md', finding);
    const store = loadAcceptedFindings(storePath);
    expect(store.entries['/test.md']).toHaveLength(1);
  });

  it('adds entries with different codes separately', () => {
    const storePath = tmpStorePath();
    acceptFinding(storePath, '/test.md', { code: 'ambiguity-llm', textPattern: 'foo bar baz', acceptedAt: '2026-06-01' });
    acceptFinding(storePath, '/test.md', { code: 'coverage-gap', textPattern: 'foo bar baz', acceptedAt: '2026-06-01' });
    const store = loadAcceptedFindings(storePath);
    expect(store.entries['/test.md']).toHaveLength(2);
  });
});

// ─── validateRelevantText (shared by MCP server + extension) ─────────────────

describe('validateRelevantText', () => {
  it('accepts a meaningful fragment and trims it', () => {
    expect(validateRelevantText('  some meaningful text  ')).toBe('some meaningful text');
  });

  it('rejects text shorter than the 5-char floor', () => {
    expect(() => validateRelevantText('abc')).toThrow(/too short/);
  });

  it('rejects text longer than the 200-char cap', () => {
    expect(() => validateRelevantText('x'.repeat(201))).toThrow(/too long/);
  });

  it('strips control characters', () => {
    expect(validateRelevantText('some\x00text\x1f')).toBe('sometext');
  });
});
