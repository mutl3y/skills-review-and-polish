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
import { createLogger } from './logger';

const log = createLogger('finding-filter');

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Apply the deterministic finding filter to an analyzer result stream.
 *
 * @param results Raw analyzer output after scoring. Read-only.
 * @param config Engine config including any `severityOverrides`. If
 *   `config.filterFindings === false`, the post-processor is bypassed and
 *   the raw results are returned unchanged (still applying severity
 *   overrides).
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
  if (config.filterFindings === false) {
    // Post-processor disabled. Still apply severity overrides.
    return results.map((r) => applyOverrides(r, config));
  }
  const out: AnalysisResult[] = [];
  const suppressedByRule: Record<string, number> = {};
  for (const r of results) {
    const ruleId = suppressionRuleId(r, config, doc);
    if (ruleId) {
      suppressedByRule[ruleId] = (suppressedByRule[ruleId] ?? 0) + 1;
      continue;
    }
    out.push(applyOverrides(r, config));
  }
  // Apply cross-finding batch rules (e.g. duplicate suppression across waves)
  const filtered = applyBatchRules(out, config, doc);
  const batchSuppressed = out.length - filtered.length;
  if (batchSuppressed > 0) {
    suppressedByRule['batch-rules'] = (suppressedByRule['batch-rules'] ?? 0) + batchSuppressed;
  }
  if (Object.keys(suppressedByRule).length > 0) {
    log.debug('suppressed findings by rule', suppressedByRule);
  }
  return filtered;
}

/** Public predicate for tests. Same logic as `filterFindings` but per-finding. */
export function shouldSuppress(
  result: AnalysisResult,
  config: Readonly<EngineConfig>,
  doc: string,
): boolean {
  return suppressionRuleId(result, config, doc) !== null;
}

function suppressionRuleId(
  result: AnalysisResult,
  config: Readonly<EngineConfig>,
  doc: string,
): string | null {
  for (const rule of FILTER_RULES) {
    if (rule.matches(result, config, doc)) return rule.id;
  }
  return null;
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
 * Return the line number (0-indexed) where the given section heading
 * starts, or -1 if the heading is not present. A section heading is a
 * line that starts with one or more `#` characters.
 */
function findSectionStart(doc: string, heading: string): number {
  const lines = doc.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) return i;
  }
  return -1;
}

/**
 * Return the line number where the YAML frontmatter ends (i.e. the
 * closing `---` of the opening frontmatter block). Returns -1 if the
 * document does not start with a YAML frontmatter.
 */
function findFrontmatterEnd(doc: string): number {
  const lines = doc.split('\n');
  if (lines[0]?.trim() !== '---') return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i;
  }
  return -1;
}

function getResultLine(result: AnalysisResult, doc: string): string {
  const line = result.range?.start?.line ?? -1;
  if (line < 0) return '';
  return doc.split('\n')[line] ?? '';
}

function lineContainsFlaggedText(line: string, text: string): boolean {
  const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedLine = normalize(line);
  const normalizedText = normalize(text);
  return normalizedText.length > 0 && normalizedLine.includes(normalizedText);
}

function isMarkdownReferenceTableText(text: string): boolean {
  return /\|/.test(text) && /\[[^\]]+\]\((?:\.\/)?references\/[^)]+\)/i.test(text);
}

function isInsideFencedBlock(doc: string, lineNo: number): boolean {
  if (lineNo < 0) return false;
  const lines = doc.split('\n');
  let inFence = false;
  for (let i = 0; i <= lineNo && i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      if (i === lineNo) return true;
      inFence = !inFence;
    }
  }
  return inFence;
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
    // Case-insensitive containment: a legitimately-quoted phrase whose case
    // differs from the document (e.g. the LLM normalised capitalisation) is
    // still present and must not be treated as "invented".
    const lowerDoc = doc.toLowerCase();
    const found = quoted.filter((q) => lowerDoc.includes(q.toLowerCase()));
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
// Rule 8 — YAML frontmatter description redundancy
// --------------------------------------------------------------------------

/**
 * The hygiene wave flags the YAML `description:` field as redundant
 * with the body when the description reuses terms from the body. The
 * description is the public-facing summary that VS Code / agent hosts
 * display; reusing body terms in the summary is intentional and required
 * for discoverability. The wave's pattern (a) "REDUNDANT INSTRUCTION"
 * is intended for body instructions, not metadata fields.
 *
 * Source of authority: VS Code / Copilot skill metadata spec, where
 * the `description` field is shown to the model in the agent picker
 * and is expected to summarise the skill's purpose.
 */
