// scripts/probes/verify-mcp-context.mjs
// Verify: with async createDefaultEngine, the analyzer gets a real
// context length from the OpenRouter catalog (not the 200K fallback).
// Cited from docs/plan/archive/releases/20260716-release-readiness-remediation/plan.yaml
// ("MCP createDefaultEngine is now async — fetches the OpenRouter
// catalog at startup (140ms cold, ~5ms warm, 1h cached)").

import fs from 'node:fs';
const { Engine } = await import('../../out/core/index.js');
const { OpenRouterProvider } = await import('../../out/providers/externalProvider.js');
const { resolveContextLength, fetchContextLengths, _resetCatalogCaches } = await import('../../out/modelCatalog.js');

// Force cold cache so we measure fresh fetch
_resetCatalogCaches();
const cacheFile = 'logs/skills-review-and-polish-openrouter-context-cache-v1.json';
try { fs.unlinkSync(cacheFile); } catch {}

const apiKey = process.env.OPENROUTER_API_KEY;
const t0 = Date.now();
const r = await resolveContextLength('google/gemini-2.5-flash-lite');
const t1 = Date.now();
console.log(`resolveContextLength('gemini-2.5-flash-lite') took ${t1 - t0}ms`);
console.log('Result:', JSON.stringify(r, null, 2));

// Second call (warm)
const t2 = Date.now();
const r2 = await resolveContextLength('google/gemini-2.5-flash-lite');
const t3 = Date.now();
console.log(`warm resolveContextLength took ${t3 - t2}ms`);

// Test the full chain: provider with contextLength
const t4 = Date.now();
const provider = new OpenRouterProvider({
  apiKey,
  model: 'google/gemini-2.5-flash-lite',
  contextLength: r?.contextLength,
});
const t5 = Date.now();
console.log(`provider construction: ${t5 - t4}ms`);
console.log(`provider.getContextLength() = ${provider.getContextLength()}`);

const engine = new Engine(provider);
const analyzer = engine.analyzer;
const skillPath = '/workspace/awesome-copilot-fork/skills/quality-playbook/SKILL.md';
const text = fs.readFileSync(skillPath, 'utf8');
const prompt = await analyzer.buildUserPrompt(text, skillPath);
console.log(`\nFinal prompt: ${prompt.length} chars (input was ${text.length} chars)`);
console.log(`Has head/tail truncation marker? ${prompt.includes('omitted for model context budget')}`);
console.log(`Ref delimiters: ${(prompt.match(/--- /g) ?? []).length}`);
