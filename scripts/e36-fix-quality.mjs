#!/usr/bin/env node
/**
 * E36: Test fix quality with the new model and prompts.
 *
 * Runs the surgical fixer on a sample of E34 findings (the 15 baseline-fork
 * skills with single mode + qwen3-coder-30b + E33 prompts) and measures:
 * - How many findings are fixable (5 fixable codes)
 * - Whether the proposed fixes are real text edits (not "consider X")
 * - Whether the fixes preserve structure (no orphan lines, no dropped content)
 *
 * Cost: ~15 skills × ~5 fixable findings × 1 LLM call = ~75 LLM calls. ~$0.10.
 * Runtime: ~10 min.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('/workspace/skills-review-and-polish/out/core/index.js');
const { OpenRouterProvider } = await import('/workspace/skills-review-and-polish/out/providers/externalProvider.js');
const { SurgicalFixer, SURGICAL_FIXABLE_CODES } = await import('/workspace/skills-review-and-polish/out/core/fixer.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = '/workspace/skills-review-and-polish/.github/experiments/documentation-review/logs';
const DATA_DIR = '/workspace/skills-review-and-polish/.github/experiments/documentation-review/data';
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `e36-fix-quality-${STAMP}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E36 fix quality started ${new Date().toISOString()} ===\n`);

// 15 baseline-fork skills from E34
const BASELINE_SKILLS = [
  'acquire-codebase-knowledge', 'arize-trace', 'azure-role-selector', 'boost-prompt',
  'create-agentsmd', 'create-readme', 'datanalysis-credit-risk', 'github-actions-efficiency',
  'github-issues', 'java-mcp-server-generator', 'microsoft-agent-framework', 'phoenix-tracing',
  'quality-playbook', 'remember-interactive-programming', 'salesforce-apex-quality',
];

const MODEL = 'qwen/qwen3-coder-30b-a3b-instruct';
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];
const PER_CALL_TIMEOUT_MS = 180_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

async function analyze(skillText, skillPath) {
  const provider = new OpenRouterProvider({ apiKey, model: MODEL });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    analysisWaves: ALL_WAVES,
    maxRetries: 0,
  });
  const out = await withTimeout(
    engine.analyze({ text: skillText, filePath: skillPath }),
    PER_CALL_TIMEOUT_MS,
    skillPath,
  );
  return Array.isArray(out) ? out : (out.diagnostics || []);
}

async function fixOne(skillText, skillPath, diagnostic) {
  const provider = new OpenRouterProvider({ apiKey, model: MODEL });
  const fixer = new SurgicalFixer(provider);
  const t0 = Date.now();
  try {
    const result = await withTimeout(
      fixer.fixIssue(skillText, skillPath, diagnostic),
      PER_CALL_TIMEOUT_MS,
      `${skillPath}:${diagnostic.code}`,
    );
    return {
      accepted: result.accepted,
      reason: result.rejectReason,
      originalLen: skillText.length,
      newLen: result.fixed ? result.fixed.length : null,
      originalHasAnchor: skillText.includes(diagnostic.relevantText || ''),
      newHasAnchor: result.fixed ? !result.fixed.includes(diagnostic.relevantText || '') : null,
      fixLen: result.fixed ? result.fixed.length - skillText.length : 0,
      risks: result.risks,
      elapsedMs: Date.now() - t0,
    };
  } catch (err) {
    return { accepted: false, reason: err.message, elapsedMs: Date.now() - t0 };
  }
}

const CORPUS = '/workspace/awesome-copilot-fork/skills';
const results = [];
let totalFixes = 0, totalAccepted = 0, totalRejected = 0, totalNonFixable = 0;

for (const skillName of BASELINE_SKILLS) {
  const skillPath = path.join(CORPUS, skillName, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    process.stderr.write(`SKIP: ${skillName} (not found)\n`);
    continue;
  }
  const skillText = fs.readFileSync(skillPath, 'utf8');
  process.stderr.write(`\n=== ${skillName} ===\n`);

  let diagnostics;
  try {
    diagnostics = await analyze(skillText, skillPath);
  } catch (err) {
    process.stderr.write(`  analyze failed: ${err.message}\n`);
    continue;
  }

  // Filter to fixable
  const fixable = diagnostics.filter(d => SURGICAL_FIXABLE_CODES.has(d.code));
  totalFixes += fixable.length;
  totalNonFixable += diagnostics.length - fixable.length;

  if (fixable.length === 0) {
    process.stderr.write(`  no fixable findings (${diagnostics.length} non-fixable)\n`);
    continue;
  }

  // Cap at 3 fixes per skill to keep cost down
  const toFix = fixable.slice(0, 3);
  process.stderr.write(`  ${fixable.length} fixable, testing ${toFix.length}\n`);

  for (const d of toFix) {
    const r = await fixOne(skillText, skillPath, d);
    if (r.accepted) totalAccepted++;
    else totalRejected++;
    process.stderr.write(`  L${(d.range?.start?.line ?? 0) + 1} [${d.code}]: ${r.accepted ? '✓ ACCEPTED' : '✗ REJECTED'} (${r.reason?.slice(0, 50) || 'ok'}) fixLen=${r.fixLen || 0}\n`);
    results.push({ skill: skillName, finding: d, fix: r });
  }
}

process.stderr.write(`\n=== E36 SUMMARY ===\n`);
process.stderr.write(`Total findings: ${totalFixes + totalNonFixable}\n`);
process.stderr.write(`Fixable: ${totalFixes}\n`);
process.stderr.write(`Non-fixable: ${totalNonFixable}\n`);
process.stderr.write(`Accepted fixes: ${totalAccepted}\n`);
process.stderr.write(`Rejected fixes: ${totalRejected}\n`);
if (totalFixes > 0) {
  process.stderr.write(`Accept rate: ${(totalAccepted / (totalAccepted + totalRejected) * 100).toFixed(0)}%\n`);
}

const outFile = path.join(DATA_DIR, `e36-fix-quality-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  results,
  summary: { totalFixes, totalAccepted, totalRejected, totalNonFixable },
  captured_at: new Date().toISOString(),
}, null, 2));
process.stderr.write(`\nFull results: ${outFile}\n`);
process.stderr.write(`Log: ${LOG_FILE}\n`);
