#!/usr/bin/env node
// scripts/probes/e27-retest.mjs
/**
 * E50-replacement probe: run all 9 candidate models through the same 6-wave
 * schema-mode evaluation as the leaderboard E27 used, but on the real-shape
 * schema so we can directly compare with our schema-mode default.
 *
 * Goal: produce a one-shot comparison of every model we previously ruled
 * out for response-shape reasons plus the E27 winners we haven't validated
 * under the new schema mode.
 */
import { LLM_RESPONSE_JSON_SCHEMA_BODY } from '../../out/providers/llmResponseSchema.js';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

// Same SAMPLE_DOC the per-model debug used — exercises contradictions + ambiguities
// + persona + structural + coverage + hygiene on a document with all of those.
const SAMPLE_DOC = `
# Authentication and Session Management

When authenticating users, you must verify the password. However, you may only
use passwordless authentication (magic links) for new accounts. Session timeout
must be set to 30 minutes for all roles. Admins can extend session timeout to
unlimited. Tokens must be rotated every 24 hours. Tokens must never be rotated
during active sessions. Use Redis to cache sessions. Use Memcached instead of
Redis for sessions. Handle all errors gracefully. Errors should bubble up to the
caller. Users must not see raw error messages. Display internal stack traces in
development mode. Always log PII for audit purposes. Never log PII under any
circumstance. Return 200 OK on all responses. Return 4xx/5xx for errors. The API
should be RESTful. The API should follow RPC conventions. Rate limit at 100
requests per second. No rate limit is necessary for trusted clients. Cache all
responses for 1 hour. Never cache authenticated responses. Always validate
input. Trust internal services without validation.
`;

const WAVES = [
  { name: 'contradictions', system: 'You are a contradiction-detection expert. Respond with strict JSON only.' },
  { name: 'ambiguities',    system: 'You are an ambiguity-detection expert. Respond with strict JSON only.' },
  { name: 'persona',        system: 'You are a persona-consistency expert. Respond with strict JSON only.' },
  { name: 'structural',     system: 'You are a structural-quality expert. Respond with strict JSON only.' },
  { name: 'coverage',       system: 'You are a semantic-coverage expert. Respond with strict JSON only.' },
  { name: 'hygiene',        system: 'You are a prompt-hygiene expert. Respond with strict JSON only.' },
];

