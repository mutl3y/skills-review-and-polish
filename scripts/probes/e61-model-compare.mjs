#!/usr/bin/env node
// scripts/probes/e61-model-compare.mjs
/**
 * E61 model comparison under schema mode.
 *
 * Runs each candidate model against the same 2-3 production skills, then
 * aggregates per-code finding counts. Lets us see if a cheaper model
 * (e.g. meta-llama/llama-3.1-8b-instruct at $0.05/$0.08) gives equivalent
 * detection quality to gemini-2.5-flash-lite on real user-facing skills.
 *
 * Output: logs/e61-model-compare.json (machine-readable)
 *         logs/e61-model-compare.log (human-readable, streamed)
 *
 * Usage:
 *   node scripts/probes/e61-model-compare.mjs
 *
 * Models and skills are hardcoded below; tweak as needed.
 */
import fs from 'node:fs';
import path from 'node:path';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

const { Engine } = await import('../../out/core/index.js');
const { OpenRouterProvider } = await import('../../out/providers/externalProvider.js');

const CORPUS_BASE = '/workspace/awesome-copilot-fork/skills';

const MODELS = [
  { id: 'google/gemini-2.5-flash-lite',          role: 'baseline (current default)',  inPerM: 0.10, outPerM: 0.40 },
  { id: 'meta-llama/llama-3.1-8b-instruct',     role: 'schema-unlocked cheapest',     inPerM: 0.05, outPerM: 0.08 },
  { id: 'mistralai/ministral-3b-2512',         role: 'symmetric cheapest',           inPerM: 0.10, outPerM: 0.10 },
  { id: 'bytedance-seed/seed-1.6-flash',       role: 'E27 #3 (100% recall, 0 FP)',   inPerM: 0.075, outPerM: 0.30 },
];

const SKILLS = [
  // Smaller first to verify the path quickly; quality-playbook is intentionally
  // huge (~300KB / ~75k tokens) — it stresses both context handling AND
  // provider per-call timeouts, so we always include it.
  { name: 'context-map',                  bytes: 1146 },
  { name: 'sql-optimization',             bytes: 9255 },
  { name: 'quality-playbook',             bytes: 294426 },
];

const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 600_000; // 10 min — quality-playbook is ~75k tokens,
                                  // smaller models (nemotron, qwen-coder) need
                                  // longer per-wave under schema mode

// Per-skill response budget: 2× the analyzer's new 200K-char / ~50K-token
// effective context, capped at 16K. Quality-playbook at 294K bytes ≈ 73K
// tokens of input needs ~14K output tokens to fully populate the schema
// (8 keys with multiple findings each). Smaller skills need less; we use
// 2× input as a safe upper bound.
function budgetForSkill(skill) {
  const ctxTokens = Math.ceil(skill.bytes / 4);
  // 2× context, but the provider's 16K cap is the ceiling and 2K is the floor.
  const desired = Math.max(2048, Math.min(16384, Math.ceil(ctxTokens * 0.4)));
  return desired;
}
const MAX_RETRIES = 0;
const STRUCTURED_OUTPUT = 'schema'; // already the default in our providers

function estimateCost(model, totalOutputTok) {
  return (model.inPerM * 0 + model.outPerM * totalOutputTok) / 1_000_000;
}

