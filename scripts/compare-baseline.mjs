/**
 * Compare a new baseline-fork run against the established baseline.
 *
 * Usage:
 *   node scripts/compare-baseline.mjs <new-summary.json> [<baseline-summary.json>]
 *
 * Defaults to comparing against the established E13 baseline at
 *   .github/experiments/documentation-review/data/baseline-fork/summary.json
 *
 * Output:
 *   - Per-skill grade/score/findings diff
 *   - Grade distribution change
 *   - Total findings change
 *   - New finding codes introduced or removed
 *   - Exit code 1 if any skill dropped a grade level (regression signal)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node scripts/compare-baseline.mjs <new-summary.json> [<baseline-summary.json>]');
  console.error('Defaults: <new-summary.json> (required), baseline = data/baseline-fork/summary.json');
  process.exit(1);
}

const NEW_SUMMARY = path.resolve(args[0]);
const BASELINE_SUMMARY = path.resolve(args[1] || '.github/experiments/documentation-review/data/baseline-fork/summary.json');

if (!fs.existsSync(NEW_SUMMARY)) {
  console.error(`New summary not found: ${NEW_SUMMARY}`);
  process.exit(1);
}
if (!fs.existsSync(BASELINE_SUMMARY)) {
  console.error(`Baseline summary not found: ${BASELINE_SUMMARY}`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_SUMMARY, 'utf8'));
const current = JSON.parse(fs.readFileSync(NEW_SUMMARY, 'utf8'));

// Build per-skill lookups
const baselineBySkill = new Map();
for (const s of baseline.by_skill) baselineBySkill.set(s.name, s);

const currentBySkill = new Map();
for (const s of current.by_skill) currentBySkill.set(s.name, s);

// Grade order (for comparison). Ungraded is treated as "no grade" and
// excluded from the comparison index — moving between Ungraded and any
// real grade is never a regression (it's an upgrade, or the analyzer
// went from running to not running).
const REAL_GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
const gradeIndex = (g) => REAL_GRADE_ORDER.indexOf(g);

const regressions = [];
const improvements = [];
const unchanged = [];
const newSkills = [];
const dropped = [];

for (const cur of current.by_skill) {
  const base = baselineBySkill.get(cur.name);
  if (!base) {
    newSkills.push(cur);
    continue;
  }
  // Skip the comparison if either grade is Ungraded — that's a state
  // transition (analyzer started/stopped working), not a regression.
  if (base.grade === 'Ungraded' || cur.grade === 'Ungraded') {
    if (cur.grade === 'Ungraded' && base.grade !== 'Ungraded') {
      // Regrade: was real, now Ungraded. Possible regression.
      regressions.push({ skill: cur.name, before: base, after: cur, delta: 0, reason: 'Regraded to Ungraded' });
    } else {
      improvements.push({ skill: cur.name, before: base, after: cur, delta: 0, reason: 'Ungraded → graded' });
    }
    continue;
  }
  const baseIdx = gradeIndex(base.grade);
  const curIdx = gradeIndex(cur.grade);
  const delta = curIdx - baseIdx; // positive = worse (lower grade)
  if (delta > 0) regressions.push({ skill: cur.name, before: base, after: cur, delta });
  else if (delta < 0) improvements.push({ skill: cur.name, before: base, after: cur, delta: -delta });
  else unchanged.push({ skill: cur.name, base, current: cur });
}

for (const base of baseline.by_skill) {
  if (!currentBySkill.has(base.name)) dropped.push(base);
}

// Finding code deltas
const baselineCodes = new Map();
for (const s of baseline.by_skill) for (const [c, n] of Object.entries(s.by_code || {})) baselineCodes.set(c, (baselineCodes.get(c) || 0) + n);

const currentCodes = new Map();
for (const s of current.by_skill) for (const [c, n] of Object.entries(s.by_code || {})) currentCodes.set(c, (currentCodes.get(c) || 0) + n);

const allCodes = new Set([...baselineCodes.keys(), ...currentCodes.keys()]);
const codeDeltas = [];
for (const c of allCodes) {
  const before = baselineCodes.get(c) || 0;
  const after = currentCodes.get(c) || 0;
  if (before !== after) codeDeltas.push({ code: c, before, after, delta: after - before });
}
codeDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

// Print the report
console.log(`\n# Baseline comparison\n`);
console.log(`- Baseline: \`${path.relative(process.cwd(), BASELINE_SUMMARY)}\``);
console.log(`- New:      \`${path.relative(process.cwd(), NEW_SUMMARY)}\``);
console.log(`- Analyzer config: ${JSON.stringify(current.analyzer_config || {})}`);
console.log();

console.log(`## Summary\n`);
console.log(`| Metric | Baseline | New | Δ |`);
console.log(`| --- | ---: | ---: | ---: |`);
const baseTotalFindings = baseline.by_skill.reduce((a, s) => a + s.findings, 0);
const newTotalFindings = current.by_skill.reduce((a, s) => a + s.findings, 0);
console.log(`| Skills | ${baseline.by_skill.length} | ${current.by_skill.length} | ${current.by_skill.length - baseline.by_skill.length} |`);
console.log(`| Total findings | ${baseTotalFindings} | ${newTotalFindings} | ${newTotalFindings - baseTotalFindings >= 0 ? '+' : ''}${newTotalFindings - baseTotalFindings} |`);
console.log(`| Regressions | 0 | ${regressions.length} | ${regressions.length > 0 ? '⚠️' : '✅'} |`);
console.log(`| Improvements | 0 | ${improvements.length} | ${improvements.length > 0 ? '✅' : '—'} |`);
console.log(`| Unchanged | 0 | ${unchanged.length} | ${unchanged.length > 0 ? '✅' : '—'} |`);
console.log(`| New skills | 0 | ${newSkills.length} | — |`);
console.log(`| Dropped skills | 0 | ${dropped.length} | — |`);
console.log();

console.log(`## Grade distribution\n`);
console.log(`| Grade | Baseline | New | Δ |`);
console.log(`| --- | ---: | ---: | ---: |`);
for (const g of REAL_GRADE_ORDER) {
  const b = baseline.by_grade[g] || 0;
  const n = current.by_grade[g] || 0;
  if (b === 0 && n === 0) continue;
  console.log(`| ${g} | ${b} | ${n} | ${n - b >= 0 ? '+' : ''}${n - b} |`);
}
console.log();

if (codeDeltas.length > 0) {
  console.log(`## Finding code deltas\n`);
  console.log(`| Code | Baseline | New | Δ |`);
  console.log(`| --- | ---: | ---: | ---: |`);
  for (const c of codeDeltas) {
    console.log(`| ${c.code} | ${c.before} | ${c.after} | ${c.delta >= 0 ? '+' : ''}${c.delta} |`);
  }
  console.log();
}

console.log(`## Per-skill comparison (sorted by largest grade change)\n`);
const all = [
  ...regressions.map(r => ({ ...r, type: 'REGRESSION' })),
  ...improvements.map(r => ({ ...r, type: 'IMPROVEMENT' })),
  ...unchanged.map(r => ({ skill: r.skill, type: 'UNCHANGED', before: r.base, after: r.current, delta: 0 })),
];
all.sort((a, b) => b.delta - a.delta);
console.log(`| Skill | Δ grade | Base grade | New grade | Base findings | New findings | Base score | New score |`);
console.log(`| --- | ---: | --- | --- | ---: | ---: | ---: | ---: |`);
for (const r of all) {
  console.log(`| ${r.skill} | ${r.delta} | ${r.before.grade} | ${r.after.grade} | ${r.before.findings} | ${r.after.findings} | ${r.before.score} | ${r.after.score} |`);
}
console.log();

if (newSkills.length > 0) {
  console.log(`## New skills (in current but not in baseline)\n`);
  for (const s of newSkills) console.log(`- ${s.name} (${s.lines} lines): ${s.grade} (${s.score})`);
  console.log();
}

if (dropped.length > 0) {
  console.log(`## Dropped skills (in baseline but not in current)\n`);
  for (const s of dropped) console.log(`- ${s.name} (${s.lines} lines): was ${s.grade} (${s.score})`);
  console.log();
}

if (regressions.length > 0) {
  console.log(`\n## ⚠️ REGRESSIONS DETECTED\n`);
  process.exit(1);
} else {
  console.log(`\n## ✅ No regressions detected\n`);
  process.exit(0);
}
