// scripts/probes/audit-static-orphans.mjs
// Find static-table entries that are NOT in the OpenRouter catalog.
// These are the only ones the static table actually serves.

const fs = await import('node:fs');
const { _STATIC_CONTEXT_LENGTHS, fetchContextLengths } =
  await import('../../out/modelCatalog.js');

const catalog = await fetchContextLengths();
const catalogLower = new Map();
for (const [k, v] of catalog) catalogLower.set(k.toLowerCase(), v);

function catalogHas(key) {
  const lower = key.toLowerCase();
  if (catalogLower.has(lower)) return true;
  // Substring check (covers "gpt-4o" matching "openai/gpt-4o-mini")
  for (const catLower of catalogLower.keys()) {
    if (catLower.includes(lower) || lower.includes(catLower)) return true;
  }
  return false;
}

console.log('Static table entries NOT covered by OpenRouter catalog:');
console.log('='.repeat(70));
let orphanCount = 0;
for (const [key, val] of _STATIC_CONTEXT_LENGTHS) {
  if (!catalogHas(key)) {
    orphanCount++;
    console.log(`  '${key}' = ${val}`);
  }
}
console.log('='.repeat(70));
console.log(`Total static entries: ${_STATIC_CONTEXT_LENGTHS.size}`);
console.log(`Orphans (not in OpenRouter catalog): ${orphanCount}`);
console.log(`Covered by OpenRouter catalog: ${_STATIC_CONTEXT_LENGTHS.size - orphanCount}`);
