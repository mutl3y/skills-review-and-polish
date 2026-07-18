// scripts/probes/test-single-schema.mjs
// Single-fixture schema-mode test to verify the path works in isolation
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { Engine } = await import(path.join(ROOT, 'out', 'core', 'index.js'));
const { OpenRouterProvider } = await import(path.join(ROOT, 'out', 'providers', 'externalProvider.js'));
import fs from 'node:fs';

const apiKey = process.env.OPENROUTER_API_KEY;
const fixture = '../../tests/fixtures/clean/test-cognitive-structural.md';
const text = fs.readFileSync(fixture, 'utf8');

const provider = new OpenRouterProvider({
  apiKey,
  model: 'google/gemini-2.5-flash-lite',
  deepModel: 'deepseek/deepseek-chat-v3',
  maxTokens: 16384,
  maxRetries: 0,
  structuredOutput: 'schema',
  requestTimeoutMs: 120000,
});
const engine = new Engine(provider, {
  analysisMode: 'multiWave',
  analysisWaves: ['contradictions','ambiguities','persona','structural','coverage','hygiene'],
  maxRetries: 0,
});

const t0 = Date.now();
console.log('starting analyze at', new Date().toISOString());
try {
  const results = await engine.analyze({ text, filePath: fixture });
  console.log(`done in ${(Date.now()-t0)/1000}s — ${results.length} findings`);
} catch (e) {
  console.log(`failed in ${(Date.now()-t0)/1000}s — ${e.message}`);
}
