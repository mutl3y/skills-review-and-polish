#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('/workspace/skills-review-and-polish/out/core/index.js');
const { OpenRouterProvider } = await import('/workspace/skills-review-and-polish/out/providers/externalProvider.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY required'); process.exit(1); }

const FIXTURES = [
  { name: 'test-coverage-gaps', path: 'tests/fixtures/primary/test-coverage-gaps/SKILL.md', expected: 13 },
  { name: 'test-coverage-gaps-hard', path: 'tests/fixtures/adversarial/test-coverage-gaps-hard/SKILL.md', expected: 15 },
];

const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const N = 3;
const PER_CALL_TIMEOUT_MS = 180_000;
const BATCH_SIZE = 2;

function withTimeout(p, ms, l) {
  return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`TIMEOUT ${ms}ms ${l}`)), ms))]);
}

async function analyzeOne(text, filePath) {
  const provider = new OpenRouterProvider({ apiKey, model: MODEL });
  const engine = new Engine(provider, { analysisMode: 'multiWave', analysisWaves: ALL_WAVES, maxRetries: 0 });
  let out;
  try {
    out = await withTimeout(engine.analyze({ text, filePath }), PER_CALL_TIMEOUT_MS, filePath);
  } catch (e) {
    return { error: e.message };
  }
  return Array.isArray(out) ? out : (out.diagnostics || []);
}

const results = [];
let done = 0;
const totalRuns = FIXTURES.length * N;
async function runBatch(jobs) {
  const out = await Promise.all(jobs.map((j) => j()));
  for (const r of out) results.push(r);
  done += jobs.length;
  process.stderr.write(`[${done}/${totalRuns}] completed\n`);
}

const jobs = [];
for (const fx of FIXTURES) {
  const text = fs.readFileSync(path.join('/workspace/skills-review-and-polish', fx.path), 'utf8');
  for (let run = 1; run <= N; run++) {
    jobs.push(async () => {
      const findings = await analyzeOne(text, fx.path);
      return {
        fixture: fx.name, run,
        total: findings.length,
        cov: findings.filter(f => f.code === 'coverage-gap').length,
        amb: findings.filter(f => f.code === 'ambiguity-llm').length,
        cont: findings.filter(f => f.code === 'contradiction' || f.code === 'contradiction-related').length,
      };
    });
  }
}
for (let i = 0; i < jobs.length; i += BATCH_SIZE) await runBatch(jobs.slice(i, i + BATCH_SIZE));

process.stderr.write(`\n=== E38 RESULTS — coverage rule fix ===\n\n`);
for (const fx of FIXTURES) {
  const runs = results.filter(r => r.fixture === fx.name);
  const covs = runs.map(r => r.cov).sort((a, b) => a - b);
  const median = covs[Math.floor(covs.length / 2)];
  process.stderr.write(`${fx.name}: expected ${fx.expected}, runs=[${covs.join(',')}], median=${median}\n`);
}
