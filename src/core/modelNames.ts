/**
 * Shared model-name normalization.
 *
 * Single source of truth for normalizing model identifiers/names for fuzzy
 * matching and catalog lookup. Both `src/modelCatalog.ts` and `src/pricing.ts`
 * previously maintained near-identical copies of the vendor-prefix regex —
 * duplicating a long magic string that must be kept in sync manually (any
 * vendor added to one and not the other silently diverges).
 */

const VENDOR_PREFIX =
  /^(openai|anthropic|google|microsoft|meta|mistral|poolside|nvidia|deepseek|qwen|cohere|amazon|tencent|bytedance|upstage|arcee|inception|minimax|moonshot|ibm|liquid|inclusion|rekaai|stepfun|ai21|xai|aion|zai|sakana|thedrummer|kwaipilot)[/:]/;

/**
 * Normalize a model name for fuzzy matching.
 *
 * Converts "GPT-5 Mini" → "gpt-5 mini", "Claude Sonnet 4.6" → "claude sonnet 4.6".
 * Strips common vendor prefixes for cross-matching.
 */
export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(VENDOR_PREFIX, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a model identifier for catalog lookup.
 *   "openai/gpt-4o-mini" → "gpt 4o mini"
 *   "GPT-4o mini"        → "gpt 4o mini"
 *
 * Like `normalizeModelName` but also collapses `-`, `_`, `.`, `/` separators
 * into spaces (catalog keys use spaces).
 */
export function normalizeModelId(id: string): string {
  return id
    .toLowerCase()
    .replace(VENDOR_PREFIX, '')
    .replace(/[-_./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
