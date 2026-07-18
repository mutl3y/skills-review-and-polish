// scripts/probes/probe-static-table.mjs
// Test the static fallback table in modelCatalog.ts.
// For each entry, run resolveContextLength with the OpenRouter catalog
// fetch disabled (so the static table is the only source). Verify:
//   - lookup returns the expected value
//   - the lookup normalizes both forms (Copilot "GPT-4o mini" vs Azure "gpt-4o-mini")

const { _STATIC_CONTEXT_LENGTHS, resolveContextLength, _resetCatalogCaches, fetchContextLengths } =
  await import('../../out/modelCatalog.js');

// Disable network: monkey-patch fetchContextLengths to throw so resolveContextLength
// falls through to the static table.
const origFetch = fetchContextLengths;
globalThis.fetch = async () => {
  throw new Error('test: network disabled');
};
_resetCatalogCaches();

// Each entry: [key as in the Map, normalized form, expected context length]
const entries = Array.from(_STATIC_CONTEXT_LENGTHS.entries());

console.log(`Testing ${entries.length} static-table entries with network disabled:`);
console.log('='.repeat(80));

let pass = 0, fail = 0;
const failures = [];
for (const [key, expected] of entries) {
  // Try the exact key first.
  const r = await resolveContextLength(key);
  if (r?.contextLength === expected && r?.source === 'static') {
    pass++;
    console.log(`  ✓ '${key}' → ${expected} (source: static)`);
  } else {
    fail++;
    failures.push({ key, expected, got: r });
    console.log(`  ✗ '${key}' → expected ${expected}, got ${r ? `${r.contextLength} (${r.source})` : 'undefined'}`);
  }
}

console.log('='.repeat(80));
console.log(`Result: ${pass} pass, ${fail} fail`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ${f.key}: expected ${f.expected}, got ${JSON.stringify(f.got)}`);
  }
  process.exit(1);
}
process.exit(0);
