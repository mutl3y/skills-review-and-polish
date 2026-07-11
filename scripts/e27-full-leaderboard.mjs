#!/usr/bin/env node
/**
 * E27: Full cost/quality leaderboard for 27 cheap analysis models and
 * 12 deepModel candidates on OpenRouter.
 *
 * Rubric (each model scored on 5 axes, normalized 0-100):
 *   - Price   : inverse avg $/1M, lower price = higher score
 *   - Speed   : inverse wall-clock seconds on the test fixture
 *   - Recall  : in-cat % on test-contradictions-hard (15 expected)
 *   - Precision: inverse contradiction FPs on v8 (0 expected)
 *   - Stability: completion rate (1 - error_count/total_calls)
 *
 * Final score: weighted average. Weights: recall 30%, precision 30%,
 * price 20%, speed 10%, stability 10%.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('../out/core/index.js');
const { OpenRouterProvider } = await import('../out/providers/externalProvider.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'logs');
const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `e27-leaderboard-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E27 leaderboard started ${new Date().toISOString()} ===\n`);

const FIXTURE_PATH = path.join(
  __dirname, '..', 'tests', 'fixtures', 'adversarial', 'test-contradictions-hard', 'SKILL.md',
);
const V8_PATH = path.join(
  __dirname, '..', '.github', 'experiments', 'documentation-review', 'versions', 'v8', 'SKILL.md',
);
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const fixtureText = fs.readFileSync(FIXTURE_PATH, 'utf8');
const v8Text = fs.readFileSync(V8_PATH, 'utf8');

// ---- candidate lists ----

// 27 analysis models (paid, cheaper than gemini-flash-lite on avg, text-capable)
const ANALYSIS_MODELS = [
  'microsoft/phi-4',
  'openai/gpt-oss-120b',
  'meta-llama/llama-3.2-1b-instruct',
  'deepseek/deepseek-v4-flash',
  'google/gemma-3-27b-it',
  'qwen/qwen3-30b-a3b-instruct-2507',
  'nvidia/nemotron-3-nano-30b-a3b',
  'qwen/qwen3.5-9b',
  'tencent/hy3-preview',
  'mistralai/mistral-small-3.2-24b-instruct',
  'mistralai/ministral-8b-2512',
  'bytedance/ui-tars-1.5-7b',
  'rekaai/reka-flash-3',
  'qwen/qwen3.5-flash-02-23',
  'qwen/qwen3-14b',
  'qwen/qwen3-coder-30b-a3b-instruct',
  'meta-llama/llama-guard-4-12b',
  'qwen/qwen3-32b',
  'bytedance-seed/seed-1.6-flash',
  'openai/gpt-oss-safeguard-20b',
  'mistralai/mistral-small-3.1-24b-instruct',
  'mistralai/magistral-small-2506',
  'mistralai/ministral-3b-2512',
  'qwen/qwen3-vl-8b-instruct',
  'xai/grok-2-mini',
  'meta-llama/llama-3.3-8b-instruct',
  'meta-llama/llama-4-scout',
];

// 12 deepModel candidates (reasoning families, <$0.25/1M avg)
const DEEP_MODELS = [
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'qwen/qwen3-coder:free',
  'qwen/qwen3-235b-a22b-2507',
  'deepseek/deepseek-v4-flash',
  'qwen/qwen3-30b-a3b-instruct-2507',
  'qwen/qwen3.5-9b',
  'qwen/qwen3.5-flash-02-23',
  'qwen/qwen3-14b',
  'qwen/qwen3-coder-30b-a3b-instruct',
  'qwen/qwen3-32b',
  'sao10k/l3-lunaris-8b',
  'qwen/qwen-2.5-7b-instruct',
];

// ---- helpers ----

// Per-call timeout to prevent slow models blocking the batch
const PER_CALL_TIMEOUT_MS = 90_000; // 90s per model

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

async function runAnalysis(modelId, docText, docPath, opts = {}) {
  const provider = new OpenRouterProvider({ apiKey, model: modelId, deepModel: opts.deepModel });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: opts.waves || ALL_WAVES,
    maxRetries: 0, // 0 retries (was 1) — faster failure on bad models
  });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(
      engine.analyze({ text: docText, filePath: docPath }),
      PER_CALL_TIMEOUT_MS,
      modelId,
    );
  } catch (err) {
    return { modelId, error: err.message, elapsedMs: Date.now() - t0 };
  }
  const elapsedMs = Date.now() - t0;
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  const byCode = {};
  for (const d of diags) byCode[d.code] = (byCode[d.code] || 0) + 1;
  return {
    modelId,
    total: diags.length,
    contradictions: (byCode['contradiction'] || 0) + (byCode['contradiction-related'] || 0),
    ambiguities: byCode['ambiguity-llm'] || 0,
    byCode,
    elapsedMs,
  };
}

// ---- analysis phase: 27 models × 2 docs in parallel batches ----

const BATCH_SIZE = 15; // 15 concurrent OpenRouter calls (was 6, slow models were bottleneck)
const results = [];
let done = 0;
const totalRuns = ANALYSIS_MODELS.length * 2 + DEEP_MODELS.length; // 54 + 12 = 66

async function runBatch(jobs) {
  const out = await Promise.all(jobs.map((j) => j()));
  for (const r of out) results.push(r);
  done += jobs.length;
  process.stderr.write(`[${done}/${totalRuns}] completed (last: ${jobs.map((_, i) => out[i]?.modelId || 'err').join(', ')})\n`);
}

process.stderr.write(`\n=== ANALYSIS PHASE: ${ANALYSIS_MODELS.length} models × 2 docs (${ANALYSIS_MODELS.length * 2} runs) ===\n`);

const analysisJobs = [];
for (const modelId of ANALYSIS_MODELS) {
  analysisJobs.push(
    () => runAnalysis(modelId, fixtureText, FIXTURE_PATH).then((r) => ({ ...r, phase: 'analysis', doc: 'test-contradictions-hard' })),
  );
  analysisJobs.push(
    () => runAnalysis(modelId, v8Text, V8_PATH).then((r) => ({ ...r, phase: 'analysis', doc: 'v8-SKILL' })),
  );
}
// Shuffle to avoid running all calls to one vendor in sequence (rate limit fairness)
for (let i = analysisJobs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [analysisJobs[i], analysisJobs[j]] = [analysisJobs[j], analysisJobs[i]];
}
for (let i = 0; i < analysisJobs.length; i += BATCH_SIZE) {
  await runBatch(analysisJobs.slice(i, i + BATCH_SIZE));
}

process.stderr.write(`\n=== DEEP MODEL PHASE: ${DEEP_MODELS.length} models on contradiction wave only ===\n`);

const deepJobs = [];
for (const modelId of DEEP_MODELS) {
  deepJobs.push(
    () => runAnalysis('google/gemini-2.5-flash-lite', fixtureText, FIXTURE_PATH, {
      deepModel: modelId,
      waves: ['contradictions'],
    }).then((r) => ({ ...r, phase: 'deepModel', deepModel: modelId, doc: 'test-contradictions-hard' })),
  );
}
for (let i = 0; i < deepJobs.length; i += BATCH_SIZE) {
  await runBatch(deepJobs.slice(i, i + BATCH_SIZE));
}

// ---- scoring ----

// Load pricing data we cached
const pricingData = JSON.parse(fs.readFileSync(
  path.join(DATA_DIR, 'openrouter-cheaper-than-gemini-flash-lite-2026-07-11.json'),
  'utf8',
));
const pricingById = new Map();
for (const r of pricingData.cheaper_models) pricingById.set(r.id, r);
for (const r of pricingData.reasoning_models) pricingById.set(r.id, r);

// Reference: gemini-flash-lite baseline
const REF = pricingById.get('google/gemini-2.5-flash-lite') || {
  id: 'google/gemini-2.5-flash-lite', inPerM: 0.10, outPerM: 0.40, avgPerM: 0.25,
};

const EXPECTED_CONTRADICTIONS_TEST = 15;
const EXPECTED_CONTRADICTIONS_V8 = 0;

// Normalization helpers
const minMax = (arr) => {
  if (arr.length === 0) return [0, 1];
  return [Math.min(...arr), Math.max(...arr)];
};

function scoreAnalysisResult(r, allAnalysisResults) {
  if (r.error) {
    return { ...r, score: 0, error: r.error };
  }
  const pricing = pricingById.get(r.modelId) || REF;
  const priceScore = pricing.avgPerM > 0 ? Math.max(0, 100 - pricing.avgPerM * 200) : 100;
  const recallPct = r.doc === 'test-contradictions-hard'
    ? Math.min(100, (r.contradictions / EXPECTED_CONTRADICTIONS_TEST) * 100)
    : null;
  const precisionScore = r.doc === 'v8-SKILL'
    ? Math.max(0, 100 - r.contradictions * 20) // -20 per FP contradiction
    : null;
  const speedScore = Math.max(0, 100 - r.elapsedMs / 200); // 20s = 0 score
  // Stability proxy: non-error result
  const stabilityScore = 100;
  let composite = 0;
  if (recallPct !== null && precisionScore !== null) {
    // Has both: weighted average
    composite = recallPct * 0.30 + precisionScore * 0.30 + priceScore * 0.20 + speedScore * 0.10 + stabilityScore * 0.10;
  } else if (recallPct !== null) {
    // Test fixture only
    composite = recallPct * 0.50 + priceScore * 0.30 + speedScore * 0.10 + stabilityScore * 0.10;
  } else {
    composite = precisionScore * 0.50 + priceScore * 0.30 + speedScore * 0.10 + stabilityScore * 0.10;
  }
  return {
    ...r,
    pricing: { inPerM: pricing.inPerM, outPerM: pricing.outPerM, avgPerM: pricing.avgPerM },
    priceScore: Math.round(priceScore * 10) / 10,
    speedScore: Math.round(speedScore * 10) / 10,
    recallPct: recallPct !== null ? Math.round(recallPct * 10) / 10 : null,
    precisionScore: precisionScore !== null ? Math.round(precisionScore * 10) / 10 : null,
    stabilityScore,
    composite: Math.round(composite * 10) / 10,
  };
}

// Aggregate by modelId (combine test + v8 results)
const byModel = new Map();
for (const r of results) {
  if (r.phase !== 'analysis') continue;
  const key = r.modelId;
  if (!byModel.has(key)) byModel.set(key, { modelId: key, test: null, v8: null });
  const slot = r.doc === 'test-contradictions-hard' ? 'test' : 'v8';
  byModel.get(key)[slot] = scoreAnalysisResult(r, results);
}

const leaderboard = Array.from(byModel.values())
  .map((entry) => {
    const t = entry.test;
    const v = entry.v8;
    const composite = t && v ? (t.composite + v.composite) / 2
      : t ? t.composite
      : v ? v.composite
      : 0;
    return {
      modelId: entry.modelId,
      test: t,
      v8: v,
      composite: Math.round(composite * 10) / 10,
    };
  })
  .sort((a, b) => b.composite - a.composite);

process.stderr.write(`\n=== E27 LEADERBOARD (analysis models, 27 entries) ===\n`);
process.stderr.write(`Composite: 30% recall + 30% precision + 20% price + 10% speed + 10% stability\n\n`);
process.stderr.write(`${'Model'.padEnd(45)} | ${'Comp'.padStart(5)} | ${'$/1M'.padStart(7)} | ${'Recall%'.padStart(7)} | ${'FPs(v8)'.padStart(7)} | ${'Time(s)'.padStart(7)}\n`);
process.stderr.write('-'.repeat(95) + '\n');
for (const m of leaderboard) {
  const t = m.test;
  const v = m.v8;
  const recall = t ? `${t.recallPct}` : 'ERR';
  const fps = v ? `${v.contradictions || 0}` : 'ERR';
  const time = t ? (t.elapsedMs / 1000).toFixed(1) : 'ERR';
  const price = t && t.pricing ? `$${t.pricing.avgPerM.toFixed(3)}` : '?';
  process.stderr.write(`${m.modelId.padEnd(45)} | ${String(m.composite).padStart(5)} | ${price.padStart(7)} | ${recall.padStart(7)} | ${fps.padStart(7)} | ${time.padStart(7)}\n`);
}

// Deep model scoring (single-fixture single-wave)
const deepResults = results.filter((r) => r.phase === 'deepModel');
const deepScored = deepResults.map((r) => {
  if (r.error) return { ...r, composite: 0 };
  const pricing = pricingById.get(r.deepModel) || { avgPerM: 0, inPerM: 0, outPerM: 0 };
  const recallPct = Math.min(100, (r.contradictions / EXPECTED_CONTRADICTIONS_TEST) * 100);
  const priceScore = pricing.avgPerM > 0 ? Math.max(0, 100 - pricing.avgPerM * 200) : 100;
  const speedScore = Math.max(0, 100 - r.elapsedMs / 1000 * 2); // 50s = 0 score
  const composite = recallPct * 0.40 + priceScore * 0.30 + speedScore * 0.20 + 100 * 0.10;
  return {
    ...r,
    pricing,
    recallPct: Math.round(recallPct * 10) / 10,
    priceScore: Math.round(priceScore * 10) / 10,
    speedScore: Math.round(speedScore * 10) / 10,
    composite: Math.round(composite * 10) / 10,
  };
}).sort((a, b) => b.composite - a.composite);

process.stderr.write(`\n=== E27 DEEP MODEL LEADERBOARD (12 entries, contradictions wave only) ===\n`);
process.stderr.write(`Composite: 40% recall + 30% price + 20% speed + 10% stability\n\n`);
process.stderr.write(`${'Model'.padEnd(45)} | ${'Comp'.padStart(5)} | ${'$/1M'.padStart(7)} | ${'Recall%'.padStart(7)} | ${'Time(s)'.padStart(7)}\n`);
process.stderr.write('-'.repeat(85) + '\n');
for (const m of deepScored) {
  if (m.error) {
    process.stderr.write(`${(m.deepModel || '').padEnd(45)} | ${'ERR'.padStart(5)} | ${'-'.padStart(7)} | ${'-'.padStart(7)} | ${'-'.padStart(7)}\n`);
    continue;
  }
  const recall = `${m.recallPct}`;
  const time = (m.elapsedMs / 1000).toFixed(1);
  const price = `$${m.pricing.avgPerM.toFixed(3)}`;
  process.stderr.write(`${m.deepModel.padEnd(45)} | ${String(m.composite).padStart(5)} | ${price.padStart(7)} | ${recall.padStart(7)} | ${time.padStart(7)}\n`);
}

// Persist
const outFile = path.join(DATA_DIR, `e27-leaderboard-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  analysis_leaderboard: leaderboard,
  deep_leaderboard: deepScored,
  raw_results: results,
  captured_at: new Date().toISOString(),
  rubric: {
    weights: { recall: 0.30, precision: 0.30, price: 0.20, speed: 0.10, stability: 0.10 },
    price_score: 'max(0, 100 - avg_per_m * 200)',
    speed_score_analysis: 'max(0, 100 - elapsedMs / 200)',
    speed_score_deep: 'max(0, 100 - elapsedMs / 50000 * 100)',
    precision_score: 'max(0, 100 - FP_count * 20)',
    stability_score: '100 if no error, else 0',
  },
}, null, 2));
process.stderr.write(`\nFull results written to ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
