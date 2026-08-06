/**
 * Shared LLM text helpers.
 *
 * Single source of truth for stripping code fences from LLM JSON output.
 * Previously the same anchored fence-strip regex was copy-pasted in the
 * analyzer, the vscode.lm provider, and the extension — a duplicated regex
 * that could drift.
 */

/**
 * Strip a code fence ONLY when it wraps the WHOLE text (anchored leading/
 * trailing). Never matches an inner fence (e.g. a ```python example embedded
 * inside a JSON string value) — that would corrupt valid JSON.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
    : trimmed;
}
