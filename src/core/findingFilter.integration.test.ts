/**
 * Integration test: the post-processor wired into the analyzer pipeline.
 *
 * Constructs a synthetic finding stream that mimics the actual post-R14
 * analyzer output on the verify-documentation skill. The test asserts
 * the post-processor suppresses the known false positives and keeps
 * the real findings.
 *
 * If this test breaks, either:
 *   - a new false positive appeared in the analyzer output, OR
 *   - a new post-processor rule over-suppresses
 *
 * The expected counts are derived from the 2026-07-09 verification
 * session (commit 74c6a65 baseline + R14 fix at fda364f).
 */

import { describe, it, expect } from 'vitest';
import { filterFindings, FILTER_RULES, shouldSuppress } from './findingFilter';
import type { AnalysisResult, EngineConfig } from './types';

const baseConfig: EngineConfig = {
  analysisMode: 'multiWave',
  enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
  scoreSamples: 3,
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: true,
  filterFindings: true,
};

function makeResult(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    code: 'ambiguity-llm',
    message: 'placeholder',
    severity: 'warning',
    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
    analyzer: 'ambiguity-detection',
    relevantText: '',
    ...over,
  };
}

/**
 * The verify-documentation skill as it exists in commit fda364f.
 * Used as the source-of-truth for the post-processor's suppression rules.
 */
const verifyDocumentationSkill = `# Verify Documentation

This skill is invoked against one supplied document and produces one verification report.

---

# Purpose

The Purpose of this skill is to verify that the supplied Document is factually correct, internally consistent, and current. The only output is the verification report defined in the Output Format section.

---

# Definitions

- **Document**: The single file supplied for verification. Nothing else is in scope.
- **Claim**: A factual statement in the Document that asserts something about the repository.
- **Published**: The state of a Document at the moment the verification report is emitted.

---

# Requirements

A Document passes verification only when every Requirement below is satisfied.

## R1. Every Claim has Evidence

Every Claim in the Document must have supporting Evidence. An Unsupportable Claim must be Resolved by R2 before the report is emitted.

## R2. Unsupportable Claims are Resolved

Every Unsupportable Claim in the Document must receive a Resolution before the report is emitted. A Document must not be published with an unresolved Unsupportable Claim.

## R3. No Strengthening

A Modification applied to the Document must not make a Claim stronger than the Evidence supports.

## R14. Author Style is Preserved

A Permitted Modification may only change a Claim. A Permitted Modification must not change the Document's surrounding terminology, section order, or voice.

---

# Procedure

The verifier executes Step 1 through Step 7 in order.

## Step 1 — Identify the Document

The verifier records the Document path.

## Step 2 — Extract Claims

The verifier reads the Document completely.

## Step 7 — Produce the report

The verifier emits the verification report.
`;

describe('findingFilter integration: verify-documentation skill', () => {
  it('suppresses the known false positives on the post-R14 skill', () => {
    // Simulate the analyzer output on the verify-documentation skill.
    // The IDs and texts are taken from the 2026-07-09 verification runs.
    const findings: AnalysisResult[] = [
      // 1. "may" finding — was flagged on pre-R14 ("may change a Claim"),
      //    gone on post-R14 ("may only"). The post-processor would
      //    suppress it because it contains only protected tokens.
      makeResult({
        code: 'ambiguity-llm',
        relevantText: 'A Permitted Modification may change a Claim.',
        message: 'A Permitted Modification may change a Claim.',
      }),
      // 2. "every Requirement below is satisfied" — a real ambiguity
      //    according to the analyzer, but the post-processor's
      //    requirement-verb rule does NOT match (no "must" / "may only"
      //    in the relevant text). The analyzer's view is the more
      //    defensible one for this sentence, so we keep the finding.
      makeResult({
        code: 'ambiguity-llm',
        relevantText: 'A Document passes verification only when every Requirement below is satisfied.',
        message: 'A Document passes verification only when every Requirement below is satisfied.',
      }),
      // 3. "both Permitted and Forbidden" tautology — the analyzer reads
      //    this as ambiguous. The post-processor does NOT have a rule
      //    for this; we keep the finding.
      makeResult({
        code: 'ambiguity-llm',
        relevantText: 'A Modification that is both Permitted and Forbidden is Forbidden.',
        message: 'A Modification that is both Permitted and Forbidden is Forbidden.',
      }),
      // 4. R1 ↔ R2 contradiction — structural, real, kept.
      makeResult({
        code: 'contradiction',
        message:
          'Contradiction: "Every Claim in the Document must have supporting Evidence" conflicts with "must be Resolved by R2".',
      }),
      // 5. hygiene-non-actionable-preamble on a 1-sentence Purpose
      //    → suppressed by Rule 6 (preamble length ≤ 3 sentences).
      makeResult({
        code: 'hygiene-non-actionable-preamble',
        relevantText: 'The Purpose of this skill is to verify that the supplied Document is factually correct, internally consistent, and current.',
        message: 'The Purpose section provides background information without actionable instructions.',
      }),
      // 6. hygiene-unordered-process on a procedure that is numbered
      //    (Step 1, Step 2, ...Step 7) → suppressed by Rule 7.
      makeResult({
        code: 'hygiene-unordered-process',
        message: 'The Procedure section lists steps without explicit numbering.',
        relevantText: 'The verifier executes Step 1 through Step 7 in order.',
      }),
    ];

    const out = filterFindings(findings, baseConfig, verifyDocumentationSkill);
    const codes = out.map((f) => f.code);

    // Suppressed by post-processor:
    //   - finding 1: obligationTokenRule (only "may", which is protected)
    //   - finding 5: preambleLengthRule (1-sentence Purpose)
    //   - finding 6: numberedProcedureRule (Step 1 through Step 7)
    // Kept:
    //   - finding 2: ambiguity-llm "every Requirement below"
    //   - finding 3: ambiguity-llm "both Permitted and Forbidden"
    //   - finding 4: contradiction R1 ↔ R2

    expect(codes).not.toContain('hygiene-non-actionable-preamble');
    expect(codes.filter((c) => c === 'ambiguity-llm')).toHaveLength(2);
    expect(codes).toContain('contradiction');
    expect(out).toHaveLength(3);
  });

  it('does not suppress when filterFindings is false', () => {
    const findings: AnalysisResult[] = [
      makeResult({
        code: 'hygiene-non-actionable-preamble',
        relevantText: 'The Purpose of this skill is X.',
        message: 'Preamble.',
      }),
      makeResult({
        code: 'hygiene-unordered-process',
        message: 'Unordered.',
        relevantText: 'Step 1 then Step 2.',
      }),
    ];
    const doc = 'Step 1 — Do X. Step 2 — Do Y.';
    // With filterFindings: true (default), the post-processor suppresses
    // both findings (1-sentence Purpose and numbered procedure).
    const filtered = filterFindings(findings, baseConfig, doc);
    expect(filtered).toHaveLength(0);
    // With filterFindings: false, the post-processor is skipped entirely.
    const unfiltered = filterFindings(findings, { ...baseConfig, filterFindings: false }, doc);
    expect(unfiltered).toHaveLength(2);
  });

  it('FILTER_RULES has consistent ids and at least one rule per code we expect to filter', () => {
    const ids = new Set(FILTER_RULES.map((r) => r.id));
    // The rules that actually trigger on the verify-documentation skill:
    expect(ids.has('obligation-token-protected')).toBe(true);
    expect(ids.has('preamble-length')).toBe(true);
    expect(ids.has('numbered-procedure')).toBe(true);
  });
});
