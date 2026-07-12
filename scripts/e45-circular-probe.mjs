#!/usr/bin/env node
/**
 * E45: Quick probe — circular detection on test-circular-hard.
 * Validates the v2 hygiene prompt fix (3-hop + near-synonym + tautological patterns).
 *
 * Cost: 1 fixture × 3 runs × 1 wave = 3 LLM calls ≈ $0.001
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
const FIXTURE = 'tests/fixtures/adversarial/test-circular-hard/SKILL.md';
const EXPECTED = 10;

const fullPath = path.join(__dirname, '..', FIXTURE);
const text = fs.readFileSync(fullPath, 'utf8');

console.log(`=== E45 circular probe on test-circular-hard ===`);
console.log(`Model: ${MODEL}, N=${N_RUNS}, expected circular: ${EXPECTED}\n`);

const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const engine = new Engine(provider, {
  analysisMode: 'multiWave',
  analysisWaves: ['hygiene'],
  maxRetries: 0,
});

const counts = [];
for (let i = 1; i <= N_RUNS; i++) {
  const t0 = Date.now();
  try {
    const out = await engine.analyze({ text, filePath: fullPath });
    const diags = Array.isArray(out) ? out : (out.diagnostics || []);
    const circs = diags.filter(f => f.code === 'hygiene-circular-definition');
    counts.push(circs.length);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Run ${i} (${elapsed}s): ${circs.length} circular (${diags.length} total findings)`);
    if (circs.length > 0) {
      circs.slice(0, 5).forEach(c => {
        const lineStr = c.line ? `L${c.line}: ` : '';
        console.log(`  - ${lineStr}"${(c.relevant_text || c.text || c.message || '').slice(0, 100)}..."`);
      });
      if (circs.length > 5) console.log(`  ... and ${circs.length - 5} more`);
    }
  } catch (err) {
    counts.push(null);
    console.log(`Run ${i}: ERROR ${err.message.slice(0, 80)}`);
  }
}
const valid = counts.filter(c => c !== null);
if (valid.length === 0) {
  console.log(`No successful runs`);
} else {
  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const status = median >= EXPECTED ? '✓ PASS' : median >= EXPECTED * 0.5 ? '⚠ PARTIAL' : '✗ FAIL';
  console.log(`\nMedian: ${median}/${EXPECTED} (runs: [${counts.join(',')}]) ${status}`);
}
