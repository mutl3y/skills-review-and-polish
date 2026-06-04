import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  appendOnlyBreak,
  classifyEditRisk,
  computeFixBounds,
  expandToParagraph,
  extractParagraphAtLine,
  factualGroundingTrigger,
  frontmatterRange,
  loadReferenceGrounding,
  meaningPreservationReject,
  shouldRunOptionalFixGate,
  skillDomainHint,
  surroundingContext,
  SurgicalFixer,
  SURGICAL_FIXABLE_CODES,
} from './fixer';
import type { AnalysisResult, LlmProvider } from './types';

function makeDiagnostic(code: string, relevantText = 'Use the tool carefully.'): AnalysisResult {
  return {
    code,
    message: `Ambiguous: "${relevantText}". Please tighten it.`,
    severity: 'warning',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: relevantText.length } },
    analyzer: 'test',
    relevantText,
  };
}

describe('frontmatterRange', () => {
  it('detects the YAML frontmatter block at the top of a skill file', () => {
    const text = '---\nname: Test\ndescription: Example\n---\nBody line';
    const range = frontmatterRange(text);
    expect(range?.[0]).toBe(0);
    expect(range?.[1]).toBeGreaterThan(0);
  });

  it('returns null for content without frontmatter', () => {
    expect(frontmatterRange('No frontmatter here')).toBeNull();
  });
});

describe('appendOnlyBreak', () => {
  it('accepts insertion-only edits that preserve original token order', () => {
    expect(appendOnlyBreak('Consider using the API', 'Consider using the API carefully')).toBeNull();
  });

  it('flags edits that reorder or replace original tokens', () => {
    expect(appendOnlyBreak('Use the API carefully', 'Carefully use the API')).toBe('carefully');
  });
});

describe('classifyEditRisk', () => {
  it('identifies deletion and numeric drift as risk signals', () => {
    expect(classifyEditRisk('ambiguity-llm', 'Use it carefully', '')).toContain('DELETES an instruction');
    expect(classifyEditRisk('contradiction', 'Use 3 retries', 'Use 5 retries')).toContain('numeric value changed (3 → 5)');
  });

  it('flags removed obligation words', () => {
    expect(classifyEditRisk('ambiguity-llm', 'Consider using the API', 'Use the API')).toContain('obligation/hedge "consider" removed');
  });

  it('reports structural and scope-word changes when they occur', () => {
    expect(classifyEditRisk('hygiene-over-specification', 'Use the API only when needed', 'Use the API')).toContain('dropped scope word "only"');
    expect(classifyEditRisk('ambiguity-llm', 'Use Python for automation', 'Use JavaScript for automation')).toEqual(
      expect.arrayContaining([expect.stringContaining('possible concept change')]),
    );
  });
});

describe('computeFixBounds and shouldRunOptionalFixGate', () => {
  it('computes safe size bounds for additive and non-additive fixes', () => {
    const bounds = computeFixBounds('Use the tool carefully.', 'ambiguity-llm', false);

    expect(bounds.upperBound).toBeGreaterThan('Use the tool carefully.'.length);
    expect(bounds.lowerBound).toBeLessThan('Use the tool carefully.'.length);
  });

  it('enables the optional critique gates only when the edit is meaningful', () => {
    const gates = shouldRunOptionalFixGate(
      'ambiguity-llm',
      'Use the tool carefully.',
      'Use the tool carefully today.',
      false,
      { selfCritique: true, semanticCheck: true },
    );

    expect(gates.selfCritique).toBe(true);
    expect(gates.semanticCheck).toBe(true);
  });
});

describe('context and grounding helpers', () => {
  it('builds surrounding context and domain hints from frontmatter', () => {
    const text = '# Setup\n\nUse the tool carefully.\n\n# Next\nKeep it brief.';

    expect(surroundingContext(text, 'Use the tool carefully.')).toContain('Use the tool carefully.');
    expect(skillDomainHint('---\nname: Example\ndescription: Test skill\n---\nBody')).toContain('Example');
  });

  it('detects factual fragments that should trigger grounding', () => {
    expect(factualGroundingTrigger('Use version 1.2.3 and the API key')).toBe(true);
    expect(factualGroundingTrigger('Use the tool carefully')).toBe(false);
  });

  it('expands and extracts paragraphs from anchored text', () => {
    const text = 'Intro\n\nUse   the tool carefully.\n\nNext line';

    expect(expandToParagraph(text, 'Use the tool carefully.')).toContain('Use   the tool carefully.');
    expect(extractParagraphAtLine(text.split('\n').join('\n'), 2)).toContain('Use');
  });
});