const yamlDescriptionRedundancyRule: FilterRule = {
  id: 'yaml-description-redundancy',
  description:
    'hygiene-redundant-instruction flagging the YAML description ' +
    'field, which is a public-facing summary and is expected to ' +
    'reuse body terms.',
  appliesTo: ['hygiene-redundant-instruction'],
  matches(result, _config, doc) {
    if (result.code !== 'hygiene-redundant-instruction') return false;
    const frontmatterEnd = findFrontmatterEnd(doc);
    if (frontmatterEnd <= 0) return false;
    // The description is on line 2 (0-indexed 1) of a typical SKILL.md
    // frontmatter; we allow lines 1..frontmatterEnd-1 to be flagged
    // for safety, but the canonical case is line 2.
    return result.range.start.line >= 1 && result.range.start.line <= frontmatterEnd;
  },
};

// --------------------------------------------------------------------------
// Rule 9 — Definitions section preamble
// --------------------------------------------------------------------------

/**
 * The hygiene wave flags the introductory paragraph of a Definitions /
 * Glossary section as non-actionable preamble or as a vague directive.
 * The introductory paragraph of a glossary ("The following definitions
 * apply throughout this document") is the standard, expected format and
 * is intentional context-setting, not preamble in the wave's pattern (b)
 * sense (which targets pre-action historical context).
 *
 * Source of authority: 2026-07-10 experiment loop, where the LLM
 * consistently flagged the "Every term used by a Constraint, a Rule,
 * or a Procedure step is defined here" intro of every v4-v7 glossary
 * as a vague directive.
 */
const definitionsPreambleRule: FilterRule = {
  id: 'definitions-preamble',
  description:
    'hygiene-non-actionable-preamble or hygiene-vague-directive ' +
    'flagging the introductory lines of a Definitions / Glossary ' +
    'section, which is the standard glossary format.',
  appliesTo: ['hygiene-non-actionable-preamble', 'hygiene-vague-directive'],
  matches(result, _config, doc) {
    if (
      result.code !== 'hygiene-non-actionable-preamble' &&
      result.code !== 'hygiene-vague-directive'
    ) {
      return false;
    }
    // The Definitions heading can be either "# Definitions",
    // "## Definitions", or "## D1 ... ## D2 ..." style.
    const sectionStart = findSectionStart(doc, '# Definitions');
    if (sectionStart === -1) return false;
    // Allow up to 5 lines of preamble inside the Definitions section.
    return result.range.start.line >= sectionStart && result.range.start.line <= sectionStart + 5;
  },
};

// --------------------------------------------------------------------------
// Rule 10 — Skill opening paragraph
// --------------------------------------------------------------------------

/**
 * The hygiene wave flags the opening paragraph of a skill (e.g. "This
 * skill is invoked against one supplied document and produces one
 * verification report") as non-actionable preamble. The opening
 * paragraph of a skill is the standard scope-setting format and is
 * required before the first action instruction. The wave's pattern (b)
 * is intended for HISTORICAL context (e.g. "In 2019, the team moved
 * from Jenkins to GitHub Actions..."), not for scope-setting.
 *
 * Source of authority: 2026-07-10 experiment loop, where the LLM
 * consistently flagged the opening paragraph of v3-v7 as
 * non-actionable-preamble.
 */
const skillOpeningParagraphRule: FilterRule = {
  id: 'skill-opening-paragraph',
  description:
    'hygiene-non-actionable-preamble or hygiene-redundant-instruction ' +
    'flagging the first 5 body lines after the YAML frontmatter, ' +
    'which is the standard scope-setting paragraph of a skill.',
  appliesTo: ['hygiene-non-actionable-preamble', 'hygiene-redundant-instruction'],
  matches(result, _config, doc) {
    if (
      result.code !== 'hygiene-non-actionable-preamble' &&
      result.code !== 'hygiene-redundant-instruction'
    ) {
      return false;
    }
    const frontmatterEnd = findFrontmatterEnd(doc);
    if (frontmatterEnd === -1) return false;
    const openingStart = frontmatterEnd + 1;
    return (
      result.range.start.line >= openingStart &&
      result.range.start.line <= openingStart + 5
    );
  },
};

// --------------------------------------------------------------------------
// Rule 11 — cross-wave duplicate suppression (batch rule)
// --------------------------------------------------------------------------

/**
 * When two findings from DIFFERENT waves point to the same span and one
 * is strictly more specific than the other, suppress the less-specific
 * one. E22 on v7 showed `ambiguity-llm` and `contradiction-related`
 * findings can both point to the same definition; the contradiction is
 * the more specific signal, so the ambiguity flag is dropped.
 *
 * "Same span" = overlap of [start.line, end.line] ranges.
 * "More specific" = present in SPECIFICITY_ORDER with a higher rank.
 *
 * We require the candidates to come from different analyzer IDs — this
 * rule never suppresses within-wave duplicates (the E23 line-stability
 * analysis showed contradiction wave is 100% line-stable, so within-wave
 * dedup is not needed). Cross-wave is the only case this rule covers.
 *
 * Source of authority: 2026-07-11 E22 focused-mode v7 run, which
 * surfaced 33 findings of which several were cross-wave duplicates of
 * the same span.
 */
