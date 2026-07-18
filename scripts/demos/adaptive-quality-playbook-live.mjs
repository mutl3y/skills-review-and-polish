#!/usr/bin/env node
/**
 * scripts/demos/adaptive-quality-playbook-live.mjs
 *
 * Real-life test of adaptive response-token budgeting against OpenRouter.
 * Uses the production skill `quality-playbook` (~294KB / ~70K tokens) as
 * the analysis target. Compares the same provider call in two modes:
 *
 *   1. Adaptive OFF (fixed 16384-token ceiling)
 *   2. Adaptive ON  (sizes max_tokens from prompt length)
 *
 * For each mode we report:
 *   - Prompt length (chars and approximate tokens)
 *   - The max_tokens sent on the wire
 *   - The model's finish_reason and completion_tokens
 *   - Whether the response truncated (finish_reason=length)
 *
 * Requires: OPENROUTER_API_KEY in env, OpenRouter must serve
 * `google/gemini-2.5-flash-lite` and `deepseek/deepseek-chat-v3`.
 *
 * Run: OPENROUTER_API_KEY=... node scripts/demos/adaptive-quality-playbook-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenRouterProvider } from '../../out/providers/externalProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = process.env.QUALITY_PLAYBOOK_PATH
  || '/workspace/awesome-copilot-fork/skills/quality-playbook/SKILL.md';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error('OPENROUTER_API_KEY not set');
  process.exit(1);
}
if (!fs.existsSync(SKILL_PATH)) {
  console.error(`Skill not found: ${SKILL_PATH}`);
  process.exit(1);
}

const text = fs.readFileSync(SKILL_PATH, 'utf8');
const chars = text.length;
const approxTokens = Math.ceil(chars / 4);

console.log('=== Real-life adaptive max_tokens test on quality-playbook ===\n');
console.log(`Skill: ${SKILL_PATH}`);
console.log(`Size:  ${chars.toLocaleString()} chars  (~${approxTokens.toLocaleString()} tokens at 4 chars/token)\n`);

const SYSTEM_PROMPT = 'You are a contradiction-detection expert. Respond with strict JSON only.';
const userPrompt = `Analyze the following prompt for contradictions. Return strict JSON only.\n\n<DOCUMENT_TO_ANALYZE>\n${text.slice(0, 50_000)}\n</DOCUMENT_TO_ANALYZE>`;
const userChars = userPrompt.length;

console.log(`Test prompt: ${userChars.toLocaleString()} chars (entry file truncated to 50K for this isolated wave test)\n`);

async function runScenario(label, opts, opts2 = {}) {
  const provider = new OpenRouterProvider({
    apiKey,
    model: 'google/gemini-2.5-flash-lite',
    maxTokens: 16_384,
    structuredOutput: 'schema',
    requestTimeoutMs: 120_000,
    maxRetries: 0,
    ...opts,
  });

  // Per-scenario override of the prompt. If a promptOverride is provided,
  // use it directly; otherwise build the standard 50K-char test prompt.
  const effectivePrompt =
    typeof opts2.promptOverride === 'string'
      ? opts2.promptOverride
      : userPrompt;
  const effectiveChars = effectivePrompt.length;

  let observedMaxTokens = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    observedMaxTokens = body.max_tokens;
    return origFetch(url, init);
  };

  const t0 = Date.now();
  const result = await provider.complete({ prompt: effectivePrompt, systemPrompt: SYSTEM_PROMPT });
  globalThis.fetch = origFetch;
  const elapsed = Date.now() - t0;

  const trimmed = (result.text ?? '').slice(0, 80).replace(/\s+/g, ' ');
  console.log(`${label}`);
  console.log(`  promptChars              : ${effectiveChars.toLocaleString()}`);
  console.log(`  maxTokens option         : ${opts.maxTokens ?? '(default 16384)'}`);
  console.log(`  adaptiveMaxTokens option : ${opts.adaptiveMaxTokens ?? 'unset'}`);
  console.log(`  adaptiveMaxTokensCap     : ${opts.adaptiveMaxTokensCap ?? 'unset'}`);
  console.log(`  minAdaptiveTokens option  : ${opts.minAdaptiveTokens ?? 'unset'}`);
  console.log(`  adaptiveCharsPerToken     : ${opts.adaptiveCharsPerToken ?? 'unset'}`);
  console.log(`  max_tokens on wire        : ${observedMaxTokens}`);
  console.log(`  finish_reason             : ${result.finishReason ?? '(none)'}`);
  console.log(`  error                     : ${result.error ?? '(none)'}`);
  console.log(`  text length               : ${(result.text ?? '').length}`);
  console.log(`  text preview              : ${trimmed}${trimmed.length === 80 ? '…' : ''}`);
  console.log(`  elapsed                   : ${(elapsed / 1000).toFixed(2)}s`);
  console.log('');
}

console.log('--- Scenario 1: adaptive OFF, fixed 16384 cap ---');
await runScenario('Fixed mode (adaptive OFF)', {});

console.log('--- Scenario 2: adaptive ON, default knobs ---');
await runScenario('Adaptive ON, default knobs (chars/token=8, min=4096, cap=65536)', {
  adaptiveMaxTokens: true,
  minAdaptiveTokens: 4_096,
  adaptiveCharsPerToken: 8,
});

console.log('--- Scenario 3: adaptive ON with a TINY prompt (clamp to min) ---');
await runScenario('Adaptive ON, tiny prompt (clamp to min)', {
  adaptiveMaxTokens: true,
  minAdaptiveTokens: 4_096,
  adaptiveCharsPerToken: 8,
}, { promptOverride: 'x'.repeat(500) });

console.log('--- Scenario 4: adaptive ON with a HUGE prompt (clamp to cap, must exceed 16384) ---');
await runScenario('Adaptive ON, huge prompt (clamp to cap)', {
  adaptiveMaxTokens: true,
  minAdaptiveTokens: 4_096,
  adaptiveCharsPerToken: 8,
}, { promptOverride: 'x'.repeat(2_000_000) });

console.log('--- Scenario 5: aggressive tuning, chars/token=4 (more output headroom) ---');
await runScenario('Adaptive ON, chars/token=4 (more output per char of prompt)', {
  adaptiveMaxTokens: true,
  minAdaptiveTokens: 8_192,
  adaptiveCharsPerToken: 4,
});

console.log('--- Scenario 6: aggressive cap, allow up to 131072 ---');
await runScenario('Adaptive ON, cap=131072', {
  adaptiveMaxTokens: true,
  minAdaptiveTokens: 4_096,
  adaptiveCharsPerToken: 8,
  adaptiveMaxTokensCap: 131_072,
}, { promptOverride: 'x'.repeat(2_000_000) });
