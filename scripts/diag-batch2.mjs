// Diagnostic 2: submit a batch and poll it to completion, reporting the
// FINAL status and any per-item errors. Mirrors what runBatchOrFallback does
// but does NOT fall back, so we can see the real OpenRouter outcome.
import { OpenRouterProvider } from '../out/providers/externalProvider.js';

const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error('No OPENROUTER_API_KEY'); process.exit(1); }

const model = process.argv[2] || 'google/gemini-2.5-flash-lite:batch';
const provider = new OpenRouterProvider({ apiKey: key, model, requestTimeoutMs: 600000 });

const item = {
  custom_id: 'req-0',
  body: {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Return only JSON: {"ok":true}' },
    ],
    max_tokens: 4096,
    temperature: 0.2,
    top_p: 0.95,
    response_format: { type: 'json_schema', json_schema: { name: 'skill_diagnostics', strict: true, schema: { type: 'object', properties: { diagnostics: { type: 'array', items: { type: 'object' } } }, required: ['diagnostics'], additionalProperties: false } } },
  },
};

console.log('MODEL:', model);
const id = await provider.submitBatch([item], { model });
console.log('SUBMITTED:', id);

const deadline = Date.now() + 9 * 60_000;
let last = '';
while (Date.now() < deadline) {
  const r = await provider.pollBatch(id, { pollIntervalMs: 5000, maxWaitMs: 600000 });
  const sig = `${r.status}|${JSON.stringify(r.error)?.slice(0, 80)}`;
  if (sig !== last) { console.log(new Date().toISOString(), 'status=', r.status, 'error=', r.error); last = sig; }
  if (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled' || r.status === 'expired') {
    console.log('FINAL status=', r.status);
    if (r.results) {
      for (const res of r.results) {
        console.log('  item', res.custom_id, 'status=', res.status, 'error=', JSON.stringify(res.error)?.slice(0, 200));
        if (res.body) console.log('  body=', JSON.stringify(res.body).slice(0, 200));
      }
    }
    break;
  }
  await new Promise((res) => setTimeout(res, 5000));
}
