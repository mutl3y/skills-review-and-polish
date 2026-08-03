/**
 * E13: Establish a NEW baseline by running the analyzer with E8+E10+E9+E11
 * fixes against 15 representative skills from /workspace/awesome-copilot-fork.
 *
 * This is the FIRST comprehensive scoring run against the fork since the
 * analyzer fixes were applied. Prior "load of skills" runs (per the user's
 * recollection) were not saved to this repo, so this run becomes the new
 * comparison point for any future analyzer versions.
 *
 * Usage: node scripts/baseline-fork.mjs
 *
 * Output:
 *   .github/experiments/documentation-review/data/baseline-fork/<skill>.json
 *   .github/experiments/documentation-review/data/baseline-fork/summary.json
 *   .github/experiments/documentation-review/logs/baseline-fork-*.log
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine, scoreSkill, parseSkillType } = await import('../out/core/index.js');
const { OpenRouterProvider } = await import('../out/providers/externalProvider.js');

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

const SKILLS_ROOT = '/workspace/awesome-copilot-fork/skills';
const OUTPUT_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'data', 'baseline-fork');
const LOG_DIR = path.join(__dirname, '..', '.github', 'experiments', 'documentation-review', 'logs');

// Redirect stderr to a timestamped log file so progress can be checked
// without consuming buffered output.
const LOG_FILE = path.join(LOG_DIR, `baseline-fork-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...args) => {
  logStream.write(chunk);
  return originalStderrWrite(chunk, ...args);
};
process.stderr.write(`=== E13 baseline-fork log started ${new Date().toISOString()} ===\n`);

// The 15 representative skills (curated sample spanning 6-2738 lines).
const SAMPLE_SKILLS = [
  // Small (6-30 lines)
  'azure-role-selector',
  'remember-interactive-programming',
  'create-readme',
  'boost-prompt',
  // Medium (50-200 lines)
  'microsoft-agent-framework',
  'github-actions-efficiency',
  'datanalysis-credit-risk',
  'phoenix-tracing',
  'salesforce-apex-quality',
  'github-issues',
  // Larger (250-500+ lines)
  'create-agentsmd',
  'java-mcp-server-generator',
  'acquire-codebase-knowledge',
  'arize-trace',
  'quality-playbook',
];

const INFRA_CODES = new Set([
  'llm-error', 'llm-parse-error', 'llm-disabled',
  'llm-loop-detected', 'high-complexity', 'limited-coverage',
  'contradiction-related', 'llm-rate-limited',
]);

const provider = new OpenRouterProvider({ apiKey, model: 'gpt-4o-mini' });
const engine = new Engine(provider, {
  analysisMode: 'single',
  enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
  scoreSamples: 1,                 // single-pass for this baseline
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: false,
  filterFindings: true,            // E11: enable new post-processor rules
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const COOLDOWN_MS = 30_000;

async function main() {
  console.error(`\n=== E13 baseline-fork: ${SAMPLE_SKILLS.length} skills from ${SKILLS_ROOT} ===`);
  console.error(`Mode: single | Model: gpt-4o-mini | Cooldown: ${COOLDOWN_MS}ms\n`);

  const startTime = Date.now();
  const results = [];
  let totalFindings = 0;
  let totalRateLimited = 0;
  let totalFailed = 0;

  for (let i = 0; i < SAMPLE_SKILLS.length; i++) {
    const skill = SAMPLE_SKILLS[i];
    const skillPath = path.join(SKILLS_ROOT, skill, 'SKILL.md');
    const fileStart = Date.now();

    if (!fs.existsSync(skillPath)) {
      console.error(`[${i + 1}/${SAMPLE_SKILLS.length}] ${skill}: SKILL.md NOT FOUND, skipping`);
      continue;
    }

    const text = fs.readFileSync(skillPath, 'utf8');
    const lineCount = text.split('\n').length;
    const charCount = text.length;
    const skillType = parseSkillType(text);
    console.error(`[${i + 1}/${SAMPLE_SKILLS.length}] ${skill} (${lineCount} lines, ${charCount} chars, type=${skillType})... `);

    try {
      const findings = await engine.analyze({ text, filePath: skillPath });
      const elapsed = ((Date.now() - fileStart) / 1000).toFixed(1);

      const isRateLimited = findings.some(f => f.code === 'llm-rate-limited');
      if (isRateLimited) totalRateLimited += 1;

      // Compute the per-skill score (the same Engine.score() uses)
      const score = scoreSkill(findings, text, { scoreSamples: 1 });

      const realFindings = findings.filter(f => !INFRA_CODES.has(f.code));
      console.error(`  ${realFindings.length} findings, grade=${score.grade}, penalty=${score.totalPenalty} (${elapsed}s)\n`);
      totalFindings += realFindings.length;

      // Per-skill output
      const skillData = {
        label: `baseline-fork-${skill}`,
        started_at: new Date(fileStart).toISOString(),
        finished_at: new Date().toISOString(),
        input: skillPath,
        skill_metadata: {
          name: skill,
          line_count: lineCount,
          char_count: charCount,
          type: skillType,
        },
        analyzer_config: { mode: 'single', model: 'gpt-4o-mini', cooldown_ms: COOLDOWN_MS, fixes_applied: ['E8', 'E10', 'E9', 'E11'] },
        stats: {
          total_findings: realFindings.length,
          by_code: realFindings.reduce((acc, f) => { acc[f.code] = (acc[f.code] || 0) + 1; return acc; }, {}),
          rate_limited: isRateLimited,
        },
        score: {
          grade: score.grade,
          total_penalty: score.totalPenalty,
          issue_penalty: score.issuePenalty,
          length_penalty: score.lengthPenalty,
          score: score.score,
          pillars: score.pillars,
        },
        findings: realFindings.map(f => ({
          code: f.code,
          severity: f.severity,
          line: f.range?.start?.line ?? null,
          message: String(f.message ?? '').slice(0, 400),
          suggestion: f.suggestion ? String(f.suggestion).slice(0, 300) : '',
        })),
      };
      results.push(skillData);

      const outFile = path.join(OUTPUT_DIR, `${skill}.json`);
      fs.writeFileSync(outFile, JSON.stringify(skillData, null, 2));
    } catch (err) {
      totalFailed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${msg.slice(0, 100)}\n`);
    }

    if (i < SAMPLE_SKILLS.length - 1) {
      console.error(`  (waiting ${COOLDOWN_MS / 1000}s for rate limit)\n`);
      await sleep(COOLDOWN_MS);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.error(`\n=== E13 Summary ===`);
  console.error(`Skills: ${SAMPLE_SKILLS.length}`);
  console.error(`Total findings: ${totalFindings}`);
  console.error(`Total LLM calls: ${SAMPLE_SKILLS.length}`);
  console.error(`Rate-limited: ${totalRateLimited}, Failed: ${totalFailed}`);
  console.error(`Total time: ${totalTime}s`);

  // Write summary
  const summary = {
    label: 'baseline-fork-summary',
    finished_at: new Date().toISOString(),
    analyzer_config: { mode: 'single', model: 'gpt-4o-mini', fixes_applied: ['E8', 'E10', 'E9', 'E11'] },
    total_skills: SAMPLE_SKILLS.length,
    total_findings: totalFindings,
    rate_limited: totalRateLimited,
    failed: totalFailed,
    total_runtime_seconds: Number(totalTime),
    by_grade: results.reduce((acc, r) => { acc[r.score.grade] = (acc[r.score.grade] || 0) + 1; return acc; }, {}),
    by_skill: results.map(r => ({
      name: r.skill_metadata.name,
      lines: r.skill_metadata.line_count,
      chars: r.skill_metadata.char_count,
      type: r.skill_metadata.type,
      grade: r.score.grade,
      score: r.score.score,
      issue_penalty: r.score.issue_penalty,
      length_penalty: r.score.length_penalty,
      total_findings: r.stats.total_findings,
    })),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  // Print the comparison table
  console.log(`\n## E13 baseline-fork (E8+E10+E9+E11 fixes)\n`);
  console.log(`| Skill | Lines | Type | Grade | Score | Penalty (issue+length) | Findings |`);
  console.log(`| --- | ---: | --- | --- | ---: | --- | ---: |`);
  for (const r of summary.by_skill.sort((a, b) => b.lines - a.lines)) {
    console.log(`| ${r.name} | ${r.lines} | ${r.type} | ${r.grade} | ${r.score} | ${r.issue_penalty}+${r.length_penalty} | ${r.total_findings} |`);
  }
  console.log(`\nGrade distribution: ${JSON.stringify(summary.by_grade)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
