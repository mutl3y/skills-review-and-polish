#!/usr/bin/env node
/**
 * E40b: Quick probe — ambiguity wave only on test-contradictions-direct.
 * Validates the prompt fix without burning 234 LLM calls.
 *
 * Cost: 3 runs × 1 wave = 3 LLM calls ≈ $0.001
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
const FIXTURE = 'tests/fixtures/primary/test-contradictions-direct/SKILL.md';
const EXPECTED_AMBIG = 11;

const fullPath = path.join(__dirname, '..', FIXTURE);
const text = fs.readFileSync(fullPath, 'utf8');

console.log(`=== E40b ambiguity probe on test-contradictions-direct ===`);
console.log(`Model: ${MODEL}, N=${N_RUNS}, expected ambig: ${EXPECTED_AMBIG}\n`);

const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const engine = new Engine(provider, {
  analysisMode: 'multiWave',
  analysisWaves: ['ambiguities'],  // ONLY the ambiguity wave
  maxRetries: 0,
});

const counts = [];
for (let i = 1; i <= N_RUNS; i++) {
  const t0 = Date.now();
  try {
    const out = await engine.analyze({ text, filePath: fullPath });
    const diags = Array.isArray(out) ? out : (out.diagnostics || []);
    const ambs = diags.filter(f => f.code === 'ambiguity-llm');
    counts.push(ambs.length);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Run ${i} (${elapsed}s): ${ambs.length} ambiguities (${diags.length} total findings)`);
    if (ambs.length > 0 && ambs.length <= 3) {
      ambs.forEach(a => {
        const lineStr = a.line ? `L${a.line}: ` : '';
        console.log(`  - ${lineStr}"${(a.text || a.message || '').slice(0, 80)}..."`);
      });
    } else if (ambs.length > 3) {
      ambs.slice(0, 3).forEach(a => {
        const lineStr = a.line ? `L${a.line}: ` : '';
        console.log(`  - ${lineStr}"${(a.text || a.message || '').slice(0, 80)}..."`);
      });
      console.log(`  ... and ${ambs.length - 3} more`);
    }
  } catch (err) {
    counts.push(null);
    console.log(`Run ${i}: ERROR ${err.message}`);
  }
}

const valid = counts.filter(c => c !== null);
const sorted = [...valid].sort((a, b) => a - b);
const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
console.log(`\nMedian: ${median}/${EXPECTED_AMBIG} (runs: [${counts.join(',')}])`);
console.log(median >= EXPECTED_AMBIG ? '✓ PASS' : median >= EXPECTED_AMBIG * 0.5 ? '⚠ PARTIAL' : '✗ FAIL');
