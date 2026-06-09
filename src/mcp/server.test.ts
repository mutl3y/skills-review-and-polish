import { describe, expect, it, vi } from 'vitest';

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

import { createMcpToolRegistry } from './server';
import { SurgicalFixer } from '../core/fixer';

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

    expect(analyze).toHaveBeenCalledWith({
      text: 'Use explicit wording.',
      filePath: undefined,
      acceptedFindingsPath: expect.stringContaining('.accepted-findings.json'),
    });
    expect(JSON.parse(result.content[0].text)).toEqual([{ code: 'ambiguity-llm' }]);
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

  it('returns error status when engine build fails in health tool', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => { throw new Error('No provider'); }) as any,
    });

    const result = await registry.callTool('health', {});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('error');
    expect(parsed.error).toBe('No provider');
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

  it('throws on empty text for analyze', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze: vi.fn() }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    await expect(registry.callTool('analyze', { text: '' })).rejects.toThrow('Missing required argument: text');
  });

  it('throws on missing diagnosticCode for fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze: vi.fn() }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    await expect(registry.callTool('fix', { text: 'hello', relevantText: 'hi' })).rejects.toThrow('Missing required argument: diagnosticCode');
  });

  it('throws on missing filePath for accept_finding', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze: vi.fn() }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    await expect(registry.callTool('accept_finding', { diagnosticCode: 'x', relevantText: 'y' })).rejects.toThrow('Missing required argument: filePath');
  });

  it('throws on unknown tool name', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: {}, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    await expect(registry.callTool('nonexistent', {})).rejects.toThrow('Unknown tool');
  });

  it('throws on text exceeding max length', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ engine: { analyze: vi.fn() }, config: { provider: 'test', model: 'test', configSource: 'test' } })) as any,
    });
    const longText = 'x'.repeat(100_001);
    await expect(registry.callTool('analyze', { text: longText })).rejects.toThrow('Text too long');
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
    expect(fixIssue).toHaveBeenCalledWith(
      'Bad text here.',
      'test.md',
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

  it('throws on empty text for score', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), score: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    await expect(registry.callTool('score', { text: '' })).rejects.toThrow('Missing required argument: text');
  });

  it('throws on empty text for verify_fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), score: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    await expect(registry.callTool('verify_fix', { text: '' })).rejects.toThrow('Missing required argument: text');
  });

  it('throws on text exceeding max length for fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), provider: {} },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const longText = 'x'.repeat(100_001);
    await expect(registry.callTool('fix', { text: longText, diagnosticCode: 'x', relevantText: 'y' })).rejects.toThrow('Text too long');
  });

  it('throws on text exceeding max length for score', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), score: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const longText = 'x'.repeat(100_001);
    await expect(registry.callTool('score', { text: longText })).rejects.toThrow('Text too long');
  });

  it('throws on text exceeding max length for verify_fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn(), score: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    const longText = 'x'.repeat(100_001);
    await expect(registry.callTool('verify_fix', { text: longText, diagnosticCode: 'x', relevantText: 'y' })).rejects.toThrow('Text too long');
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
    const buildEngine = vi.fn(async () => ({
      engine: { analyze: vi.fn(async () => []), provider: {} },
      config: { provider: 'test', model: 'test', configSource: 'test' },
    })) as any;

    const registry = createMcpToolRegistry({ buildEngine });

    await registry.callTool('analyze', { text: 'hello' });
    await registry.callTool('analyze', { text: 'world' });
    await registry.callTool('health', {});

    expect(buildEngine).toHaveBeenCalledTimes(1);
  });

  it('throws on missing relevantText for fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    await expect(registry.callTool('fix', { text: 'hello', diagnosticCode: 'x' })).rejects.toThrow('Missing required argument: relevantText');
  });

  it('throws on missing diagnosticCode for verify_fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    await expect(registry.callTool('verify_fix', { text: 'hello', relevantText: 'x' })).rejects.toThrow('Missing required argument: diagnosticCode');
  });

  it('throws on missing relevantText for verify_fix', async () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({
        engine: { analyze: vi.fn() },
        config: { provider: 'test', model: 'test', configSource: 'test' },
      })) as any,
    });
    await expect(registry.callTool('verify_fix', { text: 'hello', diagnosticCode: 'x' })).rejects.toThrow('Missing required argument: relevantText');
  });
});
