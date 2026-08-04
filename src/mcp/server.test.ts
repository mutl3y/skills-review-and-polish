import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../core/index', () => ({
  Engine: vi.fn(),
}));

vi.mock('../core/fixer', () => ({
  SurgicalFixer: vi.fn(function () {
    return {
      fixIssue: vi.fn(async () => ({ accepted: true, fixed: 'fixed', risks: [] })),
    };
  }),
}));

import { createMcpToolRegistry, sanitizeErrorMessage, _resetAnalyzeCooldown } from './server';
import { SurgicalFixer } from '../core/fixer';

describe('accept_finding input validation', () => {
  it('rejects relevantText that is too short (under 3 chars)', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    const result = await registry.callTool('accept_finding', {
      filePath: '/test/file.md',
      diagnosticCode: 'ambiguity-llm',
      relevantText: 'ab',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('error');
    expect(parsed.error).toContain('too short');
  });

  it('rejects overly generic single-word patterns', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    const result = await registry.callTool('accept_finding', {
      filePath: '/test/file.md',
      diagnosticCode: 'ambiguity-llm',
      relevantText: 'the',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('error');
    expect(parsed.error).toContain('generic');
  });

  it('rejects relevantText exceeding max length (200 chars)', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    const longText = 'a'.repeat(201);
    const result = await registry.callTool('accept_finding', {
      filePath: '/test/file.md',
      diagnosticCode: 'ambiguity-llm',
      relevantText: longText,
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('error');
    expect(parsed.error).toContain('too long');
  });

  it('trims whitespace and control characters before storing', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    const result = await registry.callTool('accept_finding', {
      filePath: '/tmp/test-validation.json',
      diagnosticCode: 'ambiguity-llm',
      relevantText: '  vague or underspecified  ',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('accepted');
  });
});

describe('createMcpToolRegistry', () => {
  it('lists the analyze and fix tools', () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    expect(registry.listTools()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'analyze' }),
        expect.objectContaining({ name: 'fix' }),
        expect.objectContaining({ name: 'accept_finding' }),
        expect.objectContaining({ name: 'health' }),
        expect.objectContaining({ name: 'score' }),
        expect.objectContaining({ name: 'verify_fix' }),
        expect.objectContaining({ name: 'list_accepted_findings' }),
      ]),
    );
  });

  it('calls the analyze tool through the engine', async () => {
    const analyze = vi.fn(async () => [{ code: 'ambiguity-llm' }]);
    const engine = { analyze, provider: {} };
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => engine) as any,
    });

    const result = await registry.callTool('analyze', { text: 'Use explicit wording.' });

    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Use explicit wording.',
        filePath: undefined,
      }),
      undefined,
      undefined,
      undefined, // configOverride
    );
    expect(JSON.parse(result.content[0].text)).toEqual([{ code: 'ambiguity-llm' }]);
  });

  it('passes analysisWaves to the engine as configOverride', async () => {
    const analyze = vi.fn(async () => [{ code: 'contradiction' }]);
    const engine = { analyze, provider: {} };
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => engine) as any,
    });

    await registry.callTool('analyze', {
      text: 'doc',
      analysisWaves: ['contradictions', 'hygiene'],
    });

    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'doc' }),
      undefined,
      undefined,
      expect.objectContaining({
        analysisWaves: ['contradictions', 'hygiene'],
        analysisMode: 'multiWave',
      }),
    );
  });

  it('ignores invalid analysisWaves values', async () => {
    const analyze = vi.fn(async () => []);
    const engine = { analyze, provider: {} };
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => engine) as any,
    });

    _resetAnalyzeCooldown();
    await registry.callTool('analyze', {
      text: 'doc',
      analysisWaves: ['contradictions', 'not-a-wave'],
    });

    // configOverride should be set, but the invalid value filtered out
    const call = analyze.mock.calls[0] as unknown as unknown[];
    const override = call[3] as { analysisWaves: string[] };
    expect(override.analysisWaves).toEqual(['contradictions']);
  });

  it('calls the fix tool through the surgical fixer', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    const result = await registry.callTool('fix', {
      text: 'bad',
      filePath: 'SKILL.md',
      diagnosticCode: 'ambiguity-llm',
      relevantText: 'vague',
    });

    expect(JSON.parse(result.content[0].text)).toEqual({
      accepted: true,
      fixed: 'fixed',
      risks: [],
    });
  });

  it('emits progress notifications during a long analyze when a progress token is provided', async () => {
    // A slow analyze that stays pending until we advance fake timers, so the
    // 15s progress interval fires before the analyze resolves.
    vi.useFakeTimers();
    let resolveAnalyze: (v: unknown) => void;
    const analyze = vi.fn(() => new Promise((resolve) => { resolveAnalyze = resolve; }));
    const engine = { analyze, provider: {} };
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => engine) as any,
    });

    const sendProgress = vi.fn(async (_p: number, _t?: number, _m?: string) => {});
    _resetAnalyzeCooldown();
    const promise = registry.callTool('analyze', { text: 'doc' }, { sendProgress });

    // Advance past the 15s progress interval to trigger a progress tick.
    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendProgress).toHaveBeenCalled();
    expect(sendProgress.mock.calls[0][2]).toBe('analyzing…');

    // Resolve the analyze and let the handler finish.
    resolveAnalyze!([{ code: 'ambiguity-llm' }]);
    await promise;
    vi.useRealTimers();
  });

  it('calls the health tool and returns ok status', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    const result = await registry.callTool('health', {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ok');
    expect(parsed.provider).toBeDefined();
    expect(parsed.configSource).toBeDefined();
  });

  it('includes external response settings in health output when configured', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn() },
        config: {
          provider: 'openrouter',
          model: 'google/gemini-2.5-flash-lite',
          structuredOutput: true,
          requestTimeoutMs: 45_000,
          configSource: 'test',
        },
      })) as any,
    });

    const result = await registry.callTool('health', {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.structuredOutput).toBe(true);
    expect(parsed.requestTimeoutMs).toBe(45_000);
  });

  it('returns error status when engine build fails in health tool', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => { throw new Error('No provider'); }) as any,
    });

    const result = await registry.callTool('health', {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('error');
    expect(parsed.error).toBe('No provider');
  });

  it('refuses analyze once the session output-token budget is exhausted', async () => {
    // Import the budget reset helper (added for testability).
    const { _resetSessionBudget, _setSessionBudgetCap } = await import('./server.js');
    _resetSessionBudget();
    // Set a tiny cap so a single analyze call exhausts it.
    _setSessionBudgetCap(1);
    const analyze = vi.fn(async () => [{ code: 'ambiguity-llm', message: 'x'.repeat(200) }]);
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });

    // First call runs and returns its result (the charge exhausts the budget).
    const first = await registry.callTool('analyze', { text: 'Use explicit wording.' });
    expect(JSON.parse(first.content[0].text)).toEqual([{ code: 'ambiguity-llm', message: 'x'.repeat(200) }]);
    expect(analyze).toHaveBeenCalledTimes(1);

    // Second call is refused because the budget is now exhausted.
    const second = await registry.callTool('analyze', { text: 'Use explicit wording.' });
    const parsed = JSON.parse(second.content[0].text);
    expect(parsed.status).toBe('error');
    expect(parsed.error).toContain('budget exhausted');
    expect(analyze).toHaveBeenCalledTimes(1);
    _resetSessionBudget();
  });

  it('disables the budget guard when the cap is set to 0', async () => {
    const { _resetSessionBudget, _setSessionBudgetCap } = await import('./server.js');
    _resetSessionBudget();
    _resetAnalyzeCooldown();
    _setSessionBudgetCap(0); // 0 disables the guard
    const analyze = vi.fn(async () => [{ code: 'ambiguity-llm', message: 'x'.repeat(200) }]);
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });

    // With the guard disabled, the call is allowed and returns its result.
    const result = await registry.callTool('analyze', { text: 'Use explicit wording.' });
    expect(JSON.parse(result.content[0].text)).toEqual([{ code: 'ambiguity-llm', message: 'x'.repeat(200) }]);
    expect(analyze).toHaveBeenCalledTimes(1);
    _resetSessionBudget();
  });

  it('reports cost budget state in health output', async () => {
    const { _resetSessionBudget } = await import('./server.js');
    _resetSessionBudget();
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    const result = await registry.callTool('health', {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.costBudget).toBeDefined();
    expect(parsed.costBudget.maxOutputTokensPerSession).toBeGreaterThan(0);
    expect(parsed.costBudget.exhausted).toBe(false);
  });

  it('calls the score tool through the engine', async () => {
    const scoreResult = { score: 85, grade: 'B+', penalty: 15, pillarScores: {} };
    const score = vi.fn(async () => scoreResult);
    const engine = { analyze: vi.fn(), score, provider: {} };
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => engine) as any,
    });

    const result = await registry.callTool('score', { text: 'A good prompt.' });

    expect(score).toHaveBeenCalledWith({ text: 'A good prompt.', filePath: undefined });
    expect(JSON.parse(result.content[0].text)).toEqual(scoreResult);
  });

  it('calls the verify_fix tool and reports fixed status', async () => {
    const analyzeResult = [{ code: 'ambiguity-llm', message: 'vague text', relevantText: 'vague text', severity: 'warning', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, analyzer: 'test' }];
    const analyze = vi.fn(async () => analyzeResult);
    const engine = { analyze, provider: {} };
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => engine) as any,
    });

    // Ask about a different code — should report as fixed since the code doesn't match
    const result = await registry.callTool('verify_fix', {
      text: 'Fixed text.',
      diagnosticCode: 'contradiction',
      relevantText: 'conflicting statement',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.fixed).toBe(true);
    expect(parsed.matchingIssue).toBeNull();
    expect(parsed).toHaveProperty('issueCount', expect.any(Number));
  });

  it('calls the list_accepted_findings tool', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    const result = await registry.callTool('list_accepted_findings', {});
    const parsed = JSON.parse(result.content[0].text);

    // Should return a store object (empty is fine since no accepted findings exist in test)
    expect(parsed).toHaveProperty('entries');
  });

  it('list_accepted_findings filters by filePath when provided', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    const result = await registry.callTool('list_accepted_findings', { filePath: 'test.md' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveProperty('filePath', 'test.md');
    expect(parsed).toHaveProperty('entries');
  });

  it('returns isError for empty text in analyze', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze: vi.fn() }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    const result = await registry.callTool('analyze', { text: '' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Missing required argument: text');
  });

  it('returns isError for missing diagnosticCode in fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze: vi.fn() }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    const result = await registry.callTool('fix', { text: 'hello', relevantText: 'hi' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Missing required argument: diagnosticCode');
  });

  it('returns isError for missing filePath in accept_finding', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze: vi.fn() }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    const result = await registry.callTool('accept_finding', { diagnosticCode: 'x', relevantText: 'y' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Missing required argument: filePath');
  });

  it('returns isError for unknown tool name', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: {}, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    const result = await registry.callTool('nonexistent', {});
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Unknown tool');
  });

  it('returns isError on text exceeding max length', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze: vi.fn() }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    const longText = 'x'.repeat(200_001);
    const result = await registry.callTool('analyze', { text: longText });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Text too long');
  });

  it('verify_fix reports fixed=false when the issue is still present', async () => {
    const analyzeResult = [{
      code: 'ambiguity-llm',
      message: 'vague text',
      relevantText: 'vague text',
      severity: 'warning',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      analyzer: 'llm',
    }];
    const analyze = vi.fn(async () => analyzeResult);
    const engine = { analyze, score: vi.fn(), provider: {} };
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });

    const result = await registry.callTool('verify_fix', {
      text: 'Some text.',
      diagnosticCode: 'ambiguity-llm',
      relevantText: 'vague text',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.fixed).toBe(false);
    expect(parsed.matchingIssue).not.toBeNull();
    expect(parsed.matchingIssue.code).toBe('ambiguity-llm');
    expect(parsed.newIssues).toHaveLength(0);
    expect(parsed.issueCount).toBe(1);
  });

  it('fix passes correct synthetic diagnostic and options to SurgicalFixer', async () => {
    const fixIssue = vi.fn(async () => ({ accepted: true, fixed: 'fixed text', risks: [] }));
    // Override the SurgicalFixer mock with a class to support `new`
    (SurgicalFixer as any).mockImplementation(function MockFixer(this: { fixIssue: typeof fixIssue; provider: undefined }) {
      this.fixIssue = fixIssue;
      this.provider = undefined;
    });

    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), provider: { fake: true } },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });

    await registry.callTool('fix', {
      text: 'Bad text here.',
      filePath: 'test.md',
      diagnosticCode: 'ambiguity-llm',
      relevantText: 'Bad text',
    });

    // Verify SurgicalFixer was constructed with the engine's provider
    expect(SurgicalFixer).toHaveBeenCalledWith(expect.objectContaining({ fake: true }));

    // Verify fixIssue was called with the correct synthetic diagnostic
    // (filePath is resolved against the workspace root for path safety).
    expect(fixIssue).toHaveBeenCalledWith(
      'Bad text here.',
      expect.stringMatching(/test\.md$/),
      expect.objectContaining({
        code: 'ambiguity-llm',
        message: 'Bad text',
        severity: 'warning',
        analyzer: 'mcp',
        relevantText: 'Bad text',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      }),
      expect.objectContaining({
        additive: true,
        semanticCheck: false,
        selfCritique: false,
        referenceGrounding: true,
      }),
    );
  });

  it('returns isError for empty text in score', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), score: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const result = await registry.callTool('score', { text: '' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Missing required argument: text');
  });

  it('returns isError for empty text in verify_fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), score: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const result = await registry.callTool('verify_fix', { text: '' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Missing required argument: text');
  });

  it('returns isError on text exceeding max length for fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), provider: {} },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const longText = 'x'.repeat(200_001);
    const result = await registry.callTool('fix', { text: longText, diagnosticCode: 'x', relevantText: 'y' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Text too long');
  });

  it('returns isError on text exceeding max length for score', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), score: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const longText = 'x'.repeat(200_001);
    const result = await registry.callTool('score', { text: longText });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Text too long');
  });

  it('returns isError on text exceeding max length for verify_fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), score: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const longText = 'x'.repeat(200_001);
    const result = await registry.callTool('verify_fix', { text: longText, diagnosticCode: 'x', relevantText: 'y' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Text too long');
  });

  it('accept_finding stores reason and list returns it', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });

    await registry.callTool('accept_finding', {
      filePath: '/tmp/test-reason.md',
      diagnosticCode: 'coverage-gap',
      relevantText: 'missing info',
      reason: 'This is intentional',
    });

    const result = await registry.callTool('list_accepted_findings', { filePath: '/tmp/test-reason.md' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.entries.length).toBeGreaterThanOrEqual(1);
    const entry = parsed.entries.find((e: { code: string; textPattern: string }) => e.code === 'coverage-gap');
    expect(entry).toBeDefined();
    expect(entry.reason).toBe('This is intentional');
  });

  it('caches the engine across multiple tool calls', async () => {
    // Reset the rate-limit cooldown before each call so consecutive analyze
    // calls don't block on the 5s cooldown (which would cause a test timeout).
    const { _resetAnalyzeCooldown } = await import('./server.js');

    const buildEngine = vi.fn(async () => ({
      engine: { analyze: vi.fn(async () => []), provider: {} },
      config: { provider: 'test', model: 'test', configSource: 'test' },
    })) as any;

    const registry = createMcpToolRegistry({ buildEngine });

    _resetAnalyzeCooldown();
    await registry.callTool('analyze', { text: 'hello' });
    _resetAnalyzeCooldown();
    await registry.callTool('analyze', { text: 'world' });
    await registry.callTool('health', {});

    expect(buildEngine).toHaveBeenCalledTimes(1);
  });

  it('returns isError on missing relevantText for fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const result = await registry.callTool('fix', { text: 'hello', diagnosticCode: 'x' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Missing required argument: relevantText');
  });

  it('returns isError on missing diagnosticCode for verify_fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const result = await registry.callTool('verify_fix', { text: 'hello', relevantText: 'x' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Missing required argument: diagnosticCode');
  });

  it('returns isError on missing relevantText for verify_fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const result = await registry.callTool('verify_fix', { text: 'hello', diagnosticCode: 'x' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('Missing required argument: relevantText');
  });
});

