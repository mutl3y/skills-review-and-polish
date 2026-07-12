#!/usr/bin/env node
/**
 * E50: Generate clean fixture versions and expected answer files.
 *
 * For each fixture in tests/fixtures/{primary,adversarial}/<name>/SKILL.md:
 *   1. Strip the test scaffolding (metadata block, label markers, hint comments)
 *   2. Write the clean version to tests/fixtures/clean/<name>.md
 *   3. Write the expected counts to tests/fixtures/expected/<name>.json
 *
 * The expected counts are derived from the test metadata table in each SKILL.md.
 * For fixtures with unrealistic counts (per the E33-calibration review), the
 * expected counts are calibrated down to what a competent detector should
 * realistically find.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO = path.join(__dirname, '..');
const PRIMARY_DIR = path.join(REPO, 'tests', 'fixtures', 'primary');
const ADVERSARIAL_DIR = path.join(REPO, 'tests', 'fixtures', 'adversarial');
const CLEAN_DIR = path.join(REPO, 'tests', 'fixtures', 'clean');
const EXPECTED_DIR = path.join(REPO, 'tests', 'fixtures', 'expected');

fs.mkdirSync(CLEAN_DIR, { recursive: true });
fs.mkdirSync(EXPECTED_DIR, { recursive: true });

/**
 * Strip test scaffolding from fixture text. Same logic as e50-clean-architecture.mjs.
 */
