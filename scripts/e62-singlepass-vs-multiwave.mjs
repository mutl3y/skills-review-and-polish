#!/usr/bin/env node
/**
 * E62: Compare the synced single-pass prompt against multiWave mode on the
 * same skills, using the same OpenRouter model, so we can see whether the
 * single-pass coverage block (synced to coverage.prompt's recall posture in
 * v0.1.44) now tracks multiWave coverage findings.
 *
 * Runs BOTH modes per skill (sequential, with a small gap) and reports:
 *   - per-skill total findings (single vs multiWave)
 *   - per-skill coverage_gap counts (single vs multiWave)
 *   - aggregate findings-by-code for each mode
 *
 * Cost: 2 calls/skill. Runtime: scales with corpus size.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = '/workspace/skills-review-and-polish';

const { Engine } = await import(path.join(ROOT, 'out/core/index.js'));
const { OpenRouterProvider } = await import(path.join(ROOT, 'out/providers/externalProvider.js'));

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

const MODEL = process.env.E62_MODEL || 'google/gemini-2.5-flash-lite';
const PER_CALL_TIMEOUT_MS = 180_000;
const CONCURRENCY = Number(process.env.E62_CONCURRENCY || 4);
const CORPUS = process.env.E62_CORPUS || '/workspace/awesome-copilot-fork/skills';
const LIMIT = process.env.E62_LIMIT ? Number(process.env.E62_LIMIT) : undefined;

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const DATA_DIR = path.join(ROOT, '.github/experiments/documentation-review/data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const OUT_FILE = path.join(DATA_DIR, `e62-singlepass-vs-multiwave-${STAMP}.json`);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

function coverageGapCount(diags) {
  return diags.filter((d) => d.code === 'coverage-gap').length;
}

async function runMode(provider, mode, skillName, text, filePath) {
  const engine = new Engine(provider, { analysisMode: mode, maxRetries: 0, filterFindings: true });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(engine.analyze({ text, filePath }), PER_CALL_TIMEOUT_MS, `${skillName}/${mode}`);
  } catch (err) {
    return { skillName, mode, error: err.message, elapsedMs: Date.now() - t0, total: 0, coverageGaps: 0, byCode: {} };
  }
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  const byCode = {};
  for (const d of diags) byCode[d.code] = (byCode[d.code] || 0) + 1;
  return {
    skillName, mode, error: null, elapsedMs: Date.now() - t0,
    total: diags.length, coverageGaps: coverageGapCount(diags), byCode,
  };
}

// Collect skills
const skills = [];
for (const entry of fs.readdirSync(CORPUS, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const p = path.join(CORPUS, entry.name, 'SKILL.md');
  if (fs.existsSync(p)) skills.push({ name: entry.name, path: p });
}
if (LIMIT) skills.length = Math.min(skills.length, LIMIT);
console.error(`Corpus: ${skills.length} skills from ${CORPUS}`);
console.error(`Model: ${MODEL} | modes: single vs multiWave | concurrency: ${CONCURRENCY}`);

const results = [];
let done = 0;
async function worker() {
  while (true) {
    const skill = skills.shift();
    if (!skill) return;
    const text = fs.readFileSync(skill.path, 'utf8');
    const provider = new OpenRouterProvider({ apiKey, model: MODEL });
    const single = await runMode(provider, 'single', skill.name, text, skill.path);
    const multi = await runMode(provider, 'multiWave', skill.name, text, skill.path);
    results.push({ single, multi });
    done += 1;
    console.error(`[${done}/${skills.length}] ${skill.name}: single=${single.total} (cov ${single.coverageGaps}) | multi=${multi.total} (cov ${multi.coverageGaps})`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

// Aggregate
const agg = { single: { total: 0, coverageGaps: 0, byCode: {} }, multi: { total: 0, coverageGaps: 0, byCode: {} } };
const errors = [];
for (const r of results) {
  for (const mode of ['single', 'multi']) {
    const res = r[mode];
    if (res.error) { errors.push({ skill: res.skillName, mode, error: res.error }); continue; }
    agg[mode].total += res.total;
    agg[mode].coverageGaps += res.coverageGaps;
    for (const [code, c] of Object.entries(res.byCode)) agg[mode].byCode[code] = (agg[mode].byCode[code] || 0) + c;
  }
}

const summary = {
  model: MODEL, captured_at: new Date().toISOString(),
  per_skill: results, aggregate: agg, errors,
};
fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2));

console.error('\n=== AGGREGATE (all skills) ===');
console.error(`single:    total=${agg.single.total}  coverage_gaps=${agg.single.coverageGaps}`);
console.error(`multiWave: total=${agg.multi.total}  coverage_gaps=${agg.multi.coverageGaps}`);
console.error(`ratio single/multi total: ${(agg.single.total / Math.max(1, agg.multi.total)).toFixed(2)}x`);
console.error(`ratio single/multi coverage: ${(agg.single.coverageGaps / Math.max(1, agg.multi.coverageGaps)).toFixed(2)}x`);
console.error(`\nFull results: ${OUT_FILE}`);
