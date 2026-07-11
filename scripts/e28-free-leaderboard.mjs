#!/usr/bin/env node
/**
 * E28: Free-tier OpenRouter model leaderboard.
 *
 * Tests all 22 free text-capable models from the OpenRouter catalog
 * (price = $0/1M) on the same rubric as E27.
 *
 * Free models typically have strict rate limits and may be unstable
 * under load, so the test uses the same per-call timeout (90s) and
 * captures HTTP 429 (rate-limited) responses as errors in the rubric.
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

const LOG_FILE = path.join(LOG_DIR, `e28-free-leaderboard-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E28 free leaderboard started ${new Date().toISOString()} ===\n`);

const FIXTURE_PATH = path.join(
  __dirname, '..', 'tests', 'fixtures', 'adversarial', 'test-contradictions-hard', 'SKILL.md',
);
const V8_PATH = path.join(
  __dirname, '..', '.github', 'experiments', 'documentation-review', 'versions', 'v8', 'SKILL.md',
);
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const fixtureText = fs.readFileSync(FIXTURE_PATH, 'utf8');
const v8Text = fs.readFileSync(V8_PATH, 'utf8');

// 22 free text-capable models
const FREE_MODELS = [
  'tencent/hy3:free',
  'poolside/laguna-xs-2.1:free',
  'nvidia/nemotron-3.5-content-safety:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'poolside/laguna-m.1:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'liquid/lfm-2.5-1.2b-thinking:free',
  'liquid/lfm-2.5-1.2b-instruct:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'openai/gpt-oss-20b:free',
  'qwen/qwen3-coder:free',
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
];

const PER_CALL_TIMEOUT_MS = 90_000;
const BATCH_SIZE = 10;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

async function runAnalysis(modelId, docText, docPath) {
  const provider = new OpenRouterProvider({ apiKey, model: modelId });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
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

const results = [];
let done = 0;
const totalRuns = FREE_MODELS.length * 2;

async function runBatch(jobs) {
  const out = await Promise.all(jobs.map((j) => j()));
  for (const r of out) results.push(r);
  done += jobs.length;
  process.stderr.write(`[${done}/${totalRuns}] completed\n`);
}

process.stderr.write(`\n=== E28: ${FREE_MODELS.length} free models × 2 docs (${totalRuns} runs) ===\n`);

const jobs = [];
for (const modelId of FREE_MODELS) {
  jobs.push(
    () => runAnalysis(modelId, fixtureText, FIXTURE_PATH).then((r) => ({ ...r, phase: 'free-analysis', doc: 'test-contradictions-hard' })),
  );
  jobs.push(
    () => runAnalysis(modelId, v8Text, V8_PATH).then((r) => ({ ...r, phase: 'free-analysis', doc: 'v8-SKILL' })),
  );
}
for (let i = jobs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
}
for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
  await runBatch(jobs.slice(i, i + BATCH_SIZE));
}

// Scoring
const EXPECTED_CONTRADICTIONS_TEST = 15;
const EXPECTED_CONTRADICTIONS_V8 = 0;

const byModel = new Map();
for (const r of results) {
  if (r.phase !== 'free-analysis') continue;
  if (!byModel.has(r.modelId)) byModel.set(r.modelId, { modelId: r.modelId, test: null, v8: null });
  const slot = r.doc === 'test-contradictions-hard' ? 'test' : 'v8';
  const recallPct = r.error ? null : Math.min(100, ((r.contradictions || 0) / EXPECTED_CONTRADICTIONS_TEST) * 100);
  const precisionScore = r.error ? null : Math.max(0, 100 - (r.contradictions || 0) * 20);
  const speedScore = r.error ? 0 : Math.max(0, 100 - r.elapsedMs / 200);
  const stabilityScore = r.error ? 0 : 100;
  let composite = 0;
  if (recallPct !== null && precisionScore !== null) {
    composite = recallPct * 0.30 + precisionScore * 0.30 + 100 * 0.20 + speedScore * 0.10 + stabilityScore * 0.10;
  } else if (recallPct !== null) {
    composite = recallPct * 0.50 + 100 * 0.30 + speedScore * 0.10 + stabilityScore * 0.10;
  } else if (precisionScore !== null) {
    composite = precisionScore * 0.50 + 100 * 0.30 + speedScore * 0.10 + stabilityScore * 0.10;
  }
  byModel.get(r.modelId)[slot] = {
    ...r,
    recallPct: recallPct !== null ? Math.round(recallPct * 10) / 10 : null,
    precisionScore: precisionScore !== null ? Math.round(precisionScore * 10) / 10 : null,
    speedScore: Math.round(speedScore * 10) / 10,
    stabilityScore,
    composite: Math.round(composite * 10) / 10,
  };
}

const leaderboard = Array.from(byModel.values()).map((entry) => {
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
}).sort((a, b) => b.composite - a.composite);

process.stderr.write(`\n=== E28 LEADERBOARD (20 free models) ===\n`);
process.stderr.write(`Composite: 30% recall + 30% precision + 20% price (free=100) + 10% speed + 10% stability\n\n`);
process.stderr.write(`${'Model'.padEnd(55)} | ${'Comp'.padStart(5)} | ${'Recall%'.padStart(7)} | ${'FPs(v8)'.padStart(7)} | ${'Time(s)'.padStart(7)}\n`);
process.stderr.write('-'.repeat(100) + '\n');
for (const m of leaderboard) {
  const t = m.test || {};
  const v = m.v8 || {};
  const recall = t.recallPct !== null && t.recallPct !== undefined ? t.recallPct.toFixed(0) : '?';
  const fps = v.contradictions !== undefined ? v.contradictions : '?';
  const time = t.elapsedMs !== undefined ? (t.elapsedMs / 1000).toFixed(1) : '?';
  const composite = m.composite !== null ? m.composite.toFixed(1) : 'ERR';
  const err = (!m.test || !m.v8 || m.test?.error || m.v8?.error) ? '*' : ' ';
  process.stderr.write(`${err}${m.modelId.padEnd(54)} | ${composite.padStart(5)} | ${recall.padStart(7)} | ${String(fps).padStart(7)} | ${String(time).padStart(7)}\n`);
}

const outFile = path.join(DATA_DIR, `e28-free-leaderboard-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  leaderboard,
  raw_results: results,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results written to ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
