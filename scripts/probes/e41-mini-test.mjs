// scripts/probes/e41-mini-test.mjs
// E41 mini: just test 1 fixture with M3 to verify it works
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const { Engine } = await import(path.join(ROOT, 'out', 'core', 'index.js'));
const { OpenRouterProvider } = await import('../../out/providers/externalProvider.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY required'); process.exit(1); }

const FIXTURE = 'tests/fixtures/primary/test-contradictions-direct/SKILL.md';
const MODEL = 'minimax/minimax-m3';
const N_RUNS = 3;
const PER_CALL_TIMEOUT_MS = 360_000;
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];

function withTimeout(p, ms, l) {
  return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`TIMEOUT ${ms}ms ${l}`)), ms))]);
}

async function runOne(text, filePath) {
  const provider = new OpenRouterProvider({ apiKey, model: MODEL });
  const engine = new Engine(provider, { analysisMode: 'multiWave', analysisWaves: ALL_WAVES, maxRetries: 0 });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(engine.analyze({ text, filePath }), PER_CALL_TIMEOUT_MS, filePath);
  } catch (e) {
    return { error: e.message, elapsedMs: Date.now() - t0 };
  }
  return { findings: Array.isArray(out) ? out : (out.diagnostics || []), elapsedMs: Date.now() - t0 };
}

const text = fs.readFileSync(path.join('/workspace/skills-review-and-polish', FIXTURE), 'utf8');
process.stderr.write('=== E41 mini: M3 on test-contradictions-direct ===\n');
const results = [];
for (let i = 1; i <= N_RUNS; i++) {
  const r = await runOne(text, FIXTURE);
  if (r.error) {
    process.stderr.write(`Run ${i}: ERROR ${r.error}\n`);
  } else {
    const byCode = {};
    for (const f of r.findings) byCode[f.code] = (byCode[f.code] || 0) + 1;
    process.stderr.write(`Run ${i}: ${r.findings.length} findings in ${(r.elapsedMs/1000).toFixed(1)}s\n  ${JSON.stringify(byCode)}\n`);
  }
  results.push(r);
}

process.stderr.write('\nSummary:\n');
const ambMedians = results.filter(r => !r.error).map(r => r.findings.filter(f => f.code === 'ambiguity-llm').length).sort((a,b) => a-b);
const conMedians = results.filter(r => !r.error).map(r => r.findings.filter(f => f.code === 'contradiction' || f.code === 'contradiction-related').length).sort((a,b) => a-b);
process.stderr.write(`contradiction median: ${conMedians[Math.floor(conMedians.length/2)]} (expected 15)\n`);
process.stderr.write(`ambiguity-llm median: ${ambMedians[Math.floor(ambMedians.length/2)]} (expected 11)\n`);

const outFile = 'logs/e41-m3-test-result.json';
fs.writeFileSync(outFile, JSON.stringify({model: MODEL, fixture: FIXTURE, results, captured_at: new Date().toISOString()}, null, 2));
process.stderr.write(`\nResult: ${outFile}\n`);
