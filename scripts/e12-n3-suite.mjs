/**
 * E12-N3: Run the analyzer with N=3 on each of the 17 test fixtures
 * using google/gemini-2.5-flash-lite via OpenRouter.
 *
 * This establishes a stable baseline for the post-E14/E15 state with
 * the same noise-floor measurement methodology that the original E12
 * lacked (E12 was a single run per fixture).
 *
 * Total LLM calls: 17 fixtures × 3 runs = 51 calls.
 * Expected runtime: 1-5 minutes (OpenRouter has no rate limits; Gemini Flash
 * is very fast).
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
const N = 3;                    // median-of-3 per fixture
const COOLDOWN_MS = 0;          // OpenRouter has no rate limits; skip cooldown
const LOG_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'logs');
const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

// Redirect stderr to a timestamped log file
const LOG_FILE = path.join(LOG_DIR, `e12-n3-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E12-N3 started ${new Date().toISOString()} ===\n`);
process.stderr.write(`Model: ${MODEL} | N=3 | Cooldown: ${COOLDOWN_MS}ms (no rate limits)\n`);

const FIXTURES = [
  // Primary (9 files, including mcp-security-audit)
  'tests/fixtures/primary/mcp-security-audit/SKILL.md',
  'tests/fixtures/primary/test-ambiguities/SKILL.md',
  'tests/fixtures/primary/test-ambiguity-pub-and-empty/SKILL.md',
  'tests/fixtures/primary/test-cognitive-structural/SKILL.md',
  'tests/fixtures/primary/test-contradictions-direct/SKILL.md',
  'tests/fixtures/primary/test-contradictions-subtle/SKILL.md',
  'tests/fixtures/primary/test-coverage-gaps/SKILL.md',
  'tests/fixtures/primary/test-instruction-quality/SKILL.md',
  'tests/fixtures/primary/test-skill-itself-pub-ambiguity/SKILL.md',
  // Adversarial (7 files)
  'tests/fixtures/adversarial/test-ambiguities-hard/SKILL.md',
  'tests/fixtures/adversarial/test-circular-hard/SKILL.md',
  'tests/fixtures/adversarial/test-contradictions-hard/SKILL.md',
  'tests/fixtures/adversarial/test-coverage-gaps-hard/SKILL.md',
  'tests/fixtures/adversarial/test-dead-hard/SKILL.md',
  'tests/fixtures/adversarial/test-mixed-hard/SKILL.md',
  'tests/fixtures/adversarial/test-obligation-hard/SKILL.md',
];

const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const engine = new Engine(provider, {
  analysisMode: 'single',
  enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
  scoreSamples: 1,
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: false,
  filterFindings: true,
});

const SEVERITY_ORDER = { error: 15, warning: 6, info: 2, hint: 1 };
const INFRA_CODES = new Set([
  'llm-error', 'llm-parse-error', 'llm-disabled',
  'llm-loop-detected', 'high-complexity', 'limited-coverage',
  'contradiction-related', 'llm-rate-limited',
]);

function findCode(code) {
  return (d) => {
    const real = (d.findings || []).filter(f => !INFRA_CODES.has(f.code));
    const byCode = real.reduce((acc, f) => { acc[f.code] = (acc[f.code] || 0) + 1; return acc; }, {});
    return { total: real.length, byCode };
  };
}

function computeExpected(path) {
  const text = fs.readFileSync(path, 'utf8');
  const count = text.match(/\*\*Test metadata:\*\*\s*(\d+)/i)?.[1];
  const cat = text.match(/Expected analyzer category:\s*`([^`]+)`/i)?.[1]
    ?? text.match(/Expected categories:\s*`([^`]+)`/i)?.[1];
  return { count: count ? Number(count) : null, cat: cat ?? null };
}

async function main() {
  const startTime = Date.now();
  const allResults = [];   // { fixture, expected, runs: [{run, total, byCode, findings}], medians }
  let totalCalls = 0;
  let totalFailed = 0;
  let totalRateLimited = 0;

  for (let i = 0; i < FIXTURES.length; i++) {
    const fixture = FIXTURES[i];
    if (!fs.existsSync(fixture)) {
      process.stderr.write(`[${i + 1}/${FIXTURES.length}] ${fixture}: SKILL.md NOT FOUND, skipping\n`);
      continue;
    }

    const text = fs.readFileSync(fixture, 'utf8');
    const expected = computeExpected(fixture);
    process.stderr.write(`[${i + 1}/${FIXTURES.length}] ${fixture} (expected=${expected.count ?? '?'}, cat=${expected.cat ?? '?'})... `);

    const runs = [];
    const fixtureStart = Date.now();
    for (let run = 1; run <= N; run++) {
      const runStart = Date.now();
      try {
        const raw = await engine.analyze({ text, filePath: fixture });
        const isRL = raw.some(f => f.code === 'llm-rate-limited');
        if (isRL) totalRateLimited += 1;
        const stats = findCode(null)({ findings: raw });
        const findings = raw
          .filter(f => !INFRA_CODES.has(f.code))
          .map(f => ({
            code: f.code,
            severity: f.severity,
            line: f.range?.start?.line ?? null,
            message: String(f.message ?? '').slice(0, 400),
            suggestion: f.suggestion ? String(f.suggestion).slice(0, 300) : '',
          }));
        runs.push({
          run,
          total: stats.total,
          by_code: stats.byCode,
          findings,
          duration_ms: Date.now() - runStart,
        });
        totalCalls += 1;
        process.stderr.write(`r${run}:${stats.total} `);
      } catch (err) {
        totalFailed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`r${run}:ERR(${msg.slice(0, 50)}) `);
      }
    }

    // Compute medians per code
    const medians = {};
    if (runs.length > 0) {
      const allCodes = new Set();
      for (const r of runs) for (const c of Object.keys(r.by_code)) allCodes.add(c);
      for (const c of allCodes) {
        const counts = runs.map(r => r.by_code[c] || 0).sort((a, b) => a - b);
        const median = counts.length % 2 === 0
          ? Math.round((counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2)
          : counts[Math.floor(counts.length / 2)];
        medians[c] = median;
      }
    }
    const medianTotal = runs.length > 0
      ? Math.round(runs.map(r => r.total).sort((a, b) => a - b)[Math.floor(runs.length / 2)])
      : null;

    const elapsed = ((Date.now() - fixtureStart) / 1000).toFixed(1);
    process.stderr.write(`median:${medianTotal} (${elapsed}s)\n`);

    allResults.push({
      fixture,
      expected,
      runs,
      medians,
      median_total: medianTotal,
    });

    // Write per-fixture JSON
    const outFile = path.join(DATA_DIR, `e12-n3-${path.basename(path.dirname(fixture))}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
      label: `e12-n3-${path.basename(path.dirname(fixture))}`,
      started_at: new Date(fixtureStart).toISOString(),
      finished_at: new Date().toISOString(),
      input: fixture,
      expected,
      analyzer_config: { mode: 'single', model: MODEL, n: N, fixes_applied: ['E8', 'E10', 'E9', 'E11', 'E14', 'E15'] },
      runs,
      medians,
      median_total: medianTotal,
    }, null, 2));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.error(`\n=== E12-N3 Summary ===`);
  console.error(`Total LLM calls: ${totalCalls} (${totalFailed} failed, ${totalRateLimited} rate-limited)`);
  console.error(`Total time: ${totalTime}s`);
  console.error(`Log: ${LOG_FILE}`);

  // Summary table
  console.log(`\n## E12-N3 (google/gemini-2.5-flash-lite, N=3)\n`);
  console.log(`| Fixture | Expected | Median | R1 | R2 | R3 |`);
  console.log(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of allResults) {
    const fixtureName = r.fixture.replace('tests/fixtures/', '').replace('/SKILL.md', '');
    const exp = r.expected.count ?? '?';
    const r1 = r.runs[0]?.total ?? '-';
    const r2 = r.runs[1]?.total ?? '-';
    const r3 = r.runs[2]?.total ?? '-';
    console.log(`| ${fixtureName} | ${exp} | ${r.median_total ?? '-'} | ${r1} | ${r2} | ${r3} |`);
  }

  // Write summary JSON
  const summary = {
    label: 'e12-n3-summary',
    finished_at: new Date().toISOString(),
    analyzer_config: { mode: 'single', model: MODEL, n: N, fixes_applied: ['E8', 'E10', 'E9', 'E11', 'E14', 'E15'] },
    total_calls: totalCalls,
    total_failed: totalFailed,
    total_rate_limited: totalRateLimited,
    total_time_seconds: Number(totalTime),
    fixtures: allResults.map(r => ({
      fixture: r.fixture,
      expected: r.expected,
      runs: r.runs.map(run => ({ run: run.run, total: run.total, by_code: run.by_code, duration_ms: run.duration_ms })),
      medians: r.medians,
      median_total: r.median_total,
    })),
  };
  fs.writeFileSync(path.join(DATA_DIR, 'e12-n3-summary.json'), JSON.stringify(summary, null, 2));
  console.error(`\nWrote summary: ${path.join(DATA_DIR, 'e12-n3-summary.json')}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
