// scripts/probes/probe-catalog.mjs
// Measure: OpenRouter /models cold-fetch latency vs warm (cached).
// Cold: clear our cache file first.

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

// Cold: clear our cache file first.
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const cacheFile = path.join(os.tmpdir(), 'skills-review-and-polish-openrouter-context-cache-v1.json');
try { fs.unlinkSync(cacheFile); } catch {}

async function timeFetch(label) {
  const t0 = Date.now();
  const resp = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'User-Agent': 'skills-review-and-polish' },
  });
  const t1 = Date.now();
  if (!resp.ok) { console.log(`  ${label}: HTTP ${resp.status}`); return; }
  const json = await resp.json();
  const t2 = Date.now();
  console.log(`  ${label}: HTTP ${resp.status}, headers+=${t1-t0}ms, body+=${t2-t0}ms, models=${json.data?.length ?? 'n/a'}`);
}

// Run 3 cold fetches in series
console.log('OpenRouter /models fetch latency:');
await timeFetch('cold #1');
await timeFetch('cold #2');
await timeFetch('cold #3');

// Warm: subsequent fetches are usually faster (CDN cache hit)
console.log('\nAfter CDN warmup:');
await timeFetch('warm #1');
await timeFetch('warm #2');

// In-memory cache simulation: same fetch object should be fast
console.log('\nConcurrent fetches (browser-style connection reuse):');
const start = Date.now();
await Promise.all([timeFetch('concurrent A'), timeFetch('concurrent B'), timeFetch('concurrent C')]);
console.log(`  total wall time: ${Date.now() - start}ms`);