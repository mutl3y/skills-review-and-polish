/**
 * E12: Run the analyzer with all cumulative fixes (E8 + E10 + E9 + E11)
 * against all 17 test fixtures and capture findings for regression analysis.
 *
 * Usage: node scripts/e12-fixture-suite.mjs
 *
 * Output: .github/experiments/documentation-review/data/e12-*.json
 *
 * Each fixture is run in single mode with gpt-4o-mini and a 30s cooldown
 * to avoid rate limits. Total runtime ~9 minutes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('../out/core/index.js');
const { GitHubModelsProvider } = await import('../out/providers/externalProvider.js');

const apiKey = process.env.GITHUB_TOKEN;
if (!apiKey) {
  console.error('GITHUB_TOKEN is not set');
  process.exit(1);
}

const FIXTURE_ROOT = path.join(__dirname, '..', 'tests', 'fixtures');
const OUTPUT_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');
const LOG_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'logs');

// Redirect stderr to a timestamped log file so progress can be checked
// without consuming buffered output (which would otherwise balloon context).
const LOG_FILE = path.join(LOG_DIR, `e12-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E12 log started ${new Date().toISOString()} ===\n`);

function findFixtures(root) {
  const out = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(p);
      else if (entry.name === 'SKILL.md') out.push(p);
    }
  }
  visit(root);
  return out.sort();
}

const INFRA_CODES = new Set([
  'llm-error', 'llm-parse-error', 'llm-disabled',
  'llm-loop-detected', 'high-complexity', 'limited-coverage',
  'contradiction-related', 'llm-rate-limited',
]);
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, warning: 3, low: 4, info: 5 };

const provider = new GitHubModelsProvider({ apiKey, model: 'gpt-4o-mini' });
const engine = new Engine(provider, {
  analysisMode: 'single',
  enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
  scoreSamples: 1,
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: false,
  filterFindings: true, // E11: enable the new post-processor rules
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const COOLDOWN_MS = 30_000;

function extractMetadata(text) {
  const expectedCount = text.match(/\*\*Test metadata:\*\*\s*(\d+)/i)?.[1];
  const expectedCategory = text.match(/Expected analyzer category:\s*`([^`]+)`/i)?.[1]
    ?? text.match(/Expected categories:\s*`([^`]+)`/i)?.[1];
  return {
    expected_count: expectedCount ? Number(expectedCount) : null,
    expected_category: expectedCategory ?? null,
  };
}

async function main() {
  const fixtures = findFixtures(FIXTURE_ROOT);
  console.error(`\n=== E12 fixture suite: ${fixtures.length} files ===`);
  console.error(`Mode: single | Model: gpt-4o-mini | Cooldown: ${COOLDOWN_MS}ms\n`);

  const results = [];
  const startTime = Date.now();
  let totalFindings = 0;
  let totalRateLimited = 0;
  let totalFailed = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const file = fixtures[i];
    const rel = path.relative(process.cwd(), file);
    const text = fs.readFileSync(file, 'utf8');
    const fileStart = Date.now();
    const metadata = extractMetadata(text);

    process.stderr.write(`[${i + 1}/${fixtures.length}] ${rel} (${text.length} chars, expected=${metadata.expected_count ?? '?'})... `);

    try {
      const rawResults = await engine.analyze({ text, filePath: file });
      const findings = rawResults.filter(r => !INFRA_CODES.has(r.code));
      const inf = rawResults.find(r => r.code === 'llm-rate-limited');
      if (inf) totalRateLimited += 1;

      const elapsed = ((Date.now() - fileStart) / 1000).toFixed(1);
      process.stderr.write(`${findings.length} findings (${elapsed}s)\n`);

      totalFindings += findings.length;

      // Compute category counts for regression analysis
      const byCode = {};
      for (const f of findings) byCode[f.code] = (byCode[f.code] || 0) + 1;

      // Build the per-fixture output
      const fixtureData = {
        label: `e12-${path.basename(path.dirname(file))}`,
        started_at: new Date(fileStart).toISOString(),
        finished_at: new Date().toISOString(),
        input: rel,
        expected: metadata,
        config: { mode: 'single', model: 'gpt-4o-mini', cooldown_ms: COOLDOWN_MS },
        stats: {
          total_findings: findings.length,
          by_code: byCode,
        },
        findings: findings.sort((a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
          || a.code.localeCompare(b.code)
        ),
      };
      results.push(fixtureData);

      // Write per-fixture JSON
      const outputFile = path.join(OUTPUT_DIR, `e12-${path.basename(path.dirname(file))}.json`);
      fs.writeFileSync(outputFile, JSON.stringify(fixtureData, null, 2));
    } catch (err) {
      totalFailed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`ERROR: ${msg.slice(0, 100)}\n`);
    }

    if (i < fixtures.length - 1) {
      process.stderr.write(`  (waiting ${COOLDOWN_MS / 1000}s for rate limit)\n`);
      await sleep(COOLDOWN_MS);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.error(`\n=== E12 Summary ===`);
  console.error(`Fixtures: ${fixtures.length}`);
  console.error(`Total findings: ${totalFindings}`);
  console.error(`Total LLM calls: ${fixtures.length}`);
  console.error(`Rate-limited: ${totalRateLimited}, Failed: ${totalFailed}`);
  console.error(`Total time: ${totalTime}s`);

  // Write summary
  const summary = {
    label: 'e12-summary',
    finished_at: new Date().toISOString(),
    total_fixtures: fixtures.length,
    total_findings: totalFindings,
    rate_limited: totalRateLimited,
    failed: totalFailed,
    fixtures: results.map(r => ({
      fixture: r.input,
      expected: r.expected,
      total: r.stats.total_findings,
      by_code: r.stats.by_code,
    })),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'e12-summary.json'), JSON.stringify(summary, null, 2));

  // Print the comparison table
  console.log(`\n## E12 fixture suite\n`);
  console.log(`| Fixture | Expected | Detected | By code |`);
  console.log(`| --- | ---: | ---: | --- |`);
  for (const r of results) {
    const exp = r.expected.expected_count ?? '?';
    const codes = Object.entries(r.stats.by_code).sort((a,b) => b[1]-a[1]).map(([c,n]) => `${c}:${n}`).join(' ');
    console.log(`| ${r.input} | ${exp} | ${r.stats.total_findings} | ${codes} |`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
