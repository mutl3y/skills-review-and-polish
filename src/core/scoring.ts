/**
 * Quality scoring — extension-agnostic.
 *
 * Implements skill quality assessment and grading.
 *
 * See docs/plan/LEARNINGS.md: "The noise floor is ±6" — do not chase small
 * score changes; use median-of-N (see Engine.score()).
 */

import { AnalysisResult, COGNITIVE_DOWNGRADE_CODES } from './types';

export type SkillType = 'simple' | 'standard' | 'workflow' | 'meta';
export type GradeLetter = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F';

export type CodePillar = 'Contradictions' | 'Clarity' | 'Completeness' | 'Structure' | 'Other';

export interface ScoreResult {
  score: number;
  grade: GradeLetter;
  issuePenalty: number;
  lengthPenalty: number;
  lengthLabel: string;
  lineCount: number;
  pillars: Record<CodePillar, number>;
  skillType: SkillType;
  thresholdOffset: number;
  total: number;
  /** True when wave failures or parse errors prevented full analysis. */
  incomplete: boolean;
  /** Number of infrastructure errors (llm-error, llm-parse-error, llm-disabled). */
  infraErrorCount: number;
}

// ─── Infrastructure codes (excluded from scoring) ─────────────────────────────
const 
INFRA_SKIP = new Set([
  'llm-error', 'llm-parse-error', 'llm-disabled', 'llm-loop-detected',
  'high-complexity', 'limited-coverage',
]);

// ─── Length tiers ─────────────────────────────────────────────────────────────
const LENGTH_TIERS: Array<{ max: number; penalty: number; label: string }> = [
  { max: 200,       penalty: 0,  label: 'Ideal length' },
  { max: 350,       penalty: 5,  label: 'Getting verbose — consider splitting into focused sub-skills' },
  { max: 550,       penalty: 12, label: 'Too long — extract reference material to JIT-loaded files' },
  { max: 800,       penalty: 22, label: 'Significantly bloated — refactor with on-demand file references' },
  { max: Infinity,  penalty: 35, label: 'Over-scoped — break into multiple skills using JIT loading' },
];

// ─── Grade thresholds ─────────────────────────────────────────────────────────
const GRADE_THRESHOLDS: Array<{ minOffset: number; grade: GradeLetter }> = [
  { minOffset: 97, grade: 'A+' },
  { minOffset: 90, grade: 'A'  },
  { minOffset: 85, grade: 'A-' },
  { minOffset: 80, grade: 'B+' },
  { minOffset: 75, grade: 'B'  },
  { minOffset: 70, grade: 'B-' },
  { minOffset: 65, grade: 'C+' },
  { minOffset: 60, grade: 'C'  },
  { minOffset: 55, grade: 'C-' },
  { minOffset: 50, grade: 'D+' },
  { minOffset: 45, grade: 'D'  },
  { minOffset: 40, grade: 'D-' },
  { minOffset: 0,  grade: 'F'  },
];

// ─── Severity weights ─────────────────────────────────────────────────────────
const SEVERITY_WEIGHTS: Record<string, number> = { error: 15, warning: 6, info: 2, hint: 1 };

/**
 * Parse the `type:` field from SKILL.md YAML frontmatter.
 * Recognised values: simple | standard (default) | workflow | meta.
 */
export function parseSkillType(text: string): SkillType {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return 'standard';
  const typeMatch = match[1].match(/^type:\s*(\S+)/m);
  const raw = typeMatch ? typeMatch[1].toLowerCase() : 'standard';
  return (['simple', 'standard', 'workflow', 'meta'] as const).includes(raw as SkillType)
    ? (raw as SkillType)
    : 'standard';
}

/**
 * Map a diagnostic code to its quality pillar.
 * Returns null for supplemental / infra codes that don't belong to a pillar.
 */
export function classifyCode(code: string): CodePillar | null {
  if (code === 'contradiction' || code === 'contradiction-related' || code === 'hygiene-circular-definition') return 'Contradictions';
  if (code === 'ambiguity-llm' || code === 'persona-inconsistency' ||
      code === 'hygiene-obligation-strength') return 'Clarity';
  if (code === 'coverage-gap' || code === 'limited-coverage' ||
      code === 'hygiene-dead-instruction') return 'Completeness';
  if (code.startsWith('cognitive-') || code === 'high-complexity' ||
      code.startsWith('hygiene-')) return 'Structure';
  return 'Other';
}

/**
 * Codes that indicate analysis was incomplete or failed.
 * When present, the score should be capped — you can't grade what wasn't analyzed.
 */
const INCOMPLETE_ANALYSIS_CODES = new Set([
  'llm-error', 'llm-parse-error', 'llm-disabled',
]);

/** Maximum grade when analysis is incomplete. */
const INCOMPLETE_GRADE_CAP = 'B-';

/**
 * Compute the quality score, grade and pillar breakdown for a skill file.
 *
 * Formula: score = 100 − issuePenalty − lengthPenalty (clamped to 0).
 * Issue penalty: error×15  warning×6  info×2  hint×1.
 * Length penalty: tiered by line count (see LENGTH_TIERS above).
 * Grade thresholds shift −10 (workflow) or −15 (meta) for complex skill types.
 *
 * When wave failures or parse errors are present, the grade is capped at B-
 * to prevent misleading A grades on incomplete analysis.
 */
export function scoreSkill(
  results: AnalysisResult[],
  lineCount: number,
  skillType: SkillType = 'standard',
): ScoreResult {
  // Detect incomplete analysis — wave failures, parse errors, disabled LLM
  const incomplete = results.some(r => INCOMPLETE_ANALYSIS_CODES.has(r.code));
  const infraErrorCount = results.filter(r => INCOMPLETE_ANALYSIS_CODES.has(r.code)).length;

  // workflow / meta: cognitive-structure findings downgraded warning→info.
  const cognitiveDowngrade =
    skillType === 'workflow' || skillType === 'meta'
      ? new Set(COGNITIVE_DOWNGRADE_CODES)
      : new Set<string>();

  const scored = results
    .filter(r => !INFRA_SKIP.has(r.code))
    .map(r => cognitiveDowngrade.has(r.code) ? { ...r, severity: 'info' as const } : r);

  const issuePenalty = scored.reduce(
    (sum, r) => sum + (SEVERITY_WEIGHTS[r.severity] ?? 1),
    0,
  );

  const lengthTier = LENGTH_TIERS.find(t => lineCount <= t.max)!;
  const score = Math.max(0, 100 - issuePenalty - lengthTier.penalty);

  const THRESHOLD_OFFSETS: Record<SkillType, number> = { simple: 0, standard: 0, workflow: 10, meta: 15 };
  const thresholdOffset = THRESHOLD_OFFSETS[skillType];
  const gradeEntry = GRADE_THRESHOLDS.find(t => score >= t.minOffset - thresholdOffset) ?? GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];
  let grade = gradeEntry.grade;

  // Cap grade when analysis is incomplete — don't show A/A+ when waves failed.
  // Grade comparison uses threshold index (higher index = better grade).
  if (incomplete) {
    const capIdx = GRADE_THRESHOLDS.findIndex(t => t.grade === INCOMPLETE_GRADE_CAP);
    const gradeIdx = GRADE_THRESHOLDS.findIndex(t => t.grade === grade);
    if (capIdx >= 0 && gradeIdx >= 0 && gradeIdx < capIdx) {
      grade = INCOMPLETE_GRADE_CAP;
    }
  }

  const pillars: Record<CodePillar, number> = {
    Contradictions: 0, Clarity: 0, Completeness: 0, Structure: 0, Other: 0,
  };
  for (const r of scored) {
    const p = classifyCode(r.code);
    if (p) pillars[p]++;
  }

  return {
    score,
    grade,
    issuePenalty,
    lengthPenalty: lengthTier.penalty,
    lengthLabel: lengthTier.label,
    lineCount,
    pillars,
    skillType,
    thresholdOffset,
    total: scored.length,
    incomplete,
    infraErrorCount,
  };
}
