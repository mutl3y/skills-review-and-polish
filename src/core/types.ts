/**
 * Core engine types — MUST stay free of any `vscode` import so this module can
 * be reused by the CLI, tests, and (later) an MCP server.
 *
 * Provides shared types for the analyzer, fixer, and scoring modules.
 */

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface AnalysisResult {
  code: string;
  message: string;
  severity: Severity;
  range: Range;
  analyzer: string;
  /** Suggested replacement / rewrite used by the surgical fixer. */
  suggestion?: string;
  /** Exact verbatim text from the document that triggered this issue. */
  relevantText?: string;
}

/** Tier hint: 'deep' requests a stronger model (e.g. contradiction wave). 'fix' uses the dedicated fix model. */
export type ModelTier = 'standard' | 'deep' | 'fix';

/**
 * The provider seam. The whole point of the new architecture: the core engine
 * only knows about this interface. The extension supplies a VsCodeLmProvider
 * (no API keys); the CLI supplies a key-based provider.
 *
 * `complete` takes the user prompt + system prompt and returns the raw text
 * response (the engine handles JSON extraction itself).
 */
/** Minimal cancellation token interface — compatible with vscode.CancellationToken. */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: (listener: () => void) => { dispose(): void };
}

export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
  /**
   * The provider's input context length in tokens, used by the analyzer
   * to scale the document budget so large-context models don't silently
   * truncate real production skills to head/tail excerpts.
   *
   * When the provider does not know its own context (cold cache, test
   * mocks, malformed config), return `undefined`. The analyzer will log
   * a warning and use a conservative 200K-char fallback (~50K tokens),
   * which is safe for every model in our supported set.
   */
  getContextLength(): number | undefined;
}

export interface LlmRequest {
  prompt: string;
  systemPrompt: string;
  modelTier?: ModelTier;
  token?: CancellationToken;
  /** Model ID to use for this request (overrides tier-based selection). */
  modelId?: string;
  /**
   * When true, the provider must omit `response_format` for this request even
   * if it was constructed in schema mode. The analyzer sets this after the
   * first non-stop finish reason on a wave so the remainder of that wave runs
   * without structured output (schema-mode response-health hardening, plan
   * item 3a). The provider treats this as a one-shot override, not a permanent
   * mode change.
   */
  disableStructuredOutput?: boolean;
  /**
   * Output-budget multiplier for this request. The analyzer sets this per
   * wave so waves whose output can far exceed their prompt size (e.g. the
   * ambiguities wave, which can emit 100+ findings on a hard fixture) request
   * extra `max_tokens` headroom and avoid `finish_reason: length`
   * truncations. Default 1.0. Applied in both adaptive and fixed-cap modes.
   */
  maxTokensMultiplier?: number;
}

export interface LlmResponse {
  text: string;
  error?: string;
  /** True when the error is a rate limit (429 / quota exhaustion). */
  isRateLimit?: boolean;
  /** Provider finish reason when available (e.g. stop, length, content_filter). */
  finishReason?: string;
}

/** Single configuration object the core reads, regardless of host. */
export interface EngineConfig {
  analysisMode: 'single' | 'focused' | 'multiWave';
  enabledWaves: WaveName[];
  /**
   * Direct per-call wave list. When set to a non-empty array, the engine
   * runs exactly these waves and bypasses the `analysisMode` switch entirely
   * (i.e. it works with `analysisMode: 'single'` too). When undefined or
   * empty, the existing `analysisMode` logic is used.
   *
   * Use cases:
   *   - Fixture-validation scripts that need a single wave without setting
   *     `analysisMode: 'multiWave'` (which would otherwise run all 6).
   *   - The VS Code per-scan modal, so a user can say "analyze only the
   *     cognitive_load wave" in one line.
   *
   * Precedence (highest first):
   *   1. `enabledWavesOverride` argument on `Engine.analyze` (per-scan modal / MCP).
   *   2. `analysisWaves` (this field).
   *   3. `analysisMode` (legacy switch).
   *
   * This field is purely additive — leaving it undefined preserves the
   * previous behavior exactly. See
   * `.github/experiments/documentation-review/notes/e21-analysisWaves-api.md`.
   */
  analysisWaves?: WaveName[];
  scoreSamples: number;
  fixStrategy: 'subtractive' | 'additive';
  fixSemanticCheck: boolean;
  fixSelfCritique: boolean;
  fixReferenceGrounding: boolean;
  /**
   * When true, run the deterministic finding post-processor
   * (`src/core/findingFilter.ts`) on the analyzer output before
   * reporting. Suppresses false positives the LLM waves produce from
   * reading project rules literally (e.g. flagging 'may' as weak
   * obligation, flagging 'must not' as ambiguous, flagging a
   * numbered procedure as unordered). Default: true.
   *
   * Source of authority: 2026-07-09 verification session, which
   * established that the analyzer's noise floor on small rule sets
   * is dominated by these self-reference false positives, not by
   * sample-level variance.
   */
  filterFindings?: boolean;
  /** Optional per-code severity overrides (ESLint-style). 'off' drops the finding. */
  severityOverrides?: Record<string, Severity | 'off'>;
  /** Guard configuration - can be overridden via settings. */
  fixGuardUpperBoundMultiplier?: number;
  fixGuardLowerBoundMultiplier?: number;
  fixGuardMaxAnchorChars?: number;
}

