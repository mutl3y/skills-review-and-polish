// Diagnostic 3: submit a batch and watch status transitions every 3s for 2 min.
// Goal: confirm whether there's a separate "start"/"run" step we're missing,
// and what status sequence OpenRouter actually emits.
import { OpenRouterProvider } from '../out/providers/externalProvider.js';

const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error('No OPENROUTER_API_KEY'); process.exit(1); }

const model = process.argv[2] || 'google/gemini-2.5-flash-lite';
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
console.log('SUBMITTED:', id, 'at', new Date().toISOString());

// Try an explicit POST start if such an endpoint exists (OpenAI has /batches/{id}/cancel;
// some providers expose a start). We'll probe a few candidate paths and ignore 404s.
for (const path of [`/api/beta/batches/${id}/start`, `/api/beta/batches/${id}/run`, `/api/beta/batches/${id}/execute`]) {
  try {
    const r = await fetch(`https://openrouter.ai${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: '{}' });
    const txt = await r.text();
    console.log('PROBE', path, '->', r.status, txt.slice(0, 120));
  } catch (e) {
    console.log('PROBE', path, '-> ERR', e.message.slice(0, 80));
  }
}

const deadline = Date.now() + 2 * 60_000;
let last = '';
while (Date.now() < deadline) {
  const r = await provider.pollBatch(id, { pollIntervalMs: 1000, maxWaitMs: 3000 });
  const sig = `${r.status}|${JSON.stringify(r.error)?.slice(0, 80)}`;
  if (sig !== last) { console.log(new Date().toISOString(), 'status=', r.status, 'error=', r.error); last = sig; }
  if (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled' || r.status === 'expired') {
    console.log('FINAL status=', r.status, 'results?', !!r.results);
    break;
  }
  await new Promise((res) => setTimeout(res, 3000));
}
console.log('DONE watching at', new Date().toISOString());
