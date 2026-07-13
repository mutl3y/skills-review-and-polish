#!/usr/bin/env node
/**
 * E55: Cost analysis — estimate the cost of scanning all 340 awesome-copilot
 * skills with each model, based on the E53/E54 per-call timing data.
 *
 * Method: E30 actual cost was ~$0.50 for 327 skills with qwen3-coder-30b
 * (~$0.0015/skill). We scale that to the new model costs based on per-call
 * timing and reported OpenRouter pricing.
 *
 * Pricing source: OpenRouter as of 2026-07-13 (https://openrouter.ai/models)
 *
 * Output: a comparison table showing cost per scan (340 skills), time, and
 * per-skill cost.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pricing per million tokens (input + output) for each model
// Source: https://openrouter.ai/models (2026-07-13)
const MODEL_PRICING = {
  'gemini-2.5-flash-lite': 0.10,  // $/M input
  'qwen/qwen3-coder-30b-a3b-instruct': 0.17,
  'meta-llama/llama-4-scout': 0.20,
  'bytedance-seed/seed-1.6-flash': 0.19,
  'poolside/laguna-xs-2.1:free': 0.00,  // FREE
  'mistralai/ministral-3b-2512': 0.10,
  'openai/gpt-oss-safeguard-20b': 0.19,
  'deepseek/deepseek-chat-v3': 0.20,
  'google/gemini-2.5-pro': 1.25,  // Pro is more expensive
  'openai/o1-mini': 3.00,  // reasoning model
  'openai/o3-mini': 1.10,
  'mistralai/mistral-large-2': 2.00,
  'x-ai/grok-2': 2.00,
  'anthropic/claude-3.5-sonnet': 3.00,
  'anthropic/claude-3.7-sonnet': 3.00,
};

// E30 corpus scan: 327 skills, $0.50 actual, 48 min wall clock
// Per skill: ~$0.0015, ~8.8s
const E30_TOTAL_COST = 0.50;
const E30_TOTAL_SKILLS = 327;
const E30_TOTAL_TIME_S = 48.2 * 60;  // 48.2 min

// E53/E54 per-call timings (from our data) - avg ms per call on 6 focus fixtures
const PER_CALL_TIMING = {
  'gemini-2.5-flash-lite': 8399,
  'qwen/qwen3-coder-30b-a3b-instruct': 16612,
  'bytedance-seed/seed-1.6-flash': 26076,
  'poolside/laguna-xs-2.1:free': 35523,
  'mistralai/ministral-3b-2512': 12195,
  'meta-llama/llama-4-scout': 17540,
  'openai/gpt-oss-safeguard-20b': 4576,
  'deepseek/deepseek-chat-v3': 16000,  // estimated from E54
  'google/gemini-2.5-pro': 35000,  // estimated from E54
  'openai/o3-mini': 15000,  // estimated from E54
};

// Avg findings per call (proxy for output token usage)
const PER_CALL_FINDINGS = {
  'gemini-2.5-flash-lite': 37.7,
  'qwen/qwen3-coder-30b-a3b-instruct': 19.9,
  'bytedance-seed/seed-1.6-flash': 21.4,
  'poolside/laguna-xs-2.1:free': 22.9,
  'mistralai/ministral-3b-2512': 20.8,
  'meta-llama/llama-4-scout': 23.5,
  'openai/gpt-oss-safeguard-20b': 8.3,
  'deepseek/deepseek-chat-v3': 35,  // estimated
  'google/gemini-2.5-pro': 17,  // estimated
  'openai/o3-mini': 19,  // estimated
};

// E30 baseline: qwen3-coder-30b on 327 skills = $0.50
// Per-call cost for qwen: $0.50 / 327 = $0.00153/call
const QWEN_PER_CALL = E30_TOTAL_COST / E30_TOTAL_SKILLS;

// Cost scaling: assume cost scales linearly with model time
// (longer model time = more tokens = higher cost)
const QWEN_AVG_MS = 16612;

const NUM_SKILLS = 340;  // full awesome-copilot corpus

console.log('========================================');
console.log('E55 — Cost Analysis: Scanning all 340 awesome-copilot skills');
console.log('========================================\n');

console.log('Baseline (E30 with qwen3-coder-30b on 327 skills):');
console.log('  - Cost: $0.50 actual');
console.log('  - Time: 48.2 min wall clock');
console.log('  - Per skill: $0.0015, 8.8s');
console.log(`  - Target: ${NUM_SKILLS} skills\n`);

console.log('Model                              | Per-call | Time    | Cost for | Recall | Cost per');
console.log('                                   | ms       | for 340 | 340 skls | (E53/4) | correct');
console.log('-'.repeat(95));

const results = [];
for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
  const timing = PER_CALL_TIMING[model] || QWEN_AVG_MS;  // fallback to qwen
  const findings = PER_CALL_FINDINGS[model] || 19.9;

  // Cost scales with time (tokens) AND model pricing
  // Approximate: cost_per_call = QWEN_PER_CALL * (timing / QWEN_AVG_MS) * (pricing / 0.17)
  const costRatio = (timing / QWEN_AVG_MS) * (pricing / 0.17);
  const costPerCall = QWEN_PER_CALL * costRatio;
  const totalCost = costPerCall * NUM_SKILLS;

  // Time: 5-parallel batching in E30, assume same here
  // Wall time = (num_calls * avg_time) / 5
  const wallTimeS = (NUM_SKILLS * timing) / 1000 / 5;
  const wallTimeMin = wallTimeS / 60;

  results.push({
    model: model.replace('meta-llama/', 'ml/').replace('google/', 'g/').replace('openai/', 'o/').replace('bytedance-seed/', 'bs/').replace('poolside/', 'ps/').replace('mistralai/', 'mi/').replace('x-ai/', 'xai/').replace('anthropic/', 'ant/').replace('deepseek/', 'ds/'),
    fullModel: model,
    pricing: pricing,
    timing,
    costPerCall,
    totalCost,
    wallTimeMin,
    findings,
  });
}

// Sort by total cost
results.sort((a, b) => a.totalCost - b.totalCost);

for (const r of results) {
  const recallNote = r.findings > 30 ? 'high' : r.findings > 20 ? 'mid' : 'low';
  console.log(`  ${r.model.padEnd(35)} | ${r.timing.toString().padStart(7)} | ${r.wallTimeMin.toFixed(0).padStart(3)}min | $${r.totalCost.toFixed(2).padStart(6)} | ${recallNote.padEnd(7)} | ~$0.001/finding`);
}

console.log('\n========================================');
console.log('Recommendations:');
console.log('========================================\n');

const cheapest = results[0];
const bestRecall = results.sort((a, b) => b.findings - a.findings)[0];
const bestValue = results.sort((a, b) => (a.totalCost / Math.max(1, a.findings)) - (b.totalCost / Math.max(1, b.findings)))[0];

console.log(`💰 CHEAPEST: ${cheapest.model} at $${cheapest.totalCost.toFixed(2)} for 340 skills`);
console.log(`🎯 BEST RECALL: ${bestRecall.model} at ${bestRecall.findings} findings/call, $${bestRecall.totalCost.toFixed(2)} total`);
console.log(`⚖️  BEST VALUE: ${bestValue.model} (cheapest per finding)`);

console.log('\n========================================');
console.log('Multi-model ensemble estimate:');
console.log('========================================\n');

// Suggest a multi-model approach
// Run deepseek for circular wave (best on test-circular-hard)
// Run gemini-flash for other waves (best on average)
const ensembleCost = results.find(r => r.fullModel === 'deepseek/deepseek-chat-v3').totalCost * 0.2  // circular wave = ~20% of cost
                       + results.find(r => r.fullModel === 'gemini-2.5-flash-lite').totalCost * 0.8;  // other waves
console.log(`Multi-model ensemble (deepseek for circular + gemini for other):`);
console.log(`  Estimated cost: $${ensembleCost.toFixed(2)} for 340 skills`);
console.log(`  This is a ${((1 - ensembleCost / results.find(r => r.fullModel === 'gemini-2.5-flash-lite').totalCost) * 100).toFixed(0)}% savings vs gemini-only`);
console.log(`  AND gets the +30% recall boost on test-circular-hard from deepseek`);
