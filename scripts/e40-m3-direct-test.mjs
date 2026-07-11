#!/usr/bin/env node
/**
 * E40: Run test-contradictions-direct with M3 (you) as the model.
 * Goal: see if a high-reasoning model finds the 11 ambiguities the
 * qwen3-coder-30b missed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('/workspace/skills-review-and-polish/out/core/index.js');
const { OpenRouterProvider } = await import('/workspace/skills-review-and-polish/out/providers/externalProvider.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY required'); process.exit(1); }

const MODEL = 'minimax/minimax-m3';
const FIXTURE = 'tests/fixtures/primary/test-contradictions-direct/SKILL.md';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const N_RUNS = 3;
const PER_CALL_TIMEOUT_MS = 240_000;
const BATCH_SIZE = 2;

function withTimeout(p, ms, l) {
  return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`TIMEOUT ${ms}ms ${l}`)), ms))]);
}

async function runOne(text, filePath, run) {
  const provider = new OpenRouterProvider({ apiKey, model: MODEL });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
  });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(engine.analyze({ text, filePath }), PER_CALL_TIMEOUT_MS, `${filePath} r${run}`);
  } catch (e) {
    return { error: e.message, elapsedMs: Date.now() - t0 };
  }
  const elapsedMs = Date.now() - t0;
  return {
    findings: Array.isArray(out) ? out : (out.diagnostics || []),
    elapsedMs,
  };
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = '/workspace/skills-review-and-polish/.github/experiments/documentation-review/logs';
const DATA_DIR = '/workspace/skills-review-and-polish/.github/experiments/documentation-review/data';
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, `e40-m3-direct-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E40 M3 test-contradictions-direct started ${new Date().toISOString()} ===\n`);

const text = fs.readFileSync(path.join('/workspace/skills-review-and-polish', FIXTURE), 'utf8');
const results = [];
let done = 0;
async function runBatch(batch) {
  const out = await Promise.all(batch.map((j) => j()));
  for (const r of out) results.push(r);
  done += batch.length;
  process.stderr.write(`[${done}/${N_RUNS}] completed\n`);
}
for (let i = 0; i < N_RUNS; i += BATCH_SIZE) {
  const slice = Array.from({ length: Math.min(BATCH_SIZE, N_RUNS - i) }, (_, k) => async () => {
    const r = await runOne(text, FIXTURE, i + k + 1);
    return { run: i + k + 1, ...r };
  });
  await runBatch(slice);
}

process.stderr.write(`\n=== M3 RESULTS — test-contradictions-direct ===\n`);
for (const r of results) {
  if (r.error) { process.stderr.write(`Run ${r.run}: ERROR ${r.error}\n`); continue; }
  const byCode = {};
  for (const f of r.findings) byCode[f.code] = (byCode[f.code] || 0) + 1;
  process.stderr.write(`Run ${r.run} (${(r.elapsedMs/1000).toFixed(1)}s): ${r.findings.length} findings: ${JSON.stringify(byCode)}\n`);
  const ambs = r.findings.filter(f => f.code === 'ambiguity-llm');
  for (const f of ambs) {
    process.stderr.write(`  L${(f.range?.start?.line ?? 0) + 1}: ${(f.message || '').slice(0, 200)}\n`);
  }
}

const outFile = path.join(DATA_DIR, `e40-m3-direct-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({ model: MODEL, fixture: FIXTURE, results, captured_at: new Date().toISOString() }, null, 2));
process.stderr.write(`\nFull results: ${outFile}\nLog: ${LOG_FILE}\n`);
