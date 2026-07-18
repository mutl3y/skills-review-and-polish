#!/usr/bin/env node
// scripts/probes/debug-schema-gemini.mjs
/**
 * Debug: exercise Gemini Flash Lite with the new strict json_schema mode,
 * wave-by-wave, mirroring what the analyzer does. Prints:
 *   - HTTP status + response time per request
 *   - finish_reason + completion_tokens
 *   - whether salvageTruncatedJSON-style recovery is needed
 *   - full response text (truncated to first 400 chars)
 *
 * If the response is valid JSON matching our schema, prints "OK".
 * If it's truncated, prints the truncation point and salvageability.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLM_RESPONSE_JSON_SCHEMA_BODY } from '../../out/providers/llmResponseSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Same shape as the analyzer's per-wave prompts (simplified — we don't have
// the real prompt files in the debug script, but the body is what matters).
const WAVES = [
  { name: 'contradictions',  system: 'You are a contradiction-detection expert. Respond with strict JSON only.' },
  { name: 'ambiguities',     system: 'You are an ambiguity-detection expert. Respond with strict JSON only.' },
  { name: 'persona',         system: 'You are a persona-consistency expert. Respond with strict JSON only.' },
  { name: 'structural',      system: 'You are a structural-quality expert. Respond with strict JSON only.' },
  { name: 'coverage',        system: 'You are a semantic-coverage expert. Respond with strict JSON only.' },
  { name: 'hygiene',         system: 'You are a prompt-hygiene expert. Respond with strict JSON only.' },
];

async function callOnce(model, systemPrompt, maxTokens) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze this document:\n\n${SAMPLE_DOC}` },
    ],
    max_tokens: maxTokens,
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
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/mutl3y/skills-review-and-polish',
      'X-Title': 'skills-review-and-polish (debug)',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const elapsed = Date.now() - t0;
  const raw = await resp.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  return { status: resp.status, elapsed, raw, parsed };
}

function summarise({ status, elapsed, parsed }, waveName) {
  console.log(`\n=== ${waveName} ===`);
  console.log(`HTTP: ${status} | elapsed: ${elapsed}ms`);
  if (!parsed) {
    console.log('Body (first 400 chars):', (raw) => raw.slice(0, 400));
    return;
  }
  if (parsed.error) {
    console.log('Error:', JSON.stringify(parsed.error).slice(0, 300));
    return;
  }
  const choice = parsed.choices?.[0];
  const finish = choice?.finish_reason;
  const text = choice?.message?.content ?? '';
  const usage = parsed.usage ?? {};
  console.log(`finish_reason: ${finish}`);
  console.log(`completion_tokens: ${usage.completion_tokens} | prompt_tokens: ${usage.prompt_tokens}`);
  console.log(`text length: ${text.length} chars`);
  console.log('Text (first 200 chars):', text.slice(0, 200).replace(/\n/g, '\\n'));
  // Try to parse as our schema
  try {
    const obj = JSON.parse(text);
    const topLevelKeys = Object.keys(obj);
    const required = ['contradictions','ambiguity_issues','persona_issues','cognitive_load','coverage_analysis','hygiene_issues','custom_diagnostics','conflicts'];
    const missing = required.filter(k => !(k in obj));
    console.log(`PARSE OK. top-level keys: ${topLevelKeys.length} (${topLevelKeys.join(', ')})`);
    if (missing.length) console.log(`MISSING REQUIRED: ${missing.join(', ')}`);
    else console.log('Schema: all 8 required keys present ✓');
  } catch (e) {
    console.log('PARSE FAIL:', e.message.slice(0, 100));
    // Truncation recovery test
    const lastBrace = text.lastIndexOf('}');
    const firstBrace = text.indexOf('{');
    if (lastBrace > firstBrace && lastBrace < text.length - 5) {
      const truncated = text.slice(firstBrace, lastBrace + 1);
      try { JSON.parse(truncated); console.log('truncation-recoverable'); }
      catch { console.log('NOT recoverable by simple truncation'); }
    }
  }
}

const MODEL = 'google/gemini-2.5-flash-lite';
const MAX_TOKENS = 16384;

console.log(`Model: ${MODEL}`);
console.log(`Max tokens: ${MAX_TOKENS}`);
console.log(`Schema: strict=${LLM_RESPONSE_JSON_SCHEMA_BODY.strict}, name=${LLM_RESPONSE_JSON_SCHEMA_BODY.name}`);
console.log(`Sample doc length: ${SAMPLE_DOC.length} chars`);

let totalSalvaged = 0;
let totalParseFails = 0;
let totalElapsed = 0;

for (const wave of WAVES) {
  try {
    const result = await callOnce(MODEL, wave.system, MAX_TOKENS);
    summarise(result, wave.name);
    totalElapsed += result.elapsed;
    if (result.parsed) {
      const text = result.parsed.choices?.[0]?.message?.content ?? '';
      try { JSON.parse(text); } catch {
        totalParseFails++;
        // crude salvage detection: response had `coverage_gaps[...` etc. was truncated
        if (text.endsWith(',') || (!text.trimEnd().endsWith('}') && text.length > 1000)) {
          totalSalvaged++;
        }
      }
    }
  } catch (e) {
    console.log(`\n=== ${wave.name} ===`);
    console.log('THREW:', e.message);
  }
}

console.log('\n=== SUMMARY ===');
console.log(`Total elapsed: ${totalElapsed}ms (${(totalElapsed/1000).toFixed(1)}s)`);
console.log(`Parse failures: ${totalParseFails} / ${WAVES.length}`);
console.log(`Likely truncated: ${totalSalvaged} / ${WAVES.length}`);