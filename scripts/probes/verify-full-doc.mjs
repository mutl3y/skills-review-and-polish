// scripts/probes/verify-full-doc.mjs
// Verify: with a 1M-context model, the analyzer sends the full skill to the
// LLM (no head/tail truncation) and includes reference files.
// Cited from CHANGELOG.md (v0.1.39 — Analyzer no longer head/tail truncates),
// docs/plan/archive/releases/20260716-release-readiness-remediation/plan.yaml, and
// docs/plan/LEARNINGS.md ("Never head/tail slice a document the analyzer is
// supposed to review in full").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { Engine } = await import(path.join(ROOT, 'out', 'core', 'index.js'));
const { OpenRouterProvider } = await import(path.join(ROOT, 'out', 'providers', 'externalProvider.js'));

const apiKey = process.env.OPENROUTER_API_KEY;
const skillPath = process.env.SKILLS_REVIEW_PROBE_SKILL
  || '/workspace/awesome-copilot-fork/skills/quality-playbook/SKILL.md';
const text = fs.readFileSync(skillPath, 'utf8');

const provider = new OpenRouterProvider({
  apiKey,
  model: 'google/gemini-2.5-flash-lite',
  contextLength: 1_000_000, // 1M tokens
  maxTokens: 100,
});
const engine = new Engine(provider, {
  analysisMode: 'focused',
  enabledWaves: [],
  scoreSamples: 1,
  fixStrategy: 'subtractive',
  fixSemanticCheck: false,
  fixSelfCritique: false,
  fixReferenceGrounding: false,
});

// Build the user prompt via a partial analyzer.analyze call but capture what we'd send.
// Easier: directly call the analyzer's private buildUserPrompt.
const analyzer = engine.analyzer;
const prompt = await analyzer.buildUserPrompt(text, skillPath);

console.log('Input text:', text.length, 'chars');
console.log('Prompt length:', prompt.length, 'chars');
console.log('Contains "HEAD-CONTENT"-style head/tail markers?', prompt.includes('[...') && prompt.includes('omitted for model context budget'));
console.log('Contains reference file delimiters?', (prompt.match(/--- /g) ?? []).length, 'matches');
console.log('First 200 chars of prompt:');
console.log(prompt.slice(0, 200));
console.log('...');
console.log('Last 200 chars of prompt:');
console.log(prompt.slice(-200));
