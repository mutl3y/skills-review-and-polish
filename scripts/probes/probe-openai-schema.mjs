#!/usr/bin/env node
/**
 * Get the full error message from OpenAI when sending our schema.
 * Useful to understand exactly which schema constraint is violated.
 */
import { LLM_RESPONSE_JSON_SCHEMA_BODY } from '../../out/providers/llmResponseSchema.js';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

const body = {
  model: 'openai/gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a contradiction-detection expert. Respond with strict JSON only.' },
    { role: 'user', content: 'Analyze: Use Redis for sessions. Use Memcached instead of Redis for sessions.' },
  ],
  max_tokens: 1024,
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: LLM_RESPONSE_JSON_SCHEMA_BODY.name,
      strict: LLM_RESPONSE_JSON_SCHEMA_BODY.strict,
      schema: LLM_RESPONSE_JSON_SCHEMA_BODY.schema,
    },
  },
};

console.log('--- request ---');
console.log(JSON.stringify(body, null, 2));

console.log('\n--- response ---');
const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/mutl3y/skills-review-and-polish',
    'X-Title': 'skills-review-and-polish (schema-debug)',
  },
  body: JSON.stringify(body),
});
const raw = await resp.text();
console.log(`HTTP ${resp.status}`);
try {
  const parsed = JSON.parse(raw);
  console.log(JSON.stringify(parsed, null, 2));
} catch {
  console.log(raw);
}