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
});
