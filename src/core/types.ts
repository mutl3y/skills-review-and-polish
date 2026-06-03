/**
 * Core engine types — MUST stay free of any `vscode` import so this module can
 * be reused by the CLI, tests, and (later) an MCP server.
 *
 * Ported/derived from reference-engine/types.ts (originally src/types.ts).
 * The only change from the original is replacing the `vscode-languageserver`
 * `Range` import with a local, dependency-free `Range` type below.
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

/** Tier hint: 'deep' requests a stronger model (e.g. contradiction wave). */
export type ModelTier = 'standard' | 'deep';

/**
 * The provider seam. The whole point of the new architecture: the core engine
 * only knows about this interface. The extension supplies a VsCodeLmProvider
 * (no API keys); the CLI supplies a key-based provider.
 *
 * `complete` takes the user prompt + system prompt and returns the raw text
 * response (the engine handles JSON extraction itself).
 */
export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmRequest {
  prompt: string;
  systemPrompt: string;
  modelTier?: ModelTier;
}

export interface LlmResponse {
  text: string;
  error?: string;
}

/** Single configuration object the core reads, regardless of host. */
export interface EngineConfig {
  analysisMode: 'single' | 'multiWave';
  enabledWaves: WaveName[];
  scoreSamples: number;
  fixStrategy: 'subtractive' | 'additive' | 'improved';
  fixSemanticCheck: boolean;
  fixSelfCritique: boolean;
  fixReferenceGrounding: boolean;
  /** Optional per-code severity overrides (ESLint-style). 'off' drops the finding. */
  severityOverrides?: Record<string, Severity | 'off'>;
  seed?: number;
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
};

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