export type WaveName =
  | 'contradictions'
  | 'ambiguities'
  | 'persona'
  | 'structural'
  | 'coverage'
  | 'hygiene';

export const ALL_WAVES: WaveName[] = [
  'contradictions',
  'ambiguities',
  'persona',
  'structural',
  'coverage',
  'hygiene',
];

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  analysisMode: 'multiWave',
  enabledWaves: [...ALL_WAVES],
  scoreSamples: 3,
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: true,
  filterFindings: true,
};

/**
 * Cognitive codes that get severity downgraded for workflow/meta skill types.
 *
 * Covers the codes emitted by processCognitiveLoad() plus sub-types that
 * survive dedup/subsumption (delegated-decision, deep-decision-tree).
 *
 * Excludes `cognitive-constraint-overload` and `cognitive-priority-conflict`
 * because they are subsumed by contradiction findings in dedup step 2
 * (see analyzer.ts) and never appear in final results.
 */
export const COGNITIVE_DOWNGRADE_CODES = [
  'cognitive-load',
  'cognitive-nested-conditions',
  'cognitive-sequencing',
  'cognitive-logical-inversion',
  'cognitive-delegated-decision',
  'cognitive-deep-decision-tree',
] as const;

// ─── LLM response shapes (internal, used by Analyzer) ────────────────────────

export interface LLMContradictionItem {
  instruction1: string;
  instruction2: string;
  severity: 'error' | 'warning';
  explanation: string;
}

export interface LLMAmbiguityItem {
  text: string;
  type: 'quantifier' | 'reference' | 'term' | 'scope' | 'other';
  severity: 'warning' | 'info';
  problem: string;
  suggestion: string;
}

export interface LLMPersonaItem {
  description: string;
  trait1: string;
  trait2: string;
  relevant_text: string;
  severity: 'warning' | 'info';
  suggestion: string;
}

export interface LLMCognitiveIssue {
  type: string;
  description: string;
  relevant_text: string;
  severity: 'warning' | 'info';
  suggestion: string;
}

export interface LLMCoverageGap {
  gap: string;
  relevant_text: string;
  impact: 'high' | 'medium' | 'low';
  suggestion: string;
}

export interface LLMHygieneItem {
  type: string;
  relevant_text: string;
  text_to_fix?: string;
  description: string;
  suggestion: string;
  severity: 'warning' | 'info';
}

export interface LLMCustomDiagnosticItem {
  title: string;
  description: string;
  relevant_text: string;
  severity: 'error' | 'warning' | 'info';
  suggestion: string;
}

export interface LLMCompositionConflictItem {
  summary: string;
  instruction1: string;
  instruction2: string;
  severity: 'error' | 'warning';
  suggestion: string;
}

/** Union of all possible top-level JSON response shapes from the LLM waves. */
export interface LLMCombinedAnalysisResponse {
  contradictions?: LLMContradictionItem[];
  ambiguity_issues?: LLMAmbiguityItem[];
  persona_issues?: LLMPersonaItem[];
  cognitive_load?: {
    issues?: LLMCognitiveIssue[];
    overall_complexity?: 'low' | 'medium' | 'high' | 'very-high';
  };
  coverage_analysis?: {
    coverage_gaps?: LLMCoverageGap[];
    overall_coverage?: 'comprehensive' | 'adequate' | 'limited' | 'minimal';
  };
  hygiene_issues?: LLMHygieneItem[];
  custom_diagnostics?: LLMCustomDiagnosticItem[];
  conflicts?: LLMCompositionConflictItem[];
}
