#!/usr/bin/env node
// scripts/probes/retry-candidates.mjs
/**
 * Cross-reference past experiment models with live OpenRouter catalog
 * to identify cheap candidates worth retrying now that schema mode is default.
 */
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

const live = await fetch('https://openrouter.ai/api/v1/models', {
  headers: { Authorization: `Bearer ${apiKey}` },
}).then(r => r.json());

const liveMap = new Map();
for (const m of live.data || []) {
  // OpenRouter returns per-token pricing; convert to per-million.
  const p = parseFloat(m.pricing?.prompt || 0) * 1_000_000;
  const oc = parseFloat(m.pricing?.completion || 0) * 1_000_000;
  const ctx = m.context_length;
  const sup = m.supported_parameters || [];
  liveMap.set(m.id, { p, oc, ctx, structured: sup.includes('structured_outputs') });
}

const candidates = [
  // E27 paid top 10 (composite score)
  { id: 'openai/gpt-oss-safeguard-20b',         note: 'E27 #1 — composite 82.7, 93% recall, 0 FPs' },
  { id: 'mistralai/ministral-3b-2512',         note: 'E27 #2 — composite 82.2, 73% recall, 0 FPs' },
  { id: 'bytedance-seed/seed-1.6-flash',       note: 'E27 #3 — composite 80.8, 100% recall, 0 FPs' },
  { id: 'qwen/qwen3-coder-30b-a3b-instruct',   note: 'E27 #4 — composite 79.8, 100% recall, 0 FPs' },
  { id: 'qwen/qwen3-vl-8b-instruct',           note: 'E27 #5 — composite 79.6, 100% recall, 0 FPs' },
  { id: 'openai/gpt-oss-120b',                  note: 'E27 #6 — composite 73.5, 60% recall, 0 FPs' },
  { id: 'qwen/qwen3-30b-a3b-instruct-2507',     note: 'E27 #7 — composite 69.4, 67% recall, 1 FP' },
  { id: 'qwen/qwen3-32b',                       note: 'E27 #8 — composite 66.7, 47% recall, 0 FPs' },
  { id: 'meta-llama/llama-4-scout',             note: 'E27 #10 — composite 60.0, 100% recall, 4 FPs' },
  // E27 deep-model leaderboard
  { id: 'qwen/qwen3-235b-a22b-2507',            note: 'E27 deep #2 — 100% recall @ $0.095/1M, 57s' },
  { id: 'sao10k/l3-lunaris-8b',                 note: 'E27 deep #5 — 40% recall @ $0.045/1M, 9s' },
  // E28 free
  { id: 'poolside/laguna-xs-2.1:free',          note: 'E28 — 100% recall, 0 FPs, free' },
  // current
  { id: 'google/gemini-2.5-flash-lite',         note: 'CURRENT default — E25 107% recall, 5 FPs' },
  // Ruled out for shape, worth retrying with schema mode
  { id: 'meta-llama/llama-3.1-8b-instruct',     note: 'E27 shape-rejected — schema may unlock it' },
  { id: 'meta-llama/llama-3.3-8b-instruct',     note: 'E27 6× llm-error — schema retry' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct', note: 'E27 4× llm-parse-error — schema retry' },
  { id: 'mistralai/magistral-small-2506',      note: 'E27 6× llm-error — schema retry' },
  { id: 'xai/grok-2-mini',                      note: 'E27 6× llm-error — schema retry' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b',      note: 'E27 3/6 errors — schema retry' },
];

console.log('Model                                              in/out $/M    ctx   structured   ≤$0.50');
console.log('-'.repeat(105));
for (const { id, note } of candidates) {
  const m = liveMap.get(id);
  if (!m) { console.log(id.padEnd(50) + '  (not in current catalog)'); continue; }
  const flag = m.structured ? 'YES' : 'no';
  const within = m.p <= 0.50 ? '✓' : ' ';
  console.log(
    id.padEnd(50) +
    ' $' + m.p.toFixed(3) + '/$' + m.oc.toFixed(3) +
    '  ' + (m.ctx/1000).toFixed(0) + 'k   ' +
    flag.padEnd(10) +
    within
  );
  console.log('  ↳ ' + note);
}