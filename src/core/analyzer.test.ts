/**
 * Analyzer unit tests.
 *
 * Key test scenarios:
 *  - `LLMAnalyzer` + `setProxyFn(fn)` → `Analyzer` constructed with `LlmProvider`.
 *  - `TextDocument.create(...)` → plain `{ text: '...' }` (AnalyzerInput).
 *  - `findTextRange(doc, text)` → `findTextRange(text, searchText)` (string-based).
 *  - `isAvailable()` / `setDebugLogPath()` removed — not in new API.
 *  - `analyze without proxy` test removed — provider handles gracefully via error response.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, AnalysisHistoryStore } from './analyzer';
import type { LlmProvider, LlmRequest, LlmResponse } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build an Analyzer backed by a custom mock provider function. */
function makeAnalyzer(fn: (req: LlmRequest) => Promise<LlmResponse>, store?: AnalysisHistoryStore): Analyzer {
  const provider: LlmProvider = { complete: fn };
  return new Analyzer(provider, store);
}

/** Default empty response for waves we don't care about in a given test. */
const EMPTY_RESPONSE = JSON.stringify({
  contradictions: [],
  ambiguity_issues: [],
  persona_issues: [],
  cognitive_load: { issues: [], overall_complexity: 'low' },
  coverage_analysis: {},
  hygiene_issues: [],
});

// ─── extractJSON ──────────────────────────────────────────────────────────────

describe('extractJSON', () => {
  // Access private method for direct testing.
  const extract = (text: string) => (new Analyzer({ complete: async () => ({ text: '{}' }) }) as any).extractJSON(text);

  it('parses plain JSON', () => {
    expect(extract('{"issues": []}')).toEqual({ issues: [] });
  });

  it('parses code-fenced JSON with language tag', () => {
    expect(extract('```json\n{"issues": []}\n```')).toEqual({ issues: [] });
  });

  it('parses code-fenced JSON without language tag', () => {
    expect(extract('```\n{"key": "value"}\n```')).toEqual({ key: 'value' });
  });

  it('throws on invalid JSON', () => {
    expect(() => extract('not json at all')).toThrow();
  });

  it('handles JSON with surrounding whitespace', () => {
    expect(extract('  \n{"ok": true}\n  ')).toEqual({ ok: true });
  });

  it('handles JSON with leading preamble text', () => {
    expect(extract('Here is the analysis:\n{"issues": []}')).toEqual({ issues: [] });
  });

  it('handles JSON with trailing text', () => {
    expect(extract('{"issues": []}\nHope this helps!')).toEqual({ issues: [] });
  });

  it('handles JSON inside code fence with preamble text', () => {
    expect(extract('```json\nHere is the analysis:\n{"issues": []}\n```')).toEqual({ issues: [] });
  });

  it('handles nested objects', () => {
    expect(extract('{"a": {"b": [1, 2, 3]}}')).toEqual({ a: { b: [1, 2, 3] } });
  });

  it('is not corrupted by an inner code fence embedded in a JSON string value', () => {
    // Regression: the old greedy fence regex matched the *inner* ```python fence
    // inside a JSON string value, breaking parse. The fix: strip outer fence only.
    const text =
      '{"hygiene_issues": [{"text": "Use ```python\\nmlflow.log_model()\\n``` here", "severity": "info"}]}';
    expect(extract(text)).toEqual({
      hygiene_issues: [{ text: 'Use ```python\nmlflow.log_model()\n``` here', severity: 'info' }],
    });
  });
});

// ─── extractJSON truncation salvage ──────────────────────────────────────────

describe('extractJSON truncation salvage', () => {
  const extract = (text: string) => (new Analyzer({ complete: async () => ({ text: '{}' }) }) as any).extractJSON(text);

  it('recovers complete elements when array is truncated mid-object', () => {
    const truncated =
      '{"ambiguity_issues": [' +
      '{"text": "foo", "severity": "warning"},' +
      '{"text": "bar", "severity": "info"},' +
      '{"text": "baz", "sever';
    expect(extract(truncated)).toEqual({
      ambiguity_issues: [
        { text: 'foo', severity: 'warning' },
        { text: 'bar', severity: 'info' },
      ],
    });
  });

  it('recovers from a truncated response inside an unterminated code fence', () => {
    const truncated =
      '```json\n{"coverage_gaps": [' +
      '{"text": "a"},' +
      '{"text": "b"},' +
      '{"text": "c';
    expect(extract(truncated)).toEqual({ coverage_gaps: [{ text: 'a' }, { text: 'b' }] });
  });

  it('preserves braces and brackets inside string values when salvaging', () => {
    const truncated =
      '{"issues": [' +
      '{"text": "use {placeholder} and [array]", "severity": "info"},' +
      '{"text": "next one but trunc';
    expect(extract(truncated)).toEqual({
      issues: [{ text: 'use {placeholder} and [array]', severity: 'info' }],
    });
  });

  it('throws when nothing can be salvaged', () => {
    expect(() => extract('{"issues": [{"text": "only a partial first ob')).toThrow();
  });

  it('salvageTruncatedJSON returns undefined for text with no JSON at all', () => {
    const salvage = (new Analyzer({ complete: async () => ({ text: '{}' }) }) as any).salvageTruncatedJSON;
    expect(salvage('This is plain text with no JSON whatsoever.')).toBeUndefined();
  });

  it('salvageTruncatedJSON returns undefined for completely empty input', () => {
    const salvage = (new Analyzer({ complete: async () => ({ text: '{}' }) }) as any).salvageTruncatedJSON;
    expect(salvage('')).toBeUndefined();
  });

  it('returns undefined when array has no complete elements (truncated mid-first-element)', () => {
    const salvage = (new Analyzer({ complete: async () => ({ text: '{}' }) }) as any).salvageTruncatedJSON;
    // Truncated mid-string — parser stuck in inString mode, closing } never reached.
    expect(salvage('{"hygiene_issues": [{"type": "dead')).toBeUndefined();
  });

  it('recovers complete element when truncation happens between elements', () => {
    // First element is complete, truncation occurs after the comma separating elements.
    const truncated =
      '{"contradictions": [' +
      '{"instruction1": "Be concise", "instruction2": "Explain in detail", "severity": "warning", "explanation": "These conflict"},' +
      '{"instruction1": "second one that is trunc';
    expect(extract(truncated)).toEqual({
      contradictions: [{ instruction1: 'Be concise', instruction2: 'Explain in detail', severity: 'warning', explanation: 'These conflict' }],
    });
  });

  it('recovers when truncation happens after a complete string value inside an object', () => {
    // First element is complete (with closing `}`), truncation occurs inside the second element.
    const truncated =
      '{"coverage_gaps": [' +
      '{"gap": "missing error handling", "impact": "high", "suggestion": "Add try-catch"},' +
      '{"gap": "no output schema", "impact": ';
    expect(extract(truncated)).toEqual({
      coverage_gaps: [{ gap: 'missing error handling', impact: 'high', suggestion: 'Add try-catch' }],
    });
  });

  it('recovers multiple keys from a truncated response', () => {
    const truncated =
      '{"contradictions": [{"instruction1": "A", "instruction2": "B", "severity": "warning", "explanation": "conflict"}],' +
      '"ambiguity_issues": [{"text": "vague term", "severity": "info"}, {"text": ' +
      '"trun';
    expect(extract(truncated)).toEqual({
      contradictions: [{ instruction1: 'A', instruction2: 'B', severity: 'warning', explanation: 'conflict' }],
      ambiguity_issues: [{ text: 'vague term', severity: 'info' }],
    });
  });
});

