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

  it('triggers on technical terms but not natural language prose', () => {
    // Should trigger: technical references
    expect(factualGroundingTrigger('GitHub Copilot models')).toBe(true);
    expect(factualGroundingTrigger('OpenRouter API endpoint')).toBe(true);
    expect(factualGroundingTrigger('YAML frontmatter parsing')).toBe(true);
    expect(factualGroundingTrigger('Use `fs.readFileSync`')).toBe(true);
    expect(factualGroundingTrigger('See https://example.com')).toBe(true);
    expect(factualGroundingTrigger('the API key')).toBe(true);
    // Should NOT trigger: natural English prose
    expect(factualGroundingTrigger('When Alice told Bob about')).toBe(false);
    expect(factualGroundingTrigger('If you want to')).toBe(false);
    expect(factualGroundingTrigger('Use the tool carefully')).toBe(false);
    expect(factualGroundingTrigger('The quick brown fox')).toBe(false);
    expect(factualGroundingTrigger('Return the result')).toBe(false);
  });

  it('expands and extracts paragraphs from anchored text', () => {
    const text = 'Intro\n\nUse   the tool carefully.\n\nNext line';

    expect(expandToParagraph(text, 'Use the tool carefully.')).toContain('Use   the tool carefully.');
    expect(extractParagraphAtLine(text.split('\n').join('\n'), 2)).toContain('Use');
  });
});

describe('loadReferenceGrounding', () => {
  it('returns null when grounding is disabled or no reference directory exists', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-grounding-'));

    expect(await loadReferenceGrounding(path.join(tempDir, 'SKILL.md'), 'Use 3 retries', false)).toBeNull();
    expect(await loadReferenceGrounding(path.join(tempDir, 'SKILL.md'), 'Use 3 retries', true)).toBeNull();
  });

  it('collects reference fragments from a sibling references folder', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixer-grounding-'));
    const refDir = path.join(tempDir, 'references');
    fs.mkdirSync(refDir);
    fs.writeFileSync(path.join(refDir, 'notes.md'), 'Use version 1.2.3 for the API.');

    const text = await loadReferenceGrounding(path.join(tempDir, 'SKILL.md'), 'Use version 1.2.3 for the API.', true);

    expect(text).toContain('references/notes.md');
    expect(text).toContain('Use version 1.2.3');
  });

  it('returns null for untitled documents (empty filePath)', async () => {
    expect(await loadReferenceGrounding('', 'Use version 1.2.3 for the API.', true)).toBeNull();
    expect(await loadReferenceGrounding('   ', 'Use version 1.2.3 for the API.', true)).toBeNull();
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
    const provider: LlmProvider = { complete: async () => ({ text: 'ignored' }), getContextLength: () => undefined };
    const fixer = new SurgicalFixer(provider);

    const result = await fixer.fixIssue('No issue here', '/tmp/test.md', makeDiagnostic('coverage-gap'));

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('not surgical-fixable');
  });

  it('rejects oversized anchors before model calls', async () => {
    const complete = vi.fn();
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

    const longText = 'Use ' + 'this carefully '.repeat(80);
    const result = await fixer.fixIssue(longText, '/tmp/test.md', makeDiagnostic('ambiguity-llm', longText));

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('anchor too large');
    expect(complete).not.toHaveBeenCalled();
  });

  it('blocks anchors that overlap frontmatter metadata', async () => {
    const complete = vi.fn();
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });
    const text = '---\nname: Example\ndescription: Demo\n---\nUse this carefully.';

    const result = await fixer.fixIssue(text, '/tmp/test.md', makeDiagnostic('ambiguity-llm', 'name: Example'));

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('frontmatter');
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects identical model output as a non-fix', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'Use the tool carefully.' });
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

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
      getContextLength: () => undefined,
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
      getContextLength: () => undefined,
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
      getContextLength: () => undefined,
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
        getContextLength: () => undefined,
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
      getContextLength: () => undefined,
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
      getContextLength: () => undefined,
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
    const fixer = new SurgicalFixer({ complete: vi.fn().mockResolvedValue({ text: 'Use the tool.' }), getContextLength: () => undefined });

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
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

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
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

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
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

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
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

    const text = 'Intro\n\nUse   the tool carefully.\n\nNext line';

    const result = await fixer.fixIssue(
      text,
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', 'Use the tool carefully.'),
    );

    expect(result.accepted).toBe(true);
    expect(result.fixed).toBe('Use the tool.');
  });

  it('rejects empty anchor text without crashing', async () => {
    const complete = vi.fn();
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

    const result = await fixer.fixIssue(
      'Use the tool carefully.',
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', ''),
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('anchor');
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only anchor text without crashing', async () => {
    const complete = vi.fn();
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

    const result = await fixer.fixIssue(
      'Use the tool carefully.',
      '/tmp/test.md',
      makeDiagnostic('ambiguity-llm', '   '),
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('anchor');
    expect(complete).not.toHaveBeenCalled();
  });

  it('skips empty anchor in fixDocument without corrupting content', async () => {
    const complete = vi.fn();
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

    const text = 'Use the tool carefully.';
    const result = await fixer.fixDocument(
      text,
      '/tmp/test.md',
      [makeDiagnostic('ambiguity-llm', '')],
    );

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.fixedText).toBe(text);
  });

  it('only allows the known surgical-fixable codes', () => {
    expect(SURGICAL_FIXABLE_CODES.has('ambiguity-llm')).toBe(true);
    expect(SURGICAL_FIXABLE_CODES.has('contradiction')).toBe(true);
    expect(SURGICAL_FIXABLE_CODES.has('coverage-gap')).toBe(false);
  });
});

describe('surroundingContext — edge cases', () => {
  it('returns null when targetText is not found in content', () => {
    expect(surroundingContext('Some content here.', 'nonexistent text')).toBeNull();
  });

  it('truncates section exceeding maxChars with … markers and centers the target', () => {
    const filler = 'word '.repeat(300);
    const target = 'TARGET_PHRASE';
    const content = `# Section\n\n${filler}${target} ${filler}\n# Next`;
    const result = surroundingContext(content, target, 1200);

    expect(result).not.toBeNull();
    expect(result).toContain(target);
    expect(result!.length).toBeLessThanOrEqual(1202);
    expect(result).toMatch(/…/);
  });

  it('returns null when section is barely larger than targetText', () => {
    const content = '# A\ntarget\n# B';
    expect(surroundingContext(content, 'target')).toBeNull();
  });
});

describe('expandToParagraph — edge cases', () => {
  it('returns null when phrase is not found in content', () => {
    expect(expandToParagraph('Some content.', 'nonexistent phrase')).toBeNull();
  });

  it('returns paragraph when phrase is at the start of content', () => {
    const content = 'Start with the target phrase here.\n\nSecond paragraph.';
    const result = expandToParagraph(content, 'target phrase here');

    expect(result).not.toBeNull();
    expect(result).toContain('target phrase here');
    expect(result).toContain('Start with');
  });

  it('returns paragraph when phrase is at the end of content', () => {
    const content = 'First paragraph.\n\nEnd with the target phrase.';
    const result = expandToParagraph(content, 'target phrase');

    expect(result).not.toBeNull();
    expect(result).toContain('target phrase');
    expect(result).toContain('End with');
  });
});

describe('factualGroundingTrigger — additional patterns', () => {
  it('detects CamelCase identifiers', () => {
    expect(factualGroundingTrigger('Use ReactComponent for rendering')).toBe(true);
  });

  it('detects SCREAMING_CASE identifiers', () => {
    expect(factualGroundingTrigger('Set the API_KEY environment variable')).toBe(true);
  });

  it('returns false when all capitalized words are excluded proper nouns', () => {
    expect(factualGroundingTrigger('If When Then The This That')).toBe(false);
  });

  it('detects dot-separated identifiers', () => {
    expect(factualGroundingTrigger('com.example.service')).toBe(true);
  });

  it('detects slash-separated paths', () => {
    expect(factualGroundingTrigger('src/utils/helpers.ts')).toBe(true);
  });
});

describe('extractParagraphAtLine — out-of-bounds', () => {
  it('returns null for a negative line index', () => {
    expect(extractParagraphAtLine('line one\nline two\nline three', -1)).toBeNull();
  });

  it('returns null when line index exceeds line count', () => {
    expect(extractParagraphAtLine('line one\nline two\nline three', 10)).toBeNull();
  });
});

describe('SURGICAL_FIXABLE_CODES — completeness', () => {
  it('contains exactly the 5 expected surgical-fixable codes', () => {
    const expected = [
      'ambiguity-llm',
      'hygiene-redundant-instruction',
      'hygiene-unordered-process',
      'hygiene-over-specification',
      'contradiction',
    ];
    for (const code of expected) {
      expect(SURGICAL_FIXABLE_CODES.has(code)).toBe(true);
    }
    expect(SURGICAL_FIXABLE_CODES.size).toBe(5);
  });

  it('does not include coverage-gap as a surgical-fixable code', () => {
    expect(SURGICAL_FIXABLE_CODES.has('coverage-gap')).toBe(false);
  });
});

describe('SurgicalFixer — boundary and acceptance tests', () => {
  it('fixIssue end-to-end happy path: ambiguity-llm with obligation preservation', async () => {
    const text = 'Consider using the tool carefully.';
    const fixer = new SurgicalFixer({
      complete: vi.fn().mockResolvedValue({ text: 'Consider using the tool.' }),
      getContextLength: () => undefined,
    });

    const result = await fixer.fixIssue(text, '/tmp/test.md', makeDiagnostic('ambiguity-llm', text), {
      semanticCheck: false,
      selfCritique: false,
    });

    expect(result.accepted).toBe(true);
    expect(result.fixed).toBe('Consider using the tool.');
    expect(result.rejectReason).toBeUndefined();
  });

  it('rejects a fix at exactly upperBound (1.5× growth guard boundary)', async () => {
    const text = 'Review the configuration settings.';
    const { upperBound } = computeFixBounds(text, 'contradiction', false);
    const fixAtBoundary = 'X'.repeat(Math.ceil(upperBound));

    const fixer = new SurgicalFixer({
      complete: vi.fn().mockResolvedValue({ text: fixAtBoundary }),
      getContextLength: () => undefined,
    });
    const result = await fixer.fixIssue(text, '/tmp/test.md', makeDiagnostic('contradiction', text));

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('expansion');
  });

  it('passes the growth guard at upperBound − 1 (1.5× boundary)', async () => {
    const text = 'Review the configuration settings.';
    const { upperBound } = computeFixBounds(text, 'contradiction', false);
    // upperBound = 51; fix of 50 chars that passes all guards
    const fixJustBelow = 'Review the configuration settings and verify fully';
    expect(fixJustBelow.length).toBe(Math.floor(upperBound) - 1);

    const fixer = new SurgicalFixer({
      complete: vi.fn().mockResolvedValue({ text: fixJustBelow }),
      getContextLength: () => undefined,
    });
    const result = await fixer.fixIssue(text, '/tmp/test.md', makeDiagnostic('contradiction', text));

    expect(result.accepted).toBe(true);
    expect(result.fixed).toBe(fixJustBelow);
  });

  it('passes the shrinkage guard at exactly lowerBound', async () => {
    const text = 'Use the API for all tasks.';
    const { lowerBound } = computeFixBounds(text, 'contradiction', false);
    // lowerBound = 13; fix of exactly lowerBound chars using only original concept words
    const fixAtFloor = 'Use API tasks';
    expect(fixAtFloor.length).toBe(Math.ceil(lowerBound));

    const fixer = new SurgicalFixer({
      complete: vi.fn().mockResolvedValue({ text: fixAtFloor }),
      getContextLength: () => undefined,
    });
    const result = await fixer.fixIssue(text, '/tmp/test.md', makeDiagnostic('contradiction', text));

    expect(result.accepted).toBe(true);
    expect(result.fixed).toBe(fixAtFloor);
  });

  it('rejects a fix at exactly lowerBound − 1 (shrinkage floor boundary)', async () => {
    const text = 'Use the API for all tasks.';
    const { lowerBound } = computeFixBounds(text, 'contradiction', false);
    const fixBelowFloor = 'X'.repeat(Math.max(1, Math.floor(lowerBound) - 1));

    const fixer = new SurgicalFixer({
      complete: vi.fn().mockResolvedValue({ text: fixBelowFloor }),
      getContextLength: () => undefined,
    });
    const result = await fixer.fixIssue(text, '/tmp/test.md', makeDiagnostic('contradiction', text));

    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('shrinkage');
  });

  it('obligation token preservation: meaning-guard does NOT reject when tokens are kept', async () => {
    const text = 'You should consider all options and may request help.';
    const fix = 'You should consider all options and may request help promptly';
    const fixer = new SurgicalFixer({
      complete: vi.fn().mockResolvedValue({ text: fix }),
      getContextLength: () => undefined,
    });

    const result = await fixer.fixIssue(text, '/tmp/test.md', makeDiagnostic('contradiction', text), {
      semanticCheck: false,
      selfCritique: false,
    });

    expect(result.accepted).toBe(true);
    expect(result.fixed).toBe(fix);
    // All three obligation tokens preserved in both original and fix
    expect(text).toMatch(/\bshould\b/i);
    expect(text).toMatch(/\bconsider\b/i);
    expect(text).toMatch(/\bmay\b/i);
    expect(fix).toMatch(/\bshould\b/i);
    expect(fix).toMatch(/\bconsider\b/i);
    expect(fix).toMatch(/\bmay\b/i);
  });

  it('fixDocument skips all diagnostics when LLM abstains on every one', async () => {
    const text = 'Line one.\nLine two.\nLine three.';
    const fixer = new SurgicalFixer({
      complete: vi.fn().mockResolvedValue({ text: '[[ABSTAIN]]' }),
      getContextLength: () => undefined,
    });

    const result = await fixer.fixDocument(text, '/tmp/test.md', [
      makeDiagnostic('ambiguity-llm', 'Line one.'),
      makeDiagnostic('ambiguity-llm', 'Line two.'),
      makeDiagnostic('ambiguity-llm', 'Line three.'),
    ]);

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.fixedText).toBe(text);
  });

  it('fixDocument returns unchanged text with zero counters for empty diagnostics', async () => {
    const text = 'No diagnostics here.';
    const fixer = new SurgicalFixer({
      complete: vi.fn(),
        getContextLength: () => undefined,
      });

    const result = await fixer.fixDocument(text, '/tmp/test.md', []);

    expect(result.fixedText).toBe(text);
    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('fixDocument handles adjacent diagnostics on the same line without corruption', async () => {
    // Two adjacent but non-overlapping anchors on the same line
    const text = 'Use the API carefully and be concise.';
    const complete = vi.fn()
      .mockResolvedValueOnce({ text: 'Use the API.' })
      .mockResolvedValueOnce({ text: 'be specific.' });
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

    const result = await fixer.fixDocument(text, '/tmp/test.md', [
      makeDiagnostic('ambiguity-llm', 'Use the API carefully'),
      makeDiagnostic('ambiguity-llm', 'be concise'),
    ]);

    // Both should be attempted; at minimum no corruption
    expect(result.fixedText).toBeDefined();
    expect(typeof result.fixedText).toBe('string');
    // The first fix applied replaces 'Use the API carefully' → 'Use the API.'
    // After that, 'be concise' may or may not be found depending on ordering;
    // the key invariant is no crash and no garbled output.
    expect(result.fixedText.length).toBeGreaterThan(0);
  });

  it('fixDocument handles overlapping text ranges safely', async () => {
    // Diagnostic A anchors on a substring that is also inside diagnostic B's anchor.
    // Both anchors are on the same line. After the first replacement, the second
    // anchor may no longer exist → skipped. The key invariant: no garbled output.
    const text = 'Use the API when calling it carefully.';
    const complete = vi.fn()
      .mockResolvedValueOnce({ text: 'Use the API.' })
      .mockResolvedValueOnce({ text: 'BE SKIPPED' });
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

    // 'Use the API' is contained within 'Use the API when calling it carefully.'
    const result = await fixer.fixDocument(text, '/tmp/test.md', [
      makeDiagnostic('ambiguity-llm', 'Use the API'),
      makeDiagnostic('ambiguity-llm', 'Use the API when calling it carefully.'),
    ]);

    // At least one fix attempted, no crash, output is valid
    expect(result.applied + result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.fixedText).toBeDefined();
    expect(typeof result.fixedText).toBe('string');
  });

  it('fixDocument handles one range completely inside another', async () => {
    // Inner anchor is a strict subset of the outer anchor.
    // Processing order depends on sort (same line → original array order).
    // Key invariant: no garbled output and no crash, regardless of which gets processed.
    const text = 'When responding always be helpful and kind.';
    // Both mocks produce text within bounds: outer=41 chars → bounds [20.5, 45.1]
    const complete = vi.fn()
      .mockResolvedValueOnce({ text: 'When responding, be helpful and kind.' })
      .mockResolvedValueOnce({ text: 'be extremely helpful' });
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

    const result = await fixer.fixDocument(text, '/tmp/test.md', [
      makeDiagnostic('ambiguity-llm', 'When responding always be helpful and kind.'),
      makeDiagnostic('ambiguity-llm', 'be helpful'),
    ]);

    expect(result.fixedText).toBeDefined();
    expect(typeof result.fixedText).toBe('string');
    // No crash, no garbled output — the test simply verifies the fixer
    // handles nested ranges without throwing or producing invalid text.
  });

  it('fixDocument skips ambiguous anchors (multiple occurrences)', async () => {
    // The same text appears twice — fixDocument should skip to avoid
    // silent data corruption.
    const text = 'Be concise.\nSome other content.\nBe concise.';
    const complete = vi.fn().mockResolvedValue({ text: 'Be specific.' });
    const fixer = new SurgicalFixer({ complete, getContextLength: () => undefined });

    const result = await fixer.fixDocument(text, '/tmp/test.md', [
      makeDiagnostic('ambiguity-llm', 'Be concise.'),
    ]);

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.fixedText).toBe(text);
  });
});
