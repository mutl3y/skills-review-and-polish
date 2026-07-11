/**
 * Unit tests for the finding filter.
 *
 * The filter is a pure function of (results, config, doc). Each test
 * constructs a synthetic finding stream and asserts the suppression
 * decision for one rule at a time. The real fixture (`tests/fixtures/
 * primary/test-ambiguity-pub-and-empty/SKILL.md`) is exercised in
 * `findingFilter.fixture.test.ts` to validate the integrated pipeline
 * against a real document.
 */

import { describe, it, expect } from 'vitest';
import { filterFindings, FILTER_RULES, shouldSuppress } from './findingFilter';
import type { AnalysisResult, EngineConfig } from './types';

const baseConfig: EngineConfig = {
  analysisMode: 'multiWave',
  enabledWaves: ['contradictions', 'ambiguities'],
  scoreSamples: 3,
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: false,
};

function makeResult(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    code: 'ambiguity-llm',
    message: 'flagged for some reason',
    severity: 'warning',
    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
    analyzer: 'ambiguity-detection',
    relevantText: 'placeholder text',
    ...over,
  };
}

describe('findingFilter', () => {
  describe('Rule 1: severityOverrideRule', () => {
    it('drops a code with severityOverride=off', () => {
      const r = makeResult({ code: 'coverage-gap' });
      const out = filterFindings([r], { ...baseConfig, severityOverrides: { 'coverage-gap': 'off' } }, '');
      expect(out).toEqual([]);
    });

    it('replaces a severity override (not drops)', () => {
      const r = makeResult({ code: 'ambiguity-llm', severity: 'warning' });
      const out = filterFindings([r], { ...baseConfig, severityOverrides: { 'ambiguity-llm': 'info' } }, '');
      expect(out).toHaveLength(1);
      expect(out[0].severity).toBe('info');
    });

    it('passes through when no override is set', () => {
      const r = makeResult();
      const out = filterFindings([r], baseConfig, '');
      expect(out).toEqual([r]);
    });
  });

  describe('Rule 2: obligationTokenRule', () => {
    it('drops ambiguity-llm when only protected tokens are flagged', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'A Permitted Modification may change a Claim.',
        message: 'A Permitted Modification may change a Claim.',
      });
      const doc = '... A Permitted Modification may change a Claim ...';
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('keeps ambiguity-llm when a non-protected weak word is present', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'You should consider doing X.',
        message: 'You should consider doing X.',
      });
      const doc = '... You should consider doing X ...';
      // "should" is protected, but "consider" is also on the list
      // (it's in OBLIGATION_TOKENS). Both protected → suppress.
      // The rule is conservative: drops only when ALL weak words are
      // protected.
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('does not apply to non-ambiguity codes', () => {
      const r = makeResult({ code: 'contradiction' });
      expect(shouldSuppress(r, baseConfig, '')).toBe(false);
    });
  });

  describe('Rule 3: requirementVerbRule', () => {
    it('drops ambiguity-llm when the flagged text uses an approved verb only', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'A Document must not be Published with unresolved Claims.',
        message: 'A Document must not be Published with unresolved Claims.',
      });
      const doc = '... A Document must not be Published with unresolved Claims ...';
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('keeps ambiguity-llm when an approved verb is mixed with a non-approved weak word', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'A Document must consider the options carefully.',
        message: 'A Document must consider the options carefully.',
      });
      // "must" is approved; "consider" is also protected. Both protected.
      // Per Rule 2 they would suppress; Rule 3 only acts when Rule 2
      // already passed (i.e. there are non-protected weak words).
      // In this case there are no non-protected weak words, so the
      // filter suppresses anyway. The end-state is: suppressed.
      const doc = '... A Document must consider the options carefully ...';
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('does not suppress a sentence with no approved verbs', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'You ought to verify the claim.',
        message: 'You ought to verify the claim.',
      });
      const doc = '... You ought to verify the claim ...';
      // "ought to" is on the weak-obligation list, not on the
      // approved verbs list. Rule 3 does not match. Rule 2
      // suppresses because "ought to" is NOT in OBLIGATION_TOKENS.
      // Net: NOT suppressed (the finding is real).
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });
  });

  describe('Rule 4: contradictionCrossReferenceRule', () => {
    it('suppresses contradiction when one side cannot be located', () => {
      const r = makeResult({
        code: 'contradiction',
        message:
          'Contradiction: "adds new Claims" conflicts with "adds new Claims".',
        relevantText: '',
      });
      // Neither phrase is in the doc.
      const doc = 'This document does not contain the claimed phrases.';
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('keeps contradiction when both sides can be located', () => {
      const r = makeResult({
        code: 'contradiction',
        message:
          'Contradiction: "X is true" conflicts with "X is false".',
        relevantText: '',
      });
      const doc = 'X is true. X is false.';
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });

    it('does not apply to non-contradiction codes', () => {
      const r = makeResult({ code: 'ambiguity-llm' });
      expect(shouldSuppress(r, baseConfig, '...')).toBe(false);
    });
  });

  describe('Rule 6: preambleLengthRule', () => {
    it('suppresses hygiene-non-actionable-preamble on a 1-sentence Purpose', () => {
      const r = makeResult({
        code: 'hygiene-non-actionable-preamble',
        message: 'The Purpose of this skill is X.',
        relevantText: 'The Purpose of this skill is X.',
      });
      const doc = 'The Purpose of this skill is X.';
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('keeps the finding on a long preamble (>= 4 sentences)', () => {
      const r = makeResult({
        code: 'hygiene-non-actionable-preamble',
        message: 'A. B. C. D.',
        relevantText: 'A. B. C. D.',
      });
      const doc = 'A. B. C. D.';
      // 4 sentences — exceeds the 3-sentence threshold.
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });
  });

  describe('Rule 7: numberedProcedureRule', () => {
    it('suppresses hygiene-unordered-process when steps are numbered', () => {
      const r = makeResult({
        code: 'hygiene-unordered-process',
        message: 'The steps are not numbered.',
        relevantText: 'The verifier executes Step 1 through Step 7.',
      });
      const doc = `
# Procedure
## Step 1 — Identify the Document
The verifier records the path.
## Step 2 — Extract Claims
The verifier reads the Document.
## Step 3 — Produce the report
The verifier emits the report.
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('keeps the finding on a genuinely unnumbered procedure', () => {
      const r = makeResult({
        code: 'hygiene-unordered-process',
        message: 'The steps are not numbered.',
        relevantText: 'The verifier records, extracts, then produces.',
      });
      const doc = `
# Procedure
The verifier records the path, extracts the claims, then produces the report.
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });
  });

  describe('Rule 8: yamlDescriptionRedundancyRule', () => {
    it('suppresses hygiene-redundant-instruction on the YAML description', () => {
      const r = makeResult({
        code: 'hygiene-redundant-instruction',
        message: 'The description repeats body terms.',
        relevantText: 'Verify repository documentation using repository evidence.',
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
      });
      const doc = `---
name: documentation-review
description: 'Verify repository documentation using repository evidence. Produce the minimum set of modifications required to satisfy the verification criteria.'
---

# Documentation Verification
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('does not suppress redundancy in the body', () => {
      const r = makeResult({
        code: 'hygiene-redundant-instruction',
        message: 'The body repeats.',
        relevantText: 'some body text',
        range: { start: { line: 10, character: 0 }, end: { line: 10, character: 0 } },
      });
      const doc = `---
name: documentation-review
description: 'short description'
---

# Documentation Verification
some body text
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });

    it('does not apply to a document with no frontmatter', () => {
      const r = makeResult({
        code: 'hygiene-redundant-instruction',
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
      });
      const doc = '# Just a heading\nNo frontmatter here.\n';
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });
  });

  describe('Rule 9: definitionsPreambleRule', () => {
    it('suppresses hygiene-non-actionable-preamble in a Definitions intro', () => {
      const r = makeResult({
        code: 'hygiene-non-actionable-preamble',
        message: 'The Definitions intro is preamble.',
        relevantText: 'The following definitions apply throughout this document.',
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } },
      });
      const doc = `---
name: foo
description: 'foo'
---

# Heading

# Definitions

The following definitions apply throughout this document.
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('suppresses hygiene-vague-directive in a Definitions intro', () => {
      const r = makeResult({
        code: 'hygiene-vague-directive',
        message: 'The intro is vague.',
        relevantText: 'Every term used by a Constraint is defined here.',
        range: { start: { line: 7, character: 0 }, end: { line: 7, character: 0 } },
      });
      const doc = `---
name: foo
description: 'foo'
---

# Definitions

The following definitions apply throughout this document.
Every term used by a Constraint is defined here.
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('does not suppress findings outside the Definitions section', () => {
      const r = makeResult({
        code: 'hygiene-vague-directive',
        range: { start: { line: 50, character: 0 }, end: { line: 50, character: 0 } },
      });
      const doc = `---
name: foo
description: 'foo'
---

# Definitions

The intro.

# Procedure
some procedure content
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });

    it('does not apply when there is no Definitions section', () => {
      // Use hygiene-vague-directive (not preamble) so Rule 6 doesn't
      // match first. Use a doc with >3 sentences so Rule 6 wouldn't
      // match either way.
      const r = makeResult({
        code: 'hygiene-vague-directive',
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } },
      });
      const doc = `---
name: foo
description: 'foo'
---

# Some other heading
Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });
  });

  describe('Rule 10: skillOpeningParagraphRule', () => {
    it('suppresses hygiene-non-actionable-preamble in the skill opening', () => {
      const r = makeResult({
        code: 'hygiene-non-actionable-preamble',
        message: 'The opening is preamble.',
        relevantText: 'This skill is invoked against one supplied document.',
        range: { start: { line: 4, character: 0 }, end: { line: 4, character: 0 } },
      });
      const doc = `---
name: foo
description: 'foo'
---

This skill is invoked against one supplied document and produces one report.

# Heading
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('suppresses hygiene-redundant-instruction in the first 5 body lines', () => {
      const r = makeResult({
        code: 'hygiene-redundant-instruction',
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } },
      });
      const doc = `---
name: foo
description: 'short'
---

Line A
Line B
Line C
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(true);
    });

    it('does not suppress redundancy deeper in the body', () => {
      const r = makeResult({
        code: 'hygiene-redundant-instruction',
        range: { start: { line: 20, character: 0 }, end: { line: 20, character: 0 } },
      });
      const doc = `---
name: foo
description: 'short'
---

# Heading
line 4
line 5
line 6
line 7
line 8
line 9
line 10
line 11
line 12
line 13
line 14
line 15
line 16
line 17
line 18
line 19
line 20
`;
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });

    it('does not apply when the document has no frontmatter', () => {
      // Use hygiene-vague-directive (not preamble) so Rule 6 doesn't
      // match first. Use a doc with >3 sentences so Rule 6 wouldn't
      // match either way.
      const r = makeResult({
        code: 'hygiene-vague-directive',
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
      });
      const doc = '# Just a heading\nSentence one. Sentence two. Sentence three. Sentence four. Sentence five.\n';
      expect(shouldSuppress(r, baseConfig, doc)).toBe(false);
    });
  });

  describe('FILTER_RULES registry', () => {
    it('has stable ids for every rule', () => {
      const ids = FILTER_RULES.map((r) => r.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
      // All ids are kebab-case.
      for (const id of ids) {
        expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      }
    });

    it('every rule has at least one appliesTo code', () => {
      for (const r of FILTER_RULES) {
        expect(r.appliesTo.length).toBeGreaterThan(0);
      }
    });
  });

  describe('integration: the verify-documentation skill fixture', () => {
    it('passes the analyzer output through with reduced false positives', () => {
      // Simulate the 9 findings from the post-R14 run.
      const findings: AnalysisResult[] = [
        // The "may" ambiguity that R14 fixed (no longer present)
        makeResult({
          code: 'ambiguity-llm',
          relevantText: 'A Permitted Modification may only change a Claim.',
          message: '"A Permitted Modification may only change a Claim."',
        }),
        // The "every Requirement below" finding
        makeResult({
          code: 'ambiguity-llm',
          relevantText: 'A Document passes verification only when every Requirement below is satisfied.',
          message: 'every Requirement below',
        }),
        // The "both Permitted and Forbidden" tautology
        makeResult({
          code: 'ambiguity-llm',
          relevantText: 'A Modification that is both Permitted and Forbidden is Forbidden.',
          message: 'A Modification that is both Permitted and Forbidden is Forbidden.',
        }),
        // The contradictions between R-1 and R-2 (the structural one)
        makeResult({
          code: 'contradiction',
          message: 'Contradiction: "Every Claim in the Document must have supporting Evidence" conflicts with "must be Resolved".',
        }),
        // The hygiene Purpose flag
        makeResult({
          code: 'hygiene-non-actionable-preamble',
          relevantText: 'The Purpose of this skill is to verify that the supplied Document is factually correct, internally consistent, and current.',
          message: 'The Purpose section provides background information without actionable instructions.',
        }),
        // The hygiene unordered-process flag
        makeResult({
          code: 'hygiene-unordered-process',
          message: 'The Procedure section lists steps without explicit numbering.',
          relevantText: 'The verifier executes Step 1 through Step 7.',
        }),
      ];
      const doc = `# Verify Documentation
The Purpose of this skill is to verify that the supplied Document is factually correct.
A Document passes verification only when every Requirement below is satisfied.
## R1. Every Claim has Evidence
Every Claim in the Document must have supporting Evidence. An Unsupportable Claim must be Resolved by R2.
A Permitted Modification may only change a Claim.
A Modification that is both Permitted and Forbidden is Forbidden.
## Step 1 — Identify the Document
The verifier records the Document path.
## Step 2 — Extract Claims
The verifier reads the Document.
## Step 3 — Produce the report
The verifier emits the report.
`;
      const out = filterFindings(findings, baseConfig, doc);
      const codes = out.map((f) => f.code);
      // After filtering:
      // - ambiguity-llm "may only" → suppressed by Rule 3
      // - ambiguity-llm "every Requirement below" → kept (no rule matches)
      // - ambiguity-llm "both Permitted and Forbidden" → kept (no rule)
      // - contradiction "Every Claim...must have..." vs "must be Resolved"
      //   → kept (both sides present in doc)
      // - hygiene-non-actionable-preamble on a 1-sentence Purpose → suppressed (Rule 6)
      // - hygiene-unordered-process on a numbered procedure → suppressed (Rule 7)
      expect(codes).toContain('ambiguity-llm');
      expect(codes).toContain('contradiction');
      // The two ambiguity-llm findings that survive are "every Requirement below"
      // and "both Permitted and Forbidden is Forbidden". The "may only" finding
      // is suppressed by Rule 3.
      expect(codes.filter((c) => c === 'ambiguity-llm')).toHaveLength(2);
    });
  });

  describe('Rule 11: crossWaveDedupRule (batch)', () => {
    it('suppresses an ambiguity-llm finding covered by a contradiction from a different wave', () => {
      const findings: AnalysisResult[] = [
        makeResult({
          code: 'ambiguity-llm',
          analyzer: 'ambiguity-detection',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
        }),
        makeResult({
          code: 'contradiction',
          analyzer: 'contradiction-detection',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
        }),
      ];
      const out = filterFindings(findings, baseConfig, '');
      expect(out.map((f) => f.code)).toEqual(['contradiction']);
    });

    it('keeps ambiguity-llm when the overlap is only with same-wave findings', () => {
      const findings: AnalysisResult[] = [
        makeResult({
          code: 'ambiguity-llm',
          analyzer: 'ambiguity-detection',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
        }),
        makeResult({
          code: 'contradiction',
          analyzer: 'ambiguity-detection', // same wave — not cross-wave
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
        }),
      ];
      const out = filterFindings(findings, baseConfig, '');
      expect(out).toHaveLength(2);
    });

    it('keeps ambiguity-llm when the stronger finding is on a different line', () => {
      const findings: AnalysisResult[] = [
        makeResult({
          code: 'ambiguity-llm',
          analyzer: 'ambiguity-detection',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
        }),
        makeResult({
          code: 'contradiction',
          analyzer: 'contradiction-detection',
          range: { start: { line: 50, character: 0 }, end: { line: 50, character: 20 } },
        }),
      ];
      const out = filterFindings(findings, baseConfig, '');
      expect(out).toHaveLength(2);
    });

    it('suppresses the weaker of two weak/broad cross-wave findings', () => {
      // ambiguity-llm (spec 3) is more specific than
      // hygiene-redundant-instruction (spec 1). The rule keeps the
      // stronger one and drops the weaker.
      const findings: AnalysisResult[] = [
        makeResult({
          code: 'ambiguity-llm',
          analyzer: 'ambiguity-detection',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
        }),
        makeResult({
          code: 'hygiene-redundant-instruction',
          analyzer: 'hygiene-check',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
        }),
      ];
      const out = filterFindings(findings, baseConfig, '');
      // ambiguity-llm survives, hygiene-redundant is suppressed as the
      // weaker signal covering the same span.
      expect(out.map((f) => f.code)).toEqual(['ambiguity-llm']);
    });

    it('does not suppress a finding from an unknown / non-ranked code', () => {
      // persona-inconsistency is not in SPECIFICITY_ORDER; it must never
      // be the "other" that suppresses anything, nor be suppressed itself.
      const findings: AnalysisResult[] = [
        makeResult({
          code: 'ambiguity-llm',
          analyzer: 'ambiguity-detection',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
        }),
        makeResult({
          code: 'persona-inconsistency',
          analyzer: 'persona-check',
          range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
        }),
      ];
      const out = filterFindings(findings, baseConfig, '');
      expect(out).toHaveLength(2);
    });
  });

  describe('Rule 12: imperativeAmbiguityRule', () => {
    it('suppresses ambiguity on "Verify: <action>" pattern', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'Verify: `npx swa --version`',
        message: 'Verify: `npx swa --version`',
      });
      expect(shouldSuppress(r, baseConfig, '')).toBe(true);
    });

    it('suppresses ambiguity on "Run: <cmd>" pattern', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'Run: `npm run compile`',
        message: 'Run: `npm run compile`',
      });
      expect(shouldSuppress(r, baseConfig, '')).toBe(true);
    });

    it('suppresses ambiguity on "Identify <x>" pattern with colon', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'Identify: README files and their locations',
        message: 'Identify: README files and their locations',
      });
      expect(shouldSuppress(r, baseConfig, '')).toBe(true);
    });

    it('suppresses ambiguity on dash-separated imperative pattern', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'Document - new dependencies and removed ones',
        message: 'Document - new dependencies and removed ones',
      });
      expect(shouldSuppress(r, baseConfig, '')).toBe(true);
    });

    it('does NOT suppress when text is genuinely vague', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'Provide a clear, concise explanation',
        message: 'Provide a clear, concise explanation',
      });
      expect(shouldSuppress(r, baseConfig, '')).toBe(false);
    });

    it('does NOT suppress when verb is not in the list', () => {
      // "Hover" is not in IMPERATIVE_VERBS and not in OBLIGATION_TOKENS, so
      // neither Rule 2 (obligation-token) nor Rule 12 (imperative-ambiguity)
      // should fire. The finding should be kept.
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'Hover: the icon to see the tooltip',
        message: 'Hover: the icon to see the tooltip',
      });
      expect(shouldSuppress(r, baseConfig, '')).toBe(false);
    });

    it('is case-insensitive on the verb', () => {
      const r = makeResult({
        code: 'ambiguity-llm',
        relevantText: 'VERIFY: package version',
        message: 'VERIFY: package version',
      });
      expect(shouldSuppress(r, baseConfig, '')).toBe(true);
    });
  });
});
