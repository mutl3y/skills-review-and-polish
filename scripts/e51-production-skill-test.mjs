#!/usr/bin/env node
/**
 * E51: Test coverage prompt v2 on a few production skills.
 *
 * Compares the v0.1.36 baseline coverage prompt against the v2 candidate
 * on a small set of production skills (not 334 — just a few). This is
 * the production validation step before any shipping decision.
 *
 * Strategy: swap src/core/prompts/coverage.prompt between baseline and v2,
 * run the analyzer, then restore. The engine loads from out/core/prompts/
 * (compiled), so we swap both src and out copies.
 *
 * Cost: ~$0.05 for 4 skills × 2 prompt versions × 1 run × 6 waves
 * Runtime: ~5 min
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

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'logs');
const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `e51-production-test-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E51 production skill test started ${new Date().toISOString()} ===\n`);

// Pick a small set of production skills with known E30 baseline data
const SKILLS = [
  'sql-optimization',
  'salesforce-component-standards',
  'context-map',
  'cosmosdb-datamodeling',
];

const CORPUS_BASE = '/workspace/awesome-copilot-fork/skills';
const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 180_000;

const PROMPTS_DIR = path.join(__dirname, '..', 'src', 'core', 'prompts');
const OUT_PROMPTS_DIR = path.join(__dirname, '..', 'out', 'core', 'prompts');
const COVERAGE_PROMPT = path.join(PROMPTS_DIR, 'coverage.prompt');
const OUT_COVERAGE_PROMPT = path.join(OUT_PROMPTS_DIR, 'coverage.prompt');
const V2_PROMPT = path.join(PROMPTS_DIR, 'coverage.v2.prompt');
const BASELINE_BACKUP = path.join(PROMPTS_DIR, 'coverage.baseline.bak');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

async function runOne(skillName, runIdx) {
  const skillPath = path.join(CORPUS_BASE, skillName, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    return { skill: skillName, run: runIdx, error: `not found: ${skillPath}` };
  }
  const text = fs.readFileSync(skillPath, 'utf8');
  const provider = new OpenRouterProvider({ apiKey, model: MODEL });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
  });
  const t0 = Date.now();
  let out;
  try {
    out = await withTimeout(
      engine.analyze({ text, filePath: skillPath }),
      PER_CALL_TIMEOUT_MS,
      `${skillName} r${runIdx}`,
    );
  } catch (err) {
    return { skill: skillName, run: runIdx, error: err.message, elapsedMs: Date.now() - t0 };
  }
  const diags = Array.isArray(out) ? out : (out.diagnostics || []);
  return {
    skill: skillName,
    run: runIdx,
    elapsedMs: Date.now() - t0,
    findings: diags,
  };
}

function swapPrompt(sourcePath) {
  fs.copyFileSync(sourcePath, COVERAGE_PROMPT);
  if (fs.existsSync(OUT_PROMPTS_DIR)) {
    fs.copyFileSync(sourcePath, OUT_COVERAGE_PROMPT);
  }
}

async function runWithPrompt(promptLabel, promptSourcePath) {
  process.stderr.write(`\n--- Running with ${promptLabel} prompt ---\n`);
  swapPrompt(promptSourcePath);
  const results = [];
  for (const skill of SKILLS) {
    const r = await runOne(skill, 1);
    results.push({ ...r, prompt: promptLabel });
    process.stderr.write(`  ${skill}: ${r.error ? 'ERROR' : `${r.findings?.length || 0} findings`}\n`);
  }
  return results;
}

// Backup baseline first
if (!fs.existsSync(BASELINE_BACKUP)) {
  fs.copyFileSync(COVERAGE_PROMPT, BASELINE_BACKUP);
  process.stderr.write(`Backed up baseline coverage.prompt to coverage.baseline.bak\n`);
}

// Run baseline
const baselineResults = await runWithPrompt('baseline', BASELINE_BACKUP);

// Run v2
const v2Results = await runWithPrompt('v2', V2_PROMPT);

// Restore baseline
swapPrompt(BASELINE_BACKUP);
process.stderr.write(`\nRestored baseline coverage.prompt\n`);

// Compare
process.stderr.write(`\n=== E51 PRODUCTION SKILL COMPARISON ===\n\n`);
process.stderr.write(`${'Skill'.padEnd(35)} | ${'Baseline'.padStart(10)} | ${'v2'.padStart(10)} | ${'Delta'.padStart(10)} | Notes\n`);
process.stderr.write('-'.repeat(85) + '\n');

for (const skill of SKILLS) {
  const baseline = baselineResults.find(r => r.skill === skill);
  const v2 = v2Results.find(r => r.skill === skill);

  const baselineCount = baseline?.findings?.length || 0;
  const v2Count = v2?.findings?.length || 0;
  const delta = v2Count - baselineCount;
  const deltaStr = delta === 0 ? '0' : (delta > 0 ? `+${delta}` : `${delta}`);
  const note = baseline?.error || v2?.error ? 'ERROR' : '';

  process.stderr.write(
    `${skill.padEnd(35)} | ${baselineCount.toString().padStart(10)} | ${v2Count.toString().padStart(10)} | ${deltaStr.padStart(10)} | ${note}\n`,
  );
}

// Per-code breakdown
process.stderr.write(`\n=== PER-CODE BREAKDOWN ===\n\n`);
const codes = ['ambiguity-llm', 'coverage-gap', 'contradiction', 'hygiene-over-specification', 'hygiene-redundant-instruction', 'hygiene-missing-agent', 'cognitive-nested-conditions', 'cognitive-priority-conflict'];
for (const code of codes) {
  process.stderr.write(`\n${code}:\n`);
  for (const skill of SKILLS) {
    const baseline = baselineResults.find(r => r.skill === skill);
    const v2 = v2Results.find(r => r.skill === skill);
    const bCount = baseline?.findings?.filter(f => f.code === code).length || 0;
    const vCount = v2?.findings?.filter(f => f.code === code).length || 0;
    const delta = vCount - bCount;
    const deltaStr = delta === 0 ? '0' : (delta > 0 ? `+${delta}` : `${delta}`);
    process.stderr.write(`  ${skill.padEnd(35)} | baseline=${bCount} | v2=${vCount} | delta=${deltaStr}\n`);
  }
}

// Persist
const outFile = path.join(DATA_DIR, `e51-production-test-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  skills: SKILLS,
  baseline_results: baselineResults,
  v2_results: v2Results,
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
