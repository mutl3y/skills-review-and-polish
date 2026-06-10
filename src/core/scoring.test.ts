import { describe, it, expect } from 'vitest';
import { classifyCode, parseSkillType, scoreSkill } from './scoring';
import type { AnalysisResult } from './types';

function makeResult(code: string, severity: AnalysisResult['severity'] = 'warning'): AnalysisResult {
  return {
    code,
    message: `Issue: ${code}`,
    severity,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    analyzer: 'test',
  };
}

describe('parseSkillType', () => {
  it('defaults to standard when frontmatter is absent', () => {
    expect(parseSkillType('No frontmatter here')).toBe('standard');
  });

  it('recognizes known skill types from YAML frontmatter', () => {
    expect(parseSkillType('---\ntype: workflow\n---\nBody')).toBe('workflow');
    expect(parseSkillType('---\ntype: meta\n---\nBody')).toBe('meta');
    expect(parseSkillType('---\ntype: simple\n---\nBody')).toBe('simple');
  });

  it('falls back to standard for unknown types', () => {
    expect(parseSkillType('---\ntype: custom\n---\nBody')).toBe('standard');
  });
});

describe('classifyCode', () => {
  it('maps contradiction heuristics to the contradictions pillar', () => {
    expect(classifyCode('contradiction')).toBe('Contradictions');
    expect(classifyCode('hygiene-circular-definition')).toBe('Contradictions');
  });

  it('maps clarity issues to the clarity pillar', () => {
    expect(classifyCode('ambiguity-llm')).toBe('Clarity');
    expect(classifyCode('persona-inconsistency')).toBe('Clarity');
  });

  it('maps coverage and dead instructions to completeness', () => {
    expect(classifyCode('coverage-gap')).toBe('Completeness');
    expect(classifyCode('limited-coverage')).toBe('Completeness');
  });

  it('maps structural and hygiene issues to the right pillars', () => {
    expect(classifyCode('cognitive-nested-conditions')).toBe('Structure');
    expect(classifyCode('hygiene-over-specification')).toBe('Structure');
    expect(classifyCode('hygiene-dead-instruction')).toBe('Completeness');
  });

  it('returns Contradictions for contradiction-related (now classified, not infra)', () => {
    expect(classifyCode('contradiction-related')).toBe('Contradictions');
    expect(classifyCode('llm-disabled')).toBe('Other');
  });
});

describe('scoreSkill', () => {
  it('applies severity weights and length penalties to the overall score', () => {
    const result = scoreSkill([
      makeResult('ambiguity-llm', 'warning'),
      makeResult('coverage-gap', 'error'),
      makeResult('hygiene-redundant-instruction', 'info'),
    ], 120, 'standard');

    expect(result.issuePenalty).toBe(6 + 15 + 2);
    expect(result.lengthPenalty).toBe(0);
    expect(result.score).toBe(77);
    expect(result.grade).toBe('B');
    expect(result.pillars).toEqual({
      Contradictions: 0,
      Clarity: 1,
      Completeness: 1,
      Structure: 1,
      Other: 0,
    });
  });

  it('drops cognitive findings to info for workflow and meta skill types', () => {
    const result = scoreSkill([
      makeResult('cognitive-nested-conditions', 'warning'),
    ], 80, 'workflow');

    expect(result.issuePenalty).toBe(2);
    expect(result.score).toBe(98);
  });

  it('skips infrastructure-only diagnostics from the penalty total', () => {
    const result = scoreSkill([
      makeResult('llm-loop-detected', 'error'),
      makeResult('contradiction-related', 'warning'),
      makeResult('hygiene-over-specification', 'hint'),
    ], 90, 'simple');

    // llm-loop-detected is infra (skipped). contradiction-related is now classified
    // as Contradictions (warning = 6 penalty). hygiene-over-specification is Structure (hint = 1).
    expect(result.total).toBe(2);
    expect(result.issuePenalty).toBe(7);
    expect(result.score).toBe(93);
  });

  it('applies the correct length tier penalty for longer files', () => {
    const result = scoreSkill([makeResult('ambiguity-llm', 'info')], 400, 'standard');

    expect(result.lengthPenalty).toBe(12);
    expect(result.lengthLabel).toContain('Too long');
    expect(result.score).toBe(86);
  });

  it('uses the higher threshold offset for workflow and meta files', () => {
    const workflow = scoreSkill([makeResult('ambiguity-llm', 'warning')], 40, 'workflow');
    const meta = scoreSkill([makeResult('ambiguity-llm', 'warning')], 40, 'meta');

    expect(workflow.thresholdOffset).toBe(10);
    expect(meta.thresholdOffset).toBe(15);
    expect(workflow.grade).toBe('A+');
    expect(meta.grade).toBe('A+');
  });

  it('caps grade at Ungraded when llm-error is present (incomplete analysis)', () => {
    const result = scoreSkill([
      makeResult('llm-error', 'warning'),
    ], 40, 'standard');

    expect(result.incomplete).toBe(true);
    expect(result.infraErrorCount).toBe(1);
    expect(result.grade).toBe('Ungraded');
  });

  it('caps grade at Ungraded when llm-parse-error is present', () => {
    const result = scoreSkill([
      makeResult('llm-parse-error', 'warning'),
    ], 40, 'standard');

    expect(result.incomplete).toBe(true);
    expect(result.grade).toBe('Ungraded');
  });

  it('caps grade at Ungraded when multiple wave failures occurred', () => {
    const result = scoreSkill([
      makeResult('llm-error', 'warning'),
      makeResult('llm-error', 'warning'),
      makeResult('llm-error', 'warning'),
    ], 40, 'standard');

    expect(result.incomplete).toBe(true);
    expect(result.infraErrorCount).toBe(3);
    expect(result.grade).toBe('Ungraded');
  });

  it('does NOT cap grade when analysis is complete (no llm-error)', () => {
    const result = scoreSkill([
      makeResult('ambiguity-llm', 'info'),
    ], 40, 'standard');

    expect(result.incomplete).toBe(false);
    expect(result.grade).toBe('A+');
  });

  it('reports incomplete flag correctly', () => {
    // Empty results = analysis didn't happen → incomplete
    const empty = scoreSkill([], 40, 'standard');
    expect(empty.incomplete).toBe(true);
    expect(empty.grade).toBe('Ungraded');

    // With errors → incomplete
    const errored = scoreSkill([makeResult('llm-error', 'warning')], 40, 'standard');
    expect(errored.incomplete).toBe(true);
  });
});