describe('sanitizeErrorMessage', () => {
  it('strips Bearer tokens', () => {
    expect(sanitizeErrorMessage('Error: Bearer abc123def456')).toBe('Error: Bearer [REDACTED]');
  });

  it('strips API key patterns', () => {
    expect(sanitizeErrorMessage('api_key=sk-1234567890abcdef')).toBe('api_key=[REDACTED]');
  });

  it('strips token patterns', () => {
    expect(sanitizeErrorMessage('token: secret123')).toBe('token=[REDACTED]');
  });

  it('strips password patterns', () => {
    expect(sanitizeErrorMessage('password=mysecretpass')).toBe('password=[REDACTED]');
  });

  it('passes through clean messages unchanged', () => {
    expect(sanitizeErrorMessage('File not found')).toBe('File not found');
  });

  it('handles multiple secrets in one message', () => {
    const msg = 'Failed: Bearer tok123 api_key=sk-abc123';
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('Bearer [REDACTED]');
    expect(result).toContain('api_key=[REDACTED]');
    expect(result).not.toContain('tok123');
    expect(result).not.toContain('sk-abc123');
  });

  it('handles empty string', () => {
    expect(sanitizeErrorMessage('')).toBe('');
  });

  it('handles non-Error objects', () => {
    expect(sanitizeErrorMessage(42)).toBe('42');
  });

  it('strips secret patterns', () => {
    expect(sanitizeErrorMessage('secret=abcdef123456')).toBe('secret=[REDACTED]');
  });
});

