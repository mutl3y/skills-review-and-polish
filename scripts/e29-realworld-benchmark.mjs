#!/usr/bin/env node
/**
 * E29: Real-world multi-model benchmark on 6 awesome-copilot-fork skills.
 *
 * Models tested (5 from E27/E28 100% recall tier + 1 deepModel):
 *   1. google/gemini-2.5-flash-lite       (current default, $0.25/1M)
 *   2. qwen/qwen3-coder-30b-a3b-instruct  (top paid, $0.17/1M)
 *   3. qwen/qwen3-vl-8b-instruct          (fastest 100%, $0.29/1M)
 *   4. poolside/laguna-xs-2.1:free        (free tier, $0/1M)
 *   5. meta-llama/llama-4-scout           (100% recall but 4 FPs in E27, $0.20/1M)
 *   6. qwen/qwen3-coder-30b-a3b-instruct  (as deepModel, only contradiction wave)
 *
 * Skills tested (6 from awesome-copilot-fork corpus):
 *   - github-issues (A+, 0 findings E11, 202 lines)
 *   - microsoft-agent-framework (A, 1 finding, 66 lines)
 *   - phoenix-tracing (A, 1 finding, 140 lines)
 *   - datanalysis-credit-risk (A-, 2 findings, 114 lines)
 *   - create-agentsmd (B-, 5 findings, 250 lines)
 *   - quality-playbook (B, 0 findings, 2739 lines — long-context stress)
 *
 * Total: 5 × 6 × 6 waves = 180 LLM calls (analysis) + 6 × 1 = 6 (deep)
 *        = 186 calls total. ~$0.14. ~21 min wall clock with 5-parallel.
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

const LOG_FILE = path.join(LOG_DIR, `e29-realworld-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E29 real-world benchmark started ${new Date().toISOString()} ===\n`);

// 6 test skills from awesome-copilot-fork
const CORPUS_BASE = '/workspace/awesome-copilot-fork/skills';
const SKILLS = [
  { id: 'github-issues', lines: 202, e11_grade: 'A+', e11_findings: 0, e11_score: 100 },
  { id: 'microsoft-agent-framework', lines: 66, e11_grade: 'A', e11_findings: 1, e11_score: 94 },
  { id: 'phoenix-tracing', lines: 140, e11_grade: 'A', e11_findings: 1, e11_score: 94 },
  { id: 'datanalysis-credit-risk', lines: 114, e11_grade: 'A-', e11_findings: 2, e11_score: 88 },
  { id: 'create-agentsmd', lines: 250, e11_grade: 'B-', e11_findings: 5, e11_score: 74 },
  { id: 'quality-playbook', lines: 2739, e11_grade: 'B', e11_findings: 0, e11_score: 78 },
];

// 5 analysis models + 1 deepModel
const MODELS = [
  { id: 'google/gemini-2.5-flash-lite', label: 'gemini-flash-lite (current default)' },
  { id: 'qwen/qwen3-coder-30b-a3b-instruct', label: 'qwen3-coder-30b (top paid)' },
  { id: 'qwen/qwen3-vl-8b-instruct', label: 'qwen3-vl-8b (fastest 100%)' },
  { id: 'poolside/laguna-xs-2.1:free', label: 'poolside-xs-2.1:free' },
  { id: 'meta-llama/llama-4-scout', label: 'llama-4-scout (100% but 4FPs)' },
];
const DEEP_MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';

const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 120_000;
const BATCH_SIZE = 5;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

async function runOne(modelId, skillText, skillPath, opts = {}) {
  const provider = new OpenRouterProvider({ apiKey, model: modelId, deepModel: opts.deepModel });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: opts.waves || ALL_WAVES,
    maxRetries: 0,
  });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(
      engine.analyze({ text: skillText, filePath: skillPath }),
      PER_CALL_TIMEOUT_MS,
      `${modelId} on ${path.basename(path.dirname(skillPath))}`,
    );
  } catch (err) {
    return { modelId, error: err.message, elapsedMs: Date.now() - t0 };
  }
  const elapsedMs = Date.now() - t0;
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  const byCode = {};
  for (const d of diags) byCode[d.code] = (byCode[d.code] || 0) + 1;
  return {
    modelId,
    total: diags.length,
    byCode,
    contradictions: (byCode['contradiction'] || 0) + (byCode['contradiction-related'] || 0),
    ambiguities: byCode['ambiguity-llm'] || 0,
    hygiene: (byCode['hygiene-redundant-instruction'] || 0) + (byCode['hygiene-non-actionable-preamble'] || 0) + (byCode['hygiene-vague-cognitive-directive'] || 0) + (byCode['hygiene-over-specification'] || 0),
    coverage: byCode['coverage-gap'] || 0,
    persona: byCode['persona-inconsistency'] || 0,
    findings: diags.map((d) => ({
      code: d.code,
      severity: d.severity,
      line: (d.range?.start?.line ?? 0) + 1,
      message: String(d.message).slice(0, 400),
      relevantText: d.relevantText ? String(d.relevantText).slice(0, 200) : null,
      analyzer: d.analyzer,
    })),
    elapsedMs,
  };
}

// Pre-load all skill texts
const skillTexts = {};
for (const s of SKILLS) {
  const p = path.join(CORPUS_BASE, s.id, 'SKILL.md');
  if (!fs.existsSync(p)) {
    process.stderr.write(`SKIP: ${p} not found\n`);
    continue;
  }
  skillTexts[s.id] = { text: fs.readFileSync(p, 'utf8'), path: p };
}

const allRuns = [];
let done = 0;
const totalRuns = (MODELS.length * SKILLS.length) + SKILLS.length; // 30 + 6 = 36
process.stderr.write(`\n=== E29: ${MODELS.length} models × ${SKILLS.length} skills (${totalRuns} runs) ===\n`);

async function runBatch(jobs) {
  const out = await Promise.all(jobs.map((j) => j()));
  for (const r of out) allRuns.push(r);
  done += jobs.length;
  process.stderr.write(`[${done}/${totalRuns}] completed\n`);
}

// Build jobs: 5 models × 6 skills = 30 analysis runs
const jobs = [];
for (const m of MODELS) {
  for (const s of SKILLS) {
    if (!skillTexts[s.id]) continue;
    jobs.push(() => runOne(m.id, skillTexts[s.id].text, skillTexts[s.id].path).then((r) => ({
      ...r,
      phase: 'analysis',
      modelLabel: m.label,
      skillId: s.id,
    })));
  }
}

// Shuffle to spread slow models across batches
for (let i = jobs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
}

for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
  await runBatch(jobs.slice(i, i + BATCH_SIZE));
}

// Deep model phase: 1 model × 6 skills × 1 wave = 6 runs
process.stderr.write(`\n=== DEEP MODEL PHASE: ${DEEP_MODEL} (contradictions wave only) ===\n`);

const deepJobs = [];
for (const s of SKILLS) {
  if (!skillTexts[s.id]) continue;
  deepJobs.push(() => runOne('google/gemini-2.5-flash-lite', skillTexts[s.id].text, skillTexts[s.id].path, {
    deepModel: DEEP_MODEL,
    waves: ['contradictions'],
  }).then((r) => ({
    ...r,
    phase: 'deep',
    modelLabel: `deepModel=${DEEP_MODEL}`,
    skillId: s.id,
  })));
}
for (let i = 0; i < deepJobs.length; i += BATCH_SIZE) {
  await runBatch(deepJobs.slice(i, i + BATCH_SIZE));
}

// Persist raw results
const outFile = path.join(DATA_DIR, `e29-realworld-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  skills: SKILLS,
  models: MODELS,
  deepModel: DEEP_MODEL,
  runs: allRuns,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results written to ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);

// Quick summary
process.stderr.write(`\n=== E29 SUMMARY (analysis only) ===\n`);
const byModel = new Map();
for (const r of allRuns) {
  if (r.phase !== 'analysis') continue;
  if (!byModel.has(r.modelId)) byModel.set(r.modelId, { modelId: r.modelId, label: r.modelLabel, runs: [] });
  byModel.get(r.modelId).runs.push(r);
}
for (const [_, m] of byModel) {
  const valid = m.runs.filter((r) => !r.error);
  const totalFindings = valid.reduce((a, r) => a + r.total, 0);
  const totalContradictions = valid.reduce((a, r) => a + r.contradictions, 0);
  const totalHygiene = valid.reduce((a, r) => a + r.hygiene, 0);
  const totalAmbiguity = valid.reduce((a, r) => a + r.ambiguities, 0);
  const totalCoverage = valid.reduce((a, r) => a + r.coverage, 0);
  const avgTime = valid.length > 0 ? valid.reduce((a, r) => a + r.elapsedMs, 0) / valid.length : 0;
  process.stderr.write(`${m.modelId.padEnd(50)} ${valid.length}/${m.runs.length} ok, total findings=${totalFindings}, contradictions=${totalContradictions}, hygiene=${totalHygiene}, ambiguity=${totalAmbiguity}, coverage=${totalCoverage}, avg time=${(avgTime/1000).toFixed(1)}s\n`);
}
