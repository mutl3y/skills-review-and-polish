/**
 * Analyze all prompt files — one at a time with delays to avoid rate limits.
 * Uses single-mode (1 call per file instead of 7 waves).
 * Run: node scripts/analyze-prompts-safe.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { Engine } = await import('../out/core/index.js');
const { OpenRouterProvider } = await import('../out/providers/externalProvider.js');

const PROMPTS_DIR = path.join(__dirname, '../src/core/prompts');
const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error('Set OPENROUTER_API_KEY');
  process.exit(1);
}

const FIXABLE = new Set([
  'ambiguity-llm', 'hygiene-redundant-instruction',
  'hygiene-unordered-process', 'hygiene-over-specification', 'contradiction',
]);

const provider = new OpenRouterProvider({
  apiKey,
  model: 'xiaomi/mimo-v2.5-pro',
});
const engine = new Engine(provider, {
  analysisMode: 'single',  // 1 call per file instead of 7 waves
  enabledWaves: ['contradictions', 'ambiguities', 'persona', 'structural', 'coverage', 'hygiene'],
  scoreSamples: 1,
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: false,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md'));
  const allIssues = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(PROMPTS_DIR, file);
    const text = fs.readFileSync(filePath, 'utf8');
    console.error(`\n[${i+1}/${files.length}] Analyzing ${file} (${text.length} chars)...`);
    
    try {
      const results = await engine.analyze({ text, filePath });
      const infra = new Set(['llm-error', 'llm-parse-error', 'llm-disabled', 'llm-loop-detected', 'high-complexity', 'limited-coverage', 'contradiction-related']);
      const findings = results.filter(r => !infra.has(r.code));
      console.error(`  → ${findings.length} issues found`);
      
      for (const r of findings) {
        allIssues.push({
          file,
          code: r.code,
          severity: r.severity,
          message: r.message.slice(0, 250),
          suggestion: r.suggestion?.slice(0, 200) ?? '',
          fixable: FIXABLE.has(r.code),
        });
      }
    } catch (err) {
      console.error(`  → Error: ${err.message}`);
    }
    
    // Delay between files to respect rate limits
    if (i < files.length - 1) {
      console.error('  Waiting 5s for rate limit...');
      await sleep(5000);
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total issues: ${allIssues.length}`);
  console.log(`Fixable (✅): ${allIssues.filter(i => i.fixable).length}`);
  console.log(`Not fixable (❌): ${allIssues.filter(i => !i.fixable).length}`);
  
  console.log('\n=== BY CODE ===');
  const byCode = {};
  for (const issue of allIssues) {
    byCode[issue.code] = (byCode[issue.code] || 0) + 1;
  }
  for (const [code, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${FIXABLE.has(code) ? '✅' : '❌'} ${code}: ${count}`);
  }

  console.log('\n=== ALL ISSUES ===');
  for (const issue of allIssues) {
    console.log(`\n[${issue.fixable ? '✅' : '❌'}] ${issue.file} | ${issue.code} (${issue.severity})`);
    console.log(`    ${issue.message}`);
    if (issue.suggestion) console.log(`    💡 ${issue.suggestion}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
