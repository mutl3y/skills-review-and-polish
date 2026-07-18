#!/usr/bin/env node
// scripts/probes/e35b-v9.mjs
/**
 * E35b: Quick grade check on v9 (D9 precedence fix).
 *
 * Uses E35 script logic but only for v9.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('../../out/core/index.js');
const { OpenRouterProvider } = await import('../../out/providers/externalProvider.js');
const { scoreSkill, parseSkillType } = await import('../../out/core/scoring.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 180_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

async function runOne(text, filePath) {
  const provider = new OpenRouterProvider({ apiKey, model: MODEL });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
  });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(engine.analyze({ text, filePath }), PER_CALL_TIMEOUT_MS, 'v9');
  } catch (err) {
    return { error: err.message, elapsedMs: Date.now() - t0 };
  }
  return {
    elapsedMs: Date.now() - t0,
    findings: Array.isArray(out) ? out : (out.diagnostics || []),
  };
}

const v9Path = '../../.github/experiments/documentation-review/versions/v9/SKILL.md';
const text = fs.readFileSync(v9Path, 'utf8');
const lineCount = text.split('\n').length;
const result = await runOne(text, v9Path);

if (result.error) {
  console.log('Error:', result.error);
  process.exit(1);
}

const byCode = {};
for (const d of result.findings) byCode[d.code] = (byCode[d.code] || 0) + 1;
const fakeDiags = result.findings.map(f => ({
  code: f.code, severity: f.severity,
  range: f.range, message: f.message, analyzer: f.analyzer,
}));
const score = scoreSkill(fakeDiags, lineCount, parseSkillType('test'));

console.log(`\n=== v9 RESULTS ===\n`);
console.log(`Score: ${score.score}, Grade: ${score.grade}`);
console.log(`Total findings: ${result.findings.length}`);
console.log(`By code: ${JSON.stringify(byCode)}`);
console.log(`Lines: ${lineCount}, Time: ${(result.elapsedMs / 1000).toFixed(1)}s`);

console.log(`\nv8 score: 69 (C+)`);
console.log(`v9 score: ${score.score} (${score.grade})`);
console.log(`Delta: ${score.score - 69 >= 0 ? '+' : ''}${score.score - 69}`);

console.log(`\nv9 findings:`);
for (const f of result.findings) {
  const line = (f.range?.start?.line ?? 0) + 1;
  console.log(`  L${line} [${f.code}]: ${f.message.slice(0, 200)}`);
}
