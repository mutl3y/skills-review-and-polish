// scripts/probes/noise-floor-10x.mjs
// 10-iteration noise floor remeasure on the new whole-doc analyzer.
// Sample 5 is statistically thin; 10 lets us reject outliers (like the
// 750s timeout that hit run 3 of the 5x run) and see the real central
// tendency. Records each run's totalPenalty + finding count.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { OpenRouterProvider } = await import(path.join(ROOT, 'out', 'providers', 'externalProvider.js'));
const { Engine } = await import(path.join(ROOT, 'out', 'core', 'index.js'));

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'clean', 'test-contradictions-direct.md');
if (!fs.existsSync(fixturePath)) { console.error('fixture missing'); process.exit(1); }
const text = fs.readFileSync(fixturePath, 'utf8');

const provider = new OpenRouterProvider({
  apiKey,
  model: 'google/gemini-2.5-flash-lite',
  deepModel: 'deepseek/deepseek-chat-v3',
  contextLength: 1_000_000,
  structuredOutput: process.env.STRUCTURED_OUTPUT || 'schema',
  requestTimeoutMs: 120_000,
  maxRetries: 0,
});

const N = Number(process.env.N || 10);
console.log(`=== noise-floor-10x: ${N} iterations of test-contradictions-direct ===`);
console.log(`model: google/gemini-2.5-flash-lite, structured=${process.env.STRUCTURED_OUTPUT || 'schema'}, post-processor=ON`);
console.log(`started ${new Date().toISOString()}`);

const SEV = { error: 4, warning: 3, hint: 2, info: 1 };
const results = [];

for (let i = 1; i <= N; i++) {
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
    maxRetries: 0,
    filterFindings: true,
    scoreSamples: 1,
  });

  const t0 = Date.now();
  try {
    const out = await Promise.race([
      engine.analyze({ text, filePath: fixturePath }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT 240s')), 240_000)),
    ]);
    const findings = Array.isArray(out) ? out : (out?.diagnostics || []);
    const total = findings.reduce((s, f) => s + (SEV[f.severity] || 1), 0);
    results.push({ run: i, total, count: findings.length, elapsedMs: Date.now() - t0 });
    console.log(`run ${i}: totalPenalty=${total} (${findings.length} findings), ${Date.now() - t0}ms`);
  } catch (e) {
    results.push({ run: i, error: e.message, elapsedMs: Date.now() - t0 });
    console.log(`run ${i}: ERROR ${e.message}`);
  }
}

const valid = results.filter(r => !r.error).map(r => r.total);
const errors = results.filter(r => r.error);
console.log('');
console.log('=== SUMMARY ===');
console.log(`successful: ${valid.length} of ${N}`);
console.log(`errored: ${errors.length}`);
if (valid.length > 0) {
  valid.sort((a,b) => a-b);
  const min = valid[0], max = valid[valid.length-1];
  const range = max - min;
  const median = valid[Math.floor(valid.length/2)];
  console.log(`totals (sorted): [${valid.join(', ')}]`);
  console.log(`range: ${range}, median: ${median}`);
  console.log(`half-range margin: +${Math.ceil(range/2)}`);
  console.log('');
  console.log(`Baseline (LEARNINGS L8, legacy 60K-cap): totals 30,32,38,38,42, range 12, +6 floor`);
  if (errors.length > 0) {
    console.log(`Note: ${errors.length} run(s) timed out. The errored runs would have produced nonzero totals;`);
    console.log(`removing them biases the range downward. Real floor likely higher if we ran to completion.`);
  }
}
