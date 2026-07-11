#!/usr/bin/env node
/**
 * E19 post-processor: re-compute the in-cat count with the corrected
 * filter (contradiction-related is in-cat for test-contradictions-hard).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');

const FIXTURES = [
  {
    name: 'test-instruction-quality',
    expected: 15,
    inCat: (d) => !['llm-error', 'llm-parse-error', 'llm-disabled', 'llm-rate-limited', 'llm-loop-detected', 'high-complexity', 'limited-coverage'].includes(d.code),
  },
  {
    name: 'test-contradictions-hard',
    expected: 15,
    inCat: (d) => d.code === 'contradiction' || d.code === 'contradiction-related',
  },
];

const N = 3;
const results = [];

for (const fx of FIXTURES) {
  const perRun = [];
  for (let run = 1; run <= N; run++) {
    const file = path.join(DATA_DIR, `e19-${fx.name}-run${run}.json`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diags = data.diags || [];
    const inCat = diags.filter(fx.inCat).length;
    perRun.push({ run, total: diags.length, in_cat: inCat });
  }
  const totals = perRun.map(r => r.total).sort((a, b) => a - b);
  const inCats = perRun.map(r => r.in_cat).sort((a, b) => a - b);
  const medianTotal = totals[Math.floor(N / 2)];
  const medianInCat = inCats[Math.floor(N / 2)];
  results.push({
    fixture: fx.name,
    expected: fx.expected,
    per_run: perRun.map(r => `R${r.run}: ${r.total} (${r.in_cat} in-cat)`).join(', '),
    median_total: medianTotal,
    median_in_cat: medianInCat,
    in_cat_rate: (medianInCat / fx.expected * 100).toFixed(1) + '%',
  });
}

const summary = {
  model: 'google/gemini-2.5-flash-lite',
  n: N,
  results,
  note: 'Re-computed with contradiction-related counted as in-cat for test-contradictions-hard',
  recomputed: new Date().toISOString(),
};

const outFile = path.join(DATA_DIR, 'e19-focused-summary.json');
fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`\nWritten to: ${outFile}`);