const SPECIFICITY_ORDER: ReadonlyArray<string> = [
  'contradiction',                // strongest: logical conflict
  'contradiction-related',        // near-contradiction
  'coverage-gap',                 // missing content
  'hygiene-vague-cognitive-directive',
  'hygiene-over-specification',
  'ambiguity-llm',                // weakest: vague language
  'hygiene-non-actionable-preamble',
  'hygiene-redundant-instruction',
];

/** Codes that are eligible to be SUPPRESSED (must be weak and broad). */
const SUPPRESSABLE_WEAK_CODES: ReadonlySet<string> = new Set([
  'ambiguity-llm',
  'hygiene-non-actionable-preamble',
  'hygiene-redundant-instruction',
]);

function specificity(code: string): number {
  const idx = SPECIFICITY_ORDER.indexOf(code);
  return idx === -1 ? -1 : SPECIFICITY_ORDER.length - idx;
}

function rangesOverlap(a: AnalysisResult, b: AnalysisResult): boolean {
  const aStart = a.range.start.line;
  const aEnd = a.range.end.line;
  const bStart = b.range.start.line;
  const bEnd = b.range.end.line;
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Batch rule: drop a weak/broad finding (per SUPPRESSABLE_WEAK_CODES)
 * if another, more specific finding (per SPECIFICITY_ORDER) from a
 * DIFFERENT analyzer (i.e. a different wave) covers an overlapping range.
 */
const crossWaveDedupRule: BatchFilterRule = {
  id: 'cross-wave-dedup',
  description:
    'Suppress a weak/broad finding (ambiguity-llm, hygiene-*) if a ' +
    'more specific finding from a different wave covers the same span.',
  matches(candidate, others) {
    if (!SUPPRESSABLE_WEAK_CODES.has(candidate.code)) return false;
    const candSpec = specificity(candidate.code);
    if (candSpec === -1) return false;
    const sortedOthers = others
      .filter((other) => other !== candidate)
      .slice()
      .sort((left, right) =>
        (left.analyzer ?? '').localeCompare(right.analyzer ?? '') ||
        left.code.localeCompare(right.code) ||
        (left.range?.start?.line ?? 0) - (right.range?.start?.line ?? 0) ||
        (left.range?.start?.character ?? 0) - (right.range?.start?.character ?? 0),
      );
    for (const other of sortedOthers) {
      // Different wave (analyzer ID) — within-wave dedup is not this rule's job
      if (other.analyzer === candidate.analyzer) continue;
      const otherSpec = specificity(other.code);
      if (otherSpec === -1) continue;
      if (otherSpec > candSpec && rangesOverlap(candidate, other)) {
        return true;
      }
    }
    return false;
  },
};

// --------------------------------------------------------------------------
// Rule 12 — imperative-verb ambiguity suppression
// --------------------------------------------------------------------------

/**
 * The ambiguity wave sometimes flags imperative-verb patterns as
 * "ambiguous" when they are actually clear action instructions. The
 * pattern `<imperative>: <concrete action>` is a standard documentation
 * convention (e.g. "Verify: `npx swa --version`", "Identify README files
 * and their locations") and is not ambiguous.
 *
 * E30 full-corpus scan (327 skills) found 939 ambiguity-llm findings,
 * 15-20% of which were this pattern. Suppress when the quoted text
 * starts with a recognized imperative verb followed by `:` and a
 * concrete action.
 *
 * Source of authority: 2026-07-11 E30 corpus scan (`e30-corpus-scan.md`).
 */
const IMPERATIVE_VERBS = new Set([
  'verify', 'check', 'run', 'execute', 'use', 'add', 'remove', 'delete',
  'create', 'make', 'set', 'update', 'edit', 'open', 'close', 'start',
  'stop', 'identify', 'find', 'list', 'show', 'print', 'read', 'write',
  'parse', 'load', 'save', 'export', 'import', 'call', 'invoke',
  'document', 'capture', 'record', 'note', 'include', 'exclude',
  'validate', 'confirm', 'ensure', 'require', 'specify', 'define',
  'review', 'inspect', 'examine', 'test', 'try', 'attempt', 'build',
  'compile', 'install', 'deploy', 'publish', 'commit', 'push', 'pull',
]);

const imperativeAmbiguityRule: FilterRule = {
  id: 'imperative-ambiguity',
  description:
    'ambiguity-llm flagging an imperative-verb instruction pattern ' +
    '("Verify: <action>", "Run: <cmd>", etc.) which is a clear action, ' +
    'not ambiguity.',
  appliesTo: ['ambiguity-llm'],
  matches(result) {
    if (result.code !== 'ambiguity-llm') return false;
    const text = extractQuotedText(result);
    if (!text) return false;
    // Match "<verb>: <something>" or "<verb> - <something>" at the start
    const m = text.match(/^\s*([A-Za-z]+)\s*[:-]\s*\S/);
    if (!m) return false;
    return IMPERATIVE_VERBS.has(m[1].toLowerCase());
  },
};

// --------------------------------------------------------------------------
// Rule 13 — Markdown structure ambiguity suppression
// --------------------------------------------------------------------------

/**
 * Production skills often include output templates, code examples, reference
 * tables, and headings. The ambiguity wave can mistake those structural labels
 * for executable instructions ("Window function approach", "When to Use",
 * table-cell descriptions, etc.). Suppress ambiguity findings whose source
 * line is Markdown structure rather than a normative instruction.
 *
 * Source of authority: E61 production validation on context-map,
 * sql-optimization, and audit-integrity (2026-07-16).
 */
const markdownStructureAmbiguityRule: FilterRule = {
  id: 'markdown-structure-ambiguity',
  description:
    'ambiguity-llm on fenced examples, headings, tables, frontmatter, or ' +
    'other Markdown structure rather than executable prompt instructions.',
  appliesTo: ['ambiguity-llm'],
  matches(result, _config, doc) {
    if (result.code !== 'ambiguity-llm') return false;
    const text = extractQuotedText(result);
    if (!text) return false;
    const lineNo = result.range?.start?.line ?? -1;
    if (lineNo < 0) return false;
    const line = getResultLine(result, doc).trim();
    if (!lineContainsFlaggedText(line, text)) return false;
    if (isInsideFencedBlock(doc, lineNo)) return true;

    if (!line) return false;
    if (/^---$/.test(line)) return true;
    if (/^#{1,6}\s+\S/.test(line)) return true;
    if (/^\|.*\|$/.test(line)) return true;

    const frontmatterEnd = findFrontmatterEnd(doc);
    if (frontmatterEnd >= 0 && lineNo <= frontmatterEnd) return true;

    return false;
  },
};

const MARKDOWN_STRUCTURE_HYGIENE_CODES = [
  'hygiene-missing-agent',
  'hygiene-vague-cognitive-directive',
  'hygiene-vague-directive',
  'hygiene-dead-instruction',
  'hygiene-circular-definition',
  'hygiene-over-specification',
];

const markdownStructureHygieneRule: FilterRule = {
  id: 'markdown-structure-hygiene',
  description:
    'hygiene finding on fenced examples, headings, tables, or frontmatter ' +
    'rather than executable prompt instructions.',
  appliesTo: MARKDOWN_STRUCTURE_HYGIENE_CODES,
  matches(result, _config, doc) {
    if (!MARKDOWN_STRUCTURE_HYGIENE_CODES.includes(result.code)) return false;
    const text = extractQuotedText(result);
    if (!text) return false;
    if (isMarkdownReferenceTableText(text)) return true;
    const lineNo = result.range?.start?.line ?? -1;
    if (lineNo < 0) return false;
    const line = getResultLine(result, doc).trim();
    if (!lineContainsFlaggedText(line, text)) return false;
    if (isInsideFencedBlock(doc, lineNo)) return true;

    if (!line) return false;
    if (/^---$/.test(line)) return true;
    if (/^#{1,6}\s+\S/.test(line)) return true;
    if (/^\|.*\|$/.test(line)) return true;

    const frontmatterEnd = findFrontmatterEnd(doc);
    return frontmatterEnd >= 0 && lineNo <= frontmatterEnd;
  },
};

/** Batch rule shape — operates on the full filtered finding set. */
export interface BatchFilterRule {
  readonly id: string;
  readonly description: string;
  matches(candidate: AnalysisResult, others: ReadonlyArray<AnalysisResult>): boolean;
}

/**
 * Apply cross-finding batch rules. Run AFTER per-finding FILTER_RULES so
 * batch dedup operates on the already-suppressed survivors.
 */
export function applyBatchRules(
  results: ReadonlyArray<AnalysisResult>,
  _config: Readonly<EngineConfig>,
  _doc: string,
): AnalysisResult[] {
  const out: AnalysisResult[] = [];
  for (const r of results) {
    let suppressed = false;
    for (const rule of BATCH_FILTER_RULES) {
      if (rule.matches(r, results)) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) out.push(r);
  }
  return out;
}

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
  yamlDescriptionRedundancyRule,
  definitionsPreambleRule,
  skillOpeningParagraphRule,
  imperativeAmbiguityRule,
  markdownStructureAmbiguityRule,
  markdownStructureHygieneRule,
];

/** Cross-finding batch rules. Applied after FILTER_RULES. */
export const BATCH_FILTER_RULES: ReadonlyArray<BatchFilterRule> = [
  crossWaveDedupRule,
];
