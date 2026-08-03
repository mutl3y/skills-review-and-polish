/**
 * Experiment loop for the documentation-review skill.
 *
 * Runs the analyzer on a list of skill files using a single LLM call per file
 * (analysisMode: 'single') with a configurable cooldown to avoid rate limits.
 * Writes findings to a JSON file for later delta comparison.
 *
 * Usage:
 *   node scripts/experiment-loop.mjs \
 *     --label v3-baseline \
 *     --input .github/experiments/documentation-review/versions/v3/SKILL.md \
 *     --output .github/experiments/documentation-review/data/v3-baseline.json
 *
 * The --input argument can be a file or a directory; if a directory is given,
 * every *.md / *.SKILL.md file inside is analyzed.
 *
 * Provider: OpenRouter via OPENROUTER_API_KEY.
 * Analysis mode: single (1 LLM call per file).
 * Cooldown: 5s between calls (matches MCP ANALYZE_COOLDOWN_MS).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Args ─────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}
const LABEL = arg('--label', `run-${new Date().toISOString().slice(0, 19)}`);
const INPUT = arg('--input', null);
const OUTPUT = arg('--output', null);
const COOLDOWN_MS = parseInt(arg('--cooldown-ms', '5000'), 10);
const MODEL = arg('--model', 'gpt-4o-mini');

if (!INPUT || !OUTPUT) {
  console.error('Usage: node scripts/experiment-loop.mjs --label <name> --input <path> --output <path> [--cooldown-ms 5000] [--model gpt-4o-mini]');
  process.exit(1);
}

// ── Env ──────────────────────────────────────────────────────────────────────
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

// ── Provider / engine ────────────────────────────────────────────────────────
const { Engine } = await import('../out/core/index.js');
const { OpenRouterProvider } = await import('../out/providers/externalProvider.js');

const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const engine = new Engine(provider, {
  analysisMode: 'single',          // 1 LLM call per file — cheapest mode
  enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
  scoreSamples: 1,
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: false,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Input resolution ─────────────────────────────────────────────────────────
function collectInputs(p) {
  const stat = fs.statSync(p);
  if (stat.isFile()) return [p];
  const out = [];
  for (const name of fs.readdirSync(p)) {
    const full = path.join(p, name);
    if (fs.statSync(full).isDirectory()) out.push(...collectInputs(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out.sort();
}
const inputs = collectInputs(INPUT);

// ── Infra codes (filtered out of "real" findings) ────────────────────────────
const INFRA_CODES = new Set([
  'llm-error', 'llm-parse-error', 'llm-disabled',
  'llm-loop-detected', 'high-complexity', 'limited-coverage',
  'contradiction-related',
]);
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, warning: 3, low: 4, info: 5 };

// ── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();
  const allFindings = [];
  let totalLlmCalls = 0;
  let rateLimited = 0;
  let failed = 0;

  console.error(`\n=== Experiment loop: ${LABEL} ===`);
  console.error(`Inputs: ${inputs.length} file(s)`);
  console.error(`Mode: single | Model: ${MODEL} | Cooldown: ${COOLDOWN_MS}ms\n`);

  for (let i = 0; i < inputs.length; i++) {
    const file = inputs[i];
    const rel = path.relative(process.cwd(), file);
    const text = fs.readFileSync(file, 'utf8');
    const fileStart = Date.now();

    process.stderr.write(`[${i + 1}/${inputs.length}] ${rel} (${text.length} chars)... `);

    try {
      const results = await engine.analyze({ text, filePath: file });
      totalLlmCalls += 1;
      const findings = results.filter(r => !INFRA_CODES.has(r.code));
      const inf = results.find(r => r.code === 'llm-rate-limited');
      if (inf) rateLimited += 1;

      const elapsed = ((Date.now() - fileStart) / 1000).toFixed(1);
      process.stderr.write(`${findings.length} findings (${elapsed}s)\n`);

      for (const r of findings) {
        allFindings.push({
          file: rel,
          code: r.code,
          severity: r.severity,
          line: r.range?.start?.line ?? null,
          message: String(r.message ?? '').slice(0, 400),
          suggestion: r.suggestion ? String(r.suggestion).slice(0, 300) : '',
        });
      }
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`ERROR: ${msg.slice(0, 100)}\n`);
    }

    if (i < inputs.length - 1) await sleep(COOLDOWN_MS);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const byCode = {};
  for (const f of allFindings) byCode[f.code] = (byCode[f.code] || 0) + 1;
  const bySeverity = {};
  for (const f of allFindings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;

  const output = {
    label: LABEL,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    inputs: inputs.map(p => path.relative(process.cwd(), p)),
    config: { mode: 'single', model: MODEL, cooldown_ms: COOLDOWN_MS },
    stats: {
      total_findings: allFindings.length,
      llm_calls: totalLlmCalls,
      rate_limited_files: rateLimited,
      failed_files: failed,
      by_code: byCode,
      by_severity: bySeverity,
    },
    findings: allFindings.sort((a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
      || a.code.localeCompare(b.code)
      || a.file.localeCompare(b.file)
    ),
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));

  console.error(`\n=== Summary ===`);
  console.error(`LLM calls: ${totalLlmCalls}`);
  console.error(`Findings: ${allFindings.length} | Rate-limited files: ${rateLimited} | Failed: ${failed}`);
  console.error(`By severity: ${JSON.stringify(bySeverity)}`);
  console.error(`By code: ${JSON.stringify(byCode)}`);
  console.error(`\nWrote: ${OUTPUT}\n`);

  // Also dump the human summary table to stdout for easy copy-paste
  console.log(`\n## ${LABEL}\n`);
  console.log(`- Files: ${inputs.length}`);
  console.log(`- LLM calls: ${totalLlmCalls}`);
  console.log(`- Findings: ${allFindings.length}`);
  console.log(`- Rate-limited: ${rateLimited}, Failed: ${failed}\n`);
  console.log(`| Code | Count |`);
  console.log(`| --- | --- |`);
  for (const [code, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
    console.log(`| ${code} | ${count} |`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
