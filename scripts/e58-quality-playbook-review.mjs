#!/usr/bin/env node
/**
 * E58: Deep review of quality-playbook (B grade, 0 E11 findings)
 *
 * Scans the 2738-line skill with the E56 config and reviews EVERY finding
 * to verify they are real (not noise).
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

const STANDARD_MODEL = 'gemini-2.5-flash-lite';
const DEEP_MODEL = 'deepseek/deepseek-chat-v3';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 300_000;  // 5 min for the large doc

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

const skillPath = '/workspace/awesome-copilot-fork/skills/quality-playbook/SKILL.md';
const text = fs.readFileSync(skillPath, 'utf8');
console.log(`Loaded quality-playbook (${text.length} chars, ${text.split('\n').length} lines)`);

const provider = new OpenRouterProvider({
  apiKey,
  model: STANDARD_MODEL,
  deepModel: DEEP_MODEL,
});
const engine = new Engine(provider, {
  analysisMode: 'multiWave',
  analysisWaves: ALL_WAVES,
  maxRetries: 0,
});

console.log(`\nRunning analysis with model=${STANDARD_MODEL}, deepModel=${DEEP_MODEL}...`);
const t0 = Date.now();
let out;
try {
  out = await withTimeout(
    engine.analyze({ text, filePath: skillPath }),
    PER_CALL_TIMEOUT_MS,
    'quality-playbook',
  );
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
const findings = Array.isArray(out) ? out : (out.diagnostics || []);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s. ${findings.length} findings.`);

// Group by code
const byCode = {};
for (const f of findings) {
  if (!byCode[f.code]) byCode[f.code] = [];
  byCode[f.code].push(f);
}

console.log(`\n=== Findings by code ===`);
for (const [code, fs] of Object.entries(byCode).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${code.padEnd(35)}: ${fs.length}`);
}

// Print every finding
console.log(`\n=== ALL ${findings.length} FINDINGS ===\n`);
for (let i = 0; i < findings.length; i++) {
  const f = findings[i];
  const line = f.range?.start?.line || '?';
  const code = f.code || '?';
  const msg = (f.message || '').slice(0, 250);
  const sugg = f.suggestion ? ` | Sugg: ${f.suggestion.slice(0, 100)}` : '';
  console.log(`#${i + 1} [${code}] L${line}: ${msg}${sugg}`);
  console.log(`---`);
}

// Persist
const outFile = path.join('/workspace/skills-review-and-polish/.github/experiments/documentation-review/data', 'e58-quality-playbook.json');
fs.writeFileSync(outFile, JSON.stringify({
  skill: 'quality-playbook',
  standard_model: STANDARD_MODEL,
  deep_model: DEEP_MODEL,
  text_length: text.length,
  text_lines: text.split('\n').length,
  elapsed_ms: Date.now() - t0,
  total_findings: findings.length,
  by_code: Object.fromEntries(Object.entries(byCode).map(([k, v]) => [k, v.length])),
  findings,
  captured_at: new Date().toISOString(),
}, null, 2));
console.log(`\nFull results: ${outFile}`);
