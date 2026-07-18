// scripts/probes/audit-static-vs-catalog.mjs
// Cross-reference static table values against the live OpenRouter catalog.
// Report any drift (model exists in both with different values).

const fs = await import('node:fs');
const { _STATIC_CONTEXT_LENGTHS, fetchContextLengths } =
  await import('../../out/modelCatalog.js');

// Force fresh fetch
const cacheFile = 'logs/skills-review-and-polish-openrouter-context-cache-v1.json';
try { fs.unlinkSync(cacheFile); } catch {}

const catalog = await fetchContextLengths();
console.log(`Catalog has ${catalog.size} entries`);

// Normalize helper, mirrors modelCatalog.ts
function normalize(id) {
  return id
    .toLowerCase()
    .replace(/^(openai|anthropic|google|microsoft|meta|mistral|poolside|nvidia|deepseek|qwen|cohere|amazon|tencent|bytedance|upstage|arcee|inception|minimax|moonshot|ibm|liquid|inclusion|rekaai|stepfun|ai21|xai|aion|zai|sakana|thedrummer|kwaipilot)[/:]/, '')
    .replace(/[-_./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

console.log('Cross-reference: static table vs OpenRouter catalog');
console.log('='.repeat(80));

let matches = 0, drifts = 0, notInCatalog = 0;
const driftList = [];

for (const [key, staticVal] of _STATIC_CONTEXT_LENGTHS.entries()) {
  // Try exact match, then normalized
  let catalogVal = catalog.get(key);
  if (catalogVal === undefined) {
    const norm = normalize(key);
    catalogVal = catalog.get(norm);
  }
  if (catalogVal === undefined) {
    // Try substrings both directions
    for (const [catKey, catVal] of catalog) {
      const catLower = catKey.toLowerCase();
      if (catLower.includes(key.toLowerCase()) || key.toLowerCase().includes(catLower)) {
        catalogVal = catVal;
        break;
      }
    }
  }

  if (catalogVal === undefined) {
    notInCatalog++;
    console.log(`  ? '${key}' = ${staticVal} — not in OpenRouter catalog (likely vscode.lm-only)`);
  } else if (catalogVal === staticVal) {
    matches++;
    console.log(`  ✓ '${key}' = ${staticVal} (matches catalog)`);
  } else {
    drifts++;
    driftList.push({ key, static: staticVal, catalog: catalogVal });
    console.log(`  ✗ '${key}' = static ${staticVal}, catalog ${catalogVal}  ← DRIFT`);
  }
}

console.log('='.repeat(80));
console.log(`Result: ${matches} match, ${drifts} drift, ${notInCatalog} not in catalog`);

if (driftList.length > 0) {
  console.log('\nDrift details:');
  for (const d of driftList) {
    console.log(`  ${d.key}: static says ${d.static}, catalog says ${d.catalog} (delta ${d.catalog - d.static})`);
  }
}
