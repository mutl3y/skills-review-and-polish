#!/usr/bin/env node
/**
 * E40e: Real-world skill evaluation.
 * Runs the analyzer (multiWave, qwen3-coder-30b + E40d v4 prompt) on a single
 * real-world skill file and reports the findings.
 *
 * Usage: node scripts/e40e-realworld-skill.mjs <path-to-SKILL.md>
 *
 * Cost: ~$0.02 per scan (6 waves × 1 run)
 * Runtime: ~1-2 min
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

const skillPath = process.argv[2];
if (!skillPath) {
  console.error('Usage: node scripts/e40e-realworld-skill.mjs <path-to-SKILL.md>');
  process.exit(1);
}
const fullPath = path.resolve(skillPath);
if (!fs.existsSync(fullPath)) {
  console.error(`File not found: ${fullPath}`);
  process.exit(1);
}

const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const text = fs.readFileSync(fullPath, 'utf8');
const fileLines = text.split('\n').length;
const fileBytes = text.length;

console.log(`=== E40e: real-world skill evaluation ===`);
console.log(`File: ${fullPath}`);
console.log(`Size: ${fileLines} lines, ${fileBytes} bytes\n`);

const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const engine = new Engine(provider, {
  analysisMode: 'multiWave',
  maxRetries: 0,
});

const t0 = Date.now();
let out;
try {
  out = await engine.analyze({ text, filePath: fullPath });
} catch (err) {
  console.error(`Analysis failed: ${err.message}`);
  process.exit(1);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const diags = Array.isArray(out) ? out : (out.diagnostics || []);

// Persist raw findings to data/
const dataDir = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const skillName = path.basename(path.dirname(fullPath));
const outFile = path.join(dataDir, `e40e-${skillName}-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  prompt_version: 'e40d-v4',
  file: fullPath,
  lines: fileLines,
  bytes: fileBytes,
  elapsed_s: parseFloat(elapsed),
  findings: diags,
  captured_at: new Date().toISOString(),
}, null, 2));
console.log(`Persisted: ${outFile}\n`);

const codeCounts = {};
const severityCounts = {};
for (const f of diags) {
  codeCounts[f.code] = (codeCounts[f.code] || 0) + 1;
  severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
}

console.log(`Completed in ${elapsed}s — ${diags.length} findings`);
console.log(`\nBy code:`);
for (const [code, count] of Object.entries(codeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${code.padEnd(40)} ${count}`);
}
console.log(`\nBy severity:`);
for (const [sev, count] of Object.entries(severityCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${sev.padEnd(10)} ${count}`);
}

console.log(`\n=== All findings ===`);
for (const f of diags) {
  const line = f.line ? `L${f.line.toString().padStart(4)}: ` : '     ';
  const sev = (f.severity || '?').padEnd(7);
  const code = (f.code || '?').padEnd(35);
  const text_ = (f.text || f.message || '').slice(0, 100);
  console.log(`${line}[${sev}] ${code} ${text_}`);
}