// ─── findTextRange ────────────────────────────────────────────────────────────

describe('findTextRange', () => {
  const analyzer = new Analyzer({ complete: async () => ({ text: '{}' }) });
  const find = (text: string, searchText: string) =>
    (analyzer as any).findTextRange(text, searchText);

  it('finds exact match with column offsets', () => {
    const r = find('first line\nsecond line\nthird line', 'second line');
    expect(r.line).toBe(1);
    expect(r.startChar).toBe(0);
    expect(r.endChar).toBe('second line'.length);
  });

  it('finds partial match with column offsets', () => {
    const r = find('the quick brown fox\njumps over\nthe lazy dog', 'brown fox');
    expect(r.line).toBe(0);
    expect(r.startChar).toBe('the quick '.length);
    expect(r.endChar).toBe('the quick brown fox'.length);
  });

  it('returns null when no match found', () => {
    const r = find('hello world', 'nonexistent text that does not appear');
    expect(r).toBeNull();
  });

  it('is case-insensitive', () => {
    const r = find('Hello World\nGoodbye', 'hello world');
    expect(r.line).toBe(0);
    expect(r.startChar).toBe(0);
    expect(r.endChar).toBe('hello world'.length);
  });

  it('handles empty search text', () => {
    const r = find('hello', '');
    expect(r).toBeNull();
  });

  it('falls back to word-level partial match with column offsets', () => {
    const r = find('line one\nline two with important word\nline three', 'important word in a different sentence');
    expect(r.line).toBe(1);
    expect(r.startChar).toBe('line two with '.length);
    expect(r.endChar).toBe('line two with '.length + 'important'.length);
  });
});

// ─── analyze — mock provider responses ──────────────────────────────────────

describe('analyze with mock provider', () => {
  it('handles valid contradiction response', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [{
          instruction1: 'Be concise',
          instruction2: 'Provide detailed explanations',
          severity: 'warning',
          explanation: 'These conflict',
        }],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
      }),
    }));

    const results = await analyzer.analyze({ text: 'Be concise.\nProvide detailed explanations.' });
    const contradictions = results.filter(r => r.code === 'contradiction');
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0].range.start.line).toBe(0); // "Be concise" on line 0
  });

  it('handles empty LLM responses gracefully', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}' }));
    const results = await analyzer.analyze({ text: 'Simple prompt.' });
    expect(Array.isArray(results)).toBe(true);
  });

  it('handles malformed JSON responses gracefully', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: 'not valid json at all' }));
    const results = await analyzer.analyze({ text: 'Simple prompt.' });
    expect(results.some(r => r.code === 'llm-parse-error')).toBe(true);
    expect(results.some(r => r.severity === 'info')).toBe(true);
  });

  it('handles provider error responses gracefully', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}', error: 'Model unavailable' }));
    const results = await analyzer.analyze({ text: 'Simple prompt.' });
    expect(results.some(r => r.code === 'llm-error')).toBe(true);
    expect(results.some(r => r.severity === 'warning')).toBe(true);
    expect(results.some(r => r.message.includes('Model unavailable'))).toBe(true);
    expect(results.some(r => /\[\w[\w-]*\]/.test(r.message))).toBe(true);
  });

  it('handles provider rejection gracefully', async () => {
    const analyzer = makeAnalyzer(async () => { throw new Error('Network error'); });
    const results = await analyzer.analyze({ text: 'Simple prompt.' });
    expect(results.some(r => r.code === 'llm-error')).toBe(true);
    expect(results.some(r => r.message.includes('Network error'))).toBe(true);
  });

  it('produces persona inconsistency results', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [{
          description: 'Tone conflict',
          trait1: 'helpful',
          trait2: 'sarcastic',
          relevant_text: 'Respond with sarcasm',
          severity: 'warning',
          suggestion: 'Pick one tone',
        }],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
      }),
    }));

    const results = await analyzer.analyze({ text: 'You are a helpful assistant. Respond with sarcasm.' });
    expect(results.filter(r => r.code === 'persona-inconsistency').length).toBeGreaterThan(0);
  });

  it('produces ambiguity results and resolves line numbers', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [{
          text: 'be professional',
          type: 'term',
          severity: 'info',
          problem: 'Vague term',
          suggestion: 'Define what professional means',
        }],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
      }),
    }));

    const results = await analyzer.analyze({ text: 'Be professional in all responses.' });
    const ambiguity = results.filter(r => r.code === 'ambiguity-llm');
    expect(ambiguity.length).toBeGreaterThan(0);
    expect(ambiguity[0].range.start.line).toBe(0);
  });

  it('includes custom diagnostics results', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
        custom_diagnostics: [{
          title: 'Output Schema Validation',
          description: 'The prompt does not define the expected JSON schema for output.',
          relevant_text: 'Return output as JSON.',
          severity: 'warning',
          suggestion: 'Add a full JSON schema with required fields and types.',
        }],
      }),
    }));

    const results = await analyzer.analyze(
      { text: 'Return output as JSON.' },
      [{ name: 'Output Schema Validation', description: 'Flag missing explicit output schema requirements.' }],
    );
    const customDiags = results.filter(r => r.code === 'custom-diagnostic');
    expect(customDiags.length).toBeGreaterThan(0);
    expect(customDiags[0].severity).toBe('warning');
    expect(customDiags[0].range.start.line).toBe(0);
  });

  it('returns error diagnostics with phase name when a wave errors', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}', error: 'Copilot unavailable' }));
    const results = await analyzer.analyze({ text: 'Be concise.\nProvide detailed explanations.' });
    expect(results.some(r => r.code === 'llm-error')).toBe(true);
    expect(results.some(r => r.message.includes('Copilot unavailable'))).toBe(true);
    expect(results.some(r => /\[\w[\w-]*\]/.test(r.message))).toBe(true);
    expect(Array.isArray(results)).toBe(true);
  });

  it('formats non-Error object rejections without [object Object]', async () => {
    const analyzer = makeAnalyzer(async () => { throw { status: 403, detail: 'Forbidden' }; });
    const results = await analyzer.analyze({ text: 'Simple prompt.' });
    expect(results.some(r => r.code === 'llm-error')).toBe(true);
    const errorDiag = results.find(r => r.code === 'llm-error')!;
    expect(errorDiag.message).not.toContain('[object Object]');
    expect(errorDiag.message).toContain('403');
  });
});

