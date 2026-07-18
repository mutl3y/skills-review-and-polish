import { vi } from 'vitest';
import { OpenRouterProvider } from '../../out/providers/externalProvider.js';

const fetchMock = vi.fn()
  .mockResolvedValueOnce({
    ok: true,
    json: async () => ({ error: { code: 400, message: 'json_schema is not supported for this model' } }),
  })
  .mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
  });

const originalFetch = globalThis.fetch;
globalThis.fetch = fetchMock;

const provider = new OpenRouterProvider({ apiKey: 'token', model: 'standard-model', maxRetries: 0, structuredOutput: 'schema' });
const result = await provider.complete({ prompt: 'p', systemPrompt: 's' });

console.log('fetchMock called:', fetchMock.mock.calls.length, 'times');
console.log('first body:', fetchMock.mock.calls[0]?.[1]?.body);
console.log('second body:', fetchMock.mock.calls[1]?.[1]?.body);
console.log('result:', result);
globalThis.fetch = originalFetch;