// ─── handleFix duplicate anchor guard ───────────────────────────────────────────

describe('handleFix — duplicate anchor guard', () => {
  beforeEach(() => { _resetAnalyzeCooldown(); });

  it('returns error when relevantText appears multiple times and no line provided', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: () => ({
        engine: { analyze: vi.fn().mockResolvedValue([]), score: vi.fn(), provider: {} } as any,
        config: { provider: 'openrouter', model: 'test', configSource: 'test' },
      }),
    });

    const result = await registry.callTool('fix', {
      text: 'Be concise. Be concise. Be accurate.',
      diagnosticCode: 'ambiguity-llm',
      relevantText: 'Be concise',
      // line intentionally omitted
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('error');
    expect(parsed.error).toContain('appears 2 times');
  });

  it('allows fix when relevantText appears once (no line needed)', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: () => ({
        engine: { analyze: vi.fn().mockResolvedValue([]), score: vi.fn(), provider: { complete: vi.fn().mockResolvedValue({ text: JSON.stringify({ accepted: true, fixed: 'Be accurate.' }) }) } } as any,
        config: { provider: 'openrouter', model: 'test', configSource: 'test' },
      }),
    });

    // Should NOT return the duplicate anchor error
    const result = await registry.callTool('fix', {
      text: 'Be concise. Be accurate.',
      diagnosticCode: 'ambiguity-llm',
      relevantText: 'Be concise',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).not.toBe('error');
  });

  it('allows fix when relevantText appears multiple times but line is provided', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: () => ({
        engine: { analyze: vi.fn().mockResolvedValue([]), score: vi.fn(), provider: { complete: vi.fn().mockResolvedValue({ text: JSON.stringify({ accepted: false, fixed: '' }) }) } } as any,
        config: { provider: 'openrouter', model: 'test', configSource: 'test' },
      }),
    });

    const result = await registry.callTool('fix', {
      text: 'Be concise. Be concise.',
      diagnosticCode: 'ambiguity-llm',
      relevantText: 'Be concise',
      line: 0,  // explicit line disambiguates
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).not.toBe('error');
  });
});

// ─── handleAnalyze cooldown ─────────────────────────────────────────────────────

describe('handleAnalyze — cooldown', () => {
  it('waits between rapid back-to-back analyze calls', async () => {
    _resetAnalyzeCooldown();
    vi.useFakeTimers();

    const registry = createMcpToolRegistry({
      buildEngine: () => ({
        engine: { analyze: vi.fn().mockResolvedValue([]), score: vi.fn(), provider: {} } as any,
        config: { provider: 'openrouter', model: 'test', configSource: 'test' },
      }),
    });

    // First call — sets the timestamp
    const first = registry.callTool('analyze', { text: 'doc one.' });
    await vi.runAllTimersAsync();
    await first;

    // Second call immediately — enters the cooldown delay branch
    const second = registry.callTool('analyze', { text: 'doc two.' });
    // Fast-forward past the 5s cooldown window so setTimeout resolves
    await vi.runAllTimersAsync();
    await second;

    vi.useRealTimers();
  });
});
