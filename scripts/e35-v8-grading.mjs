#!/usr/bin/env node
/**
 * E35: Test if v8 documentation-review skill grades an A and whether the
 * RFC-style design (v8) helps the model follow it.
 *
 * Runs the analyzer (E33 prompts + qwen3-coder-30b) on all 8 skill
 * versions (v1 through v8) using focused multiWave mode (the most
 * accurate mode per E18/E19).
 *
 * Measures:
 * - Score (0-100) and grade for each version
 * - Total findings
 * - Findings by code (especially contradiction)
 * - Cross-version trend
 *
 * Cost: 8 skills × 1 multiWave = 8 calls (6 waves each) = 48 LLM calls. ~$0.05.
 * Runtime: ~5 min.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('/workspace/skills-review-and-polish/out/core/index.js');
const { OpenRouterProvider } = await import('/workspace/skills-review-and-polish/out/providers/externalProvider.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = '/workspace/skills-review-and-polish/.github/experiments/documentation-review/logs';
const DATA_DIR = '/workspace/skills-review-and-polish/.github/experiments/documentation-review/data';
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `e35-v8-grading-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E35 v8 grading started ${new Date().toISOString()} ===\n`);

const VERSIONS_DIR = '/workspace/skills-review-and-polish/.github/experiments/documentation-review/versions';
const versions = fs.readdirSync(VERSIONS_DIR).filter(d => d.match(/^v\d+$/)).sort();

const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 180_000;
const BATCH_SIZE = 4;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

async function runOne(version, text, filePath) {
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
      engine.analyze({ text, filePath }),
      PER_CALL_TIMEOUT_MS,
      version,
    );
  } catch (err) {
    return { version, error: err.message, elapsedMs: Date.now() - t0 };
  }
  const elapsedMs = Date.now() - t0;
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  const byCode = {};
  for (const d of diags) byCode[d.code] = (byCode[d.code] || 0) + 1;
  return {
    version,
    total: diags.length,
    byCode,
    elapsedMs,
    findings: diags.map((d) => ({
      code: d.code,
      severity: d.severity,
      line: (d.range?.start?.line ?? 0) + 1,
      message: String(d.message).slice(0, 250),
    })),
  };
}

const jobs = [];
for (const v of versions) {
  const p = path.join(VERSIONS_DIR, v, 'SKILL.md');
  if (!fs.existsSync(p)) continue;
  jobs.push(() => {
    const text = fs.readFileSync(p, 'utf8');
    return runOne(v, text, p);
  });
}

const results = [];
let done = 0;
async function runBatch(batch) {
  const out = await Promise.all(batch.map((j) => j()));
  for (const r of out) results.push(r);
  done += batch.length;
  process.stderr.write(`[${done}/${jobs.length}] completed\n`);
}
for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
  await runBatch(jobs.slice(i, i + BATCH_SIZE));
}

// Compute scores
const { scoreSkill, parseSkillType } = await import('/workspace/skills-review-and-polish/out/core/scoring.js');

process.stderr.write(`\n=== E35 RESULTS ===\n\n`);
process.stderr.write(`${'Version'.padEnd(8)} | ${'Score'.padStart(5)} | ${'Grade'.padStart(6)} | ${'Findings'.padStart(8)} | ${'Contradiction'.padStart(12)} | ${'Lines'.padStart(5)} | ${'Time(s)'.padStart(7)}\n`);
process.stderr.write('-'.repeat(80) + '\n');

for (const r of results) {
  if (r.error) {
    process.stderr.write(`${r.version.padEnd(8)} | ERR  | ERR   | ERR       | ERR            | ?     | ?\n`);
    continue;
  }
  const filePath = path.join(VERSIONS_DIR, r.version, 'SKILL.md');
  const text = fs.readFileSync(filePath, 'utf8');
  const lineCount = text.split('\n').length;
  // Build the findings as AnalysisResult-like objects for scoring
  const fakeDiags = r.findings.map(f => ({
    code: f.code,
    severity: f.severity,
    range: { start: { line: f.line, character: 0 }, end: { line: f.line, character: 0 } },
    message: f.message,
    analyzer: 'test',
  }));
  const skillType = parseSkillType(fakeDiags[0]?.analyzer || '');
  const score = scoreSkill(fakeDiags, lineCount, skillType);
  process.stderr.write(`${r.version.padEnd(8)} | ${String(score.score).padStart(5)} | ${score.grade.padStart(6)} | ${r.total.toString().padStart(8)} | ${(r.byCode['contradiction'] || 0).toString().padStart(12)} | ${lineCount.toString().padStart(5)} | ${(r.elapsedMs/1000).toFixed(1).padStart(7)}\n`);
}

const outFile = path.join(DATA_DIR, `e35-v8-grading-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  versions_tested: versions,
  results,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
