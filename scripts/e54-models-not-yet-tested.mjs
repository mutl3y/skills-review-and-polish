#!/usr/bin/env node
/**
 * E54: Test models NOT in E53 round 2 (the "wildcards" — models from
 * OpenRouter we haven't tried on clean fixtures).
 *
 * Models to test (user-requested):
 * - anthropic/claude-3.5-sonnet (strong at instruction analysis)
 * - anthropic/claude-3.7-sonnet (newer Sonnet)
 * - google/gemini-2.5-pro (larger than flash-lite)
 * - google/gemini-2.0-flash-exp (newer flash)
 * - openai/o1-mini (reasoning model)
 * - openai/o3-mini (reasoning model, newer)
 * - deepseek/deepseek-chat-v3 (non-reasoning, good at instruction)
 * - x-ai/grok-2 (newer model)
 * - mistralai/mistral-large-2 (large Mistral)
 *
 * Will compare recall on the 6 focus fixtures from E53.
 *
 * Cost: ~$0.20 (9 models × 6 fixtures × 3 runs × 6 waves)
 * Runtime: ~15-20 min
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

const LOG_FILE = path.join(LOG_DIR, `e54-wildcards-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E54 wildcards model test started ${new Date().toISOString()} ===\n`);

// 6 focus fixtures from E53
const FOCUS_FIXTURES = [
  'test-circular-hard',
  'test-contradictions-direct',
  'test-cognitive-structural',
  'test-dead-hard',
  'test-coverage-gaps-hard',
  'test-ambiguities-hard',
];

// Wildcard models — not in E53 round 2
const MODELS = [
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.7-sonnet',
  'google/gemini-2.5-pro',
  'openai/o1-mini',
  'openai/o3-mini',
  'deepseek/deepseek-chat-v3',
  'x-ai/grok-2',
  'mistralai/mistral-large-2',
];

const CLEAN_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'clean');
const EXPECTED_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'expected');

const CATEGORY_MAP = {
  'cognitive': ['cognitive-nested-conditions', 'cognitive-deep-decision-tree', 'cognitive-priority-conflict', 'cognitive-delegated-decision', 'cognitive-constraint-overload', 'cognitive-sequencing', 'cognitive-logical-inversion'],
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
      const errMsg = r.error ? ` (${r.error.slice(0, 50)})` : '';
      process.stderr.write(`  ${fixture} r${run}: ${r.error ? 'ERROR' : `${totalFindings} findings`}${errMsg}\n`);
    }
  }
}

// Compute per-fixture per-category recall per model
process.stderr.write(`\n=== E54 WILDCARD MODEL RESULTS ===\n\n`);

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
  const modelShort = model.replace('anthropic/', 'ant/').replace('google/', 'g/').replace('openai/', 'o/').replace('deepseek/', 'ds/').replace('x-ai/', 'xai/').replace('mistralai/', 'mi/');
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
    const modelShort = model.replace('anthropic/', 'ant/').replace('google/', 'g/').replace('openai/', 'o/').replace('deepseek/', 'ds/').replace('x-ai/', 'xai/').replace('mistralai/', 'mi/');
    process.stderr.write(`  ${modelShort.padEnd(30)} | ${recallPct.padStart(3)}%   | ${totalFindings}\n`);
  }
}

// Persist
const outFile = path.join(DATA_DIR, `e54-wildcards-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  models: MODELS,
  fixtures: FOCUS_FIXTURES,
  results,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
