/**
 * Model pricing fetcher — fetches per-million-token pricing from:
 *   - GitHub Copilot docs (HTML table scraping)
 *   - OpenRouter API (JSON)
 *
 * Pure fetch/parse module — no vscode imports. Safe to use in any Node 18+ context.
 *
 * @module pricing
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelPricing {
  /** Cost per million input tokens (USD). */
  input: number;
  /** Cost per million output tokens (USD). */
  output: number;
  /** Cost per million cached input tokens (USD), if available. */
  cached?: number;
  /** Where the pricing data came from. */
  source: 'copilot' | 'openrouter';
}

export interface PricingCache {
  models: Map<string, ModelPricing>;
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Module-level caches
// ---------------------------------------------------------------------------

const COPILOT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const OPENROUTER_CACHE_TTL_MS = 60 * 60 * 1000;   // 1 hour

let copilotCache: PricingCache | null = null;
let openrouterCache: PricingCache | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and cache all pricing data from both sources.
 * Returns a merged Map of model name/id → pricing.
 *
 * Failures from either source are silently ignored so the picker
 * always works — it just won't have pricing for the failed source.
 */
export async function fetchPricing(): Promise<Map<string, ModelPricing>> {
  const [copilot, openrouter] = await Promise.allSettled([
    fetchCopilotPricing(),
    fetchOpenRouterPricing(),
  ]);

  const merged = new Map<string, ModelPricing>();

  if (copilot.status === 'fulfilled') {
    for (const [k, v] of copilot.value) merged.set(k, v);
  }
  if (openrouter.status === 'fulfilled') {
    for (const [k, v] of openrouter.value) merged.set(k, v);
  }

  return merged;
}

/**
 * Format a ModelPricing for display in a VS Code quick-pick label.
 *
 * Examples:
 *   "$0.25/M in, $2.00/M out"
 *   "$0.10/M in, $0.40/M out (cached: $0.05)"
 *   "27x"   (fallback — used when only multiplier is known)
 *   "❓ unknown"
 */
export function formatPricing(pricing: ModelPricing | undefined): string {
  if (!pricing) return '❓ unknown';

  const inStr = formatPerMillion(pricing.input);
  const outStr = formatPerMillion(pricing.output);
  let result = `${inStr}/M in, ${outStr}/M out`;
  if (pricing.cached !== undefined) {
    result += ` (cached: ${formatPerMillion(pricing.cached)})`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Copilot pricing — HTML table scraping
// ---------------------------------------------------------------------------

async function fetchCopilotPricing(): Promise<Map<string, ModelPricing>> {
  if (copilotCache && Date.now() - copilotCache.fetchedAt < COPILOT_CACHE_TTL_MS) {
    return copilotCache.models;
  }

  // Try HTML scraping first, fall back to static data
  try {
    const resp = await fetch(
      'https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing',
      { headers: { 'User-Agent': 'skills-review-and-polish' } },
    );
    if (resp.ok) {
      const html = await resp.text();
      try {
        const models = parseCopilotHtml(html);
        if (models.size > 0) {
          copilotCache = { models, fetchedAt: Date.now() };
          return models;
        }
      } catch (parseErr) {
        // HTML structure changed — log and fall through to static data
        console.warn(
          `[skills-review] Copilot HTML pricing parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)} — using static fallback`,
        );
      }
    }
  } catch { /* HTML scraping failed — fall through to static data */ }

  // Static fallback — source: docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
  // Last updated: 2026-06-08
  // Canonical source of truth for Copilot model pricing.
  // See also: src/copilotPricing.ts (static subset, retained for backward compatibility).
  const models = new Map<string, ModelPricing>();
  const staticData: Array<[string, number, number, number?]> = [
    ['GPT-4o mini',                   0.03,  0.12],
    ['GPT-4.1 mini',                  0.03,  0.12],
    ['GPT-4.1 nano',                  0.01,  0.04],
    ['GPT-4o',                        1.00,  3.00,  0.25],
    ['GPT-4.1',                       1.00,  3.00,  0.25],
    ['Claude Sonnet 4',              1.50,  6.00,  0.15],
    ['Claude Sonnet 3.5',            1.50,  6.00,  0.15],
    ['Claude Sonnet 3.7',            1.50,  6.00,  0.15],
    ['Claude Sonnet 3.7 Thinking',   1.50,  6.00,  0.15],
    ['Claude Haiku 3.5',             0.50,  2.00,  0.05],
    ['Gemini 2.0 Flash',             0.04,  0.16],
    ['Gemini 2.5 Flash',             0.04,  0.16],
    ['Gemini 2.5 Pro',               0.50,  2.00],
    ['Claude Opus 4',                6.00,  24.00, 0.60],
    ['o1',                           6.00,  24.00, 1.50],
    ['o1-mini',                      1.65,  6.60,  0.41],
    ['o3',                           6.00,  24.00, 1.50],
    ['o3-mini',                      0.55,  2.20,  0.14],
    ['o4-mini',                      0.55,  2.20,  0.14],
    ['Grok 3',                       1.50,  6.00,  0.15],
    ['Grok 3 mini',                  0.15,  0.60],
    ['Mistral Large',                1.00,  3.00],
    ['Mistral Small',                0.05,  0.15],
  ];
  for (const [name, input, output, cached] of staticData) {
    const pricing: ModelPricing = { input, output, source: 'copilot' };
    if (cached !== undefined) pricing.cached = cached;
    models.set(name, pricing);
    models.set(normalizeModelName(name), pricing);
  }
  copilotCache = { models, fetchedAt: Date.now() };
  return models;
}

/**
 * Parse Copilot pricing tables from the docs HTML.
 *
 * Tables have varying column layouts. We look for rows that contain
 * dollar amounts ($X.XX) and extract the model name + pricing columns.
 *
 * Column patterns we handle:
 *   Model | Input | Cached input | Output
 *   Model | Release status | Category | Input | Cached input | Output
 *   Model | Release status | Category | Tier | Threshold | Input | Cached input | Cache write | Output
 */
function parseCopilotHtml(html: string): Map<string, ModelPricing> {
  const models = new Map<string, ModelPricing>();

  // Remove HTML tags to get a simpler text view, but keep <tr>/<td> structure
  // Strategy: find all <tr> rows, extract cell text, then detect pricing patterns
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells = extractCells(rowHtml);
    if (cells.length < 4) continue;

    // Find the model name — first cell that looks like a model name
    const modelName = findModelName(cells);
    if (!modelName) continue;

    // Find dollar-value cells (pattern: $X.XX or $X.XXXX)
    const dollarCells = cells
      .map((c, i) => ({ text: c, index: i }))
      .filter(({ text }) => /^\$\d+(?:\.\d+)?$/.test(text.trim()));

    // Need at least input + output (2 dollar values)
    if (dollarCells.length < 2) continue;

    // The pricing columns vary, but we can detect by position relative to model name.
    // Typical layouts:
    //   [Model, $input, $cached, $output]                (4 cells)
    //   [Model, status, cat, $input, $cached, $output]   (6 cells)
    //   [Model, status, cat, tier, threshold, $input, $cached, $cacheWrite, $output] (9 cells)
    //
    // Strategy: take dollar cells in order — first is input, last is output,
    // second is cached (if there are ≥3 dollar cells).
    const input = parseDollarAmount(dollarCells[0].text);
    const output = parseDollarAmount(dollarCells[dollarCells.length - 1].text);
    const cached = dollarCells.length >= 3
      ? parseDollarAmount(dollarCells[1].text)
      : undefined;

    if (input !== null && output !== null) {
      const pricing: ModelPricing = {
        input,
        output,
        source: 'copilot',
      };
      if (cached !== null) pricing.cached = cached;

      // Store under both the exact name and a normalized lowercase key
      models.set(modelName, pricing);
      models.set(normalizeModelName(modelName), pricing);
    }
  }

  return models;
}

/** Extract text content from <td> or <th> cells in a table row. */
function extractCells(rowHtml: string): string[] {
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = cellRegex.exec(rowHtml)) !== null) {
    // Strip any inner HTML tags and decode common entities
    const text = m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();
    cells.push(text);
  }
  return cells;
}

/**
 * Given a set of cells from a table row, identify which one is the model name.
 *
 * Model names typically contain letters + digits + dots/hyphens, and are NOT
 * dollar amounts, dates, or status words.
 */
function findModelName(cells: string[]): string | null {
  // Known model name patterns — these are the Copilot model display names
  const modelPatterns = [
    /gpt-?\s*\d/i,
    /claude/i,
    /gemini/i,
    /o[1-4]/i,
    /llama/i,
    /mistral/i,
    /phi-/i,
    /deepseek/i,
    /codestral/i,
    /grok/i,
  ];

  for (const cell of cells) {
    const trimmed = cell.trim();
    if (!trimmed || trimmed.length > 200) continue;
    // Skip cells that are clearly not model names
    if (/^\$/.test(trimmed)) continue;        // dollar amount
    if (/^(Input|Output|Cached|Model|Tier|Free|Preview|GA|Status|Category|Threshold|Cache)/i.test(trimmed)) continue;
    if (modelPatterns.some((p) => p.test(trimmed))) {
      return trimmed;
    }
  }

  // Fallback: first non-empty cell that looks like a product name
  for (const cell of cells) {
    const trimmed = cell.trim();
    if (!trimmed || trimmed.length > 100 || trimmed.length < 3) continue;
    if (/^\$/.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (/^(Input|Output|Cached|Model|Tier|Free|Preview|GA|Status|Category|Threshold|Cache)/i.test(trimmed)) continue;
    return trimmed;
  }

  return null;
}

// ---------------------------------------------------------------------------
// OpenRouter pricing — JSON API
// ---------------------------------------------------------------------------

async function fetchOpenRouterPricing(): Promise<Map<string, ModelPricing>> {
  if (openrouterCache && Date.now() - openrouterCache.fetchedAt < OPENROUTER_CACHE_TTL_MS) {
    return openrouterCache.models;
  }

  const resp = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'User-Agent': 'skills-review-and-polish' },
  });
  if (!resp.ok) throw new Error(`OpenRouter pricing fetch failed: HTTP ${resp.status}`);
  const json = (await resp.json()) as OpenRouterModelsResponse;

  const models = parseOpenRouterResponse(json);
  openrouterCache = { models, fetchedAt: Date.now() };
  return models;
}

interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name: string;
    pricing?: {
      prompt?: string;
      completion?: string;
    };
  }>;
}

function parseOpenRouterResponse(json: OpenRouterModelsResponse): Map<string, ModelPricing> {
  const models = new Map<string, ModelPricing>();

  for (const entry of json.data ?? []) {
    if (!entry.pricing) continue;

    const promptPrice = parseFloat(entry.pricing.prompt ?? '0');
    const completionPrice = parseFloat(entry.pricing.completion ?? '0');

    // OpenRouter pricing is per-token in dollars → convert to per-million
    const input = promptPrice * 1_000_000;
    const output = completionPrice * 1_000_000;

    const pricing: ModelPricing = { input, output, source: 'openrouter' };

    // Store under the OpenRouter model ID (e.g. "openai/gpt-4o-mini")
    if (entry.id) {
      models.set(entry.id, pricing);
    }
    // Also store under friendly name if different
    if (entry.name && entry.name !== entry.id) {
      models.set(entry.name, pricing);
      models.set(normalizeModelName(entry.name), pricing);
    }
  }

  return models;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a "$X.XX" string into a numeric dollar amount. Returns null if invalid. */
function parseDollarAmount(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, '');
  const match = cleaned.match(/^\$(\d+(?:\.\d+)?)$/);
  return match ? parseFloat(match[1]) : null;
}

/** Format a per-million-token price for display. */
function formatPerMillion(price: number): string {
  if (price === 0) return '$0.00';
  if (price < 0.01) return `$${price.toFixed(4)}`;
  if (price < 1) return `$${price.toFixed(2)}`;
  if (price < 100) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(2)}`;
}

/**
 * Normalize a model name for fuzzy matching.
 *
 * Converts "GPT-5 Mini" → "gpt-5 mini", "Claude Sonnet 4.6" → "claude sonnet 4.6"
 * Also strips common vendor prefixes for cross-matching.
 */
export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(openai|anthropic|google|microsoft|meta|mistral)\//, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Testing helpers — exported for unit tests only
// ---------------------------------------------------------------------------

/** @internal Reset all caches (for testing). */
export function _resetCaches(): void {
  copilotCache = null;
  openrouterCache = null;
}

/** @internal Expose parseCopilotHtml for unit testing. */
export { parseCopilotHtml as _parseCopilotHtml };

/** @internal Expose parseOpenRouterResponse for unit testing. */
export { parseOpenRouterResponse as _parseOpenRouterResponse };
