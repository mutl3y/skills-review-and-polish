#!/usr/bin/env node
/**
 * E40f: Multi-skill batch evaluator.
 * Runs the analyzer (E40d v4 prompt) on a curated set of awesome-copilot skills
 * and produces a summary report.
 *
 * Usage: node scripts/e40f-multi-skill-batch.mjs
 *
 * Skills evaluated (by line count, picked to span small/medium/large):
 *   - quality-playbook (2738 lines, the hardest real-world skill)
 *   - ai-prompt-engineering-safety-review
 *   - agent-supply-chain
 *   - agent-governance
 *   - appinsights-instrumentation
 *
 * Cost: ~5 × $0.02 = $0.10
 * Runtime: ~5-10 min
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('../out/core/index.js');
const { OpenRouterProvider } = await import('../out/providers/externalProvider.js');
const { BatchAwareOpenRouterProvider } = await import('../out/providers/batchAwareProvider.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

// When BATCH_API=1, the waves of each skill are submitted as a single
// OpenRouter Batch API job (plan step 5) instead of sequential chat
// completions. Falls back to single-request for non-batch-capable models.
const USE_BATCH_API = process.env.BATCH_API === '1';

const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const SKILLS_ROOT = '/workspace/awesome-copilot-fork/skills';
const TARGETS = [
  'quality-playbook',
  'ai-prompt-engineering-safety-review',
  'agent-supply-chain',
  'agent-governance',
  'appinsights-instrumentation',
];

const dataDir = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const baseProvider = new OpenRouterProvider({ apiKey, model: MODEL });
const provider = USE_BATCH_API
  ? new BatchAwareOpenRouterProvider({ provider: baseProvider, modelId: MODEL, flushSize: 6 })
  : baseProvider;

const summary = [];

for (const skillName of TARGETS) {
  const skillPath = path.join(SKILLS_ROOT, skillName, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    console.log(`SKIP ${skillName}: file not found`);
    continue;
  }
  const text = fs.readFileSync(skillPath, 'utf8');
  const fileLines = text.split('\n').length;
  console.log(`\n=== ${skillName} (${fileLines} lines) ===`);
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    maxRetries: 0,
  });
  const t0 = Date.now();
  try {
    const out = await engine.analyze({ text, filePath: skillPath });
    if (USE_BATCH_API && provider instanceof BatchAwareOpenRouterProvider) {
      await provider.flush();
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const diags = Array.isArray(out) ? out : (out.diagnostics || []);
    const codeCounts = {};
    for (const f of diags) codeCounts[f.code] = (codeCounts[f.code] || 0) + 1;
    console.log(`  ${elapsed}s — ${diags.length} findings`);
    for (const [code, count] of Object.entries(codeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${code.padEnd(40)} ${count}`);
    }
    summary.push({ skill: skillName, lines: fileLines, elapsed_s: parseFloat(elapsed), total: diags.length, code_counts: codeCounts });
    // Persist
    const outFile = path.join(dataDir, `e40f-${skillName}-${stamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
      model: MODEL,
      prompt_version: 'e40d-v4',
      file: skillPath,
      lines: fileLines,
      elapsed_s: parseFloat(elapsed),
      findings: diags,
      captured_at: new Date().toISOString(),
    }, null, 2));
    console.log(`  Persisted: ${path.basename(outFile)}`);
  } catch (err) {
    console.log(`  ERROR: ${err.message.slice(0, 100)}`);
    summary.push({ skill: skillName, lines: fileLines, error: err.message });
  }
}

console.log(`\n=== Summary ===`);
console.log(`${'Skill'.padEnd(45)} ${'Lines':>6} ${'Time':>6} ${'Total':>6}  Top codes`);
for (const s of summary) {
  const topCodes = s.error ? 'ERR' : Object.entries(s.code_counts).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([c,n]) => `${c.split('-')[0]}:${n}`).join(' ');
  console.log(`${s.skill.padEnd(45)} ${s.lines.toString().padStart(6)} ${(s.elapsed_s || 0).toFixed(1).padStart(5)}s ${(s.total || 0).toString().padStart(6)}  ${topCodes}`);
}