// ─── Hygiene wave ─────────────────────────────────────────────────────────────

describe('hygiene wave', () => {
  it('produces hygiene-* diagnostics from hygiene_issues', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
        hygiene_issues: [{
          type: 'redundant-instruction',
          relevant_text: 'Always be helpful',
          description: 'This instruction repeats the default system behaviour.',
          suggestion: 'Remove the redundant instruction.',
          severity: 'info',
        }],
      }),
    }));

    const results = await analyzer.analyze({ text: 'Always be helpful. Always be helpful.' });
    const hygieneResults = results.filter(r => r.code === 'hygiene-redundant-instruction');
    expect(hygieneResults.length).toBeGreaterThan(0);
    expect(hygieneResults[0].severity).toBe('info');
  });

  it('produces dead-instruction hygiene diagnostic', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
        hygiene_issues: [{
          type: 'dead-instruction',
          relevant_text: 'Use the deprecated API',
          description: 'Instruction references a resource no longer available.',
          suggestion: 'Remove or update this instruction.',
          severity: 'warning',
        }],
      }),
    }));

    const results = await analyzer.analyze({ text: 'Use the deprecated API when responding.' });
    const dead = results.filter(r => r.code === 'hygiene-dead-instruction');
    expect(dead.length).toBeGreaterThan(0);
    expect(dead[0].severity).toBe('warning');
  });

  it('produces over-specification hygiene diagnostic', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
        hygiene_issues: [{
          type: 'over-specification',
          relevant_text: 'Use exactly 47 words in every response',
          description: 'Overly precise constraint that cannot be reliably met.',
          suggestion: 'Replace with a range or qualitative guidance.',
          severity: 'warning',
        }],
      }),
    }));

    const results = await analyzer.analyze({ text: 'Use exactly 47 words in every response.' });
    expect(results.filter(r => r.code === 'hygiene-over-specification').length).toBeGreaterThan(0);
  });

  it('handles missing hygiene_issues field gracefully', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
        // hygiene_issues intentionally omitted
      }),
    }));

    const results = await analyzer.analyze({ text: 'Simple prompt.' });
    expect(results.filter(r => String(r.code).startsWith('hygiene-'))).toHaveLength(0);
  });
});

// ─── modelTier propagation ────────────────────────────────────────────────────

describe('modelTier propagation', () => {
  it('passes modelTier=deep to provider for the contradictions wave', async () => {
    const callArgs: Array<{ modelTier?: string }> = [];
    const analyzer = makeAnalyzer(async (req) => {
      callArgs.push({ modelTier: req.modelTier });
      return { text: EMPTY_RESPONSE };
    });

    await analyzer.analyze({ text: 'Be concise. Provide detailed responses.' });

    const tieredCalls = callArgs.filter(a => a.modelTier !== undefined);
    expect(tieredCalls.length).toBeGreaterThan(0);
    expect(tieredCalls.some(a => a.modelTier === 'deep')).toBe(true);
  });
});

// ─── Wave isolation ──────────────────────────────────────────────────────────

describe('wave isolation', () => {
  it('returns results from healthy waves when contradictions wave errors', async () => {
    let callCount = 0;
    const analyzer = makeAnalyzer(async (req) => {
      callCount++;
      if (req.modelTier === 'deep' && callCount === 1) {
        return { text: '{}', error: 'Deep model quota exceeded' };
      }
      return {
        text: JSON.stringify({
          contradictions: [],
          ambiguity_issues: [{
            text: 'be professional',
            type: 'term',
            severity: 'info',
            problem: 'Vague',
            suggestion: 'Define professional',
          }],
          persona_issues: [],
          cognitive_load: { issues: [], overall_complexity: 'low' },
          coverage_analysis: {},
        }),
      };
    });

    const results = await analyzer.analyze({ text: 'Be professional in all responses.' });
    expect(Array.isArray(results)).toBe(true);
    expect(results.some(r => r.code === 'llm-error')).toBe(true);
  });
});

