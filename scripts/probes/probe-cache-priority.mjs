// scripts/probes/probe-cache-priority.mjs
// Verify: warm calls hit the in-memory OpenRouter cache (no I/O).
// Cold calls fetch from network, populate the cache, return.
// Network failure falls through to the fixture, then to the static table.
// Cited from docs/plan/archive/releases/20260716-release-readiness-remediation/plan.yaml
// ("End-to-end probe confirms the chain: cold 139ms network → 0ms
// in-memory cache → fixture on network failure → static table on niche
// names → undefined → 200K analyzer fallback").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = await import(path.join(ROOT, 'out', 'modelCatalog.js'));
const { resolveContextLength, _resetCatalogCaches, _resetFixtureCache, fetchContextLengths } = CATALOG;

_resetCatalogCaches();
_resetFixtureCache();
try { fs.unlinkSync('logs/skills-review-and-polish-openrouter-context-cache-v1.json'); } catch {}

// ── 1. Cold call — should hit network, populate cache
console.log('--- 1. Cold call (OpenRouter network) ---');
const t0 = Date.now();
const r1 = await resolveContextLength('google/gemini-2.5-flash-lite');
const t1 = Date.now();
console.log(`  ${t1 - t0}ms  result:`, r1);

// ── 2. Warm call — should hit in-memory cache
console.log('\n--- 2. Warm call (in-memory cache) ---');
const t2 = Date.now();
const r2 = await resolveContextLength('google/gemini-2.5-flash-lite');
const t3 = Date.now();
console.log(`  ${t3 - t2}ms  result:`, r2);

// ── 3. Lookup of a model NOT in OpenRouter catalog but in the fixture
console.log('\n--- 3. Lookup of fixture-only model (no OpenRouter hit, fixture hit) ---');
// First confirm the model is in the fixture
const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'openrouter-catalog.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const target = fixture.entries.find(([id]) => id.toLowerCase().includes('claude opus 4.7') && !id.toLowerCase().includes('sonnet'));
if (!target) { console.log('  (no suitable fixture entry found)'); }
else {
  console.log(`  Probing: ${target[0]}`);
  const t4 = Date.now();
  const r4 = await resolveContextLength(target[0]);
  const t5 = Date.now();
  console.log(`  ${t5 - t4}ms  result:`, r4);
}

// ── 4. Force a network failure by deleting the cache and disabling fetch
console.log('\n--- 4. Network down, fixture has the model ---');
_resetCatalogCaches();
const origFetch = globalThis.fetch;
let callCount = 0;
globalThis.fetch = async (...args) => {
  callCount++;
  throw new Error('test: network disabled');
};
const t6 = Date.now();
const r6 = await resolveContextLength('google/gemini-2.5-flash-lite');
const t7 = Date.now();
console.log(`  ${t7 - t6}ms  result:`, r6, `  (network calls attempted: ${callCount})`);

globalThis.fetch = origFetch;

// ── 5. Unknown model that is in neither OpenRouter nor fixture — should fall back to 200K warning
console.log('\n--- 5. Unknown model (no catalog/fixture/static hit) ---');
const r7 = await resolveContextLength('totally-unknown-model-xyz-9999');
console.log('  result:', r7);
