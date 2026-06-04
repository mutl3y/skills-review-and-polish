import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Engine } from './index';
import { Analyzer } from './analyzer';
import { SurgicalFixer } from './fixer';
import type { AnalysisResult, LlmProvider } from './types';

const provider: LlmProvider = { complete: async () => ({ text: '' }) };

function makeResult(code: string, severity: AnalysisResult['severity'] = 'warning'): AnalysisResult {
  return {
    code,
    message: code,
    severity,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    analyzer: 'test',
  };
}

describe('Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates analysis to the analyzer with the supplied input', async () => {
    const spy = vi.spyOn(Analyzer.prototype, 'analyze').mockResolvedValue([makeResult('ambiguity-llm')]);
    const engine = new Engine(provider);

    const results = await engine.analyze({ text: 'Use this carefully.', filePath: '/tmp/test.md' });

    expect(spy).toHaveBeenCalledWith({ text: 'Use this carefully.', filePath: '/tmp/test.md' }, undefined);
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe('ambiguity-llm');
  });

  it('scores a document using the current skill type and line count', async () => {
    const spy = vi.spyOn(Analyzer.prototype, 'analyze').mockResolvedValue([
      makeResult('ambiguity-llm', 'warning'),
      makeResult('coverage-gap', 'error'),
    ]);
    const engine = new Engine(provider);

    const scored = await engine.score({ text: '---\ntype: workflow\n---\nBody' });

    expect(spy).toHaveBeenCalled();
    expect(scored.skillType).toBe('workflow');
    expect(scored.lineCount).toBe(4);
    expect(scored.penalty).toBeGreaterThanOrEqual(0);
  });

  it('passes surgical fix options through to the fixer', async () => {
    const spy = vi.spyOn(SurgicalFixer.prototype, 'fixDocument').mockResolvedValue({ fixedText: 'fixed', applied: 1, skipped: 0 });
    const engine = new Engine(provider, {
      analysisMode: 'single',
      enabledWaves: ['contradictions'],
      scoreSamples: 1,
      fixStrategy: 'additive',
      fixSemanticCheck: true,
      fixSelfCritique: true,
      fixReferenceGrounding: false,
    });

    await engine.surgicalFix({ text: 'Use it carefully.', filePath: '/tmp/test.md' }, [makeResult('ambiguity-llm')], { additive: true });

    expect(spy).toHaveBeenCalledWith(
      'Use it carefully.',
      '/tmp/test.md',
      [expect.objectContaining({ code: 'ambiguity-llm' })],
      expect.objectContaining({
        additive: true,
        semanticCheck: true,
        selfCritique: true,
        referenceGrounding: false,
      }),
    );
  });
});