// ─── Analysis history / loop detection ──────────────────────────────────────

describe('analysis history and resilience', () => {
  let store: AnalysisHistoryStore;

  beforeEach(() => {
    store = new AnalysisHistoryStore();
  });

  it('parses skill metadata and extracts domain keywords from frontmatter', () => {
    const analyzer = new Analyzer({ complete: async () => ({ text: '{}' }) });

    const meta = (analyzer as any).parseSkillMetadata(
      '---\nname: Security Helper\ndescription: "API security deployment testing"\n---\nUse it carefully.',
    );

    expect(meta.isSkill).toBe(true);
    expect(meta.name).toBe('Security Helper');
    expect(meta.useCaseKeywords).toContain('api');
    expect(meta.useCaseKeywords).toContain('security');
    expect(meta.useCaseKeywords).toContain('testing');
  });

  it('returns no loop when history is empty or overlap is too low', () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}' }), store);

    expect((analyzer as any).detectLoops('new.md', []).isLoop).toBe(false);

    store.set('doc.md', {
      uri: 'doc.md',
      recommendations: [{ timestamp: 1, issueCode: 'ambiguity-llm', relevantText: 'Use it carefully', issueHash: 'x', severity: 'warning', suggestion: 'Tighten it' }],
      lastFingerprint: 'fp',
      skillMetadata: { useCaseKeywords: [], isSkill: false },
    });

    expect((analyzer as any).detectLoops('doc.md', [{ timestamp: 2, issueCode: 'hygiene-over-specification', relevantText: 'Never use this', issueHash: 'y', severity: 'info', suggestion: 'Remove it' }]).isLoop).toBe(false);
  });

  it('deduplicates repeated findings during the consolidation pass', () => {
    const analyzer = new Analyzer({ complete: async () => ({ text: '{}' }) });

    const deduped = (analyzer as any).runConsolidationPass([
      { code: 'ambiguity-llm', message: 'same finding', severity: 'warning', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, analyzer: 'test' },
      { code: 'ambiguity-llm', message: 'same finding', severity: 'warning', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, analyzer: 'test' },
      { code: 'contradiction', message: 'different finding', severity: 'warning', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, analyzer: 'test' },
    ]);

    expect(deduped.filter((r: any) => r.code === 'ambiguity-llm')).toHaveLength(1);
  });

  it('reads linked prompt files and ignores unreadable references', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}' }), store);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    const linkedFile = path.join(dir, 'linked.prompt.md');
    fs.writeFileSync(linkedFile, 'Linked instructions body', 'utf8');

    const linked = await (analyzer as any).readLinkedPromptFiles(`[Local](./linked.prompt.md)\n[Missing](./missing.prompt.md)`, path.join(dir, 'main.prompt.md'));

    expect(linked).toHaveLength(1);
    expect(linked[0].target).toBe('./linked.prompt.md');
    expect(linked[0].content).toContain('Linked instructions body');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects linked prompt files with path traversal (..)', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}' }), store);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    const mainFile = path.join(dir, 'main.prompt.md');

    const linked = await (analyzer as any).readLinkedPromptFiles(
      `[Evil](../etc/passwd.prompt.md)`,
      mainFile,
    );

    expect(linked).toHaveLength(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects linked prompt files with absolute paths', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}' }), store);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    const mainFile = path.join(dir, 'main.prompt.md');

    const linked = await (analyzer as any).readLinkedPromptFiles(
      `[Evil](/etc/passwd.prompt.md)`,
      mainFile,
    );

    expect(linked).toHaveLength(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects linked prompt files that are symlinks', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}' }), store);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    const realFile = path.join(dir, 'real.prompt.md');
    fs.writeFileSync(realFile, 'secret', 'utf8');
    const symlinkFile = path.join(dir, 'trick.prompt.md');
    fs.symlinkSync(realFile, symlinkFile);
    const mainFile = path.join(dir, 'main.prompt.md');

    const linked = await (analyzer as any).readLinkedPromptFiles(
      `[Trick](./trick.prompt.md)`,
      mainFile,
    );

    expect(linked).toHaveLength(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects linked prompt files that resolve outside the skill directory', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}' }), store);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    const subDir = path.join(dir, 'sub');
    fs.mkdirSync(subDir);
    const mainFile = path.join(subDir, 'main.prompt.md');

    // Write a file in the parent dir — path resolves outside subDir
    const outsideFile = path.join(dir, 'outside.prompt.md');
    fs.writeFileSync(outsideFile, 'escaped content', 'utf8');

    const linked = await (analyzer as any).readLinkedPromptFiles(
      `[Outside](../outside.prompt.md)`,
      mainFile,
    );

    expect(linked).toHaveLength(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('recovers truncated JSON arrays via salvageTruncatedJSON', () => {
    const analyzer = new Analyzer({ complete: async () => ({ text: '{}' }) });

    const truncated = '```json\n{"ambiguity_issues": [{"text":"one"},{"text":"two"}';
    const recovered = (analyzer as any).salvageTruncatedJSON(truncated);

    expect(recovered).toEqual({ ambiguity_issues: [{ text: 'one' }, { text: 'two' }] });
  });

  it('flags repeated recommendations as a loop using stored history', () => {
    const analyzer = makeAnalyzer(async () => ({ text: '{}' }), store);

    store.set('doc.md', {
      uri: 'doc.md',
      recommendations: [
        {
          timestamp: 1,
          issueCode: 'ambiguity-llm',
          relevantText: 'Use it carefully',
          issueHash: 'abc123',
          severity: 'warning',
          suggestion: 'Tighten it',
        },
      ],
      lastFingerprint: 'fp',
      skillMetadata: { useCaseKeywords: [], isSkill: false },
    });

    const loop = (analyzer as any).detectLoops('doc.md', [
      {
        timestamp: 2,
        issueCode: 'ambiguity-llm',
        relevantText: 'Use it carefully',
        issueHash: 'abc123',
        severity: 'warning',
        suggestion: 'Tighten it',
      },
    ]);

    expect(loop.isLoop).toBe(true);
    expect(loop.explanation).toContain('match');
  });

  it('updates stored history fingerprints across analyzes', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: EMPTY_RESPONSE }), store);

    await analyzer.analyze({ text: 'Be concise.', filePath: '/tmp/doc.md' });

    const history = store.get('/tmp/doc.md')!;

    expect(history).toBeDefined();
    expect(history.recommendations.length).toBeGreaterThanOrEqual(0);
    expect(typeof history.lastFingerprint).toBe('string');
  });

  it('second analyze call on same doc does not throw', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: EMPTY_RESPONSE }), store);

    await analyzer.analyze({ text: 'You are a helpful assistant.', filePath: '/test/doc.md' });
    await expect(analyzer.analyze({ text: 'You are a helpful assistant.', filePath: '/test/doc.md' })).resolves.toBeDefined();
  });

  it('analyze calls provider multiple times (one per wave)', async () => {
    const mockFn = vi.fn().mockResolvedValue({ text: EMPTY_RESPONSE });
    const analyzer = new Analyzer({ complete: mockFn }, store);

    await analyzer.analyze({ text: 'You are an assistant.' });
    expect(mockFn.mock.calls.length).toBeGreaterThan(1);
  });
});

