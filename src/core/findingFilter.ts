/**
 * Finding filter — deterministic post-processor for the analyzer output.
 *
 * The analyzer produces an `AnalysisResult[]` after median-of-N scoring. The
 * finding filter runs on that stream and applies a fixed set of rules that
 * suppress false positives which the analyzer cannot avoid producing because
 * the rules are derived from the project's own choices (vocabulary, fix-time
 * guarantees, requirement shape) rather than from the LLM's text reading.
 *
 * The filter is a pure function. It has no LLM call, no randomness, no I/O.
 * Given the same `AnalysisResult[]`, `EngineConfig`, and source Document text,
 * it always produces the same output.
 */

import { AnalysisResult, EngineConfig, Severity } from './types';
import {
  OBLIGATION_TOKENS,
  EMPHASIS_SCOPE_WORDS,
  REQUIREMENT_VERBS,
} from './vocabulary';

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Apply the deterministic finding filter to an analyzer result stream.
 *
 * @param results Raw analyzer output after scoring. Read-only.
 * @param config Engine config including any `severityOverrides`.
 * @param doc The full source Document text. Required for rules that re-read
 *   the document (cross-reference verification, section boundary checks).
 * @returns A new array containing only the findings that survive the filter.
 *   Findings are not mutated; suppressed findings are simply absent.
 */
export function filterFindings(
  results: ReadonlyArray<AnalysisResult>,
  config: Readonly<EngineConfig>,
  doc: string,
): AnalysisResult[] {
  const out: AnalysisResult[] = [];
  for (const r of results) {
    if (shouldSuppress(r, config, doc)) continue;
    out.push(applyOverrides(r, config));
  }
  return out;
}

