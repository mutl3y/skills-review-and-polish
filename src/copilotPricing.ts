/**
 * Static pricing data for GitHub Copilot premium models.
 *
 * Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
 * Last updated: 2026-06-08
 *
 * When this list gets stale, run the model picker — unmatched models will show
 * the Copilot multiplier (Nx) as a fallback.
 *
 * NOTE: This file duplicates the static fallback data in `src/pricing.ts`.
 * `pricing.ts` is the canonical pricing source (it fetches live data and falls
 * back to the same static list). This module is retained for backward
 * compatibility with any external consumers.
 */

export interface CopilotModelPricing {
  /** Model name as it appears in vscode.lm (case-insensitive match). */
  name: string;
  /** Cost per 1 million input tokens in US dollars. */
  inputPerM: number;
  /** Cost per 1 million output tokens in US dollars. */
  outputPerM: number;
  /** Cost per 1 million cached input tokens in US dollars. 0 if N/A. */
  cachedPerM: number;
}

// Copilot Business/Enterprise models — sorted by input cost ascending.
export const COPILOT_MODEL_PRICING: CopilotModelPricing[] = [
  // --- Included in Copilot plans (0 premium requests) ---
  { name: 'GPT-4o mini',                    inputPerM: 0.03,  outputPerM: 0.12, cachedPerM: 0 },
  { name: 'GPT-4.1 mini',                   inputPerM: 0.03,  outputPerM: 0.12, cachedPerM: 0 },
  { name: 'GPT-4.1 nano',                   inputPerM: 0.01,  outputPerM: 0.04, cachedPerM: 0 },
  // --- Premium models ---
  { name: 'GPT-4o',                         inputPerM: 1.00,  outputPerM: 3.00, cachedPerM: 0.25 },
  { name: 'GPT-4.1',                        inputPerM: 1.00,  outputPerM: 3.00, cachedPerM: 0.25 },
  { name: 'Claude Sonnet 4',               inputPerM: 1.50,  outputPerM: 6.00, cachedPerM: 0.15 },
  { name: 'Claude Sonnet 3.5',             inputPerM: 1.50,  outputPerM: 6.00, cachedPerM: 0.15 },
  { name: 'Claude Sonnet 3.7',             inputPerM: 1.50,  outputPerM: 6.00, cachedPerM: 0.15 },
  { name: 'Claude Sonnet 3.7 Thinking',    inputPerM: 1.50,  outputPerM: 6.00, cachedPerM: 0.15 },
  { name: 'Claude Haiku 3.5',              inputPerM: 0.50,  outputPerM: 2.00, cachedPerM: 0.05 },
  { name: 'Gemini 2.0 Flash',              inputPerM: 0.04,  outputPerM: 0.16, cachedPerM: 0 },
  { name: 'Gemini 2.5 Flash',              inputPerM: 0.04,  outputPerM: 0.16, cachedPerM: 0 },
  { name: 'Gemini 2.5 Pro',                inputPerM: 0.50,  outputPerM: 2.00, cachedPerM: 0 },
  // --- Higher tier ---
  { name: 'Claude Opus 4',                 inputPerM: 6.00,  outputPerM: 24.00, cachedPerM: 0.60 },
  { name: 'o1',                            inputPerM: 6.00,  outputPerM: 24.00, cachedPerM: 1.50 },
  { name: 'o1-mini',                       inputPerM: 1.65,  outputPerM: 6.60, cachedPerM: 0.41 },
  { name: 'o3',                            inputPerM: 6.00,  outputPerM: 24.00, cachedPerM: 1.50 },
  { name: 'o3-mini',                       inputPerM: 0.55,  outputPerM: 2.20, cachedPerM: 0.14 },
  { name: 'o4-mini',                       inputPerM: 0.55,  outputPerM: 2.20, cachedPerM: 0.14 },
  { name: 'Grok 3',                        inputPerM: 1.50,  outputPerM: 6.00, cachedPerM: 0.15 },
  { name: 'Grok 3 mini',                   inputPerM: 0.15,  outputPerM: 0.60, cachedPerM: 0 },
  { name: 'Mistral Large',                 inputPerM: 1.00,  outputPerM: 3.00, cachedPerM: 0 },
  { name: 'Mistral Small',                 inputPerM: 0.05,  outputPerM: 0.15, cachedPerM: 0 },
];

/**
 * Look up pricing for a model by its display name.
 * Does a case-insensitive substring match so "Claude Sonnet 4 (copilot)"
 * matches "Claude Sonnet 4".
 */
export function findModelPricing(modelName: string): CopilotModelPricing | undefined {
  const lower = modelName.toLowerCase();
  return COPILOT_MODEL_PRICING.find(p => lower.includes(p.name.toLowerCase()));
}

/**
 * Format a per-M token price for display.
 * e.g. $1.50/M, $0.03/M, $0.00/M
 */
export function formatPerM(price: number): string {
  if (price === 0) return '$0.00/M';
  if (price < 0.01) return `$${price.toFixed(2)}/M`;
  if (price < 1) return `$${price.toFixed(2)}/M`;
  return `$${price.toFixed(2)}/M`;
}

/**
 * Format a model's pricing as a human-readable string.
 * e.g. "$1.50/M in, $6.00/M out"
 */
export function formatModelPricing(pricing: CopilotModelPricing): string {
  return `${formatPerM(pricing.inputPerM)} in, ${formatPerM(pricing.outputPerM)} out`;
}
