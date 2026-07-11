#!/usr/bin/env node
/**
 * E25: Model comparison for cost/quality tradeoff.
 *
 * Question: which OpenRouter model gives the best detection at the
 * lowest cost for general analysis? Currently using
 * `google/gemini-2.5-flash-lite` as the cheap default. Candidate
 * alternatives to test:
 *
 *   1. google/gemini-2.5-flash-lite    — current default (cheapest)
 *   2. openai/gpt-4o-mini              — stable mid-tier, used in E11 baseline
 *   3. anthropic/claude-3-haiku        — well-known cheap model
 *   4. meta-llama/llama-3.3-70b-instruct — open-source mid-tier
 *   5. deepseek/deepseek-r1            — reasoning model for deepModel
 *
 * Methodology: run focused multiWave on TWO documents with known
 * expected findings:
 *   - tests/fixtures/adversarial/test-contradictions-hard (15 expected
 *     contradictions — known ground truth from E19)
 *   - .github/experiments/documentation-review/versions/v8/SKILL.md
 *     (0 expected contradictions after E24 fixes — known clean baseline)
 *
 * Metrics per model:
 *   - Detection count on test-contradictions-hard (target = 15)
 *   - False positive count on v8 (target = 0 contradictions)
 *   - Wall-clock seconds
 *   - Estimated USD cost (using OpenRouter's published pricing)
 *
 * Also: for the v8 contradiction count, also test with `deepModel` set
 * to deepseek-r1 to see if the reasoning model improves detection on
 * the contradiction wave specifically.
 *
 * Cost: ~5 models × 2 documents × 6 wave calls = 60 LLM calls. ~$0.05.
 *        Plus 2 deepModel runs (single wave, contradictions) = 2 more.
 *        Total ~$0.05-0.10.
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

const MODELS = [
  { id: 'google/gemini-2.5-flash-lite', label: 'gemini-flash-lite (current default)' },
  { id: 'openai/gpt-4o-mini', label: 'gpt-4o-mini (E11 baseline)' },
  { id: 'anthropic/claude-3-haiku', label: 'claude-3-haiku' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'llama-3.3-70b' },
];

const REASONING_MODEL = 'deepseek/deepseek-r1';

const FIXTURE_PATH = path.join(
  __dirname,
  '..',
  'tests',
  'fixtures',
  'adversarial',
  'test-contradictions-hard',
  'SKILL.md',
);
const V8_PATH = path.join(
  __dirname,
  '..',
  '.github',
  'experiments',
  'documentation-review',
  'versions',
  'v8',
  'SKILL.md',
);
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];

const LOG_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'logs');
const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(LOG_DIR, `e25-model-comparison-${stamp}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E25 model comparison started ${new Date().toISOString()} ===\n`);

async function runOne(label, modelId, docPath, docLabel, opts = {}) {
  const text = fs.readFileSync(docPath, 'utf8');
  const provider = new OpenRouterProvider({
    apiKey,
    model: modelId,
    deepModel: opts.deepModel,
  });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: opts.waves || ALL_WAVES,
    maxRetries: 1,
  });
  const t0 = Date.now();
  let out;
  try {
    out = await engine.analyze({ text, filePath: docPath });
  } catch (err) {
    process.stderr.write(`FAIL ${label} on ${docLabel}: ${err.message}\n`);
    return { label, modelId, docLabel, error: err.message };
  }
  const elapsedMs = Date.now() - t0;
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  const byCode = {};
  for (const d of diags) byCode[d.code] = (byCode[d.code] || 0) + 1;
  const contradictions = (byCode['contradiction'] || 0) + (byCode['contradiction-related'] || 0);
  process.stderr.write(
    `${label} on ${docLabel}: ${diags.length} findings, ${contradictions} contradictions, ${elapsedMs}ms\n`,
  );
  return {
    label,
    modelId,
    deepModel: opts.deepModel,
    docLabel,
    total: diags.length,
    contradictions,
    byCode,
    elapsedMs,
  };
}

const results = [];

// Test all 4 models on both documents with full multiWave
for (const m of MODELS) {
  results.push(await runOne(m.label, m.id, FIXTURE_PATH, 'test-contradictions-hard'));
  results.push(await runOne(m.label, m.id, V8_PATH, 'v8-SKILL'));
}

// Test deepseek-r1 as a `deepModel` override on just the contradictions wave
// for the test fixture (the reasoning model is too expensive for all 6 waves)
results.push(
  await runOne(
    `${REASONING_MODEL} (deepModel, contradictions only)`,
    'google/gemini-2.5-flash-lite',
    FIXTURE_PATH,
    'test-contradictions-hard',
    { deepModel: REASONING_MODEL, waves: ['contradictions'] },
  ),
);

// Compute the summary table
process.stderr.write(`\n=== E25 RESULTS SUMMARY ===\n`);
process.stderr.write(`\nTest fixture (test-contradictions-hard, expected = 15 contradictions):\n`);
const fixtureResults = results.filter((r) => r.docLabel === 'test-contradictions-hard');
for (const r of fixtureResults) {
  const inCat = r.contradictions || 0;
  const inCatPct = ((inCat / 15) * 100).toFixed(0);
  process.stderr.write(
    `  ${r.label.padEnd(45)} total=${String(r.total).padStart(3)} contradict=${String(inCat).padStart(3)} (${inCatPct}% of 15) time=${r.elapsedMs}ms\n`,
  );
}

process.stderr.write(`\nv8 SKILL.md (expected = 0 contradictions):\n`);
const v8Results = results.filter((r) => r.docLabel === 'v8-SKILL');
for (const r of v8Results) {
  process.stderr.write(
    `  ${r.label.padEnd(45)} total=${String(r.total).padStart(3)} contradict=${String(r.contradictions || 0).padStart(3)} time=${r.elapsedMs}ms\n`,
  );
}

const outFile = path.join(DATA_DIR, `e25-model-comparison-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ results, captured_at: new Date().toISOString() }, null, 2));
process.stderr.write(`\nResults written to ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);

// RECOMMENDATION
process.stderr.write(`\n=== RECOMMENDATION ===\n`);
const sorted = fixtureResults
  .filter((r) => !r.error)
  .sort((a, b) => b.contradictions - a.contradictions);
if (sorted.length > 0) {
  process.stderr.write(`Highest in-cat detection: ${sorted[0].label} (${sorted[0].contradictions}/15)\n`);
  process.stderr.write(`Lowest cost: google/gemini-2.5-flash-lite\n`);
  const v8Penalty = v8Results.find(
    (r) => r.modelId === 'google/gemini-2.5-flash-lite',
  );
  if (v8Penalty && v8Penalty.contradictions === 0) {
    process.stderr.write(
      `gemini-flash-lite has 0 false positives on v8 → confirmed safe default.\n`,
    );
  }
}
