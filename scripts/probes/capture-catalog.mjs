// scripts/probes/capture-catalog.mjs
// One-time capture: write the live OpenRouter catalog to a fixture file
// so audits can run offline. Re-run when the catalog changes materially.

import fs from 'node:fs';
const { fetchContextLengths } = await import('../../out/modelCatalog.js');

const catalog = await fetchContextLengths();
const out = {
  fetchedAt: new Date().toISOString(),
  count: catalog.size,
  entries: Array.from(catalog.entries()).sort(([a], [b]) => a.localeCompare(b)),
};
const path = '../../tests/fixtures/openrouter-catalog.json';
fs.mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`Wrote ${out.count} entries to ${path}`);