describe('loadReferenceGrounding', () => {
  it('returns null when grounding is disabled or no reference directory exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-grounding-'));

    expect(loadReferenceGrounding(path.join(tempDir, 'SKILL.md'), 'Use 3 retries', false)).toBeNull();
    expect(loadReferenceGrounding(path.join(tempDir, 'SKILL.md'), 'Use 3 retries', true)).toBeNull();
  });

  it('collects reference fragments from a sibling references folder', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-grounding-'));
    const refDir = path.join(tempDir, 'references');
    fs.mkdirSync(refDir);
    fs.writeFileSync(path.join(refDir, 'notes.md'), 'Use version 1.2.3 for the API.');

    const text = loadReferenceGrounding(path.join(tempDir, 'SKILL.md'), 'Use version 1.2.3 for the API.', true);

    expect(text).toContain('references/notes.md');
    expect(text).toContain('Use version 1.2.3');
  });
});

describe('meaningPreservationReject', () => {
  it('rejects injected fences and line deletions', () => {
    expect(meaningPreservationReject('ambiguity-llm', 'Line one\nLine two', 'Line one\n```bad```')).toBe('fence-injection');
    expect(meaningPreservationReject('ambiguity-llm', 'Line one\nLine two', 'Line one')).toBe('line-deletion');
  });

  it('rejects edits that drop obligation words', () => {
    expect(meaningPreservationReject('ambiguity-llm', 'Consider using the API', 'Use the API')).toBe('obligation-drop:consider');
  });

  it('rejects numeric drift and additive reorder violations', () => {
    expect(meaningPreservationReject('contradiction', 'Use 3 retries', 'Use 5 retries')).toBe('numeric-change');
    expect(meaningPreservationReject('ambiguity-llm', 'Use the API carefully', 'Carefully use the API', true)).toBe('append-only-violation(not-insertion-only: "carefully")');
  });
});

describe('SurgicalFixer', () => {
  it('rejects non-surgical codes before calling the provider', async () => {
    const provider: LlmProvider = { complete: async () => ({ text: 'ignored' }) };
    const fixer = new SurgicalFixer(provider);

    const result = await fixer.fixIssue('No issue here', '/tmp/test.md', makeDiagnostic('coverage-gap'));

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('not surgical-fixable');
  });

  it('rejects oversized anchors before model calls', async () => {
    const complete = vi.fn();
    const fixer = new SurgicalFixer({ complete });

    const longText = 'Use ' + 'this carefully '.repeat(80);
    const result = await fixer.fixIssue(longText, '/tmp/test.md', makeDiagnostic('ambiguity-llm', longText));

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('anchor too large');
    expect(complete).not.toHaveBeenCalled();
  });

  it('blocks anchors that overlap frontmatter metadata', async () => {
    const complete = vi.fn();
    const fixer = new SurgicalFixer({ complete });
    const text = '---\nname: Example\ndescription: Demo\n---\nUse this carefully.';

    const result = await fixer.fixIssue(text, '/tmp/test.md', makeDiagnostic('ambiguity-llm', 'name: Example'));

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('frontmatter');
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects identical model output as a non-fix', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'Use the tool carefully.' });
    const fixer = new SurgicalFixer({ complete });

    const result = await fixer.fixIssue(
      'Use the tool carefully.',
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'),
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toBe('identical output');
  });

  it('rejects model abstentions and meaning-guard failures', async () => {
    const abstain = new SurgicalFixer({
      complete: vi.fn().mockResolvedValue({ text: '[[ABSTAIN]] because it is unsafe.' }),
    });

    const abstainResult = await abstain.fixIssue(
      'Use the tool carefully.',
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'),
    );

    expect(abstainResult.accepted).toBe(false);
    expect(abstainResult.rejectReason).toContain('abstained');

    const guarded = new SurgicalFixer({
      complete: vi.fn().mockResolvedValue({ text: 'Use the tool carefully.' }),
    });

    const guardedResult = await guarded.fixIssue(
      'Consider using the tool carefully.',
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', 'Consider using the tool carefully.'),
    );

    expect(guardedResult.accepted).toBe(false);
    expect(guardedResult.rejectReason).toContain('meaning-guard');
  });

  it('rejects expansion and shrinkage outside the safe bounds', async () => {
    const fixer = new SurgicalFixer({
      complete: vi.fn()
        .mockResolvedValueOnce({ text: 'Use the tool carefully and always document every step before proceeding.' })
        .mockResolvedValueOnce({ text: 'Use it.' }),
    });

    const longResult = await fixer.fixIssue('Use the tool carefully.', '/tmp/test.md', makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'));
    expect(longResult.accepted).toBe(false);
    expect(longResult.rejectReason).toContain('expansion');

    const shortResult = await fixer.fixIssue('Use the tool carefully.', '/tmp/test.md', makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'));
    expect(shortResult.accepted).toBe(false);
    expect(shortResult.rejectReason).toContain('shrinkage');
  });

  it('rejects provider/LLM failures before applying a fix', async () => {
    const fixer = new SurgicalFixer({
      complete: vi.fn().mockRejectedValue(new Error('network down')),
    });

    const result = await fixer.fixIssue(
      'Use the tool carefully.',
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'),
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('LLM error');
  });

  it('rejects fixes when the semantic judge says the edit changed meaning', async () => {
    const provider: LlmProvider = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({ text: 'Use the tool carefully' })
        .mockResolvedValueOnce({ text: 'NO' }),
    };
    const fixer = new SurgicalFixer(provider);

    const result = await fixer.fixIssue(
      'Use the tool carefully.',
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'),
      { semanticCheck: true },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toBe('semantic-judge: obligation/scope change');
  });

  it('rejects fixes flagged by self-critique as factual drift', async () => {
    const provider: LlmProvider = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({ text: 'Use the tool carefully today.' })
        .mockResolvedValueOnce({ text: 'DRIFT: invented detail' }),
    };
    const fixer = new SurgicalFixer(provider);

    const result = await fixer.fixIssue(
      'Use the tool carefully.',
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'),
      { additive: true, selfCritique: true },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('self-critique');
  });

  it('skips fixDocument entries when the anchor cannot be resolved', async () => {
    const fixer = new SurgicalFixer({ complete: vi.fn().mockResolvedValue({ text: 'Use the tool.' }) });

    const result = await fixer.fixDocument(
      'Intro\n\nKeep it brief.',
      '/tmp/test.md',
      [makeDiagnostic('ambiguity-llm', 'Missing anchor text')],
    );

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.fixedText).toBe('Intro\n\nKeep it brief.');
  });

  it('applies accepted deletions in fixDocument and skips rejected ones', async () => {
    const complete = vi.fn().mockResolvedValue({ text: '' });
    const fixer = new SurgicalFixer({ complete });

    const result = await fixer.fixDocument(
      'Please be concise.\nKeep it brief.',
      '/tmp/test.md',
      [makeDiagnostic('hygiene-redundant-instruction', 'Please be concise.')],
    );

    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.fixedText).toContain('Keep it brief.');
    expect(result.fixedText).not.toContain('Please be concise.');
  });

  it('applies multiple accepted diagnostics in one fixDocument pass', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({ text: '' })
      .mockResolvedValueOnce({ text: 'Use the tool.' });
    const fixer = new SurgicalFixer({ complete });

    const result = await fixer.fixDocument(
      'Please be concise.\nUse the tool carefully.\nKeep it brief.',
      '/tmp/test.md',
      [
        makeDiagnostic('hygiene-redundant-instruction', 'Please be concise.'),
        makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'),
      ],
    );

    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.fixedText).toContain('Use the tool.');
    expect(result.fixedText).not.toContain('Please be concise.');
    expect(result.fixedText).toContain('Keep it brief.');
  });

  it('applies accepted non-deletion fixes in fixDocument', async () => {
    const complete = vi.fn().mockResolvedValue({
      text: '1. Use the tool carefully.\n2. Keep it brief.',
    });
    const fixer = new SurgicalFixer({ complete });

    const result = await fixer.fixDocument(
      'Use the tool carefully.\nKeep it brief.',
      '/tmp/test.md',
      [makeDiagnostic('hygiene-unordered-process', 'Use the tool carefully.\nKeep it brief.')],
    );

    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.fixedText).toContain('1. Use the tool carefully.');
  });

  it('falls back to paragraph expansion when the anchor text is whitespace-normalized', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'Use the tool.' });
    const fixer = new SurgicalFixer({ complete });

    const text = 'Intro\n\nUse   the tool carefully.\n\nNext line';

    const result = await fixer.fixIssue(
      text,
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'),
    );

    expect(result.accepted).toBe(true);
    expect(result.fixed).toBe('Use the tool.');
  });

  it('only allows the known surgical-fixable codes', () => {
    expect(SURGICAL_FIXABLE_CODES.has('ambiguity-llm')).toBe(true);
    expect(SURGICAL_FIXABLE_CODES.has('contradiction')).toBe(true);
    expect(SURGICAL_FIXABLE_CODES.has('coverage-gap')).toBe(false);
  });
});
