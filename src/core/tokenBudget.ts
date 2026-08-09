/**
 * Shared token-budget constants.
 *
 * Single source of truth for the "1 token ≈ N chars" heuristic and the
 * default document-size cap. Previously these magic numbers were scattered
 * across the analyzer, the MCP server, and the providers — duplicated
 * constants that could drift.
 */

/** Approximate characters per token (English). */
export const CHARS_PER_TOKEN = 4;

/** Default maximum document size (chars) ≈ 50K tokens. */
export const DEFAULT_DOCUMENT_CHARS = 200_000;

/** Floor so very small models still get useful document text. */
export const MIN_DOCUMENT_CHARS = 8_000;
