#!/usr/bin/env node
/**
 * Grade an e50-clean-architecture JSON file against its embedded expected counts.
 * Reports per-fixture per-category recall, precision, over-report ratio, plus overall.
 *
 * Usage: node scripts/grade-e50.mjs <path-to-e50.json>
 */
import fs from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/grade-e50.mjs <e50.json>');
  process.exit(1);
}

const CATEGORY_MAP = {
  cognitive: ['cognitive-nested-conditions', 'cognitive-deep-decision-tree', 'cognitive-priority-conflict', 'cognitive-delegated-decision', 'cognitive-constraint-overload', 'cognitive-sequencing', 'cognitive-logical-inversion'],
  hygiene: ['hygiene-over-specification', 'hygiene-non-actionable-preamble', 'hygiene-redundant-instruction', 'hygiene-vague-cognitive-directive', 'hygiene-unordered-process', 'hygiene-unordered-sequential-process', 'hygiene-ordered-process', 'hygiene-ordered-sequential-process', 'hygiene-missing-agent', 'hygiene-circular-definition', 'hygiene-vague-directive'],
  contradiction: ['contradiction', 'contradiction-related'],
  circular: ['hygiene-circular-definition'],
  dead: ['hygiene-dead-instruction'],
};

function countByCategory(findings, expectedKey) {
  const codes = new Set([expectedKey, ...(CATEGORY_MAP[expectedKey] || [])]);
  return findings.filter(f => codes.has(f.code)).length;
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const fixtureMap = new Map(data.fixtures.map(f => [f.name, f]));

// Group runs by fixture
const byFixture = new Map();
for (const r of data.results) {
  if (!byFixture.has(r.fixture)) byFixture.set(r.fixture, []);
  byFixture.get(r.fixture).push(r);
}

let totalExpected = 0;
let totalFound = 0;
let totalOverReports = 0;
let totalFindings = 0;

console.log('Per-fixture × per-category (3-run median):');
console.log('Fixture                          | Cat                | Exp | Med | Recall | Total | Over');
console.log('-'.repeat(100));

for (const [name, runs] of byFixture) {
  const exp = fixtureMap.get(name).expected;
  const catStats = [];
  for (const [cat, expCount] of Object.entries(exp)) {
    const counts = runs.map(r => countByCategory(r.findings || [], cat));
    counts.sort((a, b) => a - b);
    const median = counts[1];
    const recall = expCount > 0 ? median / expCount : 1;
    const recallPct = (recall * 100).toFixed(0) + '%';
    const total = counts.reduce((a, b) => a + b, 0);
    const avg = total / counts.length;
    const over = avg / expCount;
    catStats.push({ cat, expCount, median, total, recall, recallPct, over });
    totalExpected += expCount;
    totalFound += median;
    totalOverReports += avg;
  }
  for (const s of catStats) {
    console.log(
      `${name.padEnd(32)} | ${s.cat.padEnd(18)} | ${String(s.expCount).padStart(3)} | ${String(s.median).padStart(3)} | ${s.recallPct.padStart(6)} | ${String(s.total).padStart(5)} | ${s.over.toFixed(2)}x`
    );
  }
}

// Aggregate overall
const overallRecall = totalExpected > 0 ? totalFound / totalExpected : 1;
const totalFindingsAllRuns = data.results.reduce((acc, r) => acc + (r.findings?.length || 0), 0);
const nRuns = data.results.length;
const avgTotalPerRun = totalFindingsAllRuns / nRuns;
const avgExpectedPerRun = totalExpected;
const overallOver = avgTotalPerRun / avgExpectedPerRun;

console.log('-'.repeat(100));
console.log(`OVERALL:    total expected=${totalExpected}, total findings (median-sum)=${totalFound}, recall=${(overallRecall * 100).toFixed(1)}%`);
console.log(`            avg findings/run=${avgTotalPerRun.toFixed(1)}, avg expected/run=${avgExpectedPerRun.toFixed(1)}, over-report=${overallOver.toFixed(2)}x`);