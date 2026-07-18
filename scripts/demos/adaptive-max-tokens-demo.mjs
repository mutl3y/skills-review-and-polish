#!/usr/bin/env node
/**
 * scripts/demos/adaptive-max-tokens-demo.mjs
 *
 * Demonstrates adaptive response-token budgeting on the OpenRouter provider
 * without hitting the network. Stubs `fetch` so we can inspect the exact
 * request body the provider would send for several prompt sizes.
 *
 * Scenarios shown:
 *   1. Default fixed max (16384) when adaptive mode is OFF.
 *   2. Adaptive ON, small prompt  →  clamped to minAdaptiveTokens.
 *   3. Adaptive ON, medium prompt →  computed desired tokens.
 *   4. Adaptive ON, huge prompt   →  clamped to maxResponseTokens.
 *   5. Override via maxTokens to confirm the explicit value wins.
 *
 * Run:  node scripts/demos/adaptive-max-tokens-demo.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenRouterProvider } from '../../out/providers/externalProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

async function capture(provider, prompt) {
  let body;
  const fetchMock = async (_url, init) => {
    body = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      }),
    };
  };
  globalThis.fetch = fetchMock;
  await provider.complete({ prompt, systemPrompt: 'sys' });
  globalThis.fetch = undefined;
  return body.max_tokens;
}

function fmt(prompt) {
  return `${prompt.length.toLocaleString()} chars`;
}

async function scenario(label, options, prompt) {
  const provider = new OpenRouterProvider({
    apiKey: 'demo-token',
    model: 'google/gemini-2.5-flash-lite',
    ...options,
  });
  const maxTokens = await capture(provider, prompt);
  console.log(
    `${label.padEnd(60)} prompt=${fmt(prompt).padEnd(11)} → max_tokens=${maxTokens}`,
  );
}

console.log('=== Adaptive response-token budgeting — live demo ===\n');

await scenario(
  '1. adaptive OFF, default settings',
  {},
  'Short prompt, no overrides.',
);

await scenario(
  '2. adaptive ON, tiny prompt → clamp to min',
  {
    adaptiveMaxTokens: true,
    maxTokens: 16_384,
    minAdaptiveTokens: 4_096,
    adaptiveCharsPerToken: 8,
  },
  'tiny',
);

await scenario(
  '3. adaptive ON, medium prompt → desired = chars / 8',
  {
    adaptiveMaxTokens: true,
    maxTokens: 16_384,
    minAdaptiveTokens: 4_096,
    adaptiveCharsPerToken: 8,
  },
  'x'.repeat(80_000),
);

await scenario(
  '4. adaptive ON, huge prompt → clamp to max',
  {
    adaptiveMaxTokens: true,
    maxTokens: 16_384,
    minAdaptiveTokens: 4_096,
    adaptiveCharsPerToken: 8,
  },
  'x'.repeat(1_000_000),
);

await scenario(
  '5. explicit maxTokens override',
  { maxTokens: 2_048 },
  'x'.repeat(80_000),
);

console.log(`\nExpected from the formula:`);
console.log(`  desired = ceil(promptChars / adaptiveCharsPerToken)`);
console.log(`  result  = clamp(desired, minAdaptiveTokens, maxResponseTokens)`);
console.log(`\nDemo against compiled output at: ${path.relative(process.cwd(), ROOT)}`);
