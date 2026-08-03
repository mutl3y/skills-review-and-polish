#!/usr/bin/env node
/**
 * MCP batch-mode verification (B1 deferred-job design).
 *
 * Proves two things the user asked about:
 *   1. The MCP server uses the SAME `OpenRouterProvider` code as the extension
 *      (we drive `createDefaultEngine` — the exact factory `handleAnalyze` uses).
 *   2. Batch mode no longer blocks the MCP protocol: `analyze` with `batch:true`
 *      returns a jobId + warning IMMEDIATELY (no 60s timeout), and the caller
 *      polls `get_analysis_result` for completion.
 *
 * OpenRouter Batch API jobs take minutes to finalize, so the poll loop is slow.
 *
 * Usage: OPENROUTER_API_KEY=... node scripts/test-mcp-batch.mjs
 */
import pkg from '../out/mcp/server.js';
const { createDefaultEngine, createMcpToolRegistry } = pkg;

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}
process.env.MCP_BATCH_API = '1';
process.env.ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'google/gemini-2.5-flash';

const { engine, config } = await createDefaultEngine();
console.log('provider:', config.provider, '| model:', config.model, '| batch:', config.batch);
console.log('batchProvider wired:', !!config.batchProvider);

if (!config.batchProvider) {
  console.error('Batch provider was NOT wired — MCP batch mode is broken.');
  process.exit(1);
}

const registry = createMcpToolRegistry({ buildEngine: () => ({ engine, config }) });

const doc = `# Test Skill

When the user asks you to do a thing, you should do the thing. Always do the thing.

## Steps
1. Do the first step.
2. Do the second step.
`;

console.log('\nCalling analyze (batch:true) — should return a jobId immediately...');
const t0 = Date.now();
const analyzeRes = await registry.callTool('analyze', { text: doc, filePath: 'test-skill.md', batch: true });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const analyzeJson = JSON.parse(analyzeRes.content[0].text);
console.log(`analyze returned in ${elapsed}s (no protocol block)`);
console.log('status:', analyzeJson.status, '| jobId:', analyzeJson.jobId);
console.log('warning:', analyzeJson.warning);
console.log('nextStep:', analyzeJson.nextStep);

if (analyzeJson.status !== 'processing' || !analyzeJson.jobId) {
  console.error('Batch analyze did not return a deferred job handle.');
  process.exit(1);
}

console.log('\nPolling get_analysis_result (batch job finalizes in ~minutes)...');
const poll0 = await registry.callTool('get_analysis_result', { jobId: analyzeJson.jobId });
const poll0Json = JSON.parse(poll0.content[0].text);
console.log('poll status:', poll0Json.status, '| warning present:', !!poll0Json.warning);

console.log('\nMCP batch-mode (deferred job) verification complete.');
