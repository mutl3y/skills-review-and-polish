#!/usr/bin/env node
/**
 * E23: Contradiction line-number stability check.
 *
 * E19 showed test-contradictions-hard is 100% deterministic in count
 * (16/16/16 across N=3). But the 8 `contradiction` + 8
 * `contradiction-related` findings may point to different line numbers
 * in each run. If they shift, the LLM is finding different pairs each
 * time and a dedup post-processor would help. If they're stable, no
 * dedup is needed.
 *
 * This script reads the 3 E19 run files, builds a stability matrix,
 * and reports aggregate stats + recommendation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');
const RUN_FILES = [
  path.join(DATA_DIR, 'e19-test-contradictions-hard-run1.json'),
  path.join(DATA_DIR, 'e19-test-contradictions-hard-run2.json'),
  path.join(DATA_DIR, 'e19-test-contradictions-hard-run3.json'),
];

function loadRun(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return data.diags;
}

const runs = RUN_FILES.map(loadRun);
if (runs.some(r => !Array.isArray(r) || r.length === 0)) {
  console.error('FAIL: one or more run files are missing or empty');
  process.exit(1);
}

// Build a "slot" index: within each run, order findings by (code, start.line).
// Then compare line numbers across runs for each (code, slot) position.
function slotKey(d) {
  return d.code;
}

function slotByCode(run) {
  const byCode = { 'contradiction': [], 'contradiction-related': [] };
  for (const d of run) {
    if (byCode[d.code]) {
      byCode[d.code].push(d);
    }
  }
  // Sort by start.line so ordering is deterministic across runs
  for (const code of Object.keys(byCode)) {
    byCode[code].sort((a, b) => {
      const al = a.range?.start?.line ?? 0;
      const bl = b.range?.start?.line ?? 0;
      if (al !== bl) return al - bl;
      const ac = a.range?.start?.character ?? 0;
      const bc = b.range?.start?.character ?? 0;
      return ac - bc;
    });
  }
  return byCode;
}

const slotsByCode = runs.map(slotByCode);
const codes = ['contradiction', 'contradiction-related'];

const stability = {}; // { code -> [ { slot, line_r1, line_r2, line_r3, stable } ] }
for (const code of codes) {
  const arr = slotsByCode.map(s => s[code]);
  const maxLen = Math.max(...arr.map(a => a.length));
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const lines = arr.map(run => run[i]?.range?.start?.line ?? null);
    const allSame = lines.every(l => l !== null && l === lines[0]);
    const allNull = lines.every(l => l === null);
    rows.push({
      slot: i + 1,
      run1_line: lines[0],
      run2_line: lines[1],
      run3_line: lines[2],
      stable: allSame && !allNull,
    });
  }
  stability[code] = rows;
}

// Aggregate stats
let totalSlots = 0;
let stableSlots = 0;
let shiftingSlots = 0;
let missingSlots = 0;
for (const code of codes) {
  for (const row of stability[code]) {
    totalSlots++;
    if (row.stable) stableSlots++;
    else if (row.run1_line === null || row.run2_line === null || row.run3_line === null) missingSlots++;
    else shiftingSlots++;
  }
}

const stablePct = totalSlots ? (stableSlots / totalSlots * 100).toFixed(1) : '0.0';
const shiftingPct = totalSlots ? (shiftingSlots / totalSlots * 100).toFixed(1) : '0.0';
const missingPct = totalSlots ? (missingSlots / totalSlots * 100).toFixed(1) : '0.0';

let recommendation;
if (shiftingSlots / totalSlots > 0.30) {
  recommendation = 'ADD DEDUP POST-PROCESSOR (>30% line-shifting — LLM is finding different pairs each time)';
} else if (shiftingSlots / totalSlots < 0.10) {
  recommendation = 'NO DEDUP NEEDED (<10% line-shifting — LLM is finding the same pairs consistently)';
} else {
  recommendation = `INVESTIGATE — line-shifting is in the gray zone (10-30%); may or may not warrant a dedup post-processor`;
}

const report = {
  fixture: 'test-contradictions-hard',
  runs_analyzed: 3,
  codes: codes,
  total_slots: totalSlots,
  stable_slots: stableSlots,
  shifting_slots: shiftingSlots,
  missing_slots: missingSlots,
  stable_pct: stablePct + '%',
  shifting_pct: shiftingPct + '%',
  missing_pct: missingPct + '%',
  stability: stability,
  recommendation: recommendation,
  computed_at: new Date().toISOString(),
};

const outFile = path.join(DATA_DIR, 'e23-line-stability.json');
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

console.log('=== E23 contradiction line-stability ===\n');
console.log('Per-slot stability:');
console.table([
  ...stability['contradiction'].map(r => ({ code: 'contradiction', ...r })),
  ...stability['contradiction-related'].map(r => ({ code: 'contradiction-related', ...r })),
]);
console.log('\nAggregate:');
console.log(`  Total slots:        ${totalSlots}`);
console.log(`  Stable:             ${stableSlots} (${stablePct}%)`);
console.log(`  Shifting:           ${shiftingSlots} (${shiftingPct}%)`);
console.log(`  Missing (one run):  ${missingSlots} (${missingPct}%)`);
console.log(`\nRecommendation: ${recommendation}`);
console.log(`\nSaved: ${outFile}`);
