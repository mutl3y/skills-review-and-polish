#!/usr/bin/env node
/**
 * E43: Compare E33 runs side-by-side.
 * Usage: node scripts/e43-compare-runs.mjs <baseline.json> <candidate.json>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [, , baselinePath, ...candidatePaths] = process.argv;
if (!baselinePath || candidatePaths.length === 0) {
  console.error('Usage: node scripts/e43-compare-runs.mjs <baseline.json> <candidate1.json> [candidate2.json] ...');
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const candidates = candidatePaths.map(p => ({ path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) }));

console.log(`Baseline: ${path.basename(baselinePath)} (${baseline.summary.hits}/${baseline.summary.total_categories} = ${(baseline.summary.hits / baseline.summary.total_categories * 100).toFixed(0)}%)`);
for (const c of candidates) {
  console.log(`Candidate: ${path.basename(c.path)} (${c.data.summary.hits}/${c.data.summary.total_categories} = ${(c.data.summary.hits / c.data.summary.total_categories * 100).toFixed(0)}%)`);
}

// Build per-fixture per-category median lookup
function lookup(data, fixtureName, cat) {
  const fx = data.fixture_results[fixtureName];
  if (!fx) return null;
  const entry = fx.perCategory[cat];
  if (!entry) return null;
  return entry.median;
}

const fixtures = Object.keys(baseline.fixture_results);
const cats = new Set();
for (const fx of fixtures) {
  for (const c of Object.keys(baseline.fixture_results[fx].expected)) cats.add(c);
}
const allCats = Array.from(cats);

console.log('\n=== Per-fixture per-category deltas (baseline → candidate medians) ===\n');
const COL_W = 35;
const CAT_W = 28;
const BASE_W = 7;
const CAND_W = 30;

console.log(
  'Fixture'.padEnd(COL_W) +
  ' | ' + 'Category'.padEnd(CAT_W) +
  ' | ' + 'Base'.padStart(BASE_W) +
  ' | ' + 'Candidates'.padStart(CAND_W) +
  ' | Notes'
);
console.log('-'.repeat(COL_W + CAT_W + BASE_W + CAND_W + 20));

for (const fx of fixtures) {
  for (const cat of allCats) {
    const baseExpected = baseline.fixture_results[fx].expected[cat];
    if (!baseExpected) continue;
    const baseVal = lookup(baseline, fx, cat);
    const candVals = candidates.map(c => lookup(c.data, fx, cat));
    const candStr = candVals.map((v, i) => {
      const status = v === null ? 'ERR' : v;
      const expected = candidates[i].data.fixture_results[fx].expected[cat];
      if (v === null) return `${status}`;
      const flag = v >= expected ? '✓' : v >= expected * 0.5 ? '⚠' : '✗';
      return `${v}/${expected}${flag}`;
    }).join(' | ');

    // Compute delta
    const validCand = candVals.filter(v => v !== null);
    const avgCand = validCand.length ? validCand.reduce((a, b) => a + b, 0) / validCand.length : null;
    const delta = avgCand !== null ? (avgCand - baseVal) : 0;
    const deltaStr = delta === 0 ? '=' : delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
    const note = avgCand === null ? 'all errors' :
                 Math.abs(delta) < 0.5 ? 'noise' :
                 delta > 0 ? '↑ improved' : '↓ regressed';

    if (delta === 0 && !note.includes('noise')) continue;
    console.log(
      fx.padEnd(COL_W) +
      ' | ' + cat.padEnd(CAT_W) +
      ' | ' + (baseVal === null ? 'ERR' : baseVal.toString()).padStart(BASE_W) +
      ' | ' + candStr.padStart(CAND_W) +
      ' | ' + note
    );
  }
}

console.log('\n=== Summary ===');
for (const c of candidates) {
  const baseHits = baseline.summary.hits;
  const candHits = c.data.summary.hits;
  const delta = candHits - baseHits;
  const pct = (candHits / c.data.summary.total_categories * 100).toFixed(0);
  console.log(`${path.basename(c.path)}: ${candHits}/${c.data.summary.total_categories} (${pct}%) — Δ${delta >= 0 ? '+' : ''}${delta}`);
}
