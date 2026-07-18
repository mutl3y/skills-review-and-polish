// scripts/probes/noise-floor-direct.mjs
// Re-measure PENALTY_NOISE_MARGIN on the new no-truncation analyzer.
// The original +6 floor was measured under legacy 60K truncation.
// With whole-doc + reference-files, the floor may have shifted.
//
// Approach: load the same fixture 5 times, score each, capture the range
// of totalPenalty across the 5 runs. Compare against the baseline
// 30/32/38/38/42 (range 12, +6 floor) recorded in LEARNINGS.md.
// Citations:
//   docs/plan/LEARNINGS.md (the +6 floor)
//   docs/plan/archive/releases/20260716-release-readiness-remediation/plan.yaml
//     (follow_ups_added_2026_07_17_b: remeasure-noise-floor-after-truncation-fix)
//
// If range ≤ 12: floor unchanged → update constant/docs with negative-result
//                proof that the refactor didn't tighten the variance budget.
// If range > 12:  floor shifted → recompute margin and update both constant
//                 AND LEARNINGS.md atomically.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { OpenRouterProvider } = await import(path.join(ROOT, 'out', 'providers', 'externalProvider.js'));
const { Engine } = await import(path.join(ROOT, 'out', 'core', 'index.js'));

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY not set');
  process.exit(1);
}

const fixturePath = path.join(ROOT, 'tests', 'fixtures', 'clean', 'test-contradictions-direct.md');
if (!fs.existsSync(fixturePath)) {
  console.error('fixture not found:', fixturePath);
  process.exit(1);
}
const text = fs.readFileSync(fixturePath, 'utf8');

const provider = new OpenRouterProvider({
  apiKey,
  model: 'google/gemini-2.5-flash-lite',
  deepModel: 'deepseek/deepseek-chat-v3',
  contextLength: 1_000_000,
  structuredOutput: 'schema',
  requestTimeoutMs: 120_000,
  maxRetries: 0,
});

const N = Number(process.env.N || 5);
console.log(`=== noise-floor-direct: ${N} iterations of test-contradictions-direct ===`);
console.log(`model: google/gemini-2.5-flash-lite, structured=schema, post-processor=ON`);
console.log(`started ${new Date().toISOString()}`);

const totals = [];
for (let i = 1; i <= N; i++) {
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
    maxRetries: 0,
    filterFindings: true,
    scoreSamples: 1,
  });

  const t0 = Date.now();
  let findings = [];
  try {
    const out = await Promise.race([
      engine.analyze({ text, filePath: fixturePath }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT 240s')), 240_000)),
    ]);
    findings = Array.isArray(out) ? out : (out?.diagnostics || []);
  } catch (e) {
    console.error(`run ${i} failed:`, e.message);
    totals.push(null);
    continue;
  }

  // Compute a totalPenalty proxy: severity-weighted finding count
  const SEV = { error: 4, warning: 3, hint: 2, info: 1 };
  const total = findings.reduce((s, f) => s + (SEV[f.severity] || 1), 0);
  totals.push(total);
  console.log(`run ${i}: ${total} (${findings.length} findings, ${Date.now() - t0}ms)`);
}

const valid = totals.filter(t => t !== null);
const min = Math.min(...valid);
const max = Math.max(...valid);
const range = max - min;
console.log('');
console.log(`=== RESULT ===`);
console.log(`totals: [${totals.join(', ')}]`);
console.log(`range: ${range} (min=${min}, max=${max})`);
console.log(`baseline (LEARNINGS L8): 30,32,38,38,42 → range 12, +6 floor`);
console.log('');
if (range <= 12) {
  console.log(`VERDICT: range ${range} ≤ 12 — floor unchanged. Update LEARNINGS.md / noise-margin constant with the new data, no behavior change.`);
  console.log(`Suggested new floor: +(range/2) = +${Math.ceil(range/2)} (half-range, to maintain conservative margin)`);
} else {
  console.log(`VERDICT: range ${range} > 12 — floor has shifted. Update PENALTY_NOISE_MARGIN to ${Math.ceil(range/2)} and LEARNINGS.md atomically.`);
}
