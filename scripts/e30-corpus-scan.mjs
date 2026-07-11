#!/usr/bin/env node
/**
 * E30: Full corpus scan — run the analyzer on all 340 skills in the
 * awesome-copilot-fork corpus with the E29 winner (qwen3-coder-30b).
 *
 * Goal: gather FP patterns to add to findingFilter.ts, validate E11
 * baseline noise floor, and check coverage-gap taxonomy.
 *
 * Skips the 15 skills in baseline-fork (already scanned with E11).
 * Output: per-skill findings + aggregate stats by code.
 *
 * Cost: ~340 × $0.002 = ~$0.68
 * Runtime: ~22 min (5-parallel)
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

const LOG_FILE = path.join(LOG_DIR, `e30-corpus-scan-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E30 corpus scan started ${new Date().toISOString()} ===\n`);

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
const PER_CALL_TIMEOUT_MS = 180_000; // 3 min for large docs
const BATCH_SIZE = 5; // conservative for corpus scan

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
    findings: diags.map((d) => ({
      code: d.code,
      severity: d.severity,
      line: (d.range?.start?.line ?? 0) + 1,
      message: String(d.message).slice(0, 250),
      relevantText: d.relevantText ? String(d.relevantText).slice(0, 150) : null,
    })),
  };
}

// Discover all skills
const allSkillDirs = fs.readdirSync(CORPUS_BASE).filter((d) => {
  const full = path.join(CORPUS_BASE, d, 'SKILL.md');
  return fs.existsSync(full);
});
const skillsToScan = allSkillDirs.filter((id) => !SKIP_SKILLS.has(id));
process.stderr.write(`Found ${allSkillDirs.length} total, skipping ${allSkillDirs.size}, scanning ${skillsToScan.length}\n`);

const results = [];
let done = 0;
const totalRuns = skillsToScan.length;

async function runBatch(jobs) {
  const out = await Promise.all(jobs.map((j) => j()));
  for (const r of out) results.push(r);
  done += jobs.length;
  // Log every 10 completions
  if (done % 10 === 0 || done === totalRuns) {
    const validCount = results.filter((r) => !r.error).length;
    const totalFindings = results.reduce((a, r) => a + (r.total || 0), 0);
    process.stderr.write(`[${done}/${totalRuns}] valid=${validCount}, total findings so far=${totalFindings}\n`);
    // Periodic checkpoint save
    const checkpointFile = path.join(DATA_DIR, `e30-corpus-scan-checkpoint-${STAMP}.json`);
    fs.writeFileSync(checkpointFile, JSON.stringify({ done, results, captured_at: new Date().toISOString() }, null, 2));
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

// Shuffle to spread large docs
for (let i = jobs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
}

for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
  await runBatch(jobs.slice(i, i + BATCH_SIZE));
}

// Aggregate by code
const byCode = {};
const byCodeSkills = {}; // which skills have which code
const errors = [];
for (const r of results) {
  if (r.error) {
    errors.push({ skillId: r.skillId, error: r.error });
    continue;
  }
  for (const [code, count] of Object.entries(r.byCode || {})) {
    byCode[code] = (byCode[code] || 0) + count;
    if (!byCodeSkills[code]) byCodeSkills[code] = [];
    byCodeSkills[code].push({ skillId: r.skillId, count });
  }
}

// Persist final
const outFile = path.join(DATA_DIR, `e30-corpus-scan-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  corpus_base: CORPUS_BASE,
  total_skills: skillsToScan.length,
  skipped: Array.from(SKIP_SKILLS),
  results,
  by_code: byCode,
  by_code_skills: byCodeSkills,
  errors,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results written to ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);

// Summary
process.stderr.write(`\n=== E30 CORPUS SCAN SUMMARY ===\n`);
process.stderr.write(`Scanned: ${skillsToScan.length} skills, errors: ${errors.length}\n`);
process.stderr.write(`\nFindings by code (most common first):\n`);
const sortedCodes = Object.entries(byCode).sort((a, b) => b[1] - a[1]);
for (const [code, count] of sortedCodes) {
  process.stderr.write(`  ${code.padEnd(35)} ${count.toString().padStart(4)} (across ${byCodeSkills[code].length} skills)\n`);
}
process.stderr.write(`\nTop 5 most common FP-prone codes (for findingFilter.ts candidates):\n`);
for (const [code, count] of sortedCodes.slice(0, 5)) {
  const topSkills = byCodeSkills[code].sort((a, b) => b.count - a.count).slice(0, 3);
  process.stderr.write(`  ${code} (${count} total): most in ${topSkills.map(s => `${s.skillId}(${s.count})`).join(', ')}\n`);
}