// ─── Persona wave ─────────────────────────────────────────────────────────────

describe('persona wave', () => {
  it('extracts persona-inconsistency results from persona_issues', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [{
          description: 'Tone shift',
          trait1: 'formal',
          trait2: 'casual',
          relevant_text: 'Write casually to users',
          severity: 'info',
          suggestion: 'Standardise the tone.',
        }],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
      }),
    }));

    const results = await analyzer.analyze({ text: 'You must always write formally.\nWrite casually to users.' });
    const persona = results.filter(r => r.code === 'persona-inconsistency');
    expect(persona.length).toBeGreaterThan(0);
    expect(persona[0].analyzer).toBe('persona-consistency');
    expect(persona[0].severity).toBe('info');
    expect(persona[0].range.start.line).toBe(1);
  });

  it('handles multiple persona issues', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [
          {
            description: 'Voice conflict',
            trait1: 'first-person',
            trait2: 'third-person',
            relevant_text: 'The system handles it',
            severity: 'warning',
            suggestion: 'Use consistent voice.',
          },
          {
            description: 'Register clash',
            trait1: 'technical',
            trait2: 'informal',
            relevant_text: 'just chill and vibe',
            severity: 'info',
            suggestion: 'Pick a register.',
          },
        ],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
      }),
    }));

    const results = await analyzer.analyze({
      text: 'The system handles it\njust chill and vibe',
    });
    const persona = results.filter(r => r.code === 'persona-inconsistency');
    expect(persona.length).toBe(2);
    expect(persona[0].severity).toBe('warning');
    expect(persona[1].severity).toBe('info');
  });

  it('skips persona issues whose relevant_text cannot be located', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [{
          description: 'Ghost trait',
          trait1: 'a',
          trait2: 'b',
          relevant_text: 'text that does not appear anywhere',
          severity: 'warning',
          suggestion: 'Fix it.',
        }],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
      }),
    }));

    const results = await analyzer.analyze({ text: 'No matching content here.' });
    expect(results.filter(r => r.code === 'persona-inconsistency')).toHaveLength(0);
  });
});

// ─── Structural (cognitive load) wave ─────────────────────────────────────────

describe('structural wave', () => {
  it('produces high-complexity diagnostic for very-high overall_complexity', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: {
          overall_complexity: 'very-high',
          issues: [],
        },
        coverage_analysis: {},
      }),
    }));

    const results = await analyzer.analyze({ text: 'A very long and complex prompt...' });
    const highComplexity = results.filter(r => r.code === 'high-complexity');
    expect(highComplexity.length).toBe(1);
    expect(highComplexity[0].severity).toBe('warning');
    expect(highComplexity[0].analyzer).toBe('cognitive-load');
    expect(highComplexity[0].range.start.line).toBe(0);
  });

  it('produces cognitive-* diagnostics for individual cognitive issues', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: {
          overall_complexity: 'high',
          issues: [{
            type: 'nested-conditions',
            description: 'Deeply nested if-then logic',
            relevant_text: 'If A then if B then if C',
            severity: 'warning',
            suggestion: 'Flatten conditions.',
          }],
        },
        coverage_analysis: {},
      }),
    }));

    const results = await analyzer.analyze({ text: 'If A then if B then if C do something.' });
    const cogResults = results.filter(r => String(r.code).startsWith('cognitive-'));
    expect(cogResults.length).toBe(1);
    expect(cogResults[0].code).toBe('cognitive-nested-conditions');
    expect(cogResults[0].severity).toBe('warning');
    expect(cogResults[0].analyzer).toBe('cognitive-load');
    expect(cogResults[0].range.start.line).toBe(0);
  });

  it('skips cognitive issues whose relevant_text cannot be found', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: {
          overall_complexity: 'medium',
          issues: [{
            type: 'sequencing',
            description: 'Unclear ordering',
            relevant_text: 'nonexistent target text',
            severity: 'info',
            suggestion: 'Add step numbers.',
          }],
        },
        coverage_analysis: {},
      }),
    }));

    const results = await analyzer.analyze({ text: 'Simple prompt.' });
    expect(results.filter(r => String(r.code).startsWith('cognitive-'))).toHaveLength(0);
    // overall_complexity is 'medium', so no high-complexity diagnostic either
    expect(results.filter(r => r.code === 'high-complexity')).toHaveLength(0);
  });

  it('does not produce high-complexity when overall_complexity is not very-high', async () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      const analyzer = makeAnalyzer(async () => ({
        text: JSON.stringify({
          contradictions: [],
          ambiguity_issues: [],
          persona_issues: [],
          cognitive_load: { overall_complexity: level, issues: [] },
          coverage_analysis: {},
        }),
      }));

      const results = await analyzer.analyze({ text: 'Simple prompt.' });
      expect(results.filter(r => r.code === 'high-complexity')).toHaveLength(0);
    }
  });
});

