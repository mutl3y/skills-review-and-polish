#!/usr/bin/env node
// scripts/probes/list-models.mjs
/**
 * List candidate models + their pricing + structured_outputs support.
 * Filters to "structured_outputs: true" + reasonable input cost.
 */
import fs from 'node:fs';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

const resp = await fetch('https://openrouter.ai/api/v1/models', {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const data = await resp.json();
const models = data.data ?? [];

// Filter to models that advertise structured_outputs AND have pricing.
const candidates = models
  .filter(m => m.supported_parameters?.includes('structured_outputs'))
  .filter(m => m.pricing?.prompt && parseFloat(m.pricing.prompt) > 0)
  .map(m => ({
    id: m.id,
    name: m.name,
    prompt_per_1m: parseFloat(m.pricing.prompt) * 1_000_000,
    completion_per_1m: parseFloat(m.pricing.completion) * 1_000_000,
    context: m.context_length,
    description: m.description?.slice(0, 80) ?? '',
  }))
  .sort((a, b) => a.prompt_per_1m - b.prompt_per_1m);

// Also pull a few specific ones we know about.
const known = [
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'google/gemini-2.0-flash-001',
  'google/gemini-2.0-flash-exp',
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'meta-llama/llama-3.3-70b-instruct',
  'meta-llama/llama-3.1-8b-instruct',
  'qwen/qwen-2.5-72b-instruct',
  'mistralai/mistral-small-3.1-24b-instruct',
  'deepseek/deepseek-chat-v3',
];

console.log('Known candidates of interest:\n');
console.log('Model ID'.padEnd(48) + 'Prompt/1M'.padStart(12) + 'Complet/1M'.padStart(13) + '  Ctx'.padStart(8));
console.log('-'.repeat(85));
for (const id of known) {
  const m = candidates.find(c => c.id === id);
  if (m) {
    console.log(
      m.id.padEnd(48) +
      `$${m.prompt_per_1m.toFixed(3)}`.padStart(12) +
      `$${m.completion_per_1m.toFixed(3)}`.padStart(13) +
      `${(m.context/1000).toFixed(0)}k`.padStart(8),
    );
  } else {
    console.log(id.padEnd(48) + '  (not in candidates list)');
  }
}

console.log('\n\nCheapest 20 structured-output models:\n');
console.log('Model ID'.padEnd(48) + 'Prompt/1M'.padStart(12) + 'Complet/1M'.padStart(13) + '  Ctx'.padStart(8));
console.log('-'.repeat(85));
for (const m of candidates.slice(0, 20)) {
  console.log(
    m.id.padEnd(48) +
    `$${m.prompt_per_1m.toFixed(3)}`.padStart(12) +
    `$${m.completion_per_1m.toFixed(3)}`.padStart(13) +
    `${(m.context/1000).toFixed(0)}k`.padStart(8),
  );
}