// scripts/probes/pick-top-50.mjs
// Pick the ~50 most-likely-to-be-picked OpenRouter models.
// Heuristic: prefer models from major providers with established track records.

const { fetchContextLengths } = await import('../../out/modelCatalog.js');
const catalog = await fetchContextLengths();

const entries = Array.from(catalog.entries());
console.log(`Total catalog: ${entries.length} entries`);

// Major providers whose models we want in the top-50.
const KEEP_PROVIDERS = [
  'openai/', 'anthropic/', 'google/', 'meta-llama/', 'mistralai/', 'deepseek/',
  'qwen/', 'x-ai/', 'cohere/', 'ai21/', 'nvidia/', '01-ai/', 'inflection/',
  'reka/', 'perplexity/', 'nousresearch/', 'openchat/', 'teknium/',
  'undi95/', 'mancer/', 'lmsys/', 'phind/', 'pygmalion', 'gryphe',
];

// Cheap & recommended (from earlier benchmark notes)
const FEATURED = new Set([
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'openai/gpt-5',
  'openai/gpt-5-mini',
  'openai/gpt-5-nano',
  'openai/o1',
  'openai/o1-mini',
  'openai/o3-mini',
  'openai/o4-mini',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4',
  'anthropic/claude-opus-4.1',
  'anthropic/claude-opus-4.5',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-haiku-4.5',
  'meta-llama/llama-3.1-8b-instruct',
  'meta-llama/llama-3.3-70b-instruct',
  'meta-llama/llama-4-scout',
  'meta-llama/llama-4-maverick',
  'mistralai/mistral-large-2407',
  'mistralai/mistral-small-2503',
  'mistralai/ministral-3b-2512',
  'mistralai/mistral-nemo',
  'deepseek/deepseek-chat-v3',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'qwen/qwen-2.5-72b-instruct',
  'qwen/qwen-2.5-coder-32b-instruct',
  'qwen/qwen3-coder-30b-a3b-instruct',
  'qwen/qwen3-235b-a22b',
  'x-ai/grok-2',
  'x-ai/grok-3',
  'x-ai/grok-3-mini',
  'cohere/command-r-plus',
  'cohere/command-r',
  'meta-llama/llama-3.2-90b-vision-instruct',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'google/gemma-3-27b-it',
  'mistralai/codestral-2501',
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'nvidia/nemotron-3-nano-30b-a3b',
  'bytedance-seed/seed-1.6-flash',
]);

// Always include the featured set if present
const picked = new Map();
for (const id of FEATURED) {
  if (catalog.has(id)) {
    picked.set(id, catalog.get(id));
  } else {
    // Try fuzzy match
    for (const [k, v] of catalog) {
      if (k.toLowerCase().includes(id.toLowerCase().split('/').pop().slice(0, 20))) {
        picked.set(k, v);
        break;
      }
    }
  }
}

// Add models from major providers
for (const [k, v] of catalog) {
  if (picked.size >= 50) break;
  if (KEEP_PROVIDERS.some(p => k.startsWith(p))) {
    // Prefer canonical names (not "free", "nitro", or version-suffixed variants)
    const lower = k.toLowerCase();
    if (lower.includes(':free') || lower.includes('nitro')) continue;
    if (!picked.has(k)) picked.set(k, v);
  }
}

console.log(`\nPicked ${picked.size} models for the bundled fixture:\n`);
const sorted = Array.from(picked.entries()).sort(([a], [b]) => a.localeCompare(b));
for (const [k, v] of sorted) {
  console.log(`  ${k.padEnd(50)} ${v.toLocaleString()}`);
}

import fs from 'node:fs';
const out = {
  fetchedAt: new Date().toISOString(),
  count: picked.size,
  entries: sorted,
};
fs.writeFileSync('../../tests/fixtures/openrouter-catalog-top50.json', JSON.stringify(out, null, 2));
console.log(`\nWrote ${picked.size} entries to tests/fixtures/openrouter-catalog-top50.json`);
console.log(`File size: ${fs.statSync('../../tests/fixtures/openrouter-catalog-top50.json').size} bytes`);
