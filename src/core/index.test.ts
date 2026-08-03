import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Engine } from './index';
import { Analyzer } from './analyzer';
import { SurgicalFixer } from './fixer';
import type { AnalysisResult, LlmProvider } from './types';

const provider: LlmProvider = { complete: async () => ({ text: '' }), getContextLength: () => undefined };

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

    expect(spy).toHaveBeenCalledWith(
      { text: 'Use this carefully.', filePath: '/tmp/test.md' },
      undefined,
      ['contradictions', 'ambiguities'],
      expect.objectContaining({ filterFindings: true }),
    );
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

  it('uses the median penalty when scoreSamples is greater than one', async () => {
    const spy = vi.spyOn(Analyzer.prototype, 'analyze')
      .mockResolvedValueOnce([makeResult('ambiguity-llm', 'warning')])
      .mockResolvedValueOnce([
        makeResult('ambiguity-llm', 'warning'),
        makeResult('coverage-gap', 'warning'),
      ])
      .mockResolvedValueOnce([
        makeResult('contradiction', 'error'),
        makeResult('coverage-gap', 'warning'),
        makeResult('hygiene-dead-instruction', 'info'),
      ]);
    const engine = new Engine(provider, {
      analysisMode: 'multiWave',
      enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
      scoreSamples: 3,
      fixStrategy: 'subtractive',
      fixSemanticCheck: false,
      fixSelfCritique: false,
      fixReferenceGrounding: true,
    });

    const scored = await engine.score({ text: 'Body' });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Body', skipLoopDetection: true }),
      undefined,
      ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
      expect.objectContaining({ scoreSamples: 3 }),
    );
    expect(scored.penalty).toBe(12);
    expect(scored.total).toBe(2);
  });

  it('passes surgical fix options through to the fixer', async () => {
    const spy = vi.spyOn(SurgicalFixer.prototype, 'fixDocument').mockResolvedValue({ fixedText: 'fixed', applied: 1, skipped: 0, skippedReasons: [] });
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
      expect.objectContaining({
        upperBoundMultiplier: undefined,
        lowerBoundMultiplier: undefined,
        maxAnchorChars: undefined,
      }),
    );
  });

  // ── analysisWaves override (E21) ─────────────────────────────────────────
  // The `analysisWaves` config field is a direct per-call wave list that
  // bypasses the `analysisMode` switch. See
  // `.github/experiments/documentation-review/notes/e21-analysisWaves-api.md`.

  it('analysisWaves: [hygiene] fires only the hygiene wave', async () => {
    const spy = vi.spyOn(Analyzer.prototype, 'analyze').mockResolvedValue([makeResult('hygiene-circular-definition')]);
    const engine = new Engine(provider, {
      analysisMode: 'multiWave',
      enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
      scoreSamples: 1,
      fixStrategy: 'subtractive',
      fixSemanticCheck: false,
      fixSelfCritique: false,
      fixReferenceGrounding: true,
      analysisWaves: ['hygiene'],
    });

    const results = await engine.analyze({ text: 'Body', filePath: '/tmp/test.md' });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Body', filePath: '/tmp/test.md' }),
      undefined,
      ['hygiene'],
      expect.objectContaining({ analysisWaves: ['hygiene'] }),
    );
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe('hygiene-circular-definition');
  });

  it('analysisWaves: [cognitive_load family proxies] fires both cognitive_load and persona waves', async () => {
    // Note: there is no wave literally called 'cognitive_load' — the cognitive
    // codes are emitted by the 'structural' wave. This test mirrors the
    // realistic use case: "fire the two waves that contain the cognitive_load
    // and persona families in one call".
    const spy = vi.spyOn(Analyzer.prototype, 'analyze').mockResolvedValue([
      makeResult('cognitive-load'),
      makeResult('persona-inconsistency'),
    ]);
    const engine = new Engine(provider, {
      analysisMode: 'multiWave',
      enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
      scoreSamples: 1,
      fixStrategy: 'subtractive',
      fixSemanticCheck: false,
      fixSelfCritique: false,
      fixReferenceGrounding: true,
      analysisWaves: ['structural', 'persona'],
    });

    const results = await engine.analyze({ text: 'Body', filePath: '/tmp/test.md' });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Body', filePath: '/tmp/test.md' }),
      undefined,
      ['structural', 'persona'],
      expect.objectContaining({ analysisWaves: ['structural', 'persona'] }),
    );
    expect(results.map(r => r.code).sort()).toEqual(['cognitive-load', 'persona-inconsistency']);
  });

  it('analysisWaves: undefined falls back to the existing analysisMode logic', async () => {
    // analysisMode: 'multiWave' with all 6 enabledWaves should still pass the
    // full list to analyzer.analyze when analysisWaves is undefined.
    const spy = vi.spyOn(Analyzer.prototype, 'analyze').mockResolvedValue([makeResult('ambiguity-llm')]);
    const engine = new Engine(provider, {
      analysisMode: 'multiWave',
      enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
      scoreSamples: 1,
      fixStrategy: 'subtractive',
      fixSemanticCheck: false,
      fixSelfCritique: false,
      fixReferenceGrounding: true,
      // analysisWaves intentionally omitted
    });

    await engine.analyze({ text: 'Body', filePath: '/tmp/test.md' });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Body', filePath: '/tmp/test.md' }),
      undefined,
      ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
      expect.not.objectContaining({ analysisWaves: expect.anything() }),
    );
  });

  it('analysisMode single uses the finalized single-pass analyzer path', async () => {
    const singlePassSpy = vi.spyOn(Analyzer.prototype, 'analyzeSinglePass').mockResolvedValue([makeResult('ambiguity-llm')]);
    const rawSinglePassSpy = vi.spyOn(Analyzer.prototype, 'analyzeSinglePassWave').mockResolvedValue([makeResult('raw-single-pass')]);
    const multiWaveSpy = vi.spyOn(Analyzer.prototype, 'analyze').mockResolvedValue([]);
    const engine = new Engine(provider, {
      analysisMode: 'single',
      enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
      scoreSamples: 1,
      fixStrategy: 'subtractive',
      fixSemanticCheck: false,
      fixSelfCritique: false,
      fixReferenceGrounding: true,
      filterFindings: true,
    });

    const results = await engine.analyze({ text: 'Body', filePath: '/tmp/test.md' });

    expect(singlePassSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Body', filePath: '/tmp/test.md' }),
      expect.objectContaining({ analysisMode: 'single', filterFindings: true }),
    );
    expect(rawSinglePassSpy).not.toHaveBeenCalled();
    expect(multiWaveSpy).not.toHaveBeenCalled();
    expect(results[0].code).toBe('ambiguity-llm');
  });

  it('analysisWaves overrides analysisMode: single (runs focused multi-wave instead of single-pass)', async () => {
    // With analysisMode='single' the engine would normally take the
    // single-pass branch. Setting analysisWaves must bypass that and run
    // a multi-wave call with the exact list.
    const singlePassSpy = vi.spyOn(Analyzer.prototype, 'analyzeSinglePassWave').mockResolvedValue([makeResult('single-pass-result')]);
    const multiWaveSpy = vi.spyOn(Analyzer.prototype, 'analyze').mockResolvedValue([makeResult('hygiene-circular-definition')]);
    const engine = new Engine(provider, {
      analysisMode: 'single',
      enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
      scoreSamples: 1,
      fixStrategy: 'subtractive',
      fixSemanticCheck: false,
      fixSelfCritique: false,
      fixReferenceGrounding: true,
      analysisWaves: ['hygiene'],
    });

    const results = await engine.analyze({ text: 'Body', filePath: '/tmp/test.md' });

    expect(singlePassSpy).not.toHaveBeenCalled();
    expect(multiWaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Body', filePath: '/tmp/test.md' }),
      undefined,
      ['hygiene'],
      expect.objectContaining({ analysisMode: 'single', analysisWaves: ['hygiene'] }),
    );
    expect(results[0].code).toBe('hygiene-circular-definition');
  });
});