// ─── Coverage wave ────────────────────────────────────────────────────────────

describe('coverage wave', () => {
  it('produces limited-coverage diagnostic for limited overall_coverage', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {
          overall_coverage: 'limited',
          coverage_gaps: [],
        },
      }),
    }));

    const results = await analyzer.analyze({ text: 'Short prompt.' });
    const limited = results.filter(r => r.code === 'limited-coverage');
    expect(limited.length).toBe(1);
    expect(limited[0].severity).toBe('warning');
    expect(limited[0].analyzer).toBe('semantic-coverage');
  });

  it('produces limited-coverage diagnostic for minimal overall_coverage', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {
          overall_coverage: 'minimal',
          coverage_gaps: [],
        },
      }),
    }));

    const results = await analyzer.analyze({ text: 'Short prompt.' });
    expect(results.filter(r => r.code === 'limited-coverage').length).toBe(1);
  });

  it('produces coverage-gap diagnostics for medium and high impact gaps', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {
          overall_coverage: 'adequate',
          coverage_gaps: [
            {
              gap: 'No error handling specified',
              relevant_text: 'Return the result as JSON.',
              impact: 'high',
              suggestion: 'Add error handling guidance.',
            },
            {
              gap: 'No output format defined',
              relevant_text: 'Return the result as JSON.',
              impact: 'medium',
              suggestion: 'Define the output schema.',
            },
            {
              gap: 'Minor style nit',
              relevant_text: 'Be clear.',
              impact: 'low',
              suggestion: 'N/A',
            },
          ],
        },
      }),
    }));

    const results = await analyzer.analyze({ text: 'Return the result as JSON.' });
    const gaps = results.filter(r => r.code === 'coverage-gap');
    // low-impact gaps are filtered out by the processor
    expect(gaps.length).toBe(2);
    expect(gaps[0].severity).toBe('warning'); // high impact
    expect(gaps[1].severity).toBe('info');     // medium impact
    expect(gaps[0].analyzer).toBe('semantic-coverage');
  });

  it('does not produce limited-coverage when overall_coverage is comprehensive or adequate', async () => {
    for (const level of ['comprehensive', 'adequate'] as const) {
      const analyzer = makeAnalyzer(async () => ({
        text: JSON.stringify({
          contradictions: [],
          ambiguity_issues: [],
          persona_issues: [],
          cognitive_load: { issues: [], overall_complexity: 'low' },
          coverage_analysis: {
            overall_coverage: level,
            coverage_gaps: [],
          },
        }),
      }));

      const results = await analyzer.analyze({ text: 'Adequate prompt.' });
      expect(results.filter(r => r.code === 'limited-coverage')).toHaveLength(0);
    }
  });

  it('skips coverage gaps whose relevant_text cannot be located', async () => {
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {
          overall_coverage: 'limited',
          coverage_gaps: [{
            gap: 'Missing edge case',
            relevant_text: 'text that does not exist in the doc',
            impact: 'high',
            suggestion: 'Add it.',
          }],
        },
      }),
    }));

    const results = await analyzer.analyze({ text: 'Simple prompt.' });
    // limited-coverage fires, but coverage-gap does not (anchor not found)
    expect(results.filter(r => r.code === 'limited-coverage').length).toBe(1);
    expect(results.filter(r => r.code === 'coverage-gap')).toHaveLength(0);
  });
});

// ─── analyze — enabledWaves filtering ───────────────────────────────────────

describe('analyze — enabledWaves filtering', () => {
  it('only calls provider for the specified wave when enabledWaves is set', async () => {
    let callCount = 0;
    const analyzer = makeAnalyzer(async () => {
      callCount++;
      return { text: EMPTY_RESPONSE };
    });

    // All waves (no enabledWaves filter)
    callCount = 0;
    await analyzer.analyze({ text: 'Be concise.' });
    const allWavesCalls = callCount;

    // Single wave only — disabled waves must not start, so fewer LLM calls
    callCount = 0;
    await analyzer.analyze({ text: 'Be concise.' }, undefined, ['ambiguities']);
    const singleWaveCalls = callCount;

    expect(singleWaveCalls).toBeLessThan(allWavesCalls);
  });

  it('runs all waves when enabledWaves is empty', async () => {
    let callCount = 0;
    const analyzer = makeAnalyzer(async () => {
      callCount++;
      return { text: EMPTY_RESPONSE };
    });

    await analyzer.analyze(
      { text: 'Be concise.' },
      undefined,
      [], // empty → all waves run
    );

    // 6 named waves + composition-conflicts = at least 6 LLM calls
    expect(callCount).toBeGreaterThanOrEqual(6);
  });

  it('returns only results from the requested wave', async () => {
    const analyzer = makeAnalyzer(async (req) => {
      const sys = req.systemPrompt ?? '';
      if (sys.includes('ambigui')) {
        return {
          text: JSON.stringify({
            ambiguity_issues: [{
              text: 'be professional',
              type: 'term',
              severity: 'warning',
              problem: 'Vague',
              suggestion: 'Define it',
            }],
          }),
        };
      }
      return { text: EMPTY_RESPONSE };
    });

    const results = await analyzer.analyze(
      { text: 'Be professional.' },
      undefined,
      ['ambiguities'],
    );

    expect(results.filter(r => r.code === 'ambiguity-llm').length).toBeGreaterThan(0);
    expect(results.filter(r => r.code === 'contradiction')).toHaveLength(0);
  });
});

