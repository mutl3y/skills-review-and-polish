/**
 * E18: Focused-mode re-test for the 4 unlabeled underperformers.
 *
 * Uses `analysisWaves: [specific]` (E21 API) to fire ONLY the labeled
 * category for each fixture, with N=3 medians for statistical reliability.
 *
 * Why this is different from E12-N3:
 * - E12-N3 used `analysisMode: 'single'` which fires 1 LLM call with a
 *   5584-char combined prompt. The LLM has 1/6 attention on each
 *   category. For test-cognitive-structural, this gave 0/15 in-cat.
 * - E18 uses `analysisWaves: [specific]` (E21 API) which fires 1 LLM
 *   call per enabled wave with a focused 2274-4114 char prompt. The LLM
 *   has 100% attention on that one category.
 *
 * Predicted: 60-80% in-cat detection on the 4 unlabeled fixtures
 * (vs 0% with single mode).
 *
 * Cost: 21 LLM calls on Gemini Flash Lite. ~$0.01. ~2-3 minutes.
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

const LOG_FILE = path.join(LOG_DIR, `e18-focused-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E18 focused-mode started ${new Date().toISOString()} ===\n`);

// Map fixture -> (waves to enable, expected count, expected category)
const FIXTURES = [
  {
    path: 'tests/fixtures/primary/test-cognitive-structural/SKILL.md',
    enabledWaves: ['structural', 'persona'],  // 'structural' includes cognitive-* family
    expected_count: 15,
    expected_cat: 'mixed (cognitive+persona)',
  },
  {
    path: 'tests/fixtures/adversarial/test-circular-hard/SKILL.md',
    enabledWaves: ['hygiene'],  // circular is detected by hygiene-circular-definition
    expected_count: 10,
    expected_cat: 'hygiene-circular-definition',
  },
  {
    path: 'tests/fixtures/adversarial/test-dead-hard/SKILL.md',
    enabledWaves: ['hygiene'],  // dead is detected by hygiene-dead-instruction
    expected_count: 12,
    expected_cat: 'hygiene-dead-instruction',
  },
  {
    path: 'tests/fixtures/adversarial/test-mixed-hard/SKILL.md',
    enabledWaves: ['structural', 'persona', 'hygiene'],  // mixed
    expected_count: 16,
    expected_cat: 'mixed (cognitive+persona+structural)',
  },
];

// Map wave name to expected code
const WAVE_EXPECTED_CODE = {
  'structural': 'cognitive-',
  'persona': 'persona-',
  'hygiene': 'hygiene-',
};

const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const INFRA_CODES = new Set([
  'llm-error', 'llm-parse-error', 'llm-disabled',
  'llm-loop-detected', 'high-complexity', 'limited-coverage',
  'contradiction-related', 'llm-rate-limited',
]);

const results = [];
let totalCalls = 0;
let totalFailed = 0;

for (const fixtureSpec of FIXTURES) {
  if (!fs.existsSync(fixtureSpec.path)) {
    process.stderr.write(`SKIP: ${fixtureSpec.path} not found\n`);
    continue;
  }
  const text = fs.readFileSync(fixtureSpec.path, 'utf8');
  const name = path.basename(path.dirname(fixtureSpec.path));
  process.stderr.write(`\n[${name}] analysisWaves=${JSON.stringify(fixtureSpec.enabledWaves)} expected=${fixtureSpec.expected_count}\n`);

  // Configure engine for THIS fixture with the right waves (E21 analysisWaves API)
  const engine = new Engine(provider, {
    analysisWaves: fixtureSpec.enabledWaves,
    scoreSamples: 1,
    fixStrategy: 'subtractive',
    fixSemanticCheck: false,
    fixSelfCritique: false,
    fixReferenceGrounding: false,
    filterFindings: true,
  });

  const runs = [];
  const fixtureStart = Date.now();
  for (let run = 1; run <= N; run++) {
    const runStart = Date.now();
    try {
      const raw = await engine.analyze({ text, filePath: fixtureSpec.path });
      const real = raw.filter(f => !INFRA_CODES.has(f.code));
      // Count findings in any of the expected categories
      const inCatCount = real.filter(f =>
        fixtureSpec.enabledWaves.some(w =>
          WAVE_EXPECTED_CODE[w] && f.code.startsWith(WAVE_EXPECTED_CODE[w])
        )
      ).length;
      const findings = real.map(f => ({
        code: f.code,
        severity: f.severity,
        line: f.range?.start?.line ?? null,
        message: String(f.message ?? '').slice(0, 200),
      }));
      runs.push({
        run,
        total: real.length,
        in_cat: inCatCount,
        by_code: real.reduce((acc, f) => { acc[f.code] = (acc[f.code] || 0) + 1; return acc; }, {}),
        findings,
        duration_ms: Date.now() - runStart,
      });
      totalCalls += 1;
      process.stderr.write(`r${run}: total=${real.length} in-cat=${inCatCount} (${(inCatCount/fixtureSpec.expected_count*100).toFixed(0)}%) (${Date.now()-runStart}ms)\n`);
    } catch (err) {
      totalFailed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`r${run}: ERROR ${msg.slice(0, 100)}\n`);
    }
  }

  // Compute medians
  const totalSorted = [...runs.map(r => r.total)].sort((a, b) => a - b);
  const inCatSorted = [...runs.map(r => r.in_cat)].sort((a, b) => a - b);
  const medTotal = totalSorted[Math.floor(totalSorted.length / 2)];
  const medInCat = inCatSorted[Math.floor(inCatSorted.length / 2)];

  const elapsed = ((Date.now() - fixtureStart) / 1000).toFixed(1);
  process.stderr.write(`  median total=${medTotal} in-cat=${medInCat} (${(medInCat/fixtureSpec.expected_count*100).toFixed(0)}%) (${elapsed}s)\n`);

  results.push({
    fixture: fixtureSpec.path,
    name,
    enabled_waves: fixtureSpec.enabledWaves,
    expected: { count: fixtureSpec.expected_count, cat: fixtureSpec.expected_cat },
    runs,
    medians: { total: medTotal, in_cat: medInCat },
  });

  // Write per-fixture JSON
  const outFile = path.join(DATA_DIR, `e18-focused-${name}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    label: `e18-focused-${name}`,
    started_at: new Date(fixtureStart).toISOString(),
    finished_at: new Date().toISOString(),
    input: fixtureSpec.path,
    enabled_waves: fixtureSpec.enabledWaves,
    expected: fixtureSpec.expected,
    analyzer_config: { mode: 'multiWave', model: MODEL, n: N, fixes_applied: ['E8', 'E10', 'E9', 'E11', 'E14', 'E15'] },
    runs,
    medians: { total: medTotal, in_cat: medInCat },
  }, null, 2));
}

const totalStartTime = Date.now();

const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(0);
console.error(`\n=== E18 Summary ===`);
console.error(`Total LLM calls: ${totalCalls} (${totalFailed} failed)`);
console.error(`Total time: ${totalTime}s`);
console.error(`Log: ${LOG_FILE}`);

console.log(`\n## E18 focused-mode results (Gemini Flash Lite, N=3)\n`);
console.log(`| Fixture | enabledWaves | Expected | R1 | R2 | R3 | Median in-cat | % |`);
console.log(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
for (const r of results) {
  const r1 = r.runs[0]?.in_cat ?? '-';
  const r2 = r.runs[1]?.in_cat ?? '-';
  const r3 = r.runs[2]?.in_cat ?? '-';
  const pct = r.medians.in_cat / r.expected.count * 100;
  console.log(`| ${r.name} | ${r.enabled_waves.join(',')} | ${r.expected.count} | ${r1} | ${r2} | ${r3} | ${r.medians.in_cat} | ${pct.toFixed(0)}% |`);
}

// Write summary
const summary = {
  label: 'e18-focused-summary',
  finished_at: new Date().toISOString(),
  analyzer_config: { mode: 'multiWave', model: MODEL, n: N, fixes_applied: ['E8', 'E10', 'E9', 'E11', 'E14', 'E15'] },
  total_calls: totalCalls,
  total_failed: totalFailed,
  total_time_seconds: Number(totalTime),
  fixtures: results.map(r => ({
    name: r.name,
    enabled_waves: r.enabled_waves,
    expected: r.expected,
    runs: r.runs.map(run => ({ run: run.run, total: run.total, in_cat: run.in_cat, by_code: run.by_code, duration_ms: run.duration_ms })),
    medians: r.medians,
  })),
};
fs.writeFileSync(path.join(DATA_DIR, 'e18-focused-summary.json'), JSON.stringify(summary, null, 2));
console.error(`Wrote summary: ${path.join(DATA_DIR, 'e18-focused-summary.json')}`);
