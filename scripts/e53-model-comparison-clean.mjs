#!/usr/bin/env node
/**
 * E53: Model comparison on the E50 clean architecture.
 *
 * The original E25 model comparison (e25-model-comparison.md) used the LABELED
 * test fixtures (with [DIRECT-N] markers and "Test metadata" blocks). That
 * primed the LLM — it was reading test scaffolding, not analyzing realistic
 * skills. The "winner" (gemini-flash-lite) won partly because it handled the
 * labeled format well.
 *
 * This script repeats the comparison using the CLEAN fixtures (no labels, no
 * scaffolding). The LLM now analyzes realistic skill bodies.
 *
 * Models selected (small set, focus on likely-competitive):
 * - qwen/qwen3-coder-30b-a3b-instruct (current recommendation, E29 winner)
 * - meta-llama/llama-4-scout (E52 winner on focus fixtures)
 * - google/gemini-2.5-flash-lite (E25 winner on labeled fixtures)
 * - openai/gpt-4o-mini (E25 high-precision alternative)
 * - meta-llama/llama-3.3-70b-instruct (E25 high-quality alternative)
 *
 * Cost: ~$0.10 (5 models × 5 focus fixtures × 1 run × 6 waves)
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

const LOG_FILE = path.join(LOG_DIR, `e53-model-comparison-clean-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E53 clean-architecture model comparison started ${new Date().toISOString()} ===\n`);

// Focus on the 5 under-detecting fixtures from E50 + 1 clean fixture
const FOCUS_FIXTURES = [
  'test-circular-hard',
  'test-contradictions-direct',
  'test-cognitive-structural',
  'test-dead-hard',
  'test-coverage-gaps-hard',
  'test-ambiguities-hard',  // baseline: 5/20 — hardest ambiguity fixture
];

const MODELS = [
  'qwen/qwen3-coder-30b-a3b-instruct',  // current recommendation
  'meta-llama/llama-4-scout',  // E52 winner
  'google/gemini-2.5-flash-lite',  // E25 winner (labeled)
  'openai/gpt-4o-mini',  // E25 high-precision
  'meta-llama/llama-3.3-70b-instruct',  // E25 high-quality
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
const PER_CALL_TIMEOUT_MS = 240_000;

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
      process.stderr.write(`  ${fixture} r${run}: ${r.error ? 'ERROR' : `${totalFindings} findings (${r.elapsedMs}ms)`}\n`);
    }
  }
}

// Compute per-fixture per-category recall per model
process.stderr.write(`\n=== E53 CLEAN-ARCHITECTURE MODEL COMPARISON ===\n\n`);

// Build a summary table per model
process.stderr.write('Per-model overall recall on focus fixtures:\n');
process.stderr.write('-'.repeat(70) + '\n');
for (const model of MODELS) {
  let totalHits = 0;
  let totalExpected = 0;
  let totalFindings = 0;
  let totalErrors = 0;
  for (const r of results.filter(x => x.model === model)) {
    if (r.error) { totalErrors++; continue; }
    for (const [cat, exp] of Object.entries(r.expected)) {
      const count = countByCategory(r.findings, cat);
      totalFindings += count;
      totalExpected += exp;
      if (count >= exp) totalHits += exp;
    }
  }
  const recallPct = totalExpected > 0 ? (totalHits / totalExpected * 100).toFixed(0) : 0;
  const modelShort = model.replace('meta-llama/', 'ml/').replace('google/', 'g/').replace('openai/', 'o/');
  process.stderr.write(`  ${modelShort.padEnd(30)} | ${totalHits}/${totalExpected} = ${recallPct.padStart(3)}% | ${totalFindings} findings | ${totalErrors} errors\n`);
}

// Per-fixture comparison
process.stderr.write(`\nPer-fixture recall:\n`);
process.stderr.write('-'.repeat(70) + '\n');
for (const fixture of FOCUS_FIXTURES) {
  process.stderr.write(`\n${fixture}:\n`);
  process.stderr.write(`  Model                          | Recall | Total\n`);
  process.stderr.write(`  ` + '-'.repeat(50) + '\n');
  for (const model of MODELS) {
    const fixtureResults = results.filter(x => x.model === model && x.fixture === fixture && !x.error);
    if (fixtureResults.length === 0) {
      process.stderr.write(`  ${model.padEnd(30)} | ERROR\n`);
      continue;
    }
    const expected = fixtureResults[0].expected;
    let totalHits = 0;
    let totalExpected = 0;
    let totalFindings = 0;
    for (const r of fixtureResults) {
      for (const [cat, exp] of Object.entries(r.expected)) {
        const count = countByCategory(r.findings, cat);
        totalFindings += count;
        totalExpected += exp;
        if (count >= exp) totalHits += exp;
      }
    }
    const recallPct = totalExpected > 0 ? (totalHits / totalExpected * 100).toFixed(0) : 0;
    const modelShort = model.replace('meta-llama/', 'ml/').replace('google/', 'g/').replace('openai/', 'o/');
    process.stderr.write(`  ${modelShort.padEnd(30)} | ${recallPct.padStart(3)}%   | ${totalFindings}\n`);
  }
}

// Persist
const outFile = path.join(DATA_DIR, `e53-model-comparison-clean-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  models: MODELS,
  fixtures: FOCUS_FIXTURES,
  results,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