async function analyzeSkill(model, skill) {
  const skillPath = path.join(CORPUS_BASE, skill.name, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    return { error: `missing: ${skillPath}` };
  }
  const text = fs.readFileSync(skillPath, 'utf8');
  const maxTokens = budgetForSkill(skill);
  const provider = new OpenRouterProvider({
    apiKey,
    model: model.id,
    deepModel: 'deepseek/deepseek-chat-v3',
    maxTokens,
    maxRetries: MAX_RETRIES,
    structuredOutput: STRUCTURED_OUTPUT,
    requestTimeoutMs: 300000,
  });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
  });
  const t0 = Date.now();
  try {
    const out = await Promise.race([
      engine.analyze({ text, filePath: skillPath }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT after ${PER_CALL_TIMEOUT_MS}ms`)), PER_CALL_TIMEOUT_MS)
      ),
    ]);
    const elapsed = Date.now() - t0;
    const findings = Array.isArray(out) ? out : (out.diagnostics ?? []);
    const counts = {};
    for (const f of findings) counts[f.code] = (counts[f.code] || 0) + 1;
    const bySeverity = { error: 0, warning: 0, info: 0, hint: 0 };
    for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    return {
      ok: true,
      elapsed,
      maxTokens,
      findings: findings.length,
      counts,
      bySeverity,
    };
  } catch (e) {
    return { ok: false, elapsed: Date.now() - t0, maxTokens, error: e.message };
  }
}

console.log(`E61 model comparison (schema mode)`);
console.log(`Schema: ${STRUCTURED_OUTPUT}`);
console.log(`Models: ${MODELS.length}`);
console.log(`Skills: ${SKILLS.length}`);
console.log(`Total runs: ${MODELS.length * SKILLS.length}\n`);

const results = {};
const totals = {};

for (const model of MODELS) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`MODEL: ${model.id}`);
  console.log(`  role: ${model.role}`);
  console.log(`  pricing: $${model.inPerM}/$${model.outPerM} per 1M tokens (in/out)`);
  console.log('='.repeat(72));
  results[model.id] = {};
  totals[model.id] = { findings: 0, elapsed: 0, errors: 0 };
  for (const skill of SKILLS) {
    process.stdout.write(`  ${skill.name.padEnd(30)} ... `);
    const r = await analyzeSkill(model, skill);
    if (r.ok) {
      const topCodes = Object.entries(r.counts).sort((a,b) => b[1]-a[1]).slice(0, 4)
        .map(([k,v]) => `${k}=${v}`).join(', ');
      console.log(`OK  ${r.findings.toString().padStart(3)} findings  ${(r.elapsed/1000).toFixed(1).padStart(6)}s  budget=${r.maxTokens}  [${topCodes}]`);
      results[model.id][skill.name] = r;
      totals[model.id].findings += r.findings;
      totals[model.id].elapsed += r.elapsed;
    } else {
      console.log(`FAIL  ${(r.elapsed/1000).toFixed(1)}s  budget=${r.maxTokens}  ${r.error}`);
      results[model.id][skill.name] = r;
      totals[model.id].errors++;
    }
  }
  console.log(`  ---`);
  console.log(`  totals: ${totals[model.id].findings} findings across ${SKILLS.length} skills in ${(totals[model.id].elapsed/1000).toFixed(1)}s`);
}

// Final summary
console.log(`\n${'='.repeat(72)}`);
console.log(`SUMMARY (per-model totals across both skills)`);
console.log('='.repeat(72));
console.log(`${'Model'.padEnd(50)} ${'Findings'.padStart(10)} ${'Errors'.padStart(8)} ${'Elapsed'.padStart(10)}`);
for (const model of MODELS) {
  const t = totals[model.id];
  console.log(`${model.id.padEnd(50)} ${t.findings.toString().padStart(10)} ${t.errors.toString().padStart(8)} ${((t.elapsed/1000).toFixed(1)+'s').padStart(10)}`);
}

// Per-skill comparison table
console.log(`\n${'='.repeat(72)}`);
console.log(`PER-SKILL FINDING COUNTS`);
console.log('='.repeat(72));
for (const skill of SKILLS) {
  console.log(`\n${skill.name}:`);
  console.log(`  ${'Model'.padEnd(50)} ${'Findings'.padStart(10)}`);
  for (const model of MODELS) {
    const r = results[model.id][skill.name];
    if (r?.ok) {
      console.log(`  ${model.id.padEnd(50)} ${r.findings.toString().padStart(10)}`);
    } else {
      console.log(`  ${model.id.padEnd(50)} ${'ERR'.padStart(10)}`);
    }
  }
}

// Save JSON
const jsonOut = {
  captured_at: new Date().toISOString(),
  schema_mode: STRUCTURED_OUTPUT,
  models: MODELS,
  skills: SKILLS,
  results,
  totals,
};
fs.writeFileSync('logs/e61-model-compare.json', JSON.stringify(jsonOut, null, 2));
console.log(`\nFull results: logs/e61-model-compare.json`);