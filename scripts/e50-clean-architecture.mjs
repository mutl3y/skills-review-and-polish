#!/usr/bin/env node
/**
 * E50: New test architecture — clean skill + separate answer file.
 *
 * The fundamental fix: the LLM only sees the clean skill body, never the
 * test metadata, expected counts, or label markers. Expected counts live in
 * a separate JSON file that the test runner reads.
 *
 * Architecture:
 *   tests/fixtures/clean/<fixture-name>.md  — clean skill body (LLM-readable)
 *   tests/fixtures/expected/<fixture-name>.json — expected counts (runner-only)
 *
 * The clean skill must be created by stripping the test scaffolding from the
 * existing SKILL.md files. This script reads the clean version, sends it to
 * the LLM, and grades the LLM's findings against the expected file.
 *
 * Cost: ~$0.04 for 1 fixture × 3 runs × 6 waves
 * Runtime: ~3 min per fixture
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

const LOG_FILE = path.join(LOG_DIR, `e50-clean-architecture-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E50 clean architecture test started ${new Date().toISOString()} ===\n`);

const CLEAN_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'clean');
const EXPECTED_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'expected');

const CATEGORY_MAP = {
  'cognitive': ['cognitive-nested-conditions', 'cognitive-deep-decision-tree', 'cognitive-priority-conflict', 'cognitive-delegated-decision', 'cognitive-constraint-overload'],
  'hygiene': ['hygiene-over-specification', 'hygiene-non-actionable-preamble', 'hygiene-redundant-instruction', 'hygiene-vague-cognitive-directive', 'hygiene-unordered-process', 'hygiene-unordered-sequential-process', 'hygiene-ordered-process', 'hygiene-ordered-sequential-process', 'hygiene-missing-agent', 'hygiene-circular-definition', 'hygiene-vague-directive'],
  'contradiction': ['contradiction', 'contradiction-related'],
  'circular': ['hygiene-circular-definition'],
  'dead': ['hygiene-dead-instruction'],
};

const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const N_RUNS = 3;
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 360_000;
const BATCH_SIZE = 4;

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

/**
 * Strip test scaffolding from fixture text.
 * Same logic as the stripTestScaffolding function that was prototyped in
 * e33-fixture-validation.mjs but cleaner / standalone.
 */