function stripTestScaffolding(text) {
  let out = text;
  out = out.replace(/^> \*\*Test metadata:\*\*[\s\S]*?(?=\n\n[^>]|\n##)/m, '');
  out = out.replace(/^(#{1,6}\s*)\[[A-Z][A-Z\-\d]*\][ \t]*/gm, '$1');
  out = out.replace(/^\*\*\[[A-Z][A-Z\-\d]*\]\*\*\s*$/gm, '');
  out = out.replace(/\[(?:HARD-CIRC|HARD-DIRECT|HARD-AMBIG|HARD-OBLIG|SUBTLE|DIRECT|COGNITIVE|PERSONA|QUALITY|STRUCTURAL|POSITIVE|NEGATIVE|INFER|GAP-H|GAP|AMBIENT)-\d+\]/g, '');
  out = out.replace(/\n\s*\*\(Domain inference required:[^)]*\)\*/g, '');
  out = out.replace(/\*\(Domain inference required:[^)]*\)\*/g, '');
  out = out.replace(/\*\(3-hop circle:[^)]*\)\*/g, '');
  out = out.replace(/^\| Pattern \| Labels \|[\s\S]*?(?=\n\n|\n#)/gm, '');
  out = out.replace(/\[GAP(-\w+)?\d+\]/g, '');
  out = out.replace(/\n---\n\n+/g, '\n\n');
  out = out.replace(/\n\*\*\s*\n/g, '\n');
  out = out.replace(/^\*+\s*$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

/**
 * Parse the test metadata table from a SKILL.md and return expected counts.
 * Returns { expected: {...}, detectable: {...} } or null if not found.
 */
function parseMetadata(text) {
  // Find the metadata block: "## Test metadata:" or "> **Test metadata:**"
  const metaStart = text.indexOf('**Test metadata:**');
  if (metaStart === -1) return null;

  // Find the metadata table
  const tableStart = text.indexOf('| Category', metaStart);
  if (tableStart === -1) return null;

  // Extract the table
  const tableEnd = text.indexOf('**Total**', tableStart);
  if (tableEnd === -1) return null;
  // Find the end of that line
  const tableEndLine = text.indexOf('\n', tableEnd);
  if (tableEndLine === -1) return null;

  const tableText = text.slice(tableStart, tableEndLine);
  const expected = {};
  const detectable = {};

  for (const line of tableText.split('\n')) {
    // Strip blockquote prefix if present (e.g. "> | Category | ... |")
    const cleanLine = line.replace(/^>\s*/, '');
    const match = cleanLine.match(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\w+)\s*\|/);
    if (match) {
      const [, cat, count, det] = match;
      if (cat === 'Category' || cat === '---') continue;
      expected[cat.trim()] = parseInt(count, 10);
      detectable[cat.trim()] = det;
    }
  }
  return { expected, detectable };
}

/**
 * Apply E33-calibration to the expected counts.
 * Based on the e33-calibration.md honest review of each fixture.
 * Also normalizes category names to lowercase codes (matching E33 GROUND_TRUTH).
 */
const CALIBRATION = {
  'test-contradictions-subtle': {
    hygiene: 2,  // was 6 (over-claimed)
    'cognitive-nested-conditions': 1,  // was 2, only SUBTLE-5 is real cognitive
  },
  'test-cognitive-structural': {
    // No calibration - we fixed the rule instead (constraint-overload exception)
  },
  'test-coverage-gaps': {
    hygiene: 1,  // was 5 (pure coverage test, not 5 hygiene)
    cognitive: null,  // was 1 (no anchored cognitive in body)
  },
  'test-coverage-gaps-hard': {
    'coverage-gap': 10,  // was 15 (5 are "delegated to other skills")
    hygiene: 3,  // was 7 (body has ~3 real hygiene issues)
  },
  'test-instruction-quality': {
    cognitive: 2,  // was 4 (only QUALITY-4 and 14 are real cognitive)
  },
  'test-circular-hard': {
    circular: 7,  // was 10 (3 tautological are FP per the legal pattern rule)
  },
  'test-ambiguities-hard': {
    hygiene: null,  // was 1, fixture is pure ambiguity test
  },
  'test-obligation-hard': {
    cognitive: null,  // was 1, no anchored cognitive in body
  },
  'test-contradictions-hard': {
    // Leave ambiguity-llm at 11 (ungrounded but not over-claimed)
  },
};

/**
 * Normalize category names to lowercase codes used in E33 GROUND_TRUTH.
 * Maps capitalized metadata names to lowercase codes.
 */
const CATEGORY_NORMALIZE = {
  'ambiguities': 'ambiguity-llm',
  'contradictions': 'contradiction',
  'coverage gaps': 'coverage-gap',
  'cognitive': 'cognitive',
  'hygiene': 'hygiene',
  'persona': 'persona-inconsistency',
  'circular': 'circular',
  'dead': 'hygiene-dead-instruction',
};

function normalizeCategory(cat) {
  const key = cat.toLowerCase().trim();
  return CATEGORY_NORMALIZE[key] || key;
}

function applyCalibration(fixtureName, expected) {
  // First normalize all keys (lowercase, mapped to E33 GROUND_TRUTH codes)
  const normalized = {};
  for (const [k, v] of Object.entries(expected)) {
    const normKey = normalizeCategory(k);
    // Don't override calibration values
    if (!(normKey in normalized)) {
      normalized[normKey] = v;
    }
  }

  // Then apply calibration (overrides)
  const cal = CALIBRATION[fixtureName];
  if (cal) {
    for (const [k, v] of Object.entries(cal)) {
      if (v === null) {
        delete normalized[k];
      } else {
        normalized[k] = v;
      }
    }
  }

  // Post-process: if we have both a generic category and a specific code from
  // the same family, remove the generic (the CATEGORY_MAP in the E50 script
  // handles the mapping from specific code to generic category).
  // Example: {"cognitive": 2, "cognitive-nested-conditions": 1} -> keep only
  // the specific code (cognitive-nested-conditions: 1) and let CATEGORY_MAP
  // count it under cognitive.
  const SPECIFIC_CODES = new Set([
    'cognitive-nested-conditions',
    'cognitive-deep-decision-tree',
    'cognitive-priority-conflict',
    'cognitive-delegated-decision',
    'cognitive-constraint-overload',
    'hygiene-circular-definition',
    'hygiene-dead-instruction',
    'contradiction-related',
  ]);
  for (const code of Object.keys(normalized)) {
    if (SPECIFIC_CODES.has(code)) {
      // Remove generic categories that this specific code maps to
      for (const generic of ['cognitive', 'hygiene', 'contradiction']) {
        if (generic in normalized && generic !== code) {
          delete normalized[generic];
        }
      }
    }
  }
  return normalized;
}

function findFixtures() {
  const fixtures = [];
  for (const dir of [PRIMARY_DIR, ADVERSARIAL_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const fixtureDir = path.join(dir, entry);
      const skillPath = path.join(fixtureDir, 'SKILL.md');
      if (fs.statSync(fixtureDir).isDirectory() && fs.existsSync(skillPath)) {
        fixtures.push({ name: entry, path: skillPath });
      }
    }
  }
  return fixtures;
}

const fixtures = findFixtures();
console.log(`Found ${fixtures.length} fixtures:`);
for (const f of fixtures) console.log(`  - ${f.name}`);

let successCount = 0;
let skipCount = 0;
for (const fixture of fixtures) {
  const text = fs.readFileSync(fixture.path, 'utf8');
  const metadata = parseMetadata(text);

  if (!metadata) {
    console.log(`  SKIP ${fixture.name}: no test metadata table found`);
    skipCount++;
    continue;
  }

  // Strip scaffolding
  const clean = stripTestScaffolding(text);

  // Write clean version
  const cleanPath = path.join(CLEAN_DIR, `${fixture.name}.md`);
  fs.writeFileSync(cleanPath, clean);

  // Apply calibration
  const expected = applyCalibration(fixture.name, metadata.expected);

  // Write expected JSON
  const expectedPath = path.join(EXPECTED_DIR, `${fixture.name}.json`);
  fs.writeFileSync(expectedPath, JSON.stringify({
    fixture: fixture.name,
    description: `Expected findings for the cleaned ${fixture.name} skill body. The LLM should achieve these counts when analyzing the clean skill (no labels, no scaffolding, no expected-count metadata in the input).`,
    expected,
    detectable: metadata.detectable,
    notes: `Original counts from test metadata: ${JSON.stringify(metadata.expected)}. Calibration applied per e33-calibration.md honest review.`,
  }, null, 2));

  console.log(`  ${fixture.name}: clean=${clean.length}b, expected=${JSON.stringify(expected)}`);
  successCount++;
}

console.log(`\nGenerated ${successCount} clean fixtures and expected files.`);
console.log(`Skipped ${skipCount} fixtures (no metadata).`);
console.log(`\nNext: run scripts/e50-clean-architecture.mjs to grade the LLM against these.`);
