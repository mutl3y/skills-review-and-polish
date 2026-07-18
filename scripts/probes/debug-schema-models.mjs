#!/usr/bin/env node
// scripts/probes/debug-schema-models.mjs
/**
 * Compare structured-output reliability across models.
 * Runs the same 6-wave schema-mode probe against each model and reports
 * per-wave success rate, average elapsed time, and parse failures.
 *
 * Usage:
 *   node scripts/probes/debug-schema-models.mjs <model-id> [<model-id> ...]
 *
 * Examples:
 *   node scripts/probes/debug-schema-models.mjs google/gemini-2.5-flash-lite google/gemini-2.5-flash google/gemini-2.0-flash-001
 */
import { LLM_RESPONSE_JSON_SCHEMA_BODY } from '../../out/providers/llmResponseSchema.js';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

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
        'X-Title': 'skills-review-and-polish (compare)',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const elapsed = Date.now() - t0;
    const raw = await resp.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed) return { ok: false, elapsed, error: `HTTP ${resp.status} non-JSON`, finish: '?', tokens: 0, parsed: false };
    if (parsed.error) return { ok: false, elapsed, error: JSON.stringify(parsed.error).slice(0, 120), finish: '?', tokens: 0, parsed: true };
    const choice = parsed.choices?.[0];
    const text = choice?.message?.content ?? '';
    const finish = choice?.finish_reason ?? '?';
    const tokens = parsed.usage?.completion_tokens ?? 0;
    let parseOk = false;
    let allKeys = false;
    try {
      const obj = JSON.parse(text);
      parseOk = true;
      const required = ['contradictions','ambiguity_issues','persona_issues','cognitive_load','coverage_analysis','hygiene_issues','custom_diagnostics','conflicts'];
      allKeys = required.every(k => k in obj);
    } catch {}
    return { ok: parseOk && allKeys, elapsed, finish, tokens, parsed: true, allKeys, textLen: text.length };
  } catch (e) {
    return { ok: false, elapsed: Date.now() - t0, error: e.message.slice(0, 100), finish: '?', tokens: 0, parsed: false };
  }
}

const models = process.argv.slice(2);
if (models.length === 0) {
  console.error('pass at least one model id');
  process.exit(1);
}

console.log(`Testing ${models.length} model(s) across ${WAVES.length} waves each.\n`);

for (const model of models) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`MODEL: ${model}`);
  console.log('='.repeat(80));
  let totalElapsed = 0;
  let okCount = 0;
  let errorFinishes = 0;
  let parseFails = 0;
  let missingKeys = 0;
  let totalTokens = 0;
  for (const wave of WAVES) {
    process.stdout.write(`  ${wave.name.padEnd(15)} ... `);
    const r = await callWave(model, wave.system);
    totalElapsed += r.elapsed;
    totalTokens += r.tokens;
    const status = r.ok ? 'OK' : (r.finish === 'error' ? 'ERROR' : r.finish === 'length' ? 'TRUNC' : 'FAIL');
    process.stdout.write(`${status.padEnd(6)} ${r.finish.padEnd(7)} ${String(r.tokens).padStart(5)} tok  ${(r.elapsed/1000).toFixed(2).padStart(5)}s`);
    if (!r.ok) {
      if (r.finish === 'error') errorFinishes++;
      if (!r.parsed) parseFails++;
      if (r.parsed && !r.allKeys) missingKeys++;
      if (r.error) process.stdout.write(`  err: ${r.error}`);
    } else {
      okCount++;
    }
    process.stdout.write('\n');
  }
  const rate = (okCount / WAVES.length * 100).toFixed(0);
  console.log(`  ---`);
  console.log(`  Success: ${okCount}/${WAVES.length} (${rate}%) | error finishes: ${errorFinishes} | total: ${(totalElapsed/1000).toFixed(1)}s | ${totalTokens} tok`);
}