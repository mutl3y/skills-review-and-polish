#!/usr/bin/env node
/**
 * List all OpenRouter models cheaper than google/gemini-2.5-flash-lite
 * (the current default) for both `model` (analysis) and `deepModel`
 * (deep/reasoning) candidate selection.
 *
 * Fetches pricing directly from OpenRouter's public API (no auth needed
 * for the models endpoint) and filters to the cheapest models.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const REFERENCE_MODEL = 'google/gemini-2.5-flash-lite';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';

console.log(`Fetching OpenRouter model catalog from ${OPENROUTER_URL}...`);
const resp = await fetch(OPENROUTER_URL);
if (!resp.ok) {
  console.error(`FAIL: ${resp.status} ${resp.statusText}`);
  process.exit(1);
}
const json = await resp.json();
const models = json.data || [];
console.log(`Fetched ${models.length} models.`);

// Build a clean per-model record with normalized pricing.
// OpenRouter pricing is in USD per token. We want per-1M-token prices.
const records = [];
for (const m of models) {
  const id = m.id;
  const name = m.name || id;
  const pricing = m.pricing || {};
  // prompt = input, completion = output. Values are strings like "0.0000001" per token.
  const inPerToken = parseFloat(pricing.prompt);
  const outPerToken = parseFloat(pricing.completion);
  if (isNaN(inPerToken) || isNaN(outPerToken)) continue;
  const inPerM = inPerToken * 1_000_000;
  const outPerM = outPerToken * 1_000_000;
  records.push({
    id,
    name,
    context: m.context_length || null,
    inPerM,
    outPerM,
    // Average price per 1M tokens (50/50 weighted) — the simplest cost comparator.
    avgPerM: (inPerM + outPerM) / 2,
    inputModality: m.architecture?.input_modalities || [],
    outputModality: m.architecture?.output_modalities || [],
    isModerated: !!m.top_provider?.is_moderated,
  });
}

// Find the reference model's pricing.
const ref = records.find((r) => r.id === REFERENCE_MODEL);
if (!ref) {
  console.error(`Reference model ${REFERENCE_MODEL} not in catalog.`);
  process.exit(1);
}
console.log(`\nReference: ${ref.id}`);
console.log(`  Input  : $${ref.inPerM.toFixed(4)}/1M`);
console.log(`  Output : $${ref.outPerM.toFixed(4)}/1M`);
console.log(`  Avg    : $${ref.avgPerM.toFixed(4)}/1M`);

// Filter: text-output models (skip image/audio-only) and not heavily moderated.
const textCapable = records.filter(
  (r) => r.outputModality.includes('text') && !r.isModerated,
);
console.log(`\nText-capable, unmoderated models: ${textCapable.length}`);

// Sort by average price ascending.
const sorted = [...textCapable].sort((a, b) => a.avgPerM - b.avgPerM);

// Split into "cheaper than ref" and "more expensive than ref".
const cheaper = sorted.filter((r) => r.avgPerM < ref.avgPerM);
const rest = sorted.filter((r) => r.avgPerM >= ref.avgPerM);

console.log(`\n=== MODELS CHEAPER THAN ${REFERENCE_MODEL} (by avg $/1M) ===`);
console.log(`Total: ${cheaper.length} models\n`);

// Group by pricing tier for readability.
const tiers = [
  { label: '<$0.10 / 1M (essentially free tier)', filter: (r) => r.avgPerM < 0.10 },
  { label: '$0.10 - $0.25 / 1M (gemini-flash range)', filter: (r) => r.avgPerM >= 0.10 && r.avgPerM < 0.25 },
  { label: '$0.25 - $0.50 / 1M (cheap mid-tier)', filter: (r) => r.avgPerM >= 0.25 && r.avgPerM < 0.50 },
  { label: '$0.50 - ref avg / 1M (mid-tier before ref)', filter: (r) => r.avgPerM >= 0.50 && r.avgPerM < ref.avgPerM },
];
for (const tier of tiers) {
  const inTier = cheaper.filter(tier.filter);
  if (inTier.length === 0) continue;
  console.log(`## ${tier.label} — ${inTier.length} models`);
  // Show top 20 per tier.
  for (const r of inTier.slice(0, 20)) {
    console.log(
      `  $${r.avgPerM.toFixed(4).padStart(8)}/1M  in=$${r.inPerM.toFixed(4).padStart(7)} out=$${r.outPerM.toFixed(4).padStart(7)}  ctx=${String(r.context || '?').padStart(6)}  ${r.id}`,
    );
  }
  if (inTier.length > 20) {
    console.log(`  ... and ${inTier.length - 20} more in this tier`);
  }
  console.log('');
}

// Reason model candidates: a "reasoning model" is one with ":thinking" or
// a known reasoning model family. Filter for those below or near ref price.
const REASONING_FAMILIES = [
  'deepseek', 'qwen', 'qwq', 'o1', 'o3', 'claude-3.7', 'gemini-2.5-pro',
  'claude-sonnet-4', 'grok-2', 'grok-3', 'mistral-large',
];
const reasoning = records.filter(
  (r) =>
    r.outputModality.includes('text') &&
    !r.isModerated &&
    REASONING_FAMILIES.some(
      (f) => r.id.toLowerCase().includes(f) || (r.name || '').toLowerCase().includes(f),
    ),
);
const cheapReasoning = reasoning.filter((r) => r.avgPerM < ref.avgPerM * 2);
console.log(`\n=== REASONING-FAMILY MODELS (potential deepModel candidates) ===`);
console.log(`Total reasoning-family text models: ${reasoning.length}`);
console.log(`Reasoning models within 2x of ref avg ($${ref.avgPerM.toFixed(4)}/1M): ${cheapReasoning.length}\n`);
for (const r of cheapReasoning.sort((a, b) => a.avgPerM - b.avgPerM).slice(0, 20)) {
  console.log(
    `  $${r.avgPerM.toFixed(4).padStart(8)}/1M  in=$${r.inPerM.toFixed(4).padStart(7)} out=$${r.outPerM.toFixed(4).padStart(7)}  ctx=${String(r.context || '?').padStart(6)}  ${r.id}`,
  );
}

// Save the full sorted list to disk for the next experiment.
const outFile = path.join(DATA_DIR, `openrouter-cheaper-than-gemini-flash-lite-${new Date().toISOString().split('T')[0]}.json`);
fs.writeFileSync(
  outFile,
  JSON.stringify(
    {
      reference: ref,
      cheaper_count: cheaper.length,
      reasoning_count: reasoning.length,
      cheap_reasoning_count: cheapReasoning.length,
      cheaper_models: cheaper,
      reasoning_models: reasoning,
      fetched_at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(`\nFull list written to ${outFile}`);
