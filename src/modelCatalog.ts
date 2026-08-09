/**
 * Model context-length catalog.
 *
 * Resolves the input context length (in tokens) for a model ID. Used by
 * the analyzer to scale `MAX_ANALYSIS_DOCUMENT_CHARS` per-model so large-
 * context models (e.g. Gemini 1M, Llama-4-Scout 10M) don't truncate real
 * production skills to head/tail excerpts.
 *
 * Sources, in precedence order (highest wins):
 *
 *   1. `config.contextLength` — explicit override in `.skills-review.json`
 *      or MCP `engine_config`. Survives network failures.
 *   2. OpenRouter `/models` catalog — `context_length` field, ~1,215
 *      models with 1h cache (same TTL as the pricing catalog).
 *   3. Committed fixture (`tests/fixtures/openrouter-catalog.json`) —
 *      last-known-good snapshot of the OpenRouter catalog. Works offline.
 *      Refreshed by `node scripts/refresh-openrouter-catalog.mjs`. Stops us from
 *      hand-maintaining a model table in source code.
 *   4. Static fallback table — known vscode.lm (Copilot) IDs that don't
 *      appear in either OpenRouter catalog.
 *   5. `undefined` — caller falls back to `Analyzer.DEFAULT_MAX_DOCUMENT_CHARS`
 *      (200K chars, ~50K tokens, fits every supported model).
 *
 * The same lookup powers:
 *
 *   - The VS Code model picker (surfaces `ctx=200K` in the detail line)
 *   - The MCP `engine_info` and `resolve_model_context` tools
 *   - The provider constructor's `contextLength` option
 *
 * @module modelCatalog
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { normalizeModelId } from './core/modelNames';

const OPENROUTER_CACHE_TTL_MS = 60 * 60 * 1000;   // 1 hour — matches pricing
const OPENROUTER_DISK_CACHE_TTL_MS = 15 * 60 * 1000;
const OPENROUTER_CACHE_FILE = path.join(
  os.tmpdir(),
  'skills-review-and-polish-openrouter-context-cache-v1.json',
);
/** Minimum entries expected in a real OpenRouter /models response. */
const MIN_OPENROUTER_ENTRIES = 100;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/** Copilot context cache disk file (offline resilience, mirrors OpenRouter). */
const COPILOT_DISK_CACHE_TTL_MS = 15 * 60 * 1000;

/** Copilot disk cache file, keyed by a token hash so different tokens don't share a cache.
 *
 * Security note: The filename uses a SHA256 prefix of the API key (first 16 hex chars = 64 bits).
 * This provides sufficient entropy to prevent brute-force identification — an attacker would need
 * to guess 2^64 possible values. The cache content only stores model context lengths (public data),
 * not any sensitive information. A random salt stored separately would add complexity without
 * meaningful security benefit for this use case.
 */
function copilotCacheFile(apiKey: string): string {
  const digest = createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `skills-review-and-polish-copilot-context-cache-${digest}.json`);
}

interface CatalogCache {
  models: Map<string, number>;
  fetchedAt: number;
}

let catalogCache: CatalogCache | null = null;
let catalogFetchInFlight: Promise<Map<string, number>> | null = null;

// ---------------------------------------------------------------------------
// Committed fixture — last-known-good OpenRouter catalog, refreshed by
// running `node scripts/refresh-openrouter-catalog.mjs` (or any equivalent).
//
// Used as the offline fallback when the live OpenRouter fetch fails. Stops
// us from having to hand-maintain a model table in source code: we trust
// the captured snapshot, and a refresh of the fixture is a single command.
// ---------------------------------------------------------------------------

/** Lazy-loaded fixture Map. Undefined until first access. */
let fixtureCache: Map<string, number> | undefined;

/**
 * Path to the committed fixture, relative to the repo root.
 * Resolved at runtime so dev/CI environments work without bundling.
 */
