#!/usr/bin/env node
/**
 * E52: Compare model recall on the E50 under-detecting fixtures.
 *
 * The E50 baseline (qwen/qwen3-coder-30b) found:
 * - test-circular-hard / circular: 0/7
 * - test-contradictions-direct / contradiction: 4/15
 * - test-cognitive-structural / cognitive: 2/5
 * - test-dead-hard: 4/12
 * - test-coverage-gaps-hard / coverage-gap: 5/10
 *
 * This script runs the same fixtures with meta-llama/llama-4-scout
 * (higher recall per E25 model comparison) to see if a different
 * model closes the gaps.
 *
 * Cost: ~$0.10 (4 fixtures × 2 models × 3 runs × 6 waves)
 * Runtime: ~10 min
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

const LOG_FILE = path.join(LOG_DIR, `e52-model-comparison-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E52 model comparison started ${new Date().toISOString()} ===\n`);

// Focus on the under-detecting fixtures from E50 baseline
const FOCUS_FIXTURES = [
  'test-circular-hard',
  'test-contradictions-direct',
  'test-cognitive-structural',
  'test-dead-hard',
  'test-coverage-gaps-hard',
];

const MODELS = [
  'qwen/qwen3-coder-30b-a3b-instruct',  // baseline (E29 winner)
  'meta-llama/llama-4-scout',  // highest recall per E25
];

const CLEAN_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'clean');
const EXPECTED_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'expected');

const CATEGORY_MAP = {
  'cognitive': ['cognitive-nested-conditions', 'cognitive-deep-decision-tree', 'cognitive-priority-conflict', 'cognitive-delegated-decision', 'cognitive-constraint-overload'],
  'hygiene': ['hygiene-over-specification', 'hygiene-non-actionable-preamble', 'hygiene-redundant-instruction', 'hygiene-vague-cognitive-directive', 'hygiene-unordered-process', 'hygiene-unordered-sequential-process', 'hygiene-ordered-process', 'hygiene-ordered-sequential-process', 'hygiene-missing-agent', 'hygiene-circular-definition', 'hygiene-vague-directive'],
  'contradiction': ['contradiction', 'contradiction-related'],
  'circular': ['hygiene-circular-definition'],
  'dead': ['hygiene-dead-instruction'],
};

const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 180_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

function countByCategory(findings, expectedKey) {
  const codes = new Set([expectedKey, ...(CATEGORY_MAP[expectedKey] || [])]);
  return findings.filter(f => codes.has(f.code)).length;
}

async function runOne(model, fixture, runIdx) {
  const cleanPath = path.join(CLEAN_DIR, `${fixture}.md`);
  if (!fs.existsSync(cleanPath)) {
    return { model, fixture, run: runIdx, error: `clean skill not found: ${cleanPath}` };
  }
  const text = fs.readFileSync(cleanPath, 'utf8');
  const expectedData = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, `${fixture}.json`), 'utf8'));
  const provider = new OpenRouterProvider({ apiKey, model });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
  });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(
      engine.analyze({ text, filePath: cleanPath }),
      PER_CALL_TIMEOUT_MS,
      `${fixture} ${model} r${runIdx}`,
    );
  } catch (err) {
    return { model, fixture, run: runIdx, error: err.message, elapsedMs: Date.now() - t0 };
  }
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  return {
    model,
    fixture,
    run: runIdx,
    elapsedMs: Date.now() - t0,
    findings: diags,
    expected: expectedData.expected,
  };
}

const results = [];
for (const model of MODELS) {
  process.stderr.write(`\n--- Running with ${model} ---\n`);
  for (const fixture of FOCUS_FIXTURES) {
    for (let run = 1; run <= 3; run++) {
      const r = await runOne(model, fixture, run);
      results.push(r);
      const totalFindings = r.findings?.length || 0;
      process.stderr.write(`  ${fixture} r${run}: ${r.error ? 'ERROR' : `${totalFindings} findings`}\n`);
    }
  }
}

// Compare per (fixture, category)
process.stderr.write(`\n=== E52 MODEL COMPARISON ===\n\n`);

// Build comparison table per fixture
for (const fixture of FOCUS_FIXTURES) {
  const expectedData = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, `${fixture}.json`), 'utf8'));
  const expected = expectedData.expected;

  process.stderr.write(`\n${fixture}:\n`);
  process.stderr.write(`  Category                  | Exp | Qwen | Llama | Qwen-Δ | Llama-Δ\n`);
  process.stderr.write(`  ` + '-'.repeat(70) + '\n');

  for (const [cat, exp] of Object.entries(expected)) {
    const qwenResults = results.filter(r => r.model === MODELS[0] && r.fixture === fixture && !r.error);
    const llamaResults = results.filter(r => r.model === MODELS[1] && r.fixture === fixture && !r.error);

    const qwenCounts = qwenResults.map(r => countByCategory(r.findings, cat)).sort((a, b) => a - b);
    const llamaCounts = llamaResults.map(r => countByCategory(r.findings, cat)).sort((a, b) => a - b);

    const qwenMedian = qwenCounts[Math.floor(qwenCounts.length / 2)] || 0;
    const llamaMedian = llamaCounts[Math.floor(llamaCounts.length / 2)] || 0;
    const qwenDelta = qwenMedian - exp;
    const llamaDelta = llamaMedian - exp;
    const qwenStr = (qwenDelta === 0 ? '0' : qwenDelta > 0 ? `+${qwenDelta}` : `${qwenDelta}`);
    const llamaStr = (llamaDelta === 0 ? '0' : llamaDelta > 0 ? `+${llamaDelta}` : `${llamaDelta}`);

    process.stderr.write(`  ${cat.padEnd(25)} | ${exp.toString().padStart(3)} | ${qwenMedian.toString().padStart(4)} | ${llamaMedian.toString().padStart(5)} | ${qwenStr.padStart(6)} | ${llamaStr.padStart(7)}\n`);
  }
}

// Overall comparison
process.stderr.write(`\n=== OVERALL TOTALS ===\n`);
for (const model of MODELS) {
  let totalFindings = 0;
  let totalHits = 0;
  let totalExpected = 0;
  for (const r of results.filter(x => x.model === model && !x.error)) {
    for (const [cat, exp] of Object.entries(r.expected)) {
      const count = countByCategory(r.findings, cat);
      totalFindings += count;
      totalExpected += exp;
      if (count >= exp) totalHits += exp;
    }
  }
  const recallPct = totalExpected > 0 ? (totalHits / totalExpected * 100).toFixed(0) : 0;
  process.stderr.write(`  ${model}: ${totalFindings} total findings, ${totalHits}/${totalExpected} = ${recallPct}% recall on focus fixtures\n`);
}

// Persist
const outFile = path.join(DATA_DIR, `e52-model-comparison-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  models: MODELS,
  fixtures: FOCUS_FIXTURES,
  results,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