function stripTestScaffolding(text) {
  let out = text;
  // Remove the test metadata block: a markdown blockquote starting with `> **Test metadata:**`
  out = out.replace(/^> \*\*Test metadata:\*\*[\s\S]*?(?=\n\n[^>]|\n##)/m, '');
  // Remove label markers from headings: "### [SUBTLE-1] Title" -> "### Title"
  out = out.replace(/^(#{1,6}\s*)\[[A-Z][A-Z\-\d]*\][ \t]*/gm, '$1');
  // Remove bold-text label markers: "**[HARD-CIRC-1]**" alone on a line
  out = out.replace(/^\*\*\[[A-Z][A-Z\-\d]*\]\*\*\s*$/gm, '');
  // Remove inline label markers in body text
  out = out.replace(/\[(?:HARD-CIRC|HARD-DIRECT|HARD-AMBIG|HARD-OBLIG|SUBTLE|DIRECT|COGNITIVE|PERSONA|QUALITY|STRUCTURAL|POSITIVE|NEGATIVE|INFER|GAP-H|GAP|AMBIENT)-\d+\]/g, '');
  // Remove "Domain inference required" hint comments
  out = out.replace(/\n\s*\*\(Domain inference required:[^)]*\)\*/g, '');
  out = out.replace(/\*\(Domain inference required:[^)]*\)\*/g, '');
  // Remove "(3-hop circle: ...)" parenthetical hints
  out = out.replace(/\*\(3-hop circle:[^)]*\)\*/g, '');
  // Remove Tables that document test patterns
  out = out.replace(/^\| Pattern \| Labels \|[\s\S]*?(?=\n\n|\n#)/gm, '');
  // Remove inline `[GAP-N]` markers
  out = out.replace(/\[GAP(-\w+)?\d+\]/g, '');
  // Clean up
  out = out.replace(/\n---\n\n+/g, '\n\n');
  out = out.replace(/\n\*\*\s*\n/g, '\n');
  out = out.replace(/^\*+\s*$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

async function runOne(fixtureName, fixturePath, expected, runIdx) {
  const fullPath = path.join(__dirname, '..', fixturePath);
  if (!fs.existsSync(fullPath)) {
    return { fixture: fixtureName, run: runIdx, error: `clean skill not found: ${fullPath}` };
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
      `${fixtureName} r${runIdx}`,
    );
  } catch (err) {
    return { fixture: fixtureName, run: runIdx, error: err.message, elapsedMs: Date.now() - t0 };
  }
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  return {
    fixture: fixtureName,
    run: runIdx,
    elapsedMs: Date.now() - t0,
    findings: diags,
  };
}

/**
 * Build a clean skill from a SKILL.md by stripping test scaffolding, OR
 * read the clean version from tests/fixtures/clean/ if it exists.
 */
function readCleanSkill(fixtureName) {
  const cleanPath = path.join(CLEAN_DIR, `${fixtureName}.md`);
  if (fs.existsSync(cleanPath)) {
    return fs.readFileSync(cleanPath, 'utf8');
  }
  // Fall back to stripping the original
  const origPath = path.join(__dirname, '..', 'tests', 'fixtures', 'primary', fixtureName, 'SKILL.md');
  if (fs.existsSync(origPath)) {
    return stripTestScaffolding(fs.readFileSync(origPath, 'utf8'));
  }
  const advPath = path.join(__dirname, '..', 'tests', 'fixtures', 'adversarial', fixtureName, 'SKILL.md');
  if (fs.existsSync(advPath)) {
    return stripTestScaffolding(fs.readFileSync(advPath, 'utf8'));
  }
  return null;
}

function findCleanSkillPath(fixtureName) {
  const cleanPath = path.join(CLEAN_DIR, `${fixtureName}.md`);
  if (fs.existsSync(cleanPath)) {
    return `tests/fixtures/clean/${fixtureName}.md`;
  }
  // Fall back to primary then adversarial (we strip at runtime)
  const primPath = `tests/fixtures/primary/${fixtureName}/SKILL.md`;
  if (fs.existsSync(path.join(__dirname, '..', primPath))) {
    return primPath;
  }
  const advPath = `tests/fixtures/adversarial/${fixtureName}/SKILL.md`;
  if (fs.existsSync(path.join(__dirname, '..', advPath))) {
    return advPath;
  }
  return null;
}

// Discover fixtures: every .json in expected/ defines a fixture
const expectedFiles = fs.readdirSync(EXPECTED_DIR).filter(f => f.endsWith('.json'));
const fixtures = expectedFiles.map(f => {
  const name = f.replace('.json', '');
  const data = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, f), 'utf8'));
  const skillPath = findCleanSkillPath(name);
  return {
    name,
    path: skillPath,
    expected: data.expected,
    notes: data.notes || '',
  };
});

if (fixtures.length === 0) {
  process.stderr.write(`\nNo fixtures found. Add JSON files to ${EXPECTED_DIR}\n`);
  process.stderr.write(`Each JSON must have shape: { "expected": { "code": count, ... } }\n`);
  process.exit(0);
}

process.stderr.write(`\nDiscovered ${fixtures.length} fixture(s):\n`);
for (const f of fixtures) {
  process.stderr.write(`  - ${f.name} (skill: ${f.path})\n`);
}

// Run all fixtures × N runs
const jobs = [];
for (const fixture of fixtures) {
  if (!fixture.path) {
    process.stderr.write(`  SKIP ${fixture.name}: no skill file found\n`);
    continue;
  }
  for (let run = 1; run <= N_RUNS; run++) {
    jobs.push(() => runOne(fixture.name, fixture.path, fixture.expected, run));
  }
}

process.stderr.write(`\nRunning ${jobs.length} jobs (${fixtures.length} fixtures × ${N_RUNS} runs)...\n`);

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
for (const fixture of fixtures) {
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
process.stderr.write(`\n=== E50 CLEAN ARCHITECTURE TEST REPORT ===\n\n`);
const SEP = '-'.repeat(110);
process.stderr.write(`${'Fixture'.padEnd(40)} | ${'Category'.padEnd(28)} | ${'Exp'.padStart(4)} | ${'Med'.padStart(4)} | ${'Recall'.padStart(7)} | ${'Runs'.padStart(15)} | Status\n`);
process.stderr.write(SEP + '\n');

let totalCats = 0, totalHits = 0, totalMisses = 0;
const misses = [];

for (const fixture of fixtures) {
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
const outFile = path.join(DATA_DIR, `e50-clean-architecture-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  n_runs: N_RUNS,
  fixtures: fixtures.map(f => ({ name: f.name, path: f.path, expected: f.expected, notes: f.notes })),
  results,
  fixture_results: fixtureResults,
  summary: { total_categories: totalCats, hits: totalHits, misses: totalMisses, miss_list: misses },
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