// ─── analyze — cancellation ───────────────────────────────────────────────────

describe('analyze — cancellation', () => {
  it('returns empty array when token is already cancelled before analysis starts', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: EMPTY_RESPONSE }));
    const token = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose: () => {} }) };

    const results = await analyzer.analyze({ text: 'Be concise.', token });

    expect(results).toHaveLength(0);
  });

  it('returns empty array when token is cancelled mid-analysis', async () => {
    let resolveFirst: () => void;
    const firstCallDone = new Promise<void>(r => { resolveFirst = r; });
    let cancelled = false;

    const analyzer = makeAnalyzer(async () => {
      await firstCallDone;
      return { text: EMPTY_RESPONSE };
    });

    const token = {
      get isCancellationRequested() { return cancelled; },
      onCancellationRequested: () => ({ dispose: () => {} }),
    };

    const promise = analyzer.analyze({ text: 'Be concise.', token });
    cancelled = true;
    resolveFirst!();

    const results = await promise;
    expect(results).toHaveLength(0);
  });
});

// ─── analyze — loop detection (end-to-end) ────────────────────────────────────

describe('analyze — loop detection end-to-end', () => {
  it('adds llm-loop-detected on second call with identical findings', async () => {
    const store = new AnalysisHistoryStore();
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [{
          text: 'be professional',
          type: 'term',
          severity: 'warning',
          problem: 'Vague',
          suggestion: 'Define it',
        }],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
        hygiene_issues: [],
      }),
    }), store);

    const docPath = '/tmp/loop-test.md';
    const text = 'Be professional in all responses.';

    await analyzer.analyze({ text, filePath: docPath });
    const second = await analyzer.analyze({ text, filePath: docPath });

    expect(second.some(r => r.code === 'llm-loop-detected')).toBe(true);
  });

  it('does not flag a loop on the first call', async () => {
    const store = new AnalysisHistoryStore();
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [{
          text: 'be concise',
          type: 'term',
          severity: 'info',
          problem: 'Vague',
          suggestion: 'Define it',
        }],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
        hygiene_issues: [],
      }),
    }), store);

    const results = await analyzer.analyze({ text: 'Be concise.', filePath: '/tmp/no-loop.md' });
    expect(results.some(r => r.code === 'llm-loop-detected')).toBe(false);
  });
});

// ─── analyze — acceptedFindingsPath pipeline ─────────────────────────────────
//
// Regression suite for the reference-aliasing bug where filterAcceptedResults
// returned the *same* array reference as `results`, causing `results.length = 0`
// to wipe both arrays and the pipeline to return 0 results.

