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

describe('createMcpToolRegistry', () => {
  it('lists the analyze and fix tools', () => {
    const registry = createMcpToolRegistry({
      buildEngine: vi.fn(async () => ({ analyze: vi.fn(), provider: {} })) as any,
    });

    expect(registry.listTools()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'analyze' }),
        expect.objectContaining({ name: 'fix' }),
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

    expect(analyze).toHaveBeenCalledWith({ text: 'Use explicit wording.', filePath: undefined });
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
});
