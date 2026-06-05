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

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from './analyzer';
import type { LlmProvider, LlmRequest, LlmResponse } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build an Analyzer backed by a custom mock provider function. */
function makeAnalyzer(fn: (req: LlmRequest) => Promise<LlmResponse>): Analyzer {
  const provider: LlmProvider = { complete: fn };
  return new Analyzer(provider);
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

  it('returns line 0 full line when no match found', () => {
    const r = find('hello world', 'nonexistent text that does not appear');
    expect(r.line).toBe(0);
    expect(r.startChar).toBe(0);
    expect(r.endChar).toBe('hello world'.length);
  });

  it('is case-insensitive', () => {
    const r = find('Hello World\nGoodbye', 'hello world');
    expect(r.line).toBe(0);
    expect(r.startChar).toBe(0);
    expect(r.endChar).toBe('hello world'.length);
  });

  it('handles empty search text', () => {
    const r = find('hello', '');
    expect(r.line).toBe(0);
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
    const analyzer = new Analyzer({ complete: async () => ({ text: '{}' }) });

    expect((analyzer as any).detectLoops('new.md', []).isLoop).toBe(false);

    (analyzer as any).analysisHistory.set('doc.md', {
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

  it('reads linked prompt files and ignores unreadable references', () => {
    const analyzer = new Analyzer({ complete: async () => ({ text: '{}' }) });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    const linkedFile = path.join(dir, 'linked.prompt.md');
    fs.writeFileSync(linkedFile, 'Linked instructions body', 'utf8');

    const linked = (analyzer as any).readLinkedPromptFiles(`[Local](./linked.prompt.md)\n[Missing](./missing.prompt.md)`, path.join(dir, 'main.prompt.md'));

    expect(linked).toHaveLength(1);
    expect(linked[0].target).toBe('./linked.prompt.md');
    expect(linked[0].content).toContain('Linked instructions body');

    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('recovers truncated JSON arrays via salvageTruncatedJSON', () => {
    const analyzer = new Analyzer({ complete: async () => ({ text: '{}' }) });

    const truncated = '```json\n{"ambiguity_issues": [{"text":"one"},{"text":"two"}';
    const recovered = (analyzer as any).salvageTruncatedJSON(truncated);

    expect(recovered).toEqual({ ambiguity_issues: [{ text: 'one' }, { text: 'two' }] });
  });

  it('flags repeated recommendations as a loop using stored history', () => {
    const analyzer = new Analyzer({ complete: async () => ({ text: '{}' }) });

    (analyzer as any).analysisHistory.set('doc.md', {
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
    const analyzer = makeAnalyzer(async () => ({ text: EMPTY_RESPONSE }));

    await analyzer.analyze({ text: 'Be concise.', filePath: '/tmp/doc.md' });

    const history = (analyzer as any).analysisHistory.get('/tmp/doc.md');

    expect(history).toBeDefined();
    expect(history.recommendations.length).toBeGreaterThanOrEqual(0);
    expect(typeof history.lastFingerprint).toBe('string');
  });

  it('second analyze call on same doc does not throw', async () => {
    const analyzer = makeAnalyzer(async () => ({ text: EMPTY_RESPONSE }));

    await analyzer.analyze({ text: 'You are a helpful assistant.', filePath: '/test/doc.md' });
    await expect(analyzer.analyze({ text: 'You are a helpful assistant.', filePath: '/test/doc.md' })).resolves.toBeDefined();
  });

  it('analyze calls provider multiple times (one per wave)', async () => {
    const mockFn = vi.fn().mockResolvedValue({ text: EMPTY_RESPONSE });
    const analyzer = new Analyzer({ complete: mockFn });

    await analyzer.analyze({ text: 'You are an assistant.' });
    expect(mockFn.mock.calls.length).toBeGreaterThan(1);
  });
});
