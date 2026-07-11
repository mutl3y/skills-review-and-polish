/**
 * E19: Focused-mode re-test of the 2 E12-N3 outliers that E18 didn't cover.
 *
 * E18 (scripts/e18-focused-suite.mjs) already showed focused mode lifts
 * test-cognitive-structural, test-circular-hard, test-dead-hard, and
 * test-mixed-hard from 0-22% to 80-100% in-cat detection. The 2
 * E12-N3 outliers that E18 didn't cover are:
 *
 *   - test-instruction-quality (15 expected, E12-N3 detected 18 with
 *     single mode — already at 53% in-cat, not an underperformer but
 *     worth confirming focused mode doesn't regress)
 *   - test-contradictions-hard (15 expected, E12-N3 detected 21 with
 *     single mode — 70% in-cat, also not an underperformer but worth
 *     confirming)
 *
 * The user's intuition is: if these 2 also jump to 90%+ in-cat with
 * focused mode, then ALL 4+2 E12 underperformers were single-mode
 * dilution, fully retiring the E7 paper analysis.
 *
 * Cost: 6 LLM calls on Gemini Flash Lite. ~$0.005. ~30 seconds.
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
const N = 3;
const COOLDOWN_MS = 0;
const LOG_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'logs');
const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `e19-focused-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E19 focused-mode started ${new Date().toISOString()} ===\n`);

// Map fixture -> (waves to enable, expected count, expected code prefix)
const FIXTURES = [
  {
    path: 'tests/fixtures/primary/test-instruction-quality/SKILL.md',
    enabledWaves: ['contradictions', 'ambiguities', 'structural', 'coverage', 'hygiene', 'persona'],
    expected_count: 15,
    expected_cat: 'mixed (instruction-quality covers all categories)',
  },
  {
    path: 'tests/fixtures/adversarial/test-contradictions-hard/SKILL.md',
    enabledWaves: ['contradictions'],
    expected_count: 15,
    expected_cat: 'contradiction',
  },
];

const INFRA_CODES = new Set([
  'llm-error', 'llm-parse-error', 'llm-disabled',
  'llm-loop-detected', 'high-complexity', 'limited-coverage',
  'contradiction-related', 'llm-rate-limited',
]);

const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const results = [];
let totalCalls = 0;
let totalFailed = 0;
let totalRateLimited = 0;

for (const fixtureSpec of FIXTURES) {
  const fixtureName = path.basename(path.dirname(fixtureSpec.path));
  const absPath = path.join(__dirname, '..', fixtureSpec.path);
  const text = fs.readFileSync(absPath, 'utf8');

  process.stderr.write(`\n=== Fixture: ${fixtureName} (${fixtureSpec.enabledWaves.join('+')}) ===\n`);

  const perRunResults = [];

  for (let run = 1; run <= N; run++) {
    // Use E21 analysisWaves API — cleaner than analysisMode + enabledWaves
    const engine = new Engine(provider, {
      analysisWaves: fixtureSpec.enabledWaves,
      maxRetries: 0,
    });

    try {
      const out = await engine.analyze({ text, filePath: absPath });
      const diags = Array.isArray(out) ? out : (out.diagnostics || []);
      totalCalls++;
      const rateLimited = diags.some(d => d.code === 'llm-rate-limited');
      if (rateLimited) totalRateLimited++;

      const summary = countByCode(diags);
      process.stderr.write(`  Run ${run}: ${diags.length} findings ${rateLimited ? '[RATE-LIMITED]' : ''}\n`);
      for (const [code, count] of Object.entries(summary)) {
        process.stderr.write(`    ${code}: ${count}\n`);
      }

      // Persist the run output
      const outFile = path.join(DATA_DIR, `e19-${fixtureName}-run${run}.json`);
      fs.writeFileSync(outFile, JSON.stringify({ fixture: fixtureName, run, diags, summary }, null, 2));

      perRunResults.push({ run, total: diags.length, summary, rateLimited, diags });
    } catch (err) {
      totalFailed++;
      process.stderr.write(`  Run ${run}: FAILED - ${err.message}\n`);
      perRunResults.push({ run, total: 0, summary: {}, error: err.message });
    }

    if (COOLDOWN_MS > 0 && run < N) {
      await new Promise(r => setTimeout(r, COOLDOWN_MS));
    }
  }

  // Compute median total + in-category analysis
  const totals = perRunResults.map(r => r.total).sort((a, b) => a - b);
  const median = N % 2 === 1
    ? totals[Math.floor(N / 2)]
    : (totals[N / 2 - 1] + totals[N / 2]) / 2;

  // Count in-category: any finding whose code matches the expected_cat
  // For E19, in-category = all 6 waves since both fixtures are mixed/contradiction
  const inCatByRun = perRunResults.map(r => {
    if (r.rateLimited) return null;
    return r.diags.filter(d => !INFRA_CODES.has(d.code) && isInCategory(d, fixtureSpec)).length;
  });
  const validInCat = inCatByRun.filter(v => v !== null);
  const medianInCat = validInCat.length === 0 ? 0
    : validInCat.sort((a, b) => a - b)[Math.floor(validInCat.length / 2)];

  results.push({
    fixture: fixtureName,
    enabledWaves: fixtureSpec.enabledWaves,
    expected_count: fixtureSpec.expected_count,
    expected_cat: fixtureSpec.expected_cat,
    per_run_totals: perRunResults.map(r => r.total),
    per_run_in_cat: inCatByRun,
    median_total: median,
    median_in_cat: medianInCat,
    in_cat_rate: fixtureSpec.expected_count > 0
      ? (medianInCat / fixtureSpec.expected_count * 100).toFixed(1) + '%'
      : 'N/A',
    rate_limited: perRunResults.some(r => r.rateLimited),
  });
}

function isInCategory(d, fixtureSpec) {
  // For test-contradictions-hard, in-category = contradiction + contradiction-related
  // (both are classified as contradictions by the post-processor)
  if (fixtureSpec.path.includes('test-contradictions-hard')) {
    return d.code === 'contradiction' || d.code === 'contradiction-related';
  }
  // For test-instruction-quality, all non-infra codes are in-category
  return !INFRA_CODES.has(d.code);
}

function countByCode(diags) {
  const counts = {};
  for (const d of diags) {
    counts[d.code] = (counts[d.code] || 0) + 1;
  }
  return counts;
}

// Persist summary
const summaryFile = path.join(DATA_DIR, 'e19-focused-summary.json');
fs.writeFileSync(summaryFile, JSON.stringify({
  model: MODEL,
  n: N,
  total_calls: totalCalls,
  total_failed: totalFailed,
  total_rate_limited: totalRateLimited,
  results,
  completed: new Date().toISOString(),
}, null, 2));

process.stderr.write(`\n=== E19 SUMMARY ===\n`);
process.stderr.write(`Total calls: ${totalCalls}\n`);
process.stderr.write(`Failed: ${totalFailed}\n`);
process.stderr.write(`Rate-limited: ${totalRateLimited}\n`);
process.stderr.write(`\nResults:\n`);
console.table(results.map(r => ({
  fixture: r.fixture,
  expected: r.expected_count,
  median: r.median_total,
  median_in_cat: r.median_in_cat,
  in_cat_rate: r.in_cat_rate,
})));

console.log(`\nSummary written to: ${summaryFile}`);
console.log(`Logs: ${LOG_FILE}`);
