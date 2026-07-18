#!/usr/bin/env node
// scripts/probes/e41-minimax-m3.mjs
/**
 * E33: Fixture validation against ground truth.
 *
 * Runs the analyzer (with E31/E32 prompts) on all 13 labeled fixtures
 * and measures detection rate per category. Goal: 100% recall on every
 * category where the fixture has labeled expected findings.
 *
 * Uses N=3 medians for noise reduction (per LEARNINGS.md).
 *
 * Cost: 13 fixtures × 3 runs × 6 waves = 234 LLM calls ≈ $0.04
 * Runtime: ~5 min (5-parallel)
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

const LOG_FILE = path.join(LOG_DIR, `e41-minimax-m3-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E33 fixture validation started ${new Date().toISOString()} ===\n`);

// Ground truth: expected counts per category per fixture
// Derived from the Test metadata tables in each SKILL.md
const GROUND_TRUTH = [
  {
    path: 'tests/fixtures/primary/test-contradictions-direct/SKILL.md',
    name: 'test-contradictions-direct',
    expected: { contradiction: 15, 'ambiguity-llm': 11, 'coverage-gap': 2, hygiene: 5 },
  },
  {
    path: 'tests/fixtures/primary/test-contradictions-subtle/SKILL.md',
    name: 'test-contradictions-subtle',
    expected: { contradiction: 12, 'ambiguity-llm': 4, 'coverage-gap': 1, hygiene: 6, 'cognitive-nested-conditions': 2 },
  },
  {
    path: 'tests/fixtures/primary/test-ambiguities/SKILL.md',
    name: 'test-ambiguities',
    expected: { 'ambiguity-llm': 20 },
  },
  {
    path: 'tests/fixtures/primary/test-cognitive-structural/SKILL.md',
    name: 'test-cognitive-structural',
    expected: { cognitive: 5, 'ambiguity-llm': 6, 'coverage-gap': 4, hygiene: 4, 'persona-inconsistency': 4 },
  },
  {
    path: 'tests/fixtures/primary/test-coverage-gaps/SKILL.md',
    name: 'test-coverage-gaps',
    expected: { 'coverage-gap': 13, 'ambiguity-llm': 7, hygiene: 5, cognitive: 1 },
  },
  {
    path: 'tests/fixtures/primary/test-instruction-quality/SKILL.md',
    name: 'test-instruction-quality',
    expected: { 'ambiguity-llm': 8, hygiene: 7, 'coverage-gap': 2, contradiction: 1, cognitive: 4 },
  },
  {
    path: 'tests/fixtures/adversarial/test-contradictions-hard/SKILL.md',
    name: 'test-contradictions-hard',
    expected: { contradiction: 8, 'ambiguity-llm': 11, hygiene: 5, 'persona-inconsistency': 1 },
  },
  {
    path: 'tests/fixtures/adversarial/test-ambiguities-hard/SKILL.md',
    name: 'test-ambiguities-hard',
    expected: { 'ambiguity-llm': 20, hygiene: 1 },
  },
  {
    path: 'tests/fixtures/adversarial/test-coverage-gaps-hard/SKILL.md',
    name: 'test-coverage-gaps-hard',
    expected: { 'coverage-gap': 15, hygiene: 7 },
  },
  {
    path: 'tests/fixtures/adversarial/test-obligation-hard/SKILL.md',
    name: 'test-obligation-hard',
    expected: { 'ambiguity-llm': 15, 'coverage-gap': 2, hygiene: 5, cognitive: 1 },
  },
  {
    path: 'tests/fixtures/adversarial/test-circular-hard/SKILL.md',
    name: 'test-circular-hard',
    expected: { circular: 10, hygiene: 2, cognitive: 1 },
  },
  {
    path: 'tests/fixtures/adversarial/test-dead-hard/SKILL.md',
    name: 'test-dead-hard',
    expected: { 'hygiene-dead-instruction': 12 },
  },
  {
    path: 'tests/fixtures/adversarial/test-mixed-hard/SKILL.md',
    name: 'test-mixed-hard',
    expected: { contradiction: 2, 'ambiguity-llm': 5, 'coverage-gap': 2, hygiene: 5, cognitive: 4, dead: 2, circular: 2 },
  },
];

const CATEGORY_MAP = {
  // Top-level categories
  'cognitive': ['cognitive-nested-conditions', 'cognitive-deep-decision-tree', 'cognitive-priority-conflict', 'cognitive-delegated-decision', 'cognitive-constraint-overload'],
  'hygiene': ['hygiene-over-specification', 'hygiene-non-actionable-preamble', 'hygiene-redundant-instruction', 'hygiene-vague-cognitive-directive', 'hygiene-unordered-process', 'hygiene-unordered-sequential-process', 'hygiene-ordered-process', 'hygiene-ordered-sequential-process', 'hygiene-missing-agent', 'hygiene-circular-definition', 'hygiene-vague-directive'],
  'contradiction': ['contradiction', 'contradiction-related'],
  'circular': ['hygiene-circular-definition'],
  'dead': ['hygiene-dead-instruction'],
};

const MODEL = 'minimax/minimax-m3';
const N_RUNS = 3;
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 360_000;
const BATCH_SIZE = 5;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

/** Count findings by category, mapping top-level categories to their codes. */
function countByCategory(findings, expectedKey) {
  const directCode = expectedKey;
  let count = findings.filter(f => f.code === directCode).length;
  // Also check the category map for top-level keys
  if (CATEGORY_MAP[expectedKey]) {
    for (const code of CATEGORY_MAP[expectedKey]) {
      count += findings.filter(f => f.code === code).length;
    }
  }
  return count;
}