function getFixturePath(): string {
  // Look for the bundled OpenRouter catalog fixture. The compile script
  // copies `assets/openrouter-catalog.json` to `out/assets/` so the
  // top-N fixture ships inside the .vsix. In dev/test, the source
  // file at `assets/` is found; in production, the copy at `out/assets/`
  // is found.
  //
  //   dev:    <repo>/src/modelCatalog.ts
  //   dev:    <repo>/assets/openrouter-catalog.json
  //   prod:   <repo>/out/modelCatalog.js
  //   prod:   <repo>/out/assets/openrouter-catalog.json
  const candidates = [
    path.join(__dirname, 'assets', 'openrouter-catalog.json'),              // prod: out/assets/
    path.join(__dirname, '..', 'assets', 'openrouter-catalog.json'),         // dev: src → repo
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!; // Return the first even if missing; loadFixture() handles absence.
}

function loadFixture(): Map<string, number> | undefined {
  if (fixtureCache !== undefined) return fixtureCache;
  try {
    const raw = fs.readFileSync(getFixturePath(), 'utf8');
    const parsed = JSON.parse(raw) as { entries: Array<[string, number]> };
    if (Array.isArray(parsed.entries) && parsed.entries.length > 0) {
      fixtureCache = new Map(parsed.entries);
    } else {
      fixtureCache = new Map();
    }
  } catch {
    // Fixture missing or malformed — return empty map; resolveContextLength
    // will treat it as "no fixture hit" and fall through to the static table.
    fixtureCache = new Map();
  }
  return fixtureCache.size > 0 ? fixtureCache : undefined;
}

/** @internal Reset the fixture cache (for tests). */
export function _resetFixtureCache(): void {
  fixtureCache = undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch and cache all model context lengths from OpenRouter.
 * Failures are silently ignored so callers always get a usable Map.
 *
 * The returned Map uses the same triple-key convention as `fetchPricing`:
 *   - OpenRouter ID (e.g. `openai/gpt-4o-mini`)
 *   - Friendly display name (e.g. `OpenAI: GPT-4o mini`)
 *   - Normalized name (e.g. `gpt 4o mini`)
 */
export async function fetchContextLengths(): Promise<Map<string, number>> {
  if (catalogCache && Date.now() - catalogCache.fetchedAt < OPENROUTER_CACHE_TTL_MS) {
    return catalogCache.models;
  }

  const diskCache = readDiskCache();
  if (diskCache && Date.now() - diskCache.fetchedAt < OPENROUTER_DISK_CACHE_TTL_MS) {
    // Require both a sufficient count AND real-looking model IDs — a test mock
    // writing 1000+ sequential entries would otherwise be trusted as real.
    if (diskCache.models.size >= MIN_OPENROUTER_ENTRIES && isRealContextCache(diskCache.models)) {
      catalogCache = diskCache;
      return diskCache.models;
    }
    try { fs.unlinkSync(OPENROUTER_CACHE_FILE); } catch { /* ignore */ }
  }

  if (catalogFetchInFlight) {
    return catalogFetchInFlight;
  }

  catalogFetchInFlight = (async () => {
    const resp = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {
      headers: { 'User-Agent': 'skills-review-and-polish' },
    });
    if (!resp.ok) throw new Error(`OpenRouter context fetch failed: HTTP ${resp.status}`);
    const json = await resp.json() as OpenRouterModelsResponse;
    const models = parseOpenRouterContextResponse(json);
    catalogCache = { models, fetchedAt: Date.now() };
    if (models.size >= MIN_OPENROUTER_ENTRIES) {
      writeDiskCache(catalogCache);
    }
    return models;
  })();

  try {
    return await catalogFetchInFlight;
  } finally {
    catalogFetchInFlight = null;
  }
}

/**
 * Resolve the input context length (in tokens) for a model ID.
 *
 * Precedence (highest first):
 *   1. `explicitOverride` — caller-supplied value (e.g. from `.skills-review.json`)
 *   2. OpenRouter catalog (fetched on demand, 1h cache) — most current
 *   3. Committed fixture (`tests/fixtures/openrouter-catalog.json`) —
 *      last-known-good catalog, works offline. Refreshed by running
 *      `node scripts/refresh-openrouter-catalog.mjs`.
 *   4. Static fallback table for known Copilot IDs
 *      (vscode.lm paths where neither OpenRouter nor the fixture applies)
 *   5. `undefined`
 *
 * @param modelId The model identifier. Accepts either OpenRouter form
 *   (`google/gemini-2.5-flash-lite`) or vendor-prefixed forms
 *   (`gpt-4o-mini`, `claude-sonnet-4.6`).
 * @param explicitOverride Optional explicit context length (wins over catalog).
 */
export async function resolveContextLength(
  modelId: string,
  explicitOverride?: number,
): Promise<ResolvedContextLength | undefined> {
  if (explicitOverride && explicitOverride > 0) {
    return { contextLength: explicitOverride, source: 'config' };
  }
  if (!modelId) return undefined;

  // 1) OpenRouter catalog — live, most current. 1h in-memory cache,
  //    ~140ms cold fetch from the network.
  try {
    const catalog = await fetchContextLengths();
    const hit = catalog.get(modelId)
      ?? catalog.get(normalizeModelId(modelId));
    if (hit) {
      return { contextLength: hit, source: 'openrouter' };
    }
  } catch {
    // Network failure — fall through to the committed fixture.
  }

  // 2) Committed fixture — last-known-good OpenRouter catalog. Works
  //    offline. Refreshed by `node scripts/refresh-openrouter-catalog.mjs`. Stops us
  //    from hand-maintaining a model table in source code.
  const fixture = loadFixture();
  if (fixture) {
    const hit = fixture.get(modelId)
      ?? fixture.get(normalizeModelId(modelId));
    if (hit) {
      return { contextLength: hit, source: 'fixture' };
    }
  }

  // 3) Static fallback — covers vscode.lm (Copilot) paths where neither
  //    OpenRouter nor the fixture applies. Hand-maintained.
  const staticHit = STATIC_CONTEXT_LENGTHS.get(modelId)
    ?? STATIC_CONTEXT_LENGTHS.get(normalizeModelId(modelId));
  if (staticHit) {
    return { contextLength: staticHit, source: 'static' };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// GitHub Copilot API context lengths
// ---------------------------------------------------------------------------
// The Copilot API (`api.githubcopilot.com/models`) exposes
// `max_context_window_tokens` per model. We fetch it live (with a short cache)
// so new Copilot models are picked up automatically — no static table to
// maintain. This is the same pattern as the OpenRouter catalog fetch.

const COPILOT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const COPILOT_MODELS_URL = 'https://api.githubcopilot.com/models';

interface CopilotModelsResponse {
  data?: Array<{
    id: string;
    capabilities?: {
      limits?: {
        max_context_window_tokens?: number;
      };
    };
  }>;
}

// Completed Copilot catalog caches, keyed by token so alternating tokens don't
// thrash a single global cache (each token's result is reused independently).
const copilotCache = new Map<string, { models: Map<string, number>; fetchedAt: number }>();
// In-flight Copilot catalog fetches, keyed by token so concurrent callers with
// different tokens don't share (and observe the wrong) fetch.
const copilotFetchInFlight = new Map<string, Promise<Map<string, number>>>();

/**
 * Fetch and cache all model context lengths from the GitHub Copilot API.
 * Failures are silently ignored so callers always get a usable Map.
 *
 * The returned Map keys are the Copilot model IDs (e.g. `gpt-5-mini`,
 * `gpt-4.1`, `claude-sonnet-4.5`) plus their normalized forms, so lookups
 * by either raw ID or normalized name hit.
 *
 * The cache is keyed by the API token so different tokens (config-file engine
 * vs env-var engine, or token rotation) never reuse each other's in-flight
 * fetch or cached models.
 */
export async function fetchCopilotContextLengths(
  apiKey: string,
): Promise<Map<string, number>> {
  const cached = copilotCache.get(apiKey);
  if (cached && Date.now() - cached.fetchedAt < COPILOT_CACHE_TTL_MS) {
    return cached.models;
  }
  // Key the in-flight fetch by token so a second caller with a DIFFERENT token
  // doesn't await the first caller's fetch (which would observe the wrong
  // catalog completion or stick to the first failure).
  const inFlight = copilotFetchInFlight.get(apiKey);
  if (inFlight) {
    return inFlight;
  }

  // Disk cache for offline resilience (mirrors the OpenRouter path).
  const disk = readCopilotDiskCache(apiKey);
  if (disk && Date.now() - disk.fetchedAt < COPILOT_DISK_CACHE_TTL_MS) {
    copilotCache.set(apiKey, { models: disk.models, fetchedAt: disk.fetchedAt });
    return disk.models;
  }

  const promise = (async () => {
    const resp = await fetchWithTimeout(COPILOT_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Copilot-Integration-Id': 'vscode-chat',
        // Use the real editor version when provided (extension host passes it
        // via COPILOT_EDITOR_VERSION), falling back to a current default —
        // don't hardcode a spoofed version here.
        'Editor-Version': process.env.COPILOT_EDITOR_VERSION ?? 'vscode/1.90.0',
      },
    });
    if (!resp.ok) throw new Error(`Copilot context fetch failed: HTTP ${resp.status}`);
    const json = await resp.json() as CopilotModelsResponse;
    const models = new Map<string, number>();
    for (const entry of json.data ?? []) {
      const ctx = entry.capabilities?.limits?.max_context_window_tokens;
      if (entry.id && typeof ctx === 'number' && ctx > 0) {
        models.set(entry.id, ctx);
        models.set(normalizeModelId(entry.id), ctx);
      }
    }
    copilotCache.set(apiKey, { models, fetchedAt: Date.now() });
    writeCopilotDiskCache({ models, fetchedAt: Date.now(), apiKey });
    return models;
  })();
  copilotFetchInFlight.set(apiKey, promise);

  try {
    return await promise;
  } finally {
    copilotFetchInFlight.delete(apiKey);
  }
}

function readCopilotDiskCache(apiKey: string): CatalogCache | null {
  try {
    const file = copilotCacheFile(apiKey);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as SerializedCatalogCache;
    if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== 'number') {
      return null;
    }
    return { models: new Map(parsed.entries), fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeCopilotDiskCache(cache: { models: Map<string, number>; fetchedAt: number; apiKey: string }): void {
  try {
    const payload: SerializedCatalogCache = {
      fetchedAt: cache.fetchedAt,
      entries: Array.from(cache.models.entries()),
    };
    fs.writeFileSync(copilotCacheFile(cache.apiKey), JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Ignore — fresh fetch on next call.
  }
}

/** @internal Reset the Copilot context cache (for tests). */
export function _resetCopilotContextCache(): void {
  copilotCache.clear();
  copilotFetchInFlight.clear();
  try {
    const dir = os.tmpdir();
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('skills-review-and-polish-copilot-context-cache-')) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

/**
 * Resolve the input context length (in tokens) for a Copilot API model ID.
 * Fetches the live Copilot `/models` catalog (1h cache) so new models are
 * picked up automatically. Returns `undefined` when the model is unknown or
 * the fetch fails (caller falls back to the analyzer's 200K-char budget).
 */
export async function resolveCopilotContextLength(
  modelId: string,
  apiKey: string,
): Promise<number | undefined> {
  if (!modelId || !apiKey) return undefined;
  try {
    const models = await fetchCopilotContextLengths(apiKey);
    return models.get(modelId) ?? models.get(normalizeModelId(modelId));
  } catch {
    return undefined;
  }
}

export interface ResolvedContextLength {
  /** Input context length in tokens. */
  contextLength: number;
  /** Where this value came from. */
  source: 'config' | 'openrouter' | 'static' | 'fixture';
}

// ---------------------------------------------------------------------------
// Static fallback — niche model names not in the OpenRouter catalog
// ---------------------------------------------------------------------------

/**
 * Slim fallback for model IDs that don't appear in the OpenRouter catalog
 * (live or fixture). As of 2026-07-17 the OpenRouter catalog covers ~1,215
 * models including every major Copilot ID we care about.
 * The entries below cover the remaining edge cases:
 *
 *   - `gpt-4o mini` (with space) — Copilot picker display name. The
 *     OpenRouter catalog has `gpt-4o-mini` (hyphen) but not the spaced
 *     form. Users passing the Copilot display name to MCP hit this.
 *   - `gemini 2.0 flash` — older Gemini, deprecated but still selectable
 *     in some Copilot deployments.
 *   - `gemini 3.0 pro` — future Gemini, not yet in OpenRouter catalog.
 *
 * To add a new model: prefer the live OpenRouter catalog. Only add a
 * static entry if the model is genuinely not available there.
 */
const STATIC_CONTEXT_LENGTHS = new Map<string, number>([
  // Keys are stored in NORMALIZED form (normalizeModelId output: separators
  // collapsed to spaces) so BOTH lookup branches — raw modelId and
  // normalizeModelId(modelId) — can hit. Previously these were raw
  // spaced-hyphen keys ('gpt-4o mini'), which the normalized branch
  // ('gpt 4o mini') could never match.
  //
  // NOTE: `gpt-4o-mini` is NOT listed here — it IS in the OpenRouter catalog,
  // and the normalized lookup finds it there. Only models genuinely absent
  // from the catalog belong in this table.
  ['gemini 2 0 flash', 1_000_000],
  ['gemini 3 0 pro',   1_000_000],
]);

/**
 * Normalize a model identifier for catalog lookup.
 *   "openai/gpt-4o-mini" → "gpt 4o mini"
 *   "GPT-4o mini"        → "gpt 4o mini"
 */

// ---------------------------------------------------------------------------
// OpenRouter response parsing
// ---------------------------------------------------------------------------

interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name: string;
    /**
     * Total context length (input + output) in tokens. As of 2026-07 the
     * OpenRouter catalog returns this for every model. Older entries may
     * omit it; treat those as "unknown".
     */
    context_length?: number;
  }>;
}

function parseOpenRouterContextResponse(json: OpenRouterModelsResponse): Map<string, number> {
  const models = new Map<string, number>();

  for (const entry of json.data ?? []) {
    if (typeof entry.context_length !== 'number' || entry.context_length <= 0) continue;
    const ctx = entry.context_length;

    if (entry.id) models.set(entry.id, ctx);
    if (entry.name && entry.name !== entry.id) {
      models.set(entry.name, ctx);
      models.set(normalizeModelId(entry.name), ctx);
    }
    if (entry.id) models.set(normalizeModelId(entry.id), ctx);
  }

  return models;
}

// ---------------------------------------------------------------------------
// Display helper
// ---------------------------------------------------------------------------

/**
 * Format a context length for display in the picker and MCP tool output.
 *
 *   128000 → "128K"
 *   1000000 → "1M"
 *   16000 → "16K"
 *   undefined → "❓ ctx"
 */
export function formatContextLength(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return '❓ ctx';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  const k = Math.round(tokens / 1_000);
  return `${k}K`;
}

// ---------------------------------------------------------------------------
// HTTP + disk cache helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface SerializedCatalogCache {
  fetchedAt: number;
  entries: Array<[string, number]>;
}

function readDiskCache(): CatalogCache | null {
  try {
    if (!fs.existsSync(OPENROUTER_CACHE_FILE)) return null;
    const raw = fs.readFileSync(OPENROUTER_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as SerializedCatalogCache;
    if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== 'number') {
      return null;
    }
    return {
      models: new Map(parsed.entries),
      fetchedAt: parsed.fetchedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Content-quality check for a cached OpenRouter context-length map.
 *
 * Mirrors pricing.ts's `isRealPricingCache`: the count check alone is not
 * enough — a test mock can write 1000+ sequential `Model 0` /
 * `vendor/model-1` entries that pass the count check but are fake. Real
 * OpenRouter model IDs contain a known vendor slug and a descriptive name.
 * This rejects a cache that is mostly sequential test data.
 */
function isRealContextCache(models: Map<string, number>): boolean {
  const KNOWN_VENDORS = /^(openai|anthropic|google|microsoft|meta|mistral|poolside|nvidia|deepseek|qwen|cohere|amazon|tencent|bytedance|upstage|arcee|inception|minimax|moonshot|ibm|liquid|inclusion|rekaai|stepfun|ai21|xai|aion|zai|sakana|thedrummer|kwaipilot)\//;
  // Sequential test data patterns: `vendor/model-0`, `Model 0`, `model 0`.
  const SEQUENTIAL = /(?:^|\/)model[- ]\d+$/i;
  const keys = Array.from(models.keys());
  let real = 0;
  let sampled = 0;
  for (const key of keys) {
    if (SEQUENTIAL.test(key)) continue; // sequential test data
    if (KNOWN_VENDORS.test(key)) { real++; sampled++; continue; }
    // Non-vendor-prefixed keys (display names / normalized). Count these toward
    // real only if they don't look sequential.
    if (/^\d+$/.test(key)) continue;
    sampled++;
    real++;
    if (sampled >= 200) break;
  }
  // Require that essentially all sampled keys look real (allow a tiny noise
  // margin). If nothing was sampled (all keys were sequential test data), the
  // cache is fake.
  return sampled > 0 && (real / sampled) > 0.9;
}

function writeDiskCache(cache: CatalogCache): void {
  try {
    const payload: SerializedCatalogCache = {
      fetchedAt: cache.fetchedAt,
      entries: Array.from(cache.models.entries()),
    };
    fs.writeFileSync(OPENROUTER_CACHE_FILE, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Ignore — fresh fetch on next call.
  }
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** @internal Reset caches (for testing). */
export function _resetCatalogCaches(): void {
  catalogCache = null;
  catalogFetchInFlight = null;
  try {
    if (fs.existsSync(OPENROUTER_CACHE_FILE)) {
      fs.unlinkSync(OPENROUTER_CACHE_FILE);
    }
  } catch {
    // Ignore cleanup failures.
  }
}

/** @internal Expose static table for unit tests. */
export const _STATIC_CONTEXT_LENGTHS = STATIC_CONTEXT_LENGTHS;
