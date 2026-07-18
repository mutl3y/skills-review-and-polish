/**
 * JSON Schema for external-provider LLM responses.
 *
 * Wire-format companion to `LLMCombinedAnalysisResponse` in
 * `src/core/types.ts`. The schema is sent via OpenRouter's
 * `response_format: { type: 'json_schema', json_schema: { schema } }`
 * body, which OpenRouter then translates per provider:
 *   - OpenAI / Fireworks: passthrough
 *   - Google Gemini: `generationConfig.responseSchema`
 *   - Anthropic (Sonnet 4.5+, Opus 4.1+): tool-use with `input_schema`
 *
 * Why this lives in its own file rather than next to the type:
 *   1. Wire format and runtime type evolve at different cadences.
 *      OpenRouter may add a `description` field, models may want new
 *      enum values, etc. — those are wire-format concerns that don't
 *      affect the analyzer's runtime parsing.
 *   2. The schema is provider-bound (OpenAI-compatible). The runtime
 *      type is provider-agnostic. Co-locating them in `core/types.ts`
 *      would pull an OpenRouter-shaped dependency into the core.
 *   3. The schema is large (~3KB). Keeping it out of `types.ts`
 *      keeps the analyzer's imports lighter.
 *
 * Drift policy: if `LLMCombinedAnalysisResponse` and this schema diverge,
 * the analyzer's `extractJSON<T>` will silently accept the LLM's actual
 * output (TS type is erased at runtime). The schema is therefore the
 * authoritative wire contract; the type is the analyzer's parse contract.
 * A future post-validator can compare them at startup if we want a guard.
 *
 * Backwards-compat note: every property here is `required`, matching the
 * analyzer's "all keys present or zero findings" expectation. The model
 * is allowed to emit empty arrays for waves with no findings; that is
 * the correct shape, not a parse error.
 */

/** Schema name sent in `json_schema.name`. Keep short; some providers truncate. */
export const LLM_RESPONSE_SCHEMA_NAME = 'llm_analysis_response';

/**
 * The JSON Schema (Draft 2020-12 / OpenAI-style subset) sent to providers.
 *
 * Design choices:
 *   - `additionalProperties: false` everywhere — enforces shape; lets
 *     providers reject early instead of silently accepting drift.
 *   - `strict: true` (in the body, not here) — OpenRouter translates
 *     this into the provider's strict-mode flag where supported.
 *   - All fields `required` — matches `LLMCombinedAnalysisResponse`'s
 *     "every wave writes its key, even if to an empty array" pattern.
 *     Allowing optional keys would let the model skip waves and we'd
 *     silently lose findings.
 *   - Severity enums — mirror the analyzer's downstream processors.
 *     A value outside the enum is a parse-recoverable condition, but a
 *     strict schema keeps it from happening in the first place.
 */
export const LLM_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          instruction1: { type: 'string' },
          instruction2: { type: 'string' },
          severity: { type: 'string', enum: ['error', 'warning'] },
          explanation: { type: 'string' },
        },
        required: ['instruction1', 'instruction2', 'severity', 'explanation'],
      },
    },
    ambiguity_issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['quantifier', 'reference', 'term', 'scope', 'other'] },
          severity: { type: 'string', enum: ['warning', 'info'] },
          problem: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['text', 'type', 'severity', 'problem', 'suggestion'],
      },
    },
    persona_issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          trait1: { type: 'string' },
          trait2: { type: 'string' },
          relevant_text: { type: 'string' },
          severity: { type: 'string', enum: ['warning', 'info'] },
          suggestion: { type: 'string' },
        },
        required: ['description', 'trait1', 'trait2', 'relevant_text', 'severity', 'suggestion'],
      },
    },
    cognitive_load: {
      type: 'object',
      additionalProperties: false,
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string' },
              description: { type: 'string' },
              relevant_text: { type: 'string' },
              severity: { type: 'string', enum: ['warning', 'info'] },
              suggestion: { type: 'string' },
            },
            required: ['type', 'description', 'relevant_text', 'severity', 'suggestion'],
          },
        },
        overall_complexity: { type: 'string', enum: ['low', 'medium', 'high', 'very-high'] },
      },
      required: ['issues', 'overall_complexity'],
    },
    coverage_analysis: {
      type: 'object',
      additionalProperties: false,
      properties: {
        coverage_gaps: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              gap: { type: 'string' },
              relevant_text: { type: 'string' },
              impact: { type: 'string', enum: ['high', 'medium', 'low'] },
              suggestion: { type: 'string' },
            },
            required: ['gap', 'relevant_text', 'impact', 'suggestion'],
          },
        },
        overall_coverage: { type: 'string', enum: ['comprehensive', 'adequate', 'limited', 'minimal'] },
      },
      required: ['coverage_gaps', 'overall_coverage'],
    },
    hygiene_issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string' },
          relevant_text: { type: 'string' },
          // OpenAI's strict mode requires every property in `properties` to
          // also appear in `required`. We model text_to_fix as required
          // (must be present) rather than optional; the model returns ""
          // when there is no separate text to fix, which the analyzer's
          // `text_to_fix ?? relevant_text` fallback already handles.
          text_to_fix: { type: 'string' },
          description: { type: 'string' },
          suggestion: { type: 'string' },
          severity: { type: 'string', enum: ['warning', 'info'] },
        },
        required: ['type', 'relevant_text', 'text_to_fix', 'description', 'suggestion', 'severity'],
      },
    },
    custom_diagnostics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          relevant_text: { type: 'string' },
          severity: { type: 'string', enum: ['error', 'warning', 'info'] },
          suggestion: { type: 'string' },
        },
        required: ['title', 'description', 'relevant_text', 'severity', 'suggestion'],
      },
    },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: { type: 'string' },
          instruction1: { type: 'string' },
          instruction2: { type: 'string' },
          severity: { type: 'string', enum: ['error', 'warning'] },
          suggestion: { type: 'string' },
        },
        required: ['summary', 'instruction1', 'instruction2', 'severity', 'suggestion'],
      },
    },
  },
  required: [
    'contradictions',
    'ambiguity_issues',
    'persona_issues',
    'cognitive_load',
    'coverage_analysis',
    'hygiene_issues',
    'custom_diagnostics',
    'conflicts',
  ],
} as const;

/** Convenience: pre-built `json_schema` envelope matching OpenRouter's body shape. */
export const LLM_RESPONSE_JSON_SCHEMA_BODY = {
  name: LLM_RESPONSE_SCHEMA_NAME,
  strict: true,
  schema: LLM_RESPONSE_SCHEMA,
} as const;