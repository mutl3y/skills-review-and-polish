/**
 * Shared vocabulary for the analyzer post-processor and the surgical fixer.
 *
 * These constants are the single source of truth for words that the project
 * treats as intentional. The fixer protects them from being dropped. The
 * post-processor uses them to demote or drop analyzer findings that flag the
 * same words as ambiguous.
 *
 * Adding a word here has two effects:
 *   1. The fixer will preserve the word during surgical fixes.
 *   2. The post-processor will suppress analyzer findings that flag the word.
 *
 * Both effects are intentional. If a word is in this list, the project has
 * decided it is part of the deliberate vocabulary.
 */

/**
 * Obligation and hedge words. Closed grammatical class.
 *
 * The fixer preserves these from being dropped during ambiguity fixes because
 * removing them would silently flip a recommendation into a mandate.
 * The post-processor suppresses analyzer findings that flag these words as
 * weak obligation language.
 */
export const OBLIGATION_TOKENS: ReadonlyArray<string> = [
  'consider', 'should', 'may', 'might', 'recommend', 'recommended',
  'optional', 'optionally', 'prefer', 'preferably', 'must', 'required',
  'shall', 'at least', 'at most', 'if possible', 'when possible', 'where possible',
  'appropriate', 'necessary',
];

/**
 * Scope and emphasis words. Closed grammatical class.
 *
 * Same protection as OBLIGATION_TOKENS. The fixer preserves these; the
 * post-processor suppresses analyzer findings that flag them as delegation
 * or weak scope.
 */
export const EMPHASIS_SCOPE_WORDS: ReadonlyArray<string> = [
  'all', 'only', 'never', 'always', 'every', 'each', 'complete', 'completely',
  'comprehensive', 'exclusively', 'genuine', 'genuinely', 'independently',
  'fully', 'entire', 'entirely', 'explicit', 'explicitly', 'mandatory', 'strictly',
];

/**
 * Verbs approved for use in Requirement statements.
 *
 * The verify-documentation skill's preamble specifies that every Requirement
 * uses one of these three verbs. When the post-processor sees an
 * `ambiguity-llm` finding whose quoted text is a sentence using one of these
 * verbs, the finding is suppressed: the word is the approved vocabulary, not
 * weak obligation language.
 */
export const REQUIREMENT_VERBS: ReadonlyArray<string> = [
  'must', 'must not', 'may only',
];
