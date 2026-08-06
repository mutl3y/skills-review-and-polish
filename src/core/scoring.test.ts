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
    expect(classifyCode('cognitive-logical-inversion')).toBe('Structure');
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
      makeResult('cognitive-logical-inversion', 'warning'),
    ], 80, 'workflow');

    expect(result.issuePenalty).toBe(4);
    expect(result.score).toBe(96);
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
    // Tuned 2026-07-10: tiers are now ≤300/0, ≤500/3, ≤750/8, ≤1200/15, >1200/22
    // (was ≤200/0, ≤350/5, ≤550/12, ≤800/22, >800/35).
    // Test at 400 lines (now in the 3-pt "Getting verbose" tier).
    const result = scoreSkill([makeResult('ambiguity-llm', 'info')], 400, 'standard');

    expect(result.lengthPenalty).toBe(3);
    expect(result.lengthLabel).toContain('Getting verbose');
    expect(result.score).toBe(95);
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
    // Fixed 2026-07-10: empty results WITHOUT infra codes = clean skill, NOT
    // incomplete. A clean skill gets a real grade (A+ minus lengthPenalty),
    // not "Ungraded". Only results that are ALL infra codes → Ungraded.
    const empty = scoreSkill([], 40, 'standard');
    expect(empty.incomplete).toBe(false);
    expect(empty.grade).toBe('A+'); // 100 - 0 - 0 (length 40 is in ideal tier)

    // Only-infra results = analysis truly failed → Ungraded
    const errored = scoreSkill([makeResult('llm-error', 'warning')], 40, 'standard');
    expect(errored.incomplete).toBe(true);
    expect(errored.grade).toBe('Ungraded');

    // Mixed results (one real finding + one infra code) = partial failure →
    // still Ungraded. A failed wave means unknown findings; a letter grade
    // would assert completeness we can't vouch for (changed 2026-07-19: was
    // "real grade, no cap", which let a 5-findings-plus-one-dead-wave run
    // report A-).
    const mixed = scoreSkill([
      makeResult('llm-error', 'warning'),
      makeResult('ambiguity-llm', 'warning'),
    ], 40, 'standard');
    expect(mixed.incomplete).toBe(true);
    expect(mixed.grade).toBe('Ungraded');
    // Score is still computed from real findings — only the grade is withheld.
    expect(mixed.score).toBeGreaterThan(0);
  });

  it('does NOT cap grade when only meta findings are present (loop/complexity/coverage)', () => {
    // Regression: llm-loop-detected / high-complexity / limited-coverage are
    // legitimate model findings, NOT analysis failures. They must be excluded
    // from the penalty but must NOT force `incomplete` / Ungraded. A run that
    // produced real findings plus a loop-detection meta code should still get
    // a real grade (the poolside/laguna-m.1:free run was wrongly Ungraded).
    const withLoop = scoreSkill([
      makeResult('llm-loop-detected', 'warning'),
      makeResult('ambiguity-llm', 'warning'),
    ], 40, 'standard');
    expect(withLoop.incomplete).toBe(false);
    // llm-loop-detected is excluded from penalty; ambiguity-llm warning = 6 → score 94 → A.
    expect(withLoop.grade).toBe('A');
    expect(withLoop.score).toBeGreaterThan(0);

    const withMeta = scoreSkill([
      makeResult('high-complexity', 'warning'),
      makeResult('limited-coverage', 'warning'),
      makeResult('contradiction', 'error'),
    ], 40, 'standard');
    expect(withMeta.incomplete).toBe(false);
    expect(withMeta.grade).not.toBe('Ungraded');
  });

  it('counts rate-limited waves without double-counting the summary diagnostic', () => {
    // The analyzer emits one `llm-rate-limited` per affected wave PLUS a single
    // `llm-rate-limited-summary` diagnostic. The summary must not inflate
    // rateLimitedWaveCount (regression: it used to share the same code, so N
    // waves reported N+1).
    const result = scoreSkill([
      makeResult('llm-rate-limited', 'warning'),
      makeResult('llm-rate-limited', 'warning'),
      makeResult('llm-rate-limited-summary', 'warning'),
    ], 40, 'standard');

    expect(result.rateLimitedWaveCount).toBe(2);
    expect(result.incomplete).toBe(true);
    expect(result.grade).toBe('Ungraded');
  });

  it('returns score 0 when the ONLY results are rate-limit failures (incl. summary)', () => {
    // A fully rate-limited run emits per-wave llm-rate-limited codes PLUS a
    // llm-rate-limited-summary. The summary must count as a true-failure code
    // so the all-failure early return fires (score 0), not a ~100 score with
    // grade Ungraded.
    const result = scoreSkill([
      makeResult('llm-rate-limited', 'warning'),
      makeResult('llm-rate-limited', 'warning'),
      makeResult('llm-rate-limited-summary', 'warning'),
    ], 40, 'standard');

    expect(result.incomplete).toBe(true);
    expect(result.score).toBe(0);
    expect(result.grade).toBe('Ungraded');
  });
});