// All 9 — cheap tier (≤ £0.50/M input) candidates worth retrying under schema mode.
const MODELS = [
  // E27 winners under json_object only
  { id: 'openai/gpt-oss-safeguard-20b',         note: 'E27 #1 (composite 82.7, 93% recall)' },
  { id: 'mistralai/ministral-3b-2512',         note: 'E27 #2 (composite 82.2, 73% recall, 0 FP)' },
  { id: 'bytedance-seed/seed-1.6-flash',       note: 'E27 #3 (composite 80.8, 100% recall)' },
  { id: 'qwen/qwen3-coder-30b-a3b-instruct',   note: 'E27 #4 (composite 79.8, 100% recall)' },
  { id: 'qwen/qwen3-vl-8b-instruct',           note: 'E27 #5 (composite 79.6, 100% recall)' },
  { id: 'openai/gpt-oss-120b',                  note: 'E27 #6 (composite 73.5, 60% recall, $0.037)' },
  // Shape-rejected — should now work with schema mode
  { id: 'meta-llama/llama-3.1-8b-instruct',     note: 'E27 shape-rejected (6× llm-error)' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b',      note: 'E27 3/6 errors — partial JSON compliance' },
  // Current default — sanity baseline
  { id: 'google/gemini-2.5-flash-lite',         note: 'CURRENT default — baseline' },
];

async function callWave(model, systemPrompt) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze this document:\n\n${SAMPLE_DOC}` },
    ],
    max_tokens: 16384,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: LLM_RESPONSE_JSON_SCHEMA_BODY.name,
        strict: LLM_RESPONSE_JSON_SCHEMA_BODY.strict,
        schema: LLM_RESPONSE_JSON_SCHEMA_BODY.schema,
      },
    },
  };
  const t0 = Date.now();
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/mutl3y/skills-review-and-polish',
        'X-Title': 'skills-review-and-polish (e27-retest)',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const elapsed = Date.now() - t0;
    const raw = await resp.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed) return { ok: false, elapsed, httpStatus: resp.status, error: `HTTP ${resp.status} non-JSON body`, finish: '?', tokens: 0, parsed: false, keyCount: 0 };
    if (parsed.error) {
      const errMsg = parsed.error.message ?? JSON.stringify(parsed.error);
      const isRate = /rate.?limit|temporarily|429|too many/i.test(errMsg);
      return { ok: false, elapsed, httpStatus: resp.status, error: errMsg.slice(0, 140), finish: '?', tokens: 0, parsed: true, keyCount: 0, isRate };
    }
    const choice = parsed.choices?.[0];
    const text = choice?.message?.content ?? '';
    const finish = choice?.finish_reason ?? '?';
    const tokens = parsed.usage?.completion_tokens ?? 0;
    let parseOk = false, allKeys = false, keyCount = 0;
    try {
      const obj = JSON.parse(text);
      parseOk = true;
      const required = ['contradictions','ambiguity_issues','persona_issues','cognitive_load','coverage_analysis','hygiene_issues','custom_diagnostics','conflicts'];
      const present = required.filter(k => k in obj);
      keyCount = present.length;
      allKeys = present.length === required.length;
    } catch {}
    return { ok: parseOk && allKeys, elapsed, httpStatus: resp.status, finish, tokens, parsed: true, allKeys, keyCount, textLen: text.length };
  } catch (e) {
    return { ok: false, elapsed: Date.now() - t0, httpStatus: 0, error: e.message.slice(0, 120), finish: '?', tokens: 0, parsed: false, keyCount: 0, isRate: false };
  }
}

console.log(`Probe: ${MODELS.length} models × ${WAVES.length} waves = ${MODELS.length * WAVES.length} calls.`);
console.log(`Schema: name=${LLM_RESPONSE_JSON_SCHEMA_BODY.name}, strict=${LLM_RESPONSE_JSON_SCHEMA_BODY.strict}`);
console.log(`Log file: logs/e27-retest.log`);
console.log('=========================================================\n');

const startTime = Date.now();

// Each model: a 1.5s delay between waves to stay under typical free-tier
// upstream RPS caps. Total cost across all 9 models ≈ 9 × 6 × 1.5s = 81s
// minimum wall clock, plus request latency. Models with strict RPS caps
// (gpt-oss-safeguard-20b, gpt-oss-120b served by Groq) need this to avoid
// upstream 429s.
const INTER_WAVE_DELAY_MS = 1500;

for (const model of MODELS) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`MODEL: ${model.id}   [${model.note}]`);
  console.log('='.repeat(80));
  let totalElapsed = 0;
  let okCount = 0;
  let errorFinishes = 0;
  let totalTokens = 0;
  let firstErr = '';
  for (const wave of WAVES) {
    process.stdout.write(`  ${wave.name.padEnd(15)} ... `);
    const r = await callWave(model.id, wave.system);
    totalElapsed += r.elapsed;
    totalTokens += r.tokens;
    let status;
    if (r.ok) { status = 'OK'; okCount++; }
    else if (r.isRate) { status = 'RATE-LIMIT'; errorFinishes++; if (!firstErr) firstErr = r.error ?? ''; }
    else if (r.finish === 'error') { status = 'ERROR'; errorFinishes++; if (!firstErr) firstErr = r.error ?? ''; }
    else if (r.finish === 'length') { status = 'TRUNC'; errorFinishes++; }
    else if (!r.parsed) { status = 'FAIL'; errorFinishes++; if (!firstErr) firstErr = r.error ?? ''; }
    else { status = 'INCOMPLETE'; errorFinishes++; if (!firstErr) firstErr = `missing keys: ${r.keyCount}/8`; }
    process.stdout.write(`${status.padEnd(11)} ${r.finish.padEnd(7)} ${String(r.tokens).padStart(5)} tok  ${(r.elapsed/1000).toFixed(2).padStart(5)}s`);
    if (!r.ok && firstErr) process.stdout.write(`  (${firstErr.slice(0,80)})`);
    process.stdout.write('\n');
    if (INTER_WAVE_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, INTER_WAVE_DELAY_MS));
    }
  }
  const rate = (okCount / WAVES.length * 100).toFixed(0);
  const totalSec = (totalElapsed/1000).toFixed(1);
  console.log(`  ---`);
  console.log(`  Success: ${okCount}/${WAVES.length} (${rate}%) | error finishes: ${errorFinishes} | total: ${totalSec}s | ${totalTokens} tok`);
}

const wallClock = ((Date.now() - startTime)/1000).toFixed(1);
console.log(`\n=========================================================`);
console.log(`Total wall clock: ${wallClock}s`);
console.log(`Estimated cost: < $0.05 (all 9 models are ≤ $0.12/M input, all under £0.50/M)`);