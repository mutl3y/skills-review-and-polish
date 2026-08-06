/**
 * Shared session token-budget state machine.
 *
 * Both the MCP server (`src/mcp/server.ts`) and the VS Code extension's
 * language-model tools (`src/extension.ts`) drive the same paid engine, so
 * they must share ONE budget implementation — not two copies that drift
 * (one reserves, the other doesn't).
 *
 * Semantics:
 * - `reserveTokens` is a soft pre-check BEFORE a multi-call operation runs,
 *   so a single operation can't blow through the entire remaining budget.
 * - `chargeTokens` runs AFTER the LLM work and records actual spend. When the
 *   charge would exceed the cap, the budget is still incremented (so
 *   `usedTokens` stays honest) and false is returned — the caller may still
 *   return the result, but subsequent requests are refused.
 * - A cap of 0 disables the guard entirely.
 */

import { CHARS_PER_TOKEN } from './tokenBudget';

/** Default cumulative total-token budget cap for a session. */
export const DEFAULT_MAX_TOKENS_PER_SESSION = 500_000;

let _sessionTokens = 0;
let _maxTokensPerSession = DEFAULT_MAX_TOKENS_PER_SESSION;

/** Reset the session budget (for tests). */
export function resetSessionBudget(): void {
  _sessionTokens = 0;
  _maxTokensPerSession = DEFAULT_MAX_TOKENS_PER_SESSION;
}

/** Set the session budget cap directly (for tests). 0 disables the guard. */
export function setSessionBudgetCap(cap: number): void {
  _maxTokensPerSession = cap > 0 ? Math.floor(cap) : 0;
}

/** Read the budget cap from env var or config value. Returns 0 to disable. */
export function resolveMaxTokensPerSession(value: unknown): number {
  const env = process.env.MCP_MAX_TOKENS;
  // Env var takes precedence; an explicit "0" disables the guard.
  if (env !== undefined && env.trim() !== '') {
    const n = Number(env);
    if (Number.isFinite(n)) return n > 0 ? Math.floor(n) : 0;
  }
  // Config-file value: accept a positive number, or an explicit 0 to disable.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? Math.floor(value) : 0;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n > 0 ? Math.floor(n) : 0;
  }
  return DEFAULT_MAX_TOKENS_PER_SESSION;
}

/**
 * Estimate output tokens for a response body (chars / CHARS_PER_TOKEN).
 * Strips insignificant JSON whitespace first so pretty-printed bodies
 * (JSON.stringify(x, null, 2)) aren't over-charged for indentation.
 */
export function estimateOutputTokens(text: string): number {
  const compact = text.replace(/\s+/g, '');
  return Math.ceil(compact.length / CHARS_PER_TOKEN);
}

/**
 * Charge the session budget for an LLM call. Returns true if the charge
 * was accepted (within budget). When the charge would exceed the cap, the
 * budget is still incremented (so `usedTokens` stays honest) and false
 * is returned — the caller may still return the result, but subsequent
 * analysis requests will be refused until the next session.
 *
 * Charges BOTH input and output tokens: the expensive part of an LLM call is
 * the input (a 200K-char document is ~50K input tokens per wave, × 6 waves).
 * `inputChars` is the document text length; `outputText` is the response body.
 * `inputWaves` is the number of times the input is sent to the LLM (analyze
 * runs 6 waves; score runs scoreSamples × waves) — the input cost is charged
 * per wave so the budget reflects actual spend.
 */
export function chargeTokens(inputChars: number, outputText: string, inputWaves = 1): boolean {
  if (_maxTokensPerSession <= 0) return true; // guard disabled
  const inputCost = Math.ceil(inputChars / CHARS_PER_TOKEN) * inputWaves;
  const outputCost = estimateOutputTokens(outputText);
  _sessionTokens += inputCost + outputCost;
  return _sessionTokens <= _maxTokensPerSession;
}

/**
 * Reserve the estimated cost of a multi-call operation BEFORE it runs, so a
 * single `fix` (which makes up to 3 LLM calls) can't blow through the entire
 * remaining budget. Returns true when the reservation fits within the cap.
 * The reservation is a soft pre-check — the actual charge happens after the
 * call via `chargeTokens` — but it prevents starting an operation that is
 * guaranteed to exceed the budget.
 */
export function reserveTokens(inputChars: number, inputWaves: number): boolean {
  if (_maxTokensPerSession <= 0) return true; // guard disabled
  const inputCost = Math.ceil(inputChars / CHARS_PER_TOKEN) * inputWaves;
  return _sessionTokens + inputCost <= _maxTokensPerSession;
}

/** True when the session budget is exhausted (guard enabled and over cap). */
export function budgetExhausted(): boolean {
  return _maxTokensPerSession > 0 && _sessionTokens > _maxTokensPerSession;
}

/** Error message returned when the budget is exhausted. */
export function budgetExhaustedError(): Error {
  return new Error(
    `Session token budget exhausted (${_sessionTokens} / ${_maxTokensPerSession} tokens). ` +
    `Refusing new analysis requests until the next session. Raise the cap via ` +
    `MCP_MAX_TOKENS or the "maxTokensPerSession" config, or set it to 0 to disable.`,
  );
}

/** Current used-token count (for health/status reporting). */
export function usedTokens(): number {
  return _sessionTokens;
}

/** Current configured cap (0 = disabled). */
export function maxTokensPerSession(): number {
  return _maxTokensPerSession;
}
