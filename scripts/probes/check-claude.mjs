// scripts/probes/check-claude.mjs
const fs = await import('node:fs');
const cacheFile = 'logs/skills-review-and-polish-openrouter-context-cache-v1.json';
try { fs.unlinkSync(cacheFile); } catch {}
const { fetchContextLengths } = await import('../../out/modelCatalog.js');
const catalog = await fetchContextLengths();
const matches = [];
for (const [k, v] of catalog) {
  if (k.toLowerCase().includes('claude')) matches.push([k, v]);
}
console.log('All Claude entries in OpenRouter catalog:');
for (const [k, v] of matches.sort()) {
  console.log(`  ${k.padEnd(60)} ${v}`);
}
