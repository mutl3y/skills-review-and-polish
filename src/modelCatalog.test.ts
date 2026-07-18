// /workspace/skills-review-and-polish/src/modelCatalog.test.ts
//
// Validates the static fallback table in modelCatalog.ts against the
// captured OpenRouter catalog fixture. Flags drift that would change
// the analyzer's document budget materially.

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  _STATIC_CONTEXT_LENGTHS,
  _resetCatalogCaches,
  _resetFixtureCache,
  resolveContextLength,
} from './modelCatalog.js';

const FIXTURE_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'openrouter-catalog.json');

interface CatalogFixture {
  fetchedAt: string;
  count: number;
  entries: Array<[string, number]>;
}

function loadFixture(): CatalogFixture {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Catalog fixture missing at ${FIXTURE_PATH}. ` +
      'Re-run scripts/refresh-openrouter-catalog.mjs to populate it.',
    );
  }
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as CatalogFixture;
}

function normalize(id: string): string {
  return id
    .toLowerCase()
    .replace(/^(openai|anthropic|google|microsoft|meta|mistral|poolside|nvidia|deepseek|qwen|cohere|amazon|tencent|bytedance|upstage|arcee|inception|minimax|moonshot|ibm|liquid|inclusion|rekaai|stepfun|ai21|xai|aion|zai|sakana|thedrummer|kwaipilot)[/:]/, '')
    .replace(/[-_./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Look up an entry in the catalog fixture. Mirrors `resolveContextLength`'s
 * lookup order: exact key, then normalized key, then substring match.
 */
function findInCatalog(
  key: string,
  catalog: Map<string, number>,
): { value: number; matchedKey: string } | undefined {
  const exact = catalog.get(key);
  if (exact !== undefined) return { value: exact, matchedKey: key };
  const normalized = normalize(key);
  const normHit = catalog.get(normalized);
  if (normHit !== undefined) return { value: normHit, matchedKey: normalized };
  for (const [catKey, catVal] of catalog) {
    const catLower = catKey.toLowerCase();
    if (catLower.includes(key.toLowerCase()) || key.toLowerCase().includes(catLower)) {
      return { value: catVal, matchedKey: catKey };
    }
  }
  return undefined;
}

describe('static context-length table', () => {
  it('covers the niche model IDs not in the OpenRouter catalog', () => {
    // The static table exists for model IDs that aren't in OpenRouter
    // (live or fixture). As of 2026-07-17 those are: Copilot display
    // names with spaces, older Gemini, future Gemini, and a few GitHub
    // Models IDs. If the OpenRouter catalog grows to cover these, the
    // static table can shrink further.
    const expected = [
      'gpt-4o mini',                    // Copilot display name (space, not hyphen)
      'gemini 2.0 flash',               // deprecated Gemini
      'gemini 3.0 pro',                 // future Gemini
      'mistral-small-2503',            // GitHub Models ID
      'phi-3.5-mini-instruct',          // GitHub Models ID
    ];
    for (const id of expected) {
      expect(_STATIC_CONTEXT_LENGTHS.has(id), `static table missing '${id}'`).toBe(true);
    }
  });

  it('only contains entries not covered by the OpenRouter catalog', () => {
    // Every static entry must NOT appear in the fixture. If it does, the
    // static table is dead code for that entry — remove it.
    const fixture = loadFixture();
    const catalogLower = new Set(Array.from(fixture.entries, ([k]) => k.toLowerCase()));
    const deadEntries: string[] = [];
    for (const key of _STATIC_CONTEXT_LENGTHS.keys()) {
      const lower = key.toLowerCase();
      let covered = catalogLower.has(lower);
      if (!covered) {
        for (const catLower of catalogLower) {
          if (catLower.includes(lower) || lower.includes(catLower)) {
            covered = true;
            break;
          }
        }
      }
      if (covered) deadEntries.push(key);
    }
    expect(deadEntries, `static entries already covered by OpenRouter catalog: ${deadEntries.join(', ')}`).toEqual([]);
  });

  it('never underestimates the catalog value by more than 10%', () => {
    // Static-table underestimates are dangerous: they shrink the analyzer's
    // document budget for a model that could actually fit the whole skill.
    // Failures here mean someone added a model with an outdated value.
    const fixture = loadFixture();
    const catalog = new Map(fixture.entries);
    const significantDrift: Array<{ key: string; static: number; catalog: number; ratio: number }> = [];

    for (const [key, staticVal] of _STATIC_CONTEXT_LENGTHS) {
      const hit = findInCatalog(key, catalog);
      if (!hit) continue; // not in catalog → genuinely niche, can't audit
      if (staticVal < hit.value * 0.9) {
        significantDrift.push({ key, static: staticVal, catalog: hit.value, ratio: staticVal / hit.value });
      }
    }

    if (significantDrift.length > 0) {
      const detail = significantDrift
        .map(d => `  ${d.key}: static ${d.static}, catalog ${d.catalog} (${Math.round(d.ratio * 100)}%)`)
        .join('\n');
      throw new Error(
        `Static table underestimates the OpenRouter catalog by more than 10% for ${significantDrift.length} model(s):\n${detail}\n` +
        'Update modelCatalog.ts to match the catalog or refresh the fixture via scripts/refresh-openrouter-catalog.mjs.',
      );
    }
  });

  it('is small (covers only the niche cases)', () => {
    // Sanity check: the static table should be tiny. If it grows past
    // 15 entries, it probably means someone added a model that should
    // be in the OpenRouter catalog instead.
    expect(_STATIC_CONTEXT_LENGTHS.size).toBeLessThanOrEqual(15);
  });
});

describe('fetchContextLengths (live)', () => {
  it('returns a catalog with >=100 entries (smoke test)', async () => {
    _resetCatalogCaches();
    const { fetchContextLengths } = await import('./modelCatalog.js');
    const map = await fetchContextLengths();
    expect(map.size).toBeGreaterThanOrEqual(100);
  });
});

describe('resolveContextLength — fallback chain', () => {
  beforeEach(() => {
    _resetCatalogCaches();
    _resetFixtureCache();
  });

  it('explicit override wins over everything', async () => {
    const r = await resolveContextLength('google/gemini-2.5-flash-lite', 999_999);
    expect(r).toEqual({ contextLength: 999_999, source: 'config' });
  });

  it('returns undefined for empty modelId', async () => {
    const r = await resolveContextLength('');
    expect(r).toBeUndefined();
  });

  it('OpenRouter catalog is the primary source (1h in-memory cache)', async () => {
    // First call may hit the network; warm call should be cached.
    const r1 = await resolveContextLength('google/gemini-2.5-flash-lite');
    const t1 = Date.now();
    const r2 = await resolveContextLength('google/gemini-2.5-flash-lite');
    const elapsed = Date.now() - t1;
    expect(r1?.source).toBe('openrouter');
    expect(r2?.source).toBe('openrouter');
    expect(r1).toEqual(r2);
    // Warm call must be near-instant (in-memory cache hit).
    expect(elapsed).toBeLessThan(20);
  });

  it('falls through to the committed fixture when the network is down', async () => {
    // Force a cache miss + network failure.
    _resetCatalogCaches();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('test: network disabled'); };
    try {
      // Pick a model that's in the fixture (OpenRouter catalog has all
      // 1,215 of these so any one will do).
      const r = await resolveContextLength('google/gemini-2.5-flash-lite');
      expect(r?.source).toBe('fixture');
      expect(r?.contextLength).toBe(1_048_576);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('serves niche Copilot display names via the static table when fixture lookup fails', async () => {
    // 'gemini 3.0 pro' is the Copilot display name for a future Gemini
    // that's not yet in the OpenRouter catalog or fixture. With network
    // down, the static table should serve it.
    _resetCatalogCaches();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('test: network disabled'); };
    try {
      const r = await resolveContextLength('gemini 3.0 pro');
      expect(r?.source).toBe('static');
      expect(r?.contextLength).toBe(1_000_000);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns undefined for completely unknown models (caller falls back to 200K)', async () => {
    // Use a name that won't be in any of: live catalog, fixture, static.
    _resetCatalogCaches();
    _resetFixtureCache();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('test: network disabled'); };
    try {
      const r = await resolveContextLength('totally-unknown-model-xyz-9999');
      expect(r).toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('bundled asset (assets/openrouter-catalog.json)', () => {
  const ASSET_PATH = path.join(__dirname, '..', 'assets', 'openrouter-catalog.json');
  const BUNDLED_PATH = path.join(__dirname, '..', 'out', 'assets', 'openrouter-catalog.json');

  it('exists in source (assets/)', () => {
    expect(fs.existsSync(ASSET_PATH), `bundled asset missing at ${ASSET_PATH} — run scripts/refresh-openrouter-catalog.mjs`).toBe(true);
  });

  it('is shipped in the compiled output (out/assets/)', () => {
    // The compile step copies assets/ → out/assets/. If the bundled file
    // isn't in out/, the .vsix won't have it.
    expect(fs.existsSync(BUNDLED_PATH), `compiled bundle missing at ${BUNDLED_PATH} — did you run 'npm run compile' after refreshing the asset?`).toBe(true);
  });

  it('is small enough to ship in the .vsix (< 10KB)', () => {
    const bytes = fs.statSync(ASSET_PATH).size;
    expect(bytes, `bundled asset is ${bytes} bytes — refresh script may be bundling too many models`).toBeLessThan(10_000);
  });

  it('is a subset of the test fixture', () => {
    const bundled = JSON.parse(fs.readFileSync(ASSET_PATH, 'utf8')) as { entries: Array<[string, number]> };
    const full = new Map(loadFixture().entries);
    for (const [id, ctx] of bundled.entries) {
      expect(full.has(id), `bundled entry '${id}' not in test fixture — script is bundling models that don't exist in OpenRouter`).toBe(true);
      expect(full.get(id)).toBe(ctx);
    }
  });

  it('resolveContextLength falls through to the bundled asset (not the test fixture)', async () => {
    // With network disabled and the live catalog cache cleared, the
    // resolve chain should hit the bundled asset. The test fixture at
    // tests/fixtures/ is NOT in the runtime path — that's the test-only
    // drift-detection fixture.
    _resetCatalogCaches();
    _resetFixtureCache();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('test: network disabled'); };
    try {
      // Use a model that's in the bundled asset but should also resolve
      // via live catalog. Confirm source === 'fixture' (i.e. the asset
      // path was found).
      const r = await resolveContextLength('openai/gpt-4o-mini');
      expect(r?.source).toBe('fixture');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
