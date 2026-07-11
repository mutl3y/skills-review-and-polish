#!/usr/bin/env node
/**
 * E32: Re-run full corpus scan with the updated prompts from E31.
 * Compare to E30 baseline (1664 findings, 323 coverage-gap, 939 ambiguity-llm).
 *
 * Skips the 15 skills in baseline-fork (already scanned with E11).
 * Cost: ~$0.50
 * Runtime: ~15 min with 5-parallel batching
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

const LOG_FILE = path.join(LOG_DIR, `e32-corpus-rescan-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E32 corpus rescan started ${new Date().toISOString()} ===\n`);

const CORPUS_BASE = '/workspace/awesome-copilot-fork/skills';
const SKIP_SKILLS = new Set([
  'quality-playbook', 'java-mcp-server-generator', 'arize-trace',
  'create-agentsmd', 'github-issues', 'acquire-codebase-knowledge',
  'salesforce-apex-quality', 'phoenix-tracing', 'datanalysis-credit-risk',
  'github-actions-efficiency', 'microsoft-agent-framework', 'boost-prompt',
  'summary-playbook-store-eval', 'datascience-prompt-injection', 'arize-ai-provider-integration',
]);

const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 180_000;
const BATCH_SIZE = 5;

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
    elapsedMs,
  };
}

const allSkillDirs = fs.readdirSync(CORPUS_BASE).filter((d) => {
  const full = path.join(CORPUS_BASE, d, 'SKILL.md');
  return fs.existsSync(full);
});
const skillsToScan = allSkillDirs.filter((id) => !SKIP_SKILLS.has(id));
process.stderr.write(`Found ${allSkillDirs.length} total, skipping ${SKIP_SKILLS.size}, scanning ${skillsToScan.length}\n`);

const results = [];
let done = 0;
const totalRuns = skillsToScan.length;

async function runBatch(jobs) {
  const out = await Promise.all(jobs.map((j) => j()));
  for (const r of out) results.push(r);
  done += jobs.length;
  if (done % 25 === 0 || done === totalRuns) {
    const validCount = results.filter((r) => !r.error).length;
    const totalFindings = results.reduce((a, r) => a + (r.total || 0), 0);
    const byCode = {};
    for (const r of results) {
      if (!r.byCode) continue;
      for (const [code, count] of Object.entries(r.byCode)) {
        byCode[code] = (byCode[code] || 0) + count;
      }
    }
    process.stderr.write(`[${done}/${totalRuns}] valid=${validCount}, total findings=${totalFindings}, byCode=${JSON.stringify(byCode)}\n`);
    const checkpointFile = path.join(DATA_DIR, `e32-corpus-rescan-checkpoint-${STAMP}.json`);
    fs.writeFileSync(checkpointFile, JSON.stringify({ done, results, byCode, captured_at: new Date().toISOString() }, null, 2));
  }
}

const jobs = [];
for (const skillId of skillsToScan) {
  const p = path.join(CORPUS_BASE, skillId, 'SKILL.md');
  jobs.push(() => {
    const text = fs.readFileSync(p, 'utf8');
    return runOne(skillId, text, p);
  });
}

for (let i = jobs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
}

for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
  await runBatch(jobs.slice(i, i + BATCH_SIZE));
}

// Aggregate
const byCode = {};
const errors = [];
for (const r of results) {
  if (r.error) {
    errors.push({ skillId: r.skillId, error: r.error });
    continue;
  }
  for (const [code, count] of Object.entries(r.byCode || {})) {
    byCode[code] = (byCode[code] || 0) + count;
  }
}

const outFile = path.join(DATA_DIR, `e32-corpus-rescan-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  corpus_base: CORPUS_BASE,
  total_skills: skillsToScan.length,
  results,
  by_code: byCode,
  errors,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results written to ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);

// Summary
process.stderr.write(`\n=== E32 CORPUS RESCAN SUMMARY ===\n`);
process.stderr.write(`Scanned: ${skillsToScan.length} skills, errors: ${errors.length}\n`);

// Compare to E30 baseline
const e30 = JSON.parse(fs.readFileSync(
  path.join(DATA_DIR, 'e30-corpus-scan-2026-07-11T09-27-46-053Z.json'),
  'utf8',
));
process.stderr.write(`\n=== E30 → E32 DELTA ===\n`);
process.stderr.write(`${'Code'.padEnd(35)} | ${'E30'.padStart(6)} | ${'E32'.padStart(6)} | ${'Δ'.padStart(6)} | ${'%'.padStart(7)}\n`);
process.stderr.write('-'.repeat(80) + '\n');
const allCodes = new Set([...Object.keys(e30.by_code), ...Object.keys(byCode)]);
const sortedCodes = Array.from(allCodes).sort((a, b) => (byCode[b] || 0) - (byCode[a] || 0));
let totalE30 = 0, totalE32 = 0;
for (const code of sortedCodes) {
  const e30c = e30.by_code[code] || 0;
  const e32c = byCode[code] || 0;
  const delta = e32c - e30c;
  const pct = e30c > 0 ? Math.round((delta / e30c) * 100) : 0;
  totalE30 += e30c;
  totalE32 += e32c;
  process.stderr.write(`${code.padEnd(35)} | ${e30c.toString().padStart(6)} | ${e32c.toString().padStart(6)} | ${(delta >= 0 ? '+' : '') + delta.toString().padStart(5)} | ${(pct >= 0 ? '+' : '') + pct.toString().padStart(5)}%\n`);
}
process.stderr.write('-'.repeat(80) + '\n');
const totalDelta = totalE32 - totalE30;
const totalPct = totalE30 > 0 ? Math.round((totalDelta / totalE30) * 100) : 0;
process.stderr.write(`${'TOTAL'.padEnd(35)} | ${totalE30.toString().padStart(6)} | ${totalE32.toString().padStart(6)} | ${(totalDelta >= 0 ? '+' : '') + totalDelta.toString().padStart(5)} | ${(totalPct >= 0 ? '+' : '') + totalPct.toString().padStart(5)}%\n`);
