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
const responseHealth = {
  salvageRecoveries: 0,
  nonStopFinishReasons: 0,
  finishReasonErrors: 0,
  finishReasonLength: 0,
  deepFallbacks: 0,
  providerErrors: 0,
};
function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}
process.stderr.write = (chunk, ...args) => {
  const text = typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? '';
  responseHealth.salvageRecoveries += countOccurrences(text, 'salvageTruncatedJSON');
  responseHealth.nonStopFinishReasons += countOccurrences(text, 'non-stop finish reason');
  responseHealth.finishReasonErrors += countOccurrences(text, '"finishReason":"error"');
  responseHealth.finishReasonLength += countOccurrences(text, '"finishReason":"length"');
  responseHealth.deepFallbacks += countOccurrences(text, 'deep tier failed; retrying with standard tier');
  responseHealth.providerErrors += countOccurrences(text, 'callLLM: provider error');
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E50 clean architecture test started ${new Date().toISOString()} ===\n`);

const CLEAN_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'clean');
const EXPECTED_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'expected');

const CATEGORY_MAP = {
  'cognitive': ['cognitive-nested-conditions', 'cognitive-deep-decision-tree', 'cognitive-priority-conflict', 'cognitive-delegated-decision', 'cognitive-constraint-overload', 'cognitive-sequencing', 'cognitive-logical-inversion'],
  'hygiene': ['hygiene-over-specification', 'hygiene-non-actionable-preamble', 'hygiene-redundant-instruction', 'hygiene-vague-cognitive-directive', 'hygiene-unordered-process', 'hygiene-unordered-sequential-process', 'hygiene-ordered-process', 'hygiene-ordered-sequential-process', 'hygiene-missing-agent', 'hygiene-circular-definition', 'hygiene-vague-directive'],
  'contradiction': ['contradiction', 'contradiction-related'],
  'circular': ['hygiene-circular-definition'],
  'dead': ['hygiene-dead-instruction'],
};

const MODEL = process.env.ANALYSIS_MODEL || 'google/gemini-2.5-flash-lite';
const DEEP_MODEL = process.env.DEEP_MODEL || 'deepseek/deepseek-chat-v3';
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 16384);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 0);
// structuredOutput is a 3-state value:
//   'schema' (default) → response_format: { type: 'json_schema', ... } (strict)
//   'json'             → response_format: { type: 'json_object' } (legacy)
//   'off'              → no response_format (legacy default)
// Accepts the legacy STRUCTURED_OUTPUT=1 alias for 'json' for backward compat
// with earlier scripts that only knew the boolean form.
const RAW_STRUCTURED_OUTPUT = process.env.STRUCTURED_OUTPUT;
const STRUCTURED_OUTPUT = (() => {
  if (RAW_STRUCTURED_OUTPUT === undefined || RAW_STRUCTURED_OUTPUT === '') return 'schema';
  if (RAW_STRUCTURED_OUTPUT === '1' || RAW_STRUCTURED_OUTPUT === 'true') return 'json';
  if (RAW_STRUCTURED_OUTPUT === '0' || RAW_STRUCTURED_OUTPUT === 'false' || RAW_STRUCTURED_OUTPUT === 'off') return 'off';
  if (RAW_STRUCTURED_OUTPUT === 'schema' || RAW_STRUCTURED_OUTPUT === 'json') return RAW_STRUCTURED_OUTPUT;
  return 'schema';
})();
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120_000);
// Adaptive response-token budgeting (plan item 3 / adaptive two-budget clamp).
// ON by default so long-output waves (e.g. ambiguities) are not silently
// truncated at the fixed 16384 cap. Disable with ADAPTIVE_RESPONSE_TOKENS=0
// to reproduce historical fixed-cap behavior.
const ADAPTIVE_RESPONSE_TOKENS = process.env.ADAPTIVE_RESPONSE_TOKENS !== '0';
const ADAPTIVE_MAX_RESPONSE_TOKENS = Number(process.env.ADAPTIVE_MAX_RESPONSE_TOKENS || 131_072);
const ADAPTIVE_MIN_RESPONSE_TOKENS = Number(process.env.ADAPTIVE_MIN_RESPONSE_TOKENS || 16_384);
const ADAPTIVE_CHARS_PER_TOKEN = Number(process.env.ADAPTIVE_CHARS_PER_TOKEN || 4);
const N_RUNS = Number(process.env.SCORE_SAMPLES || 3);
const MIN_RECALL = Number(process.env.MIN_RECALL || 0.42);
const MAX_OVER_REPORT_RATIO = Number(process.env.MAX_OVER_REPORT_RATIO || 3);
const RELEASE_GATE = process.env.RELEASE_GATE === '1';
const FIXTURE_FILTER = (process.env.FIXTURE_FILTER || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
// SKIP_POST_PROCESS=1 disables the finding post-processor (crossWaveDedup,
// imperativeAmbiguity, etc.) so the script reports the raw analyzer output.
// Used by the dedup-discovery probe to re-derive stale fixture expected
// counts; production E50 runs should leave this off.
const SKIP_POST_PROCESS = process.env.SKIP_POST_PROCESS === '1';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 360_000;
// Per-wave timeout (single LLM call, including retries): if any one wave's
// OpenRouter request hangs, abort that wave and let the run loop mark the
// fixture as a non-stop finish. Without this, a single hung wave stalls the
// whole 6-wave analyze call until PER_CALL_TIMEOUT_MS fires (6 min).
// 2026-07-17: smoke run hung at fixture #41 wave 1 for >5 min and was
// killed; per-wave timeout lets the run continue past the bad wave.
const PER_WAVE_TIMEOUT_MS = Number(process.env.PER_WAVE_TIMEOUT_MS || 120_000);
// Drop BATCH_SIZE to 1 in schema mode. The strict response_format envelope
// + 6 waves + deep tier + composition-conflicts per fixture = 7+ concurrent
// LLM calls. With BATCH_SIZE=4 that's 28 concurrent schema requests, which
// appears to deadlock or rate-limit on the OpenRouter route. 1 fixture at a
// time keeps the request fanout under the provider's comfortable limit.
const BATCH_SIZE = 1;

process.stderr.write(`model=${MODEL}\n`);
process.stderr.write(`deepModel=${DEEP_MODEL}\n`);
process.stderr.write(`maxTokens=${MAX_TOKENS}\n`);
process.stderr.write(`maxRetries=${MAX_RETRIES}\n`);
process.stderr.write(`structuredOutput=${STRUCTURED_OUTPUT}\n`);
process.stderr.write(`requestTimeoutMs=${REQUEST_TIMEOUT_MS}\n`);
process.stderr.write(`skipPostProcess=${SKIP_POST_PROCESS}\n`);

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
  const provider = new OpenRouterProvider({
    apiKey,
    model: MODEL,
    deepModel: DEEP_MODEL,
    maxTokens: MAX_TOKENS,
    maxRetries: MAX_RETRIES,
    // hardcode 1M to match Gemini 2.5 Flash Lite (the standard tier);
    // a hung E50 today because getContextLength() returned undefined and the
    // analyzer logged a 200K-fallback warning on every wave. See plan item
    // `complete-e50-schema-validation` for the context-lookup chain.
    contextLength: 1_000_000,
    // 'schema' (default) sends strict JSON schema; 'json' sends legacy
    // json_object; 'off' omits response_format. The provider's own default
    // is 'schema' too, but we pass it explicitly so the log line reflects
    // the test's chosen mode.
    structuredOutput: STRUCTURED_OUTPUT,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    adaptiveMaxTokens: ADAPTIVE_RESPONSE_TOKENS,
    adaptiveMaxTokensCap: ADAPTIVE_MAX_RESPONSE_TOKENS,
    minAdaptiveTokens: ADAPTIVE_MIN_RESPONSE_TOKENS,
    adaptiveCharsPerToken: ADAPTIVE_CHARS_PER_TOKEN,
  });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
    filterFindings: !SKIP_POST_PROCESS,
  });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(
      engine.analyze({ text, filePath: fullPath }),
      PER_WAVE_TIMEOUT_MS * 6 + 30_000, // 6 waves × per-wave + 30s for scoring/post-process
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
let fixtures = expectedFiles.map(f => {
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

if (FIXTURE_FILTER.length > 0) {
  const wanted = new Set(FIXTURE_FILTER);
  fixtures = fixtures.filter(f => wanted.has(f.name));
}

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
let totalExpected = 0, totalDetectedCapped = 0, totalDetectedRaw = 0;
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
    totalExpected += exp;
    totalDetectedCapped += Math.min(data.median, exp);
    totalDetectedRaw += data.median;
    if (data.median >= exp) totalHits++;
    if (data.median < exp) {
      totalMisses++;
      misses.push({ fixture: fixture.name, category: cat, expected: exp, found: data.median, runs: data.runs });
    }
  }
}

process.stderr.write(SEP + '\n');
const overallRecall = totalExpected > 0 ? totalDetectedCapped / totalExpected : 0;
const precisionProxy = totalDetectedRaw > 0 ? totalDetectedCapped / totalDetectedRaw : 0;
const overReportRatio = totalExpected > 0 ? totalDetectedRaw / totalExpected : 0;
process.stderr.write(`\nSUMMARY: ${totalHits}/${totalCats} categories at 100% recall (median), ${totalMisses} below threshold.\n`);
process.stderr.write(`Recall: ${(overallRecall * 100).toFixed(1)}% (${totalDetectedCapped}/${totalExpected} capped hits)\n`);
process.stderr.write(`Precision proxy: ${(precisionProxy * 100).toFixed(1)}% (${totalDetectedCapped}/${totalDetectedRaw} capped/raw detections)\n`);
process.stderr.write(`Over-report ratio: ${overReportRatio.toFixed(2)}x raw detections vs expected\n`);
process.stderr.write(`Response health: salvage=${responseHealth.salvageRecoveries}, nonStopFinish=${responseHealth.nonStopFinishReasons}, finishError=${responseHealth.finishReasonErrors}, finishLength=${responseHealth.finishReasonLength}, deepFallback=${responseHealth.deepFallbacks}, providerError=${responseHealth.providerErrors}\n`);

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
  deep_model: DEEP_MODEL,
  n_runs: N_RUNS,
  fixtures: fixtures.map(f => ({ name: f.name, path: f.path, expected: f.expected, notes: f.notes })),
  results,
  fixture_results: fixtureResults,
  summary: {
    total_categories: totalCats,
    hits: totalHits,
    misses: totalMisses,
    total_expected: totalExpected,
    capped_hits: totalDetectedCapped,
    raw_detections: totalDetectedRaw,
    recall: overallRecall,
    precision_proxy: precisionProxy,
    over_report_ratio: overReportRatio,
    min_recall: MIN_RECALL,
    max_over_report_ratio: MAX_OVER_REPORT_RATIO,
    release_gate: RELEASE_GATE,
    response_health: responseHealth,
    miss_list: misses,
  },
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);

const gateFailed = RELEASE_GATE && (overallRecall < MIN_RECALL || overReportRatio > MAX_OVER_REPORT_RATIO);
if (gateFailed) {
  process.stderr.write(
    `\nRELEASE GATE FAILED: recall ${overallRecall.toFixed(3)} minimum ${MIN_RECALL}, over-report ${overReportRatio.toFixed(2)}x maximum ${MAX_OVER_REPORT_RATIO}x\n`,
  );
}

logStream.end(() => process.exit(gateFailed ? 1 : 0));