describe('analyze — acceptedFindingsPath pipeline', () => {
  const tmpDir = path.join(os.tmpdir(), 'analyzer-accepted-findings-test');

  beforeEach(() => { fs.mkdirSync(tmpDir, { recursive: true }); });
  afterEach(() => {
    try {
      for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch { /* ignore */ }
  });

  function tmpStorePath() {
    return path.join(tmpDir, `store-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  }

  /** Provider that always returns one ambiguity issue. */
  function makeAmbiguityProvider(): (req: LlmRequest) => Promise<LlmResponse> {
    return async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [{
          text: 'be professional',
          type: 'term',
          severity: 'warning',
          problem: 'Vague term',
          suggestion: 'Define what professional means',
        }],
        persona_issues: [],
        cognitive_load: { issues: [], overall_complexity: 'low' },
        coverage_analysis: {},
        hygiene_issues: [],
      }),
    });
  }

  it('preserves results when acceptedFindingsPath points to a non-existent file (regression)', async () => {
    // Bug: filterAcceptedResults returned `results` by reference when the store
    // file did not exist.  The subsequent `results.length = 0` wiped both arrays.
    const analyzer = makeAnalyzer(makeAmbiguityProvider());
    const storePath = tmpStorePath(); // file does not exist yet

    const results = await analyzer.analyze({
      text: 'Be professional in all responses.',
      filePath: '/workspace/test.md',
      acceptedFindingsPath: storePath,
    });

    expect(results.length).toBeGreaterThan(0);
  });

  it('preserves results when store exists but has no entries for the file (regression)', async () => {
    const storePath = tmpStorePath();
    fs.writeFileSync(storePath, JSON.stringify({ entries: {} }), 'utf8');

    const analyzer = makeAnalyzer(makeAmbiguityProvider());
    const results = await analyzer.analyze({
      text: 'Be professional in all responses.',
      filePath: '/workspace/test.md',
      acceptedFindingsPath: storePath,
    });

    expect(results.length).toBeGreaterThan(0);
  });

  it('suppresses results that match an accepted finding', async () => {
    const storePath = tmpStorePath();
    fs.writeFileSync(storePath, JSON.stringify({
      entries: {
        '/workspace/test.md': [{
          code: 'ambiguity-llm',
          textPattern: 'be professional',
          acceptedAt: '2026-06-27',
          reason: 'accepted by user',
        }],
      },
    }), 'utf8');

    const analyzer = makeAnalyzer(makeAmbiguityProvider());
    const results = await analyzer.analyze({
      text: 'Be professional in all responses.',
      filePath: '/workspace/test.md',
      acceptedFindingsPath: storePath,
    });

    expect(results.filter(r => r.code === 'ambiguity-llm')).toHaveLength(0);
  });

  it('preserves non-matching results when some are suppressed', async () => {
    // Provider returns two issues: ambiguity-llm (suppressed) + structural (not suppressed).
    const analyzer = makeAnalyzer(async () => ({
      text: JSON.stringify({
        contradictions: [],
        ambiguity_issues: [{
          text: 'be professional',
          type: 'term',
          severity: 'warning',
          problem: 'Vague',
          suggestion: 'Define it',
        }],
        persona_issues: [],
        cognitive_load: {
          issues: [{ type: 'delegated-decision', description: 'Let the user decide', relevant_text: 'decide how', severity: 'info' }],
          overall_complexity: 'medium',
        },
        coverage_analysis: {},
        hygiene_issues: [],
      }),
    }));

    const storePath = tmpStorePath();
    fs.writeFileSync(storePath, JSON.stringify({
      entries: {
        '/workspace/test.md': [{
          code: 'ambiguity-llm',
          textPattern: 'be professional',
          acceptedAt: '2026-06-27',
          reason: 'accepted',
        }],
      },
    }), 'utf8');

    const results = await analyzer.analyze({
      text: 'Be professional.\nDecide how to respond.',
      filePath: '/workspace/test.md',
      acceptedFindingsPath: storePath,
    });

    expect(results.filter(r => r.code === 'ambiguity-llm')).toHaveLength(0);
    // Other result codes should still be present
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── Engine analysisMode routing ─────────────────────────────────────────────
//
// Verifies that Engine.analyze() correctly routes to the right execution path
// based on the analysisMode config: single (1 combined call), focused (2 calls),
// and multiWave (all waves).

import { Engine } from './index';
import type { EngineConfig } from './types';
import { DEFAULT_ENGINE_CONFIG } from './types';

function makeEngine(fn: (req: LlmRequest) => Promise<LlmResponse>, modeOverrides: Partial<EngineConfig> = {}): Engine {
  const provider: LlmProvider = { complete: fn };
  return new Engine(provider, { ...DEFAULT_ENGINE_CONFIG, ...modeOverrides });
}

describe('Engine — analysisMode routing', () => {
  const COMBINED_RESPONSE = JSON.stringify({
    contradictions: [{ instruction1: 'Be concise', instruction2: 'Be detailed', severity: 'warning', explanation: 'conflict' }],
    ambiguity_issues: [{ text: 'be professional', type: 'term', severity: 'warning', problem: 'vague', suggestion: 'define it' }],
    persona_issues: [],
    cognitive_load: { issues: [], overall_complexity: 'low' },
    coverage_analysis: { overall_coverage: 'adequate', coverage_gaps: [] },
    hygiene_issues: [],
  });

  it('single mode: issues one LLM call regardless of document size', async () => {
    let callCount = 0;
    const engine = makeEngine(async () => { callCount++; return { text: COMBINED_RESPONSE }; }, { analysisMode: 'single' });
    await engine.analyze({ text: 'Be concise. Be detailed.' });
    expect(callCount).toBe(1);
  });

  it('single mode: processes all six response categories from one call', async () => {
    const engine = makeEngine(async () => ({ text: COMBINED_RESPONSE }), { analysisMode: 'single' });
    const results = await engine.analyze({ text: 'Be concise. Be detailed. Be professional.' });
    expect(results.some(r => r.code === 'contradiction')).toBe(true);
    expect(results.some(r => r.code === 'ambiguity-llm')).toBe(true);
  });

  it('single mode: returns empty array on LLM error, not a throw', async () => {
    const engine = makeEngine(async () => { throw new Error('network error'); }, { analysisMode: 'single' });
    const results = await engine.analyze({ text: 'Simple prompt.' });
    expect(results.some(r => r.code === 'llm-error')).toBe(true);
  });

  it('focused mode: makes exactly 2 LLM calls (contradictions + ambiguities)', async () => {
    let callCount = 0;
    const engine = makeEngine(async () => { callCount++; return { text: EMPTY_RESPONSE }; }, { analysisMode: 'focused' });
    await engine.analyze({ text: 'Be concise.' });
    expect(callCount).toBe(2);
  });

  it('focused mode: returns results from both high-signal waves', async () => {
    const engine = makeEngine(async () => ({
      text: JSON.stringify({
        contradictions: [{ instruction1: 'A', instruction2: 'B', severity: 'warning', explanation: 'conflict' }],
        ambiguity_issues: [{ text: 'vague', type: 'term', severity: 'info', problem: 'unclear', suggestion: 'fix' }],
      }),
    }), { analysisMode: 'focused' });
    // Two-line text keeps the contradiction and ambiguity findings on
    // different lines so the cross-wave dedup post-processor (Rule 11)
    // does not collapse them into a single finding.
    const results = await engine.analyze({ text: 'A. B.\nSomething vague here.' });
    expect(results.some(r => r.code === 'contradiction')).toBe(true);
    expect(results.some(r => r.code === 'ambiguity-llm')).toBe(true);
  });

  it('focused mode: does not run persona, structural, coverage, or hygiene waves', async () => {
    let callCount = 0;
    const engine = makeEngine(async () => { callCount++; return { text: EMPTY_RESPONSE }; }, { analysisMode: 'focused' });
    await engine.analyze({ text: 'Simple prompt.' });
    // Only contradictions + ambiguities = 2 calls (composition-conflicts skipped — no filePath)
    expect(callCount).toBe(2);
  });

  it('multiWave mode: makes more LLM calls than focused mode', async () => {
    let focusedCalls = 0;
    let multiCalls = 0;

    const focusedEngine = makeEngine(async () => { focusedCalls++; return { text: EMPTY_RESPONSE }; }, { analysisMode: 'focused' });
    await focusedEngine.analyze({ text: 'Simple prompt.' });

    const multiEngine = makeEngine(async () => { multiCalls++; return { text: EMPTY_RESPONSE }; }, { analysisMode: 'multiWave' });
    await multiEngine.analyze({ text: 'Simple prompt.' });

    expect(multiCalls).toBeGreaterThan(focusedCalls);
  });

  it('enabledWavesOverride takes precedence over analysisMode', async () => {
    let callCount = 0;
    // Even with single mode, an explicit override should use the wave path
    const engine = makeEngine(async () => { callCount++; return { text: EMPTY_RESPONSE }; }, { analysisMode: 'single' });
    await engine.analyze({ text: 'Simple prompt.' }, undefined, ['ambiguities']);
    // Override bypasses single-mode path → uses wave runner for ambiguities only
    expect(callCount).toBe(1);
  });
});
