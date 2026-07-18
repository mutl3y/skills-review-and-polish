#!/usr/bin/env node
/**
 * E61: Current-analyzer validation on real production skills.
 *
 * This is the companion check to E50 calibration. Calibration measures recall
 * against labeled fixtures; this script checks whether recent prompt/analyzer
 * changes create useful findings or noisy false positives on real skills.
 *
 * Usage:
 *   node scripts/e61-production-current-validation.mjs
 *   SKILLS=context-map,sql-optimization node scripts/e61-production-current-validation.mjs
 *
 * Output:
 *   .github/experiments/documentation-review/data/e61-production-current-*.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('../out/core/index.js');
const { OpenRouterProvider } = await import('../out/providers/externalProvider.js');
const { resolveContextLength } = await import('../out/modelCatalog.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const responseHealth = {
  salvageRecoveries: 0,
  nonStopFinishReasons: 0,
  finishReasonErrors: 0,
  finishReasonLength: 0,
  deepFallbacks: 0,
  providerErrors: 0,
};
function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  const text = typeof chunk === 'string' ? chunk : chunk?.toString?.() ?? '';
  responseHealth.salvageRecoveries += countOccurrences(text, 'salvageTruncatedJSON');
  responseHealth.nonStopFinishReasons += countOccurrences(text, 'non-stop finish reason');
  responseHealth.finishReasonErrors += countOccurrences(text, '"finishReason":"error"');
  responseHealth.finishReasonLength += countOccurrences(text, '"finishReason":"length"');
  responseHealth.deepFallbacks += countOccurrences(text, 'deep tier failed; retrying with standard tier');
  responseHealth.providerErrors += countOccurrences(text, 'callLLM: provider error');
  return originalStderrWrite(chunk, ...args);
};

const CORPUS_BASE = process.env.CORPUS_BASE || '/workspace/awesome-copilot-fork/skills';
const MODEL = process.env.ANALYSIS_MODEL || 'google/gemini-2.5-flash-lite';
const DEEP_MODEL = process.env.DEEP_MODEL || 'deepseek/deepseek-chat-v3';
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 16384);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 0);
const STRUCTURED_OUTPUT = process.env.STRUCTURED_OUTPUT === '1';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120_000);
const PER_CALL_TIMEOUT_MS = Number(process.env.PER_CALL_TIMEOUT_MS || 240_000);
// Adaptive response-token budgeting (plan item 3 / adaptive two-budget clamp).
// ON by default so long-output waves (e.g. ambiguities) are not silently
// truncated at the fixed 16384 cap. Disable with ADAPTIVE_RESPONSE_TOKENS=0.
const ADAPTIVE_RESPONSE_TOKENS = process.env.ADAPTIVE_RESPONSE_TOKENS !== '0';
const ADAPTIVE_MAX_RESPONSE_TOKENS = Number(process.env.ADAPTIVE_MAX_RESPONSE_TOKENS || 131_072);
const ADAPTIVE_MIN_RESPONSE_TOKENS = Number(process.env.ADAPTIVE_MIN_RESPONSE_TOKENS || 16_384);
const ADAPTIVE_CHARS_PER_TOKEN = Number(process.env.ADAPTIVE_CHARS_PER_TOKEN || 4);
// SCORE_SAMPLES: run each skill N times to measure the production-skill noise
// floor (variance budget). Default 1 preserves the original single-pass behavior.
const SCORE_SAMPLES = Math.max(1, Number(process.env.SCORE_SAMPLES || 1));
const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];

// Severity weights used for the noise-floor totalPenalty metric (mirrors
// scripts/probes/noise-floor-10x.mjs so labeled-fixture and production floors
// are comparable).
const SEV = { error: 4, warning: 3, hint: 2, info: 1 };

const DEFAULT_SKILLS = [
  'context-map',
  'sql-optimization',
  'quality-playbook',
  'audit-integrity',
  'structured-autonomy-plan',
];

const REVIEW_CODES = new Set([
  'ambiguity-llm',
  'hygiene-missing-agent',
  'hygiene-vague-cognitive-directive',
  'hygiene-vague-directive',
  'hygiene-over-specification',
  'hygiene-dead-instruction',
  'hygiene-circular-definition',
  'cognitive-priority-conflict',
  'cognitive-delegated-decision',
  'cognitive-deep-decision-tree',
  'cognitive-sequencing',
  'cognitive-logical-inversion',
  'llm-parse-error',
]);

// Resolve the real input context length for the configured tiers so the
// analyzer scales its document budget to the model instead of falling back to
// the conservative 200K-char budget (which silently truncates large skills to
// head/tail excerpts). Mirrors the MCP server's createDefaultEngine wiring:
// OpenRouter catalog -> committed fixture -> static table. Falls back to 1M if
// resolution fails for every tier (matches e50's pragmatic default).
const CONTEXT_LENGTH = await (async () => {
  const resolved = await Promise.all([
    MODEL ? resolveContextLength(MODEL).catch(() => undefined) : Promise.resolve(undefined),
    DEEP_MODEL ? resolveContextLength(DEEP_MODEL).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const values = resolved
    .filter((r) => r && typeof r.contextLength === 'number')
    .map((r) => r.contextLength);
  return values.length > 0 ? Math.min(...values) : 1_000_000;
})();
console.log(`contextLength=${CONTEXT_LENGTH} (resolved for ${MODEL} / ${DEEP_MODEL})`);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms (${label})`)), ms)),
  ]);
}

function skillPathFor(skill) {
  if (skill.endsWith('/SKILL.md') || path.isAbsolute(skill)) return path.resolve(skill);
  return path.join(CORPUS_BASE, skill, 'SKILL.md');
}

function countByCode(findings) {
  const counts = {};
  for (const f of findings) counts[f.code] = (counts[f.code] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function compactFinding(f) {
  return {
    code: f.code,
    severity: f.severity,
    line: (f.range?.start?.line ?? 0) + 1,
    message: f.message,
    relevantText: f.relevantText,
    suggestion: f.suggestion,
  };
}

async function runOne(skill) {
  const skillPath = skillPathFor(skill);
  if (!fs.existsSync(skillPath)) {
    return { skill, path: skillPath, error: `not found: ${skillPath}` };
  }

  const text = fs.readFileSync(skillPath, 'utf8');
  const provider = new OpenRouterProvider({
    apiKey,
    model: MODEL,
    deepModel: DEEP_MODEL,
    maxTokens: MAX_TOKENS,
    maxRetries: MAX_RETRIES,
    contextLength: CONTEXT_LENGTH,
    structuredOutput: STRUCTURED_OUTPUT,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    adaptiveMaxTokens: ADAPTIVE_RESPONSE_TOKENS,
    adaptiveMaxTokensCap: ADAPTIVE_MAX_RESPONSE_TOKENS,
    minAdaptiveTokens: ADAPTIVE_MIN_RESPONSE_TOKENS,
    adaptiveCharsPerToken: ADAPTIVE_CHARS_PER_TOKEN,
  });
  const engine = new Engine(provider, {
    analysisMode: 'multiWave',
    enabledWaves: ALL_WAVES,
    analysisWaves: ALL_WAVES,
    scoreSamples: 1,
    fixStrategy: 'subtractive',
    fixSemanticCheck: false,
    fixSelfCritique: false,
    fixReferenceGrounding: true,
    filterFindings: true,
  });

  const t0 = Date.now();
  const runs = [];
  try {
    for (let sample = 1; sample <= SCORE_SAMPLES; sample++) {
      const out = await withTimeout(
        engine.analyze({ text, filePath: skillPath }),
        PER_CALL_TIMEOUT_MS,
        `${skill}#${sample}`,
      );
      const findings = Array.isArray(out) ? out : (out.diagnostics || []);
      const totalPenalty = findings.reduce((s, f) => s + (SEV[f.severity] || 1), 0);
      runs.push({
        sample,
        totalFindings: findings.length,
        totalPenalty,
        byCode: countByCode(findings),
      });
      if (sample === 1) {
        // Keep the full finding detail only for the first sample to bound
        // artifact size; later samples are summarized by penalty/count.
        runs[0].findings = findings.map(compactFinding);
        runs[0].reviewFindings = findings.filter(f => REVIEW_CODES.has(f.code)).map(compactFinding);
      }
    }
    const penalties = runs.map(r => r.totalPenalty).sort((a, b) => a - b);
    const counts = runs.map(r => r.totalFindings).sort((a, b) => a - b);
    const range = penalties[penalties.length - 1] - penalties[0];
    const median = penalties[Math.floor(penalties.length / 2)];
    const first = runs[0];
    return {
      skill,
      path: skillPath,
      bytes: text.length,
      lines: text.split('\n').length,
      elapsedMs: Date.now() - t0,
      scoreSamples: SCORE_SAMPLES,
      totalFindings: first.totalFindings,
      byCode: first.byCode,
      reviewFindings: first.reviewFindings || [],
      findings: first.findings || [],
      noiseFloor: {
        penalties,
        counts,
        range,
        median,
        halfRangeMargin: Math.ceil(range / 2),
      },
    };
  } catch (err) {
    return {
      skill,
      path: skillPath,
      bytes: text.length,
      lines: text.split('\n').length,
      elapsedMs: Date.now() - t0,
      scoreSamples: SCORE_SAMPLES,
      error: err.message,
      runs,
    };
  }
}

const skills = (process.env.SKILLS || DEFAULT_SKILLS.join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

console.log('=== E61 production current validation ===');
console.log(`model=${MODEL}`);
console.log(`deepModel=${DEEP_MODEL}`);
console.log(`structuredOutput=${STRUCTURED_OUTPUT ? 'on' : 'off'}`);
console.log(`requestTimeoutMs=${REQUEST_TIMEOUT_MS}`);
console.log(`skills=${skills.join(', ')}`);
console.log('');

const results = [];
for (const skill of skills) {
  const result = await runOne(skill);
  results.push(result);
  if (result.error) {
    console.log(`${skill}: ERROR ${result.error}`);
    continue;
  }
  console.log(`${skill}: ${result.totalFindings} findings in ${(result.elapsedMs / 1000).toFixed(1)}s`);
  for (const [code, count] of Object.entries(result.byCode)) {
    console.log(`  ${code.padEnd(36)} ${count}`);
  }
  if (result.reviewFindings.length > 0) {
    console.log('  review samples:');
    for (const f of result.reviewFindings.slice(0, 10)) {
      const text = (f.relevantText || f.message || '').replace(/\s+/g, ' ').slice(0, 140);
      console.log(`    L${String(f.line).padStart(4)} ${f.code.padEnd(36)} ${text}`);
    }
  }
  if (result.noiseFloor) {
    const nf = result.noiseFloor;
    console.log(`  noise floor (N=${result.scoreSamples}): penalties=[${nf.penalties.join(', ')}] range=${nf.range} median=${nf.median} +${nf.halfRangeMargin}`);
  }
  console.log('');
}

const outFile = path.join(DATA_DIR, `e61-production-current-${STAMP}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  model: MODEL,
  deepModel: DEEP_MODEL,
  maxTokens: MAX_TOKENS,
  maxRetries: MAX_RETRIES,
  structuredOutput: STRUCTURED_OUTPUT,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  scoreSamples: SCORE_SAMPLES,
  corpusBase: CORPUS_BASE,
  capturedAt: new Date().toISOString(),
  responseHealth,
  results,
}, null, 2));

console.log(`Response health: salvage=${responseHealth.salvageRecoveries}, nonStopFinish=${responseHealth.nonStopFinishReasons}, finishError=${responseHealth.finishReasonErrors}, finishLength=${responseHealth.finishReasonLength}, deepFallback=${responseHealth.deepFallbacks}, providerError=${responseHealth.providerErrors}`);
console.log(`Full results: ${outFile}`);
setImmediate(() => process.exit(process.exitCode ?? 0));