/** Public predicate for tests. Same logic as `filterFindings` but per-finding. */
export function shouldSuppress(
  result: AnalysisResult,
  config: Readonly<EngineConfig>,
  doc: string,
): boolean {
  for (const rule of FILTER_RULES) {
    if (rule.matches(result, config, doc)) return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Rule shape
// --------------------------------------------------------------------------

/**
 * A filter rule. A rule inspects a single finding and returns `true` to
 * suppress it. Rules are pure functions; they may read the Document text
 * and the config but must not mutate either.
 */
export interface FilterRule {
  /** Stable identifier for diagnostics. Lowercase, kebab-case. */
  readonly id: string;
  /** One-line description of the false-positive it suppresses. */
  readonly description: string;
  /** Codes this rule inspects. The rule is not consulted for other codes. */
  readonly appliesTo: ReadonlyArray<string>;
  matches(result: AnalysisResult, config: Readonly<EngineConfig>, doc: string): boolean;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Extract the quoted text the wave flagged. The wave usually quotes the
 * exact phrase in the `relevantText` field; fall back to a heuristic
 * extraction from the message if not present.
 */
function extractQuotedText(result: AnalysisResult): string | null {
  if (result.relevantText && result.relevantText.trim().length > 0) {
    return result.relevantText;
  }
  const quoted = extractQuotedPhrases(result.message);
  return quoted[0] ?? null;
}

/**
 * Extract every quoted phrase from a message. Handles both straight and
 * curly double quotes that the model uses.
 */
function extractQuotedPhrases(message: string): string[] {
  const out: string[] = [];
  const re = /["“”]([^"“”]{1,400})["“”]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/**
 * Extract weak-obligation words from a text span. Returns the matched
 * words, lowercased.
 */
function extractWeakObligationWords(text: string): string[] {
  const weak = [
    'try to', 'should', 'might want to', 'consider whether', 'consider',
    'ought to', 'could', 'may', 'might', 'perhaps', 'maybe',
  ];
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const w of weak) {
    if (w.includes(' ')) {
      if (lower.includes(w)) found.add(w);
    } else {
      const re = new RegExp(`\\b${w}\\b`, 'i');
      if (re.test(text)) found.add(w);
    }
  }
  return Array.from(found);
}

// --------------------------------------------------------------------------
// Rule 1 — severity overrides (existing config field)
// --------------------------------------------------------------------------

/**
 * Applies the existing `severityOverrides` config. 'off' suppresses; any
 * other Severity value replaces the finding's severity.
 *
 * Source of authority: `EngineConfig.severityOverrides` was already
 * declared in `src/core/types.ts` but not yet wired into the finding
 * pipeline. This rule implements the wire-up.
 */
const severityOverrideRule: FilterRule = {
  id: 'severity-override',
  description: 'Apply EngineConfig.severityOverrides. "off" suppresses.',
  appliesTo: ['*'],
  matches(result, config) {
    const override = config.severityOverrides?.[result.code];
    if (override === undefined) return false;
    if (override === 'off') return true;
    return false;
  },
};

function applyOverrides(
  result: AnalysisResult,
  config: Readonly<EngineConfig>,
): AnalysisResult {
  const override = config.severityOverrides?.[result.code];
  if (override === undefined || override === 'off') return result;
  return { ...result, severity: override as Severity };
}

// --------------------------------------------------------------------------
// Rule 2 — obligation tokens are protected vocabulary
// --------------------------------------------------------------------------

/**
 * The ambiguity wave flags words from `OBLIGATION_TOKENS` and
 * `EMPHASIS_SCOPE_WORDS` as weak obligation language. But the surgical
 * fixer explicitly protects these same words from being dropped during
 * ambiguity fixes — the project has decided they are part of the
 * deliberate vocabulary. The wave's flag is therefore a false positive
 * when the flagged text contains only protected tokens.
 *
 * Source of authority: `src/core/fixer.ts` OBLIGATION_TOKENS list and
 * `docs/FIX-GUARDS.md` ("Obligation tokens (must not be dropped)"). The
 * same list now lives in `src/core/vocabulary.ts`.
 */
const obligationTokenRule: FilterRule = {
  id: 'obligation-token-protected',
  description:
    'ambiguity-llm flagging a sentence whose only obligation-strength ' +
    'word is on the project-protected OBLIGATION_TOKENS / ' +
    'EMPHASIS_SCOPE_WORDS list.',
  appliesTo: ['ambiguity-llm'],
  matches(result) {
    if (result.code !== 'ambiguity-llm') return false;
    const text = extractQuotedText(result);
    if (!text) return false;
    const candidates = extractWeakObligationWords(text);
    if (candidates.length === 0) return false;
    return candidates.every((w) =>
      OBLIGATION_TOKENS.includes(w) || EMPHASIS_SCOPE_WORDS.includes(w),
    );
  },
};

// --------------------------------------------------------------------------
// Rule 3 — requirement vocabulary is approved
// --------------------------------------------------------------------------

/**
 * When the analyzer flags a sentence whose only obligation-strength verb is
 * one of the approved Requirement verbs (`must`, `must not`, `may only`),
 * the flag is a false positive. The preamble explicitly defines this
 * vocabulary as the approved set.
 *
 * Source of authority: the Requirements preamble of every skill in this
 * project, and the verify-documentation skill's preamble in particular.
 */
const requirementVerbRule: FilterRule = {
  id: 'requirement-verb-approved',
  description:
    'ambiguity-llm flagging a sentence whose obligation verb is on the ' +
    'REQUIREMENT_VERBS approved list.',
  appliesTo: ['ambiguity-llm'],
  matches(result) {
    if (result.code !== 'ambiguity-llm') return false;
    const text = extractQuotedText(result);
    if (!text) return false;
    const approved = REQUIREMENT_VERBS.some((v) => text.toLowerCase().includes(v));
    if (!approved) return false;
    const otherWeak = extractWeakObligationWords(text).filter(
      (w) => !REQUIREMENT_VERBS.includes(w),
    );
    return otherWeak.length === 0;
  },
};

// --------------------------------------------------------------------------
// Rule 4 — contradiction cross-reference verification
// --------------------------------------------------------------------------

/**
 * The contradiction wave claims that two passages conflict. The wave does
 * not verify the conflict is real; it relies on the model to surface both
 * sides. Sometimes the model fabricates a side (e.g. claiming a bullet
 * is in both lists when it is in only one).
 *
 * Source of authority: 2026-07-09 verification session, in which the
 * analyzer claimed "adds new Claims" was in both the Permitted and
 * Forbidden lists. A literal text search showed it was in only one.
 */
const contradictionCrossReferenceRule: FilterRule = {
  id: 'contradiction-cross-reference',
  description:
    'contradiction finding whose claimed evidence cannot be located in ' +
    'the source document.',
  appliesTo: ['contradiction', 'contradiction-related'],
  matches(result, _config, doc) {
    if (
      result.code !== 'contradiction' &&
      result.code !== 'contradiction-related'
    ) {
      return false;
    }
    const message = result.message;
    const quoted = extractQuotedPhrases(message);
    if (quoted.length < 2) return false;
    const found = quoted.filter((q) => doc.includes(q));
    // Require BOTH sides to be present in the document. If one side is
    // missing, the wave invented it.
    return found.length < 2;
  },
};

// --------------------------------------------------------------------------
// Rule 5 — definitions self-reference (placeholder, no-op for v1)
// --------------------------------------------------------------------------

/**
 * Demote (not suppress) contradiction findings whose location is inside a
 * Definitions section. Reserved for v2; in v1 it acts as a pass-through.
 */
const definitionsSelfReferenceRule: FilterRule = {
  id: 'definitions-self-reference',
  description:
    'Placeholder. Demotes contradiction findings inside Definitions ' +
    'sections. Currently a no-op.',
  appliesTo: ['contradiction', 'contradiction-related'],
  matches() {
    return false;
  },
};

// --------------------------------------------------------------------------
// Rule 6 — preamble length
// --------------------------------------------------------------------------

/**
 * The hygiene wave flags Purpose / intro sections as non-actionable
 * preamble when the preamble exceeds 2–3 sentences. The verify-
 * documentation skill's Purpose is one sentence; flagging it is a false
 * positive of the length threshold.
 *
 * Source of authority: hygiene.prompt (b): "Preamble longer than 2–3
 * sentences that purely explains WHY something exists without telling
 * the model WHAT to do." A 1-sentence Purpose is below that threshold.
 */
const preambleLengthRule: FilterRule = {
  id: 'preamble-length',
  description:
    'hygiene-non-actionable-preamble flagging a Purpose or intro that ' +
    'is at or below the 3-sentence threshold the wave defines.',
  appliesTo: ['hygiene-non-actionable-preamble'],
  matches(result, _config, doc) {
    if (result.code !== 'hygiene-non-actionable-preamble') return false;
    const text = extractQuotedText(result) ?? doc;
    const sentenceCount = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0).length;
    return sentenceCount <= 3;
  },
};

// --------------------------------------------------------------------------
// Rule 7 — numbered procedure
// --------------------------------------------------------------------------

/**
 * The hygiene wave flags procedural sections whose steps are not
 * numbered. The verify-documentation skill's Procedure section IS numbered
 * ("Step 1", "Step 2", ...); the wave misses this because it pattern-
 * matches on list-formatting, not on prose-level numbering.
 *
 * Source of authority: 2026-07-09 verification session.
 */
const numberedProcedureRule: FilterRule = {
  id: 'numbered-procedure',
  description:
    'hygiene-unordered-process flagging a procedure whose steps are ' +
    'explicitly numbered in the prose (e.g. "Step 1", "Step 2").',
  appliesTo: ['hygiene-unordered-process'],
  matches(result, _config, doc) {
    if (result.code !== 'hygiene-unordered-process') return false;
    const stepCount = (doc.match(/Step\s+\d+\b/g) ?? []).length;
    return stepCount >= 2;
  },
};

// --------------------------------------------------------------------------
// Registry
// --------------------------------------------------------------------------

/**
 * The list of rules applied by `filterFindings`. Order matters: rules are
 * evaluated in declaration order, and the first match wins.
 */
export const FILTER_RULES: ReadonlyArray<FilterRule> = [
  severityOverrideRule,
  obligationTokenRule,
  requirementVerbRule,
  contradictionCrossReferenceRule,
  definitionsSelfReferenceRule,
  preambleLengthRule,
  numberedProcedureRule,
];