async function runOne(fixture, runIdx) {
  const fullPath = path.join(__dirname, '..', fixture.path);
  if (!fs.existsSync(fullPath)) {
    return { fixture: fixture.name, run: runIdx, error: `file not found: ${fullPath}` };
  }
  const text = fs.readFileSync(fullPath, 'utf8');
  const provider = new OpenRouterProvider({ apiKey, model: MODEL });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
  });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(
      engine.analyze({ text, filePath: fullPath }),
      PER_CALL_TIMEOUT_MS,
      `${fixture.name} r${runIdx}`,
    );
  } catch (err) {
    return { fixture: fixture.name, run: runIdx, error: err.message, elapsedMs: Date.now() - t0 };
  }
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  return {
    fixture: fixture.name,
    run: runIdx,
    elapsedMs: Date.now() - t0,
    findings: diags,
  };
}

// Run all fixtures × N runs
const jobs = [];
for (const fixture of GROUND_TRUTH) {
  for (let run = 1; run <= N_RUNS; run++) {
    jobs.push(() => runOne(fixture, run));
  }
}

process.stderr.write(`Running ${jobs.length} jobs (${GROUND_TRUTH.length} fixtures × ${N_RUNS} runs)...\n`);

const results = [];
let done = 0;
async function runBatch(batchJobs) {
  const out = await Promise.all(batchJobs.map((j) => j()));
  for (const r of out) results.push(r);
  done += batchJobs.length;
  if (done % 5 === 0 || done === jobs.length) {
    process.stderr.write(`[${done}/${jobs.length}] completed\n`);
  }
}
for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
  await runBatch(jobs.slice(i, i + BATCH_SIZE));
}

// Compute medians per (fixture, expectedCategory)
const fixtureResults = {};
for (const fixture of GROUND_TRUTH) {
  fixtureResults[fixture.name] = { expected: fixture.expected, perCategory: {} };
  for (const cat of Object.keys(fixture.expected)) {
    const perRun = [];
    for (let run = 1; run <= N_RUNS; run++) {
      const r = results.find(x => x.fixture === fixture.name && x.run === run);
      if (!r || r.error || !r.findings) {
        perRun.push(null);
      } else {
        perRun.push(countByCategory(r.findings, cat));
      }
    }
    const valid = perRun.filter(v => v !== null);
    if (valid.length === 0) {
      fixtureResults[fixture.name].perCategory[cat] = { median: 0, runs: perRun, error: 'all runs failed' };
    } else {
      const sorted = [...valid].sort((a, b) => a - b);
      fixtureResults[fixture.name].perCategory[cat] = {
        median: sorted[Math.floor(sorted.length / 2)],
        runs: perRun,
      };
    }
  }
}

// Report
process.stderr.write(`\n=== E33 FIXTURE VALIDATION REPORT ===\n\n`);
const SEP = '-'.repeat(110);
process.stderr.write(`${'Fixture'.padEnd(40)} | ${'Category'.padEnd(28)} | ${'Exp'.padStart(4)} | ${'Med'.padStart(4)} | ${'Recall'.padStart(7)} | ${'Runs'.padStart(15)} | Status\n`);
process.stderr.write(SEP + '\n');

let totalCats = 0, totalHits = 0, totalMisses = 0;
const misses = [];

for (const fixture of GROUND_TRUTH) {
  const res = fixtureResults[fixture.name];
  for (const [cat, exp] of Object.entries(fixture.expected)) {
    const data = res.perCategory[cat];
    const recall = data.median / exp;
    const recallPct = (recall * 100).toFixed(0) + '%';
    const status = data.median >= exp ? '✓ PASS' : (data.median >= exp * 0.5 ? '⚠ PARTIAL' : '✗ FAIL');
    const runsStr = data.runs.map(r => r === null ? 'ERR' : r).join(',');
    process.stderr.write(
      `${fixture.name.padEnd(40)} | ${cat.padEnd(28)} | ${exp.toString().padStart(4)} | ${data.median.toString().padStart(4)} | ${recallPct.padStart(7)} | ${runsStr.padStart(15)} | ${status}\n`,
    );
    totalCats++;
    if (data.median >= exp) totalHits++;
    if (data.median < exp) {
      totalMisses++;
      misses.push({ fixture: fixture.name, category: cat, expected: exp, found: data.median, runs: data.runs });
    }
  }
}

process.stderr.write(SEP + '\n');
process.stderr.write(`\nSUMMARY: ${totalHits}/${totalCats} categories at 100% recall (median), ${totalMisses} below threshold.\n`);

if (misses.length > 0) {
  process.stderr.write(`\n=== GAPS TO FIX ===\n`);
  for (const m of misses) {
    process.stderr.write(`  ${m.fixture} / ${m.category}: expected ${m.expected}, found median=${m.found}, runs=[${m.runs.join(',')}]\n`);
  }
}

// Persist
const outFile = path.join(DATA_DIR, `e41-minimax-m3-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  n_runs: N_RUNS,
  ground_truth: GROUND_TRUTH,
  results,
  fixture_results: fixtureResults,
  summary: { total_categories: totalCats, hits: totalHits, misses: totalMisses, miss_list: misses },
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
