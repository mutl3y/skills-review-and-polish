#!/usr/bin/env node
/**
 * E56: Full corpus scan with multi-model mix.
 *
 * Uses the E53/E54 winner combination:
 * - model (standard tier): gemini-2.5-flash-lite (47% recall overall)
 * - deepModel (deep tier, used for contradictions wave): deepseek-chat-v3 (best on circular)
 *
 * This is the recommended production config per E53/E54 model analysis.
 * Cost estimate: ~$0.24 for 340 skills (vs $0.50 with qwen-only).
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

const LOG_FILE = path.join(LOG_DIR, `e56-corpus-multimodel-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E56 corpus scan with multi-model mix started ${new Date().toISOString()} ===\n`);

const CORPUS_BASE = '/workspace/awesome-copilot-fork/skills';
const SKIP_SKILLS = new Set([
  'quality-playbook', 'java-mcp-server-generator', 'arize-trace',
  'create-agentsmd', 'github-issues', 'acquire-codebase-knowledge',
  'salesforce-apex-quality', 'phoenix-tracing', 'datanalysis-credit-risk',
  'github-actions-efficiency', 'microsoft-agent-framework', 'boost-prompt',
  'summary-playbook-store-eval', 'datascience-prompt-injection', 'arize-ai-provider-integration',
]);

const STANDARD_MODEL = 'gemini-2.5-flash-lite';
const DEEP_MODEL = 'deepseek/deepseek-chat-v3';
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
  const provider = new OpenRouterProvider({
    apiKey,
    model: STANDARD_MODEL,
    deepModel: DEEP_MODEL,
  });
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
      `${skillId}`,
    );
  } catch (err) {
    return { skillId, error: err.message, elapsedMs: Date.now() - t0 };
  }
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  return {
    skillId,
    elapsedMs: Date.now() - t0,
    findings: diags,
  };
}

function discoverSkills() {
  const entries = fs.readdirSync(CORPUS_BASE, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_SKILLS.has(entry.name)) continue;
    const skillPath = path.join(CORPUS_BASE, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    skills.push({ name: entry.name, path: skillPath });
  }
  return skills;
}

const skills = discoverSkills();
process.stderr.write(`Found ${skills.length} skills to scan\n`);

const jobs = skills.map(s => async () => {
  const text = fs.readFileSync(s.path, 'utf8');
  return await runOne(s.name, text, s.path);
});

const results = [];
let done = 0;
async function runBatch(batchJobs) {
  const out = await Promise.all(batchJobs.map(j => j()));
  for (const r of out) results.push(r);
  done += batchJobs.length;
  if (done % 10 === 0 || done === jobs.length) {
    process.stderr.write(`[${done}/${jobs.length}] completed\n`);
  }
}

for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
  await runBatch(jobs.slice(i, i + BATCH_SIZE));
}

// Summary
process.stderr.write(`\n=== E56 SCAN COMPLETE ===\n`);
const errorCount = results.filter(r => r.error).length;
const successCount = results.length - errorCount;
const totalFindings = results.reduce((sum, r) => sum + (r.findings?.length || 0), 0);
const totalElapsed = results.reduce((sum, r) => sum + (r.elapsedMs || 0), 0);

process.stderr.write(`Total skills: ${results.length}\n`);
process.stderr.write(`Successful: ${successCount}\n`);
process.stderr.write(`Errors: ${errorCount}\n`);
process.stderr.write(`Total findings: ${totalFindings}\n`);
process.stderr.write(`Total time: ${(totalElapsed/1000/60).toFixed(1)} min\n`);

// Per-code breakdown
const byCode = {};
for (const r of results) {
  if (!r.findings) continue;
  for (const f of r.findings) {
    byCode[f.code] = (byCode[f.code] || 0) + 1;
  }
}
process.stderr.write(`\nFindings by code:\n`);
const sortedCodes = Object.entries(byCode).sort((a, b) => b[1] - a[1]);
for (const [code, count] of sortedCodes) {
  process.stderr.write(`  ${code.padEnd(35)}: ${count}\n`);
}

// Persist
const outFile = path.join(DATA_DIR, `e56-corpus-multimodel-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  standard_model: STANDARD_MODEL,
  deep_model: DEEP_MODEL,
  corpus_base: CORPUS_BASE,
  total_skills: results.length,
  success_count: successCount,
  error_count: errorCount,
  total_findings: totalFindings,
  total_elapsed_ms: totalElapsed,
  by_code: byCode,
  results,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
