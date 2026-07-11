#!/usr/bin/env node
/**
 * E40c: Quick probe — ambiguity wave only on the two key fixtures.
 * Validates the v3 prompt fix (broader examples, default-to-flag).
 *
 * Cost: 2 fixtures × 3 runs × 1 wave = 6 LLM calls ≈ $0.002
 * Runtime: ~1 min
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

const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const N_RUNS = 3;

const FIXTURES = [
  { path: 'tests/fixtures/primary/test-contradictions-direct/SKILL.md', name: 'test-contradictions-direct', expected: 11 },
  { path: 'tests/fixtures/primary/test-ambiguities/SKILL.md', name: 'test-ambiguities', expected: 20 },
  { path: 'tests/fixtures/adversarial/test-ambiguities-hard/SKILL.md', name: 'test-ambiguities-hard', expected: 20 },
];

const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const engine = new Engine(provider, {
  analysisMode: 'multiWave',
  analysisWaves: ['ambiguities'],
  maxRetries: 0,
});

for (const fx of FIXTURES) {
  const fullPath = path.join(__dirname, '..', fx.path);
  if (!fs.existsSync(fullPath)) {
    console.log(`SKIP ${fx.name}: not found`);
    continue;
  }
  const text = fs.readFileSync(fullPath, 'utf8');
  console.log(`\n=== ${fx.name} (expected ${fx.expected}) ===`);
  const counts = [];
  for (let i = 1; i <= N_RUNS; i++) {
    const t0 = Date.now();
    try {
      const out = await engine.analyze({ text, filePath: fullPath });
      const diags = Array.isArray(out) ? out : (out.diagnostics || []);
      const ambs = diags.filter(f => f.code === 'ambiguity-llm');
      counts.push(ambs.length);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`Run ${i} (${elapsed}s): ${ambs.length} ambiguities`);
    } catch (err) {
      counts.push(null);
      console.log(`Run ${i}: ERROR ${err.message.slice(0, 80)}`);
    }
  }
  const valid = counts.filter(c => c !== null);
  if (valid.length === 0) {
    console.log(`No successful runs`);
    continue;
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const status = median >= fx.expected ? '✓ PASS' : median >= fx.expected * 0.5 ? '⚠ PARTIAL' : '✗ FAIL';
  console.log(`Median: ${median}/${fx.expected} (runs: [${counts.join(',')}]) ${status}`);
}
