#!/usr/bin/env node
/**
 * E40: Re-run the failing E33 fixtures with MiniMax-M3 (you) as the analysis
 * model. Goal: see if a high-reasoning model finds the issues that
 * qwen3-coder-30b misses.
 *
 * Compares to:
 * - E33 v5 (qwen3-coder-30b + new E38 prompt): 17/47 PASS
 * - E12-N3 (gemini-flash, v3 prompt): the original expected counts
 *
 * Cost: 13 fixtures x 3 runs x 6 waves = 234 LLM calls ≈ $1-2 with M3 pricing.
 * Runtime: ~30 min with 5-parallel batching.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('/workspace/skills-review-and-polish/out/core/index.js');
const { OpenRouterProvider } = await import('/workspace/skills-review-and-polish/out/providers/externalProvider.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY is required'); process.exit(1); }

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = '/workspace/skills-review-and-polish/.github/experiments/documentation-review/logs';
const DATA_DIR = '/workspace/skills-review-and-polish/.github/experiments/documentation-review/data';
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `e40-minimax-m3-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E40 MiniMax-M3 fixture validation started ${new Date().toISOString()} ===\n`);

// Ground truth (same as E33 v5)
const GROUND_TRUTH = [
  { path: 'tests/fixtures/primary/test-contradictions-direct/SKILL.md', name: 'test-contradictions-direct',
    expected: { contradiction: 15, 'ambiguity-llm': 11, 'coverage-gap': 2, hygiene: 5 } },
  { path: 'tests/fixtures/primary/test-contradictions-subtle/SKILL.md', name: 'test-contradictions-subtle',
    expected: { contradiction: 12, 'ambiguity-llm': 4, 'coverage-gap': 1, hygiene: 6, 'cognitive-nested-conditions': 2 } },
  { path: 'tests/fixtures/primary/test-ambiguities/SKILL.md', name: 'test-ambiguities',
    expected: { 'ambiguity-llm': 20 } },
  { path: 'tests/fixtures/primary/test-cognitive-structural/SKILL.md', name: 'test-cognitive-structural',
    expected: { cognitive: 5, 'ambiguity-llm': 6, 'coverage-gap': 4, hygiene: 4, 'persona-inconsistency': 4 } },
  { path: 'tests/fixtures/primary/test-coverage-gaps/SKILL.md', name: 'test-coverage-gaps',
    expected: { 'coverage-gap': 13, 'ambiguity-llm': 7, hygiene: 5, cognitive: 1 } },
  { path: 'tests/fixtures/primary/test-instruction-quality/SKILL.md', name: 'test-instruction-quality',
    expected: { 'ambiguity-llm': 8, hygiene: 7, 'coverage-gap': 2, contradiction: 1, cognitive: 4 } },
  { path: 'tests/fixtures/adversarial/test-contradictions-hard/SKILL.md', name: 'test-contradictions-hard',
    expected: { contradiction: 8, 'ambiguity-llm': 11, hygiene: 5, 'persona-inconsistency': 1 } },
  { path: 'tests/fixtures/adversarial/test-ambiguities-hard/SKILL.md', name: 'test-ambiguities-hard',
    expected: { 'ambiguity-llm': 20, hygiene: 1 } },
  { path: 'tests/fixtures/adversarial/test-coverage-gaps-hard/SKILL.md', name: 'test-coverage-gaps-hard',
    expected: { 'coverage-gap': 15, hygiene: 7 } },
  { path: 'tests/fixtures/adversarial/test-obligation-hard/SKILL.md', name: 'test-obligation-hard',
    expected: { 'ambiguity-llm': 15, 'coverage-gap': 2, hygiene: 5, cognitive: 1 } },
  { path: 'tests/fixtures/adversarial/test-circular-hard/SKILL.md', name: 'test-circular-hard',
    expected: { circular: 10, hygiene: 2, cognitive: 1 } },
  { path: 'tests/fixtures/adversarial/test-dead-hard/SKILL.md', name: 'test-dead-hard',
    expected: { 'hygiene-dead-instruction': 12 } },
  { path: 'tests/fixtures/adversarial/test-mixed-hard/SKILL.md', name: 'test-mixed-hard',
    expected: { contradiction: 2, 'ambiguity-llm': 5, 'coverage-gap': 2, hygiene: 5, cognitive: 4, dead: 2, circular: 2 } },
];

const CATEGORY_MAP = {
  cognitive: ['cognitive-nested-conditions', 'cognitive-deep-decision-tree', 'cognitive-priority-conflict', 'cognitive-delegated-decision', 'cognitive-constraint-overload'],
  hygiene: ['hygiene-over-specification', 'hygiene-non-actionable-preamble', 'hygiene-redundant-instruction', 'hygiene-vague-cognitive-directive', 'hygiene-unordered-process', 'hygiene-unordered-sequential-process', 'hygiene-ordered-process', 'hygiene-ordered-sequential-process', 'hygiene-missing-agent', 'hygiene-circular-definition', 'hygiene-vague-directive'],
  contradiction: ['contradiction', 'contradiction-related'],
  circular: ['hygiene-circular-definition'],
  dead: ['hygiene-dead-instruction'],
};

const MODEL = 'minimax/minimax-m3';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const N_RUNS = 3;
const PER_CALL_TIMEOUT_MS = 240_000;  // 4 min per call (M3 may be slower)
const BATCH_SIZE = 4;

function withTimeout(p, ms, l) {
  return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`TIMEOUT ${ms}ms ${l}`)), ms))]);
}

async function runOne(text, filePath) {
  const provider = new OpenRouterProvider({ apiKey, model: MODEL });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
  });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(engine.analyze({ text, filePath }), PER_CALL_TIMEOUT_MS, filePath);
  } catch (e) {
    return { error: e.message, elapsedMs: Date.now() - t0 };
  }
  return Array.isArray(out) ? out : (out.diagnostics || []);
}

const results = [];
let done = 0;
const totalRuns = GROUND_TRUTH.length * N_RUNS;
async function runBatch(batch) {
  const out = await Promise.all(batch.map((j) => j()));
  for (const r of out) results.push(r);
  done += batch.length;
  process.stderr.write(`[${done}/${totalRuns}] completed\n`);
}
for (let i = 0; i < GROUND_TRUTH.length; i += BATCH_SIZE) {
  const slice = GROUND_TRUTH.slice(i, i + BATCH_SIZE);
  await runBatch(slice.map((fx) => async () => {
    const text = fs.readFileSync(path.join('/workspace/skills-review-and-polish', fx.path), 'utf8');
    const findings = await runOne(text, fx.path);
    return { fixture: fx.name, findings, expected: fx.expected };
  }));
}

process.stderr.write(`\n=== E40 RESULTS (MiniMax-M3) ===\n\n`);
process.stderr.write(`${'Fixture'.padEnd(30)} | ${'Category'.padEnd(28)} | ${'Exp'.padStart(3)} | ${'Med'.padStart(3)} | ${'Recall'.padStart(7)} | Status\n`);
process.stderr.write('-'.repeat(100) + '\n');

let totalCats = 0, totalHits = 0;
for (const fx of GROUND_TRUTH) {
  for (const [cat, exp] of Object.entries(fx.expected)) {
    const runs = results.filter(r => r.fixture === fx.name).map(r => {
      if (r.error) return null;
      let n = r.findings.filter(f => f.code === cat).length;
      if (CATEGORY_MAP[cat]) {
        for (const code of CATEGORY_MAP[cat]) n += r.findings.filter(f => f.code === code).length;
      }
      return n;
    }).filter(v => v !== null);
    runs.sort((a, b) => a - b);
    const med = runs[Math.floor(runs.length / 2)] || 0;
    const recall = med / exp;
    const recallPct = (recall * 100).toFixed(0) + '%';
    const status = med >= exp ? '✓ PASS' : (med >= exp * 0.5 ? '⚠ PARTIAL' : '✗ FAIL');
    process.stderr.write(`${fx.name.padEnd(30)} | ${cat.padEnd(28)} | ${exp.toString().padStart(3)} | ${med.toString().padStart(3)} | ${recallPct.padStart(7)} | ${status}\n`);
    totalCats++;
    if (med >= exp) totalHits++;
  }
}
process.stderr.write(`\nPASS: ${totalHits}/${totalCats} categories at 100% recall\n`);

const outFile = path.join(DATA_DIR, `e40-minimax-m3-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  fixtures: GROUND_TRUTH,
  results,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\nLog: ${LOG_FILE}\n`);
