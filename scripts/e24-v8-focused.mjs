#!/usr/bin/env node
/**
 * E24: Re-measure v8 documentation-review skill with focused multiWave
 * after resolving the D8 vs C2/C3/C4 and D9.3 vs D9.4 contradiction
 * cluster from E22.
 *
 * Predictions:
 * - contradiction count: 5 (v7) → 0-1 (v8). The D8 (Stylistic Rewrite)
 *   fix removes the L88 contradiction; the D8 (Factual Fix) vs C2/C3
 *   clarification removes the L85 + L121 + L125 cluster; the D9.3/D9.4
 *   exception clause removes the L105 contradiction.
 * - ambiguity-llm count: 13 (v7) → ~10 (v8). The D8 rewrite tightens
 *   the SHAPE vs CONSTRAINT distinction, which should reduce ambiguity
 *   around "what is a permitted Modification" in a few places.
 * - Grade: should improve from the v7 B- (under-counted) to v8 B+ or A-
 *   with focused-mode re-grade, because the 5 contradiction findings
 *   are the heaviest signal in the v7 set.
 *
 * Cost: 1 LLM call (6 wave calls). ~$0.005. ~10s.
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

const MODEL = 'google/gemini-2.5-flash-lite';
const LOG_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'logs');
const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = path.join(LOG_DIR, `e24-v8-focused-${stamp}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E24 v8 focused multiWave started ${new Date().toISOString()} ===\n`);

const SKILL_PATH = path.join(
  __dirname,
  '..',
  '.github',
  'experiments',
  'documentation-review',
  'versions',
  'v8',
  'SKILL.md',
);

const text = fs.readFileSync(SKILL_PATH, 'utf8');
process.stderr.write(`Loaded v8 SKILL.md (${text.split('\n').length} lines)\n`);

const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];

// Use the new analysisWaves API (E21) — cleaner than enabledWaves + multiWave.
const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const engine = new Engine(provider, {
  analysisMode: 'multiWave',
  analysisWaves: ALL_WAVES,
  maxRetries: 0,
});

const t0 = Date.now();
let out;
try {
  out = await engine.analyze({ text, filePath: SKILL_PATH });
} catch (err) {
  process.stderr.write(`FAIL: ${err.message}\n`);
  process.exit(1);
}
const elapsedMs = Date.now() - t0;
const diags = Array.isArray(out) ? out : (out.diagnostics || []);
process.stderr.write(`Engine returned ${diags.length} findings in ${elapsedMs}ms\n`);

// Group by code
const byCode = {};
const bySeverity = { error: 0, warning: 0, info: 0, hint: 0 };
for (const d of diags) {
  byCode[d.code] = (byCode[d.code] || 0) + 1;
  bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
}

process.stderr.write(`\n=== E24 v8 RESULTS ===\n`);
process.stderr.write(`Total findings: ${diags.length}\n`);
process.stderr.write(`By code:\n`);
for (const [code, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
  process.stderr.write(`  ${code}: ${count}\n`);
}
process.stderr.write(`By severity: ${JSON.stringify(bySeverity)}\n`);

// Show the contradiction findings in detail
const contradictions = diags.filter(d => d.code === 'contradiction' || d.code === 'contradiction-related');
process.stderr.write(`\nContradiction findings (${contradictions.length}):\n`);
for (const c of contradictions) {
  process.stderr.write(`--- L${(c.range?.start?.line ?? 0) + 1} [${c.code}]: ${String(c.message).slice(0, 300)}\n`);
}

// Persist raw output
const outFile = path.join(DATA_DIR, `e24-v8-focused-${stamp}.json`);
const summary = {
  skill: 'v8',
  model: MODEL,
  analysisMode: 'multiWave',
  analysisWaves: ALL_WAVES,
  total_findings: diags.length,
  by_code: byCode,
  by_severity: bySeverity,
  findings: diags.map(d => ({
    code: d.code,
    severity: d.severity,
    line: (d.range?.start?.line ?? 0) + 1,
    message: String(d.message).slice(0, 500),
    relevantText: d.relevantText,
  })),
  elapsed_ms: elapsedMs,
  captured_at: new Date().toISOString(),
};
fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
process.stderr.write(`\nResults written to ${outFile}\n`);

// Compare to v7 baseline
process.stderr.write(`\n=== COMPARISON: v7 (E22) vs v8 (E24) ===\n`);
process.stderr.write(`Total: v7=33 vs v8=${diags.length} (${diags.length - 33 >= 0 ? '+' : ''}${diags.length - 33})\n`);
process.stderr.write(`Contradiction: v7=5 (2+3) vs v8=${contradictions.length}\n`);
process.stderr.write(`Ambiguity: v7=13 vs v8=${(byCode['ambiguity-llm'] || 0)}\n`);
process.stderr.write(`Hygiene: v7=13 vs v8=${(byCode['hygiene-non-actionable-preamble'] || 0) + (byCode['hygiene-redundant-instruction'] || 0) + (byCode['hygiene-vague-cognitive-directive'] || 0) + (byCode['hygiene-over-specification'] || 0)}\n`);
