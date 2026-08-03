// Diagnostic: does OpenRouter Batch API accept the :batch model id as-is?
// Mirrors runBatchOrFallback's request shape and logs each step.
import { runBatchOrFallback } from '../out/core/batchTransport.js';
import { OpenRouterProvider } from '../out/providers/externalProvider.js';

const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error('No OPENROUTER_API_KEY'); process.exit(1); }

const model = process.argv[2] || 'google/gemini-2.5-flash-lite:batch';
const provider = new OpenRouterProvider({ apiKey: key, model, requestTimeoutMs: 60000 });

const req = {
  systemPrompt: 'You are a helpful assistant.',
  prompt: 'Return only JSON: {"ok":true}',
  maxTokensMultiplier: 1,
};

const log = (m) => console.log('[batch]', m);
console.log('MODEL:', model);
try {
  const results = await runBatchOrFallback({
    modelId: model,
    provider,
    requests: [req],
    pollIntervalMs: 2000,
    maxWaitMs: 90000,
    log,
  });
  console.log('RESULTS:', JSON.stringify(results).slice(0, 400));
} catch (e) {
  console.log('ERROR:', e.message);
}
