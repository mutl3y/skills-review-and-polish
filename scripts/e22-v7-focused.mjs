/**
 * E22: Validate focused multiWave on the v7 documentation-review skill
 * (a real-world skill, not a labeled fixture).
 *
 * E18 + E19 confirmed focused multiWave lifts in-category detection from
 * 5-70% to 90-187% on LABELED fixtures. E22 asks: does the same pattern
 * hold for a real-world skill where there's no labeled ground truth?
 *
 * Compare to E11 single-mode baseline (3 findings on v7, gpt-4o-mini) and
 * to E11 stability-2/-3. We use Gemini Flash Lite here (cheaper, faster)
 * and run with all 6 waves enabled.
 *
 * Cost: 1 LLM call (6 wave calls inside the engine). ~$0.005. ~30s.
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
const LOG_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'logs');
const DATA_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data');

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `e22-v7-focused-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E22 v7 focused multiWave started ${new Date().toISOString()} ===\n`);

const SKILL_PATH = path.join(
  __dirname,
  '..',
  '.github',
  'experiments',
  'documentation-review',
  'versions',
  'v7',
  'SKILL.md',
);

const text = fs.readFileSync(SKILL_PATH, 'utf8');
process.stderr.write(`Loaded v7 SKILL.md (${text.split('\n').length} lines)\n`);

const ALL_WAVES = ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'];

// Use the new analysisWaves API (E21) — cleaner than enabledWaves + multiWave.
const provider = new OpenRouterProvider({ apiKey, model: MODEL });
const engine = new Engine(provider, {
  analysisMode: 'multiWave', // legacy, but analysisWaves below takes priority
  enabledWaves: ALL_WAVES,
  analysisWaves: ALL_WAVES,
  maxRetries: 0,
});

const t0 = Date.now();
let out;
try {
  out = await engine.analyze({ text, filePath: SKILL_PATH });
} catch (err) {
  process.stderr.write(`FAIL: ${err.message}\n`);
  process.exit(1);
}
const elapsedMs = Date.now() - t0;
const diags = Array.isArray(out) ? out : (out.diagnostics || []);

// Per-code summary
const summary = {};
for (const d of diags) {
  summary[d.code] = (summary[d.code] || 0) + 1;
}

// Per-wave mapping: which wave emitted which finding?
// The analyzer names the wave in `d.analyzer`. Map analyzer IDs to wave names.
const WAVE_BY_ANALYZER = {
  'contradiction-detection': 'contradictions',
  'ambiguity-detection': 'ambiguities',
  'persona-detection': 'persona',
  'structural-quality': 'structural',
  'coverage-gap': 'coverage',
  'hygiene-check': 'hygiene',
  'hygiene-hygiene-vague-directive': 'hygiene',
  'hygiene-hygiene-missing-trigger': 'hygiene',
  'hygiene-hygiene-section-mismatch': 'hygiene',
  'hygiene-hygiene-duplicate-headers': 'hygiene',
  'hygiene-yaml-description-redundancy': 'hygiene',
  'hygiene-definitions-preamble-redundant': 'hygiene',
  'hygiene-skill-opening-paragraph-redundant': 'hygiene',
  'hygiene-hygiene-weak-obligation': 'hygiene',
  'hygiene-hygiene-imperative-mood': 'hygiene',
};
const waveSummary = {};
for (const d of diags) {
  const wave = WAVE_BY_ANALYZER[d.analyzer] || `unknown(${d.analyzer})`;
  waveSummary[wave] = (waveSummary[wave] || 0) + 1;
}

const bySeverity = {};
for (const d of diags) {
  bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
}

process.stderr.write(`\nFindings: ${diags.length} total\n`);
process.stderr.write(`By wave:\n`);
for (const [w, c] of Object.entries(waveSummary)) {
  process.stderr.write(`  ${w}: ${c}\n`);
}
process.stderr.write(`By code:\n`);
for (const [c, n] of Object.entries(summary)) {
  process.stderr.write(`  ${c}: ${n}\n`);
}

const outFile = path.join(DATA_DIR, `e22-v7-focused-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  skill: 'v7',
  model: MODEL,
  analysisMode: 'multiWave',
  analysisWaves: ALL_WAVES,
  total_findings: diags.length,
  by_wave: waveSummary,
  by_code: summary,
  by_severity: bySeverity,
  findings: diags,
  elapsed_ms: elapsedMs,
  captured_at: new Date().toISOString(),
}, null, 2));

process.stderr.write(`\n=== E22 SUMMARY ===\n`);
process.stderr.write(`Model: ${MODEL}\n`);
process.stderr.write(`Waves: ${ALL_WAVES.join(', ')}\n`);
process.stderr.write(`Total findings: ${diags.length}\n`);
process.stderr.write(`By wave: ${JSON.stringify(waveSummary)}\n`);
process.stderr.write(`By code: ${JSON.stringify(summary)}\n`);
process.stderr.write(`Elapsed: ${elapsedMs}ms\n`);
process.stderr.write(`Saved: ${outFile}\n`);
