#!/usr/bin/env node
/**
 * E31: Re-run E29 production skills with the fixed prompts to measure
 * the FP rate improvement.
 *
 * Predictions based on prompt changes:
 * - coverage-gap count should drop dramatically (E30: 1 per skill → expected ~0 for most)
 * - ambiguity-llm count should drop (E30: 13 per skill on avg → expected ~5)
 * - Other categories unchanged
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

const LOG_FILE = path.join(LOG_DIR, `e31-prompt-fix-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E31 prompt-fix re-test started ${new Date().toISOString()} ===\n`);

const SKILLS = [
  { id: 'github-issues', e29_ambiguity: 5, e29_coverage: 1, e29_total: 11 },
  { id: 'microsoft-agent-framework', e29_ambiguity: 4, e29_coverage: 1, e29_total: 5 },
  { id: 'phoenix-tracing', e29_ambiguity: 12, e29_coverage: 1, e29_total: 15 },
  { id: 'datanalysis-credit-risk', e29_ambiguity: 4, e29_coverage: 1, e29_total: 6 },
  { id: 'create-agentsmd', e29_ambiguity: 4, e29_coverage: 1, e29_total: 5 },
  { id: 'quality-playbook', e29_ambiguity: 16, e29_coverage: 2, e29_total: 41 },
];

const CORPUS_BASE = '/workspace/awesome-copilot-fork/skills';
const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 180_000;
const BATCH_SIZE = 6;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

async function runOne(skillId, skillText, skillPath) {
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
      engine.analyze({ text: skillText, filePath: skillPath }),
      PER_CALL_TIMEOUT_MS,
      skillId,
    );
  } catch (err) {
    return { skillId, error: err.message, elapsedMs: Date.now() - t0 };
  }
  const elapsedMs = Date.now() - t0;
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  const byCode = {};
  for (const d of diags) byCode[d.code] = (byCode[d.code] || 0) + 1;
  return {
    skillId,
    total: diags.length,
    byCode,
    ambiguities: byCode['ambiguity-llm'] || 0,
    coverage: byCode['coverage-gap'] || 0,
    elapsedMs,
    findings: diags.map((d) => ({
      code: d.code, severity: d.severity,
      line: (d.range?.start?.line ?? 0) + 1,
      message: String(d.message).slice(0, 250),
    })),
  };
}

const results = [];
let done = 0;
const totalRuns = SKILLS.length;

async function runBatch(jobs) {
  const out = await Promise.all(jobs.map((j) => j()));
  for (const r of out) results.push(r);
  done += jobs.length;
  process.stderr.write(`[${done}/${totalRuns}] completed\n`);
}

const jobs = [];
for (const s of SKILLS) {
  const p = path.join(CORPUS_BASE, s.id, 'SKILL.md');
  jobs.push(() => {
    const text = fs.readFileSync(p, 'utf8');
    return runOne(s.id, text, p);
  });
}

for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
  await runBatch(jobs.slice(i, i + BATCH_SIZE));
}

// Compare to E29
process.stderr.write(`\n=== E31 vs E29 COMPARISON (per skill) ===\n`);
process.stderr.write(`${'Skill'.padEnd(30)} | ${'E29 total'.padStart(9)} | ${'E31 total'.padStart(9)} | ${'Δ total'.padStart(8)} | ${'E29 amb'.padStart(7)} | ${'E31 amb'.padStart(7)} | ${'E29 cov'.padStart(7)} | ${'E31 cov'.padStart(7)}\n`);
process.stderr.write('-'.repeat(110) + '\n');
let totalE29 = 0, totalE31 = 0, totalE29Amb = 0, totalE31Amb = 0, totalE29Cov = 0, totalE31Cov = 0;
for (const s of SKILLS) {
  const r = results.find((x) => x.skillId === s.id);
  if (!r || r.error) continue;
  const delta = r.total - s.e29_total;
  const e31Amb = r.ambiguities;
  const e31Cov = r.coverage;
  totalE29 += s.e29_total;
  totalE31 += r.total;
  totalE29Amb += s.e29_ambiguity;
  totalE31Amb += e31Amb;
  totalE29Cov += s.e29_coverage;
  totalE31Cov += e31Cov;
  process.stderr.write(`${s.id.padEnd(30)} | ${String(s.e29_total).padStart(9)} | ${String(r.total).padStart(9)} | ${(delta >= 0 ? '+' : '') + delta.toString().padStart(7)} | ${String(s.e29_ambiguity).padStart(7)} | ${String(e31Amb).padStart(7)} | ${String(s.e29_coverage).padStart(7)} | ${String(e31Cov).padStart(7)}\n`);
}
process.stderr.write('-'.repeat(110) + '\n');
const totDelta = totalE31 - totalE29;
const totDeltaAmb = totalE31Amb - totalE29Amb;
const totDeltaCov = totalE31Cov - totalE29Cov;
process.stderr.write(`${'TOTAL'.padEnd(30)} | ${String(totalE29).padStart(9)} | ${String(totalE31).padStart(9)} | ${(totDelta >= 0 ? '+' : '') + totDelta.toString().padStart(7)} | ${String(totalE29Amb).padStart(7)} | ${String(totalE31Amb).padStart(7)} | ${String(totalE29Cov).padStart(7)} | ${String(totalE31Cov).padStart(7)}\n`);
process.stderr.write(`\nAmbiguity-llm reduction: ${((1 - totalE31Amb/totalE29Amb) * 100).toFixed(0)}%\n`);
process.stderr.write(`Coverage-gap reduction: ${((1 - totalE31Cov/totalE29Cov) * 100).toFixed(0)}%\n`);
process.stderr.write(`Total reduction: ${((1 - totalE31/totalE29) * 100).toFixed(0)}%\n`);

const outFile = path.join(DATA_DIR, `e31-prompt-fix-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  results,
  e29_baseline: SKILLS,
  totals: { e29: totalE29, e31: totalE31, e29_amb: totalE29Amb, e31_amb: totalE31Amb, e29_cov: totalE29Cov, e31_cov: totalE31Cov },
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
