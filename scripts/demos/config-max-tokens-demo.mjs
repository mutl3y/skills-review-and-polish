#!/usr/bin/env node
/**
 * scripts/demos/config-max-tokens-demo.mjs
 *
 * Demonstrates the external.maxResponseTokens setting end-to-end without
 * touching the network. The demo:
 *
 *   1. Loads readConfig() against a mocked VS Code settings store.
 *   2. Prints the config value of externalMaxResponseTokens for three
 *      scenarios:
 *        a. Setting absent  → defaults to 16_384
 *        b. Setting = 32_768 → reads 32_768
 *        c. Setting = 4_096  → reads 4_096 (and stays the upper bound)
 *   3. Builds an OpenRouterProvider with each value and confirms the
 *      exact max_tokens that goes on the wire by stubbing fetch.
 *
 * Run: node scripts/demos/config-max-tokens-demo.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenRouterProvider } from '../../out/providers/externalProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock vscode with a configurable getConfiguration.
let store = {};
const vscodeMock = {
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in store ? store[key] : fallback),
    }),
  },
};
// Inject the mock into the loader's module resolution.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// We can't trivially intercept a TS import from an .mjs file. Instead, read
// the compiled config module directly and call readConfig after wiring its
// 'vscode' import via a tiny loader. Simpler: import the JS directly using
// an inline loader that maps 'vscode' to our mock.
const dataUrl =
  'data:text/javascript,' +
  encodeURIComponent(`
    export const workspace = {
      getConfiguration: () => ({
        get: (key, fallback) => (key in globalThis.__store ? globalThis.__store[key] : fallback),
      }),
    };
    export const ThemeColor = class {};
    export const Uri = class { static file(p) { return { fsPath: p, path: p, toString: () => p }; } };
    export const window = {};
    export const EventEmitter = class { event = () => () => {}; fire() {} };
  `);
globalThis.__store = store;
// Use Node's loader to alias 'vscode' to our data URL.
const dataUrlModule = await import(dataUrl);

// Hack: temporarily mutate Module._resolveFilename via a small wrapper.
// Simpler still: use a custom require/import hook. Easiest: import a
// re-export module that re-uses our mock. We create a tiny shim file.

import fs from 'node:fs';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-mock-'));
const mockPath = path.join(tmpDir, 'vscode.mjs');
fs.writeFileSync(
  mockPath,
  `
const store = globalThis.__store || {};
export const workspace = {
  getConfiguration: () => ({
    get: (key, fallback) => (key in store ? store[key] : fallback),
  }),
};
export const ThemeColor = class {};
export const Uri = class { static file(p) { return { fsPath: p, path: p, toString: () => p }; } };
export const window = {};
export const EventEmitter = class { event = () => () => {}; fire() {} };
`,
);

// Patch Module._resolveFilename to redirect 'vscode' to our shim.
const Module = await import('node:module');
const origResolve = Module.default._resolveFilename;
Module.default._resolveFilename = function (request, parent, ...rest) {
  if (request === 'vscode') return mockPath;
  return origResolve.call(this, request, parent, ...rest);
};

const { readConfig, clearConfigCache } = await import('../../out/config.js');

function withStore(values, fn) {
  globalThis.__store = { ...values };
  clearConfigCache();
  return fn();
}

async function captureMaxTokens(provider, prompt) {
  let captured;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body).max_tokens;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      }),
    };
  };
  await provider.complete({ prompt, systemPrompt: 's' });
  globalThis.fetch = undefined;
  return captured;
}

console.log('=== Config-driven max tokens demo ===\n');

console.log('Scenario A: setting absent → defaults to 16_384');
await withStore({}, async () => {
  const cfg = readConfig();
  const provider = new OpenRouterProvider({
    apiKey: 'demo',
    model: 'google/gemini-2.5-flash-lite',
    maxTokens: cfg.externalMaxResponseTokens,
    structuredOutput: 'schema',
    requestTimeoutMs: 60_000,
    maxRetries: 0,
  });
  const wire = await captureMaxTokens(provider, 'hi');
  console.log(`  config.externalMaxResponseTokens = ${cfg.externalMaxResponseTokens}`);
  console.log(`  wire max_tokens                  = ${wire}`);
});

console.log('\nScenario B: setting = 32_768 → reads 32_768');
await withStore({ 'external.maxResponseTokens': 32_768 }, async () => {
  const cfg = readConfig();
  const provider = new OpenRouterProvider({
    apiKey: 'demo',
    model: 'google/gemini-2.5-flash-lite',
    maxTokens: cfg.externalMaxResponseTokens,
    structuredOutput: 'schema',
    requestTimeoutMs: 60_000,
    maxRetries: 0,
  });
  const wire = await captureMaxTokens(provider, 'hi');
  console.log(`  config.externalMaxResponseTokens = ${cfg.externalMaxResponseTokens}`);
  console.log(`  wire max_tokens                  = ${wire}`);
});

console.log('\nScenario C: setting = 4_096 (smaller than default)');
await withStore({ 'external.maxResponseTokens': 4_096 }, async () => {
  const cfg = readConfig();
  const provider = new OpenRouterProvider({
    apiKey: 'demo',
    model: 'google/gemini-2.5-flash-lite',
    maxTokens: cfg.externalMaxResponseTokens,
    structuredOutput: 'schema',
    requestTimeoutMs: 60_000,
    maxRetries: 0,
  });
  const wire = await captureMaxTokens(provider, 'hi');
  console.log(`  config.externalMaxResponseTokens = ${cfg.externalMaxResponseTokens}`);
  console.log(`  wire max_tokens                  = ${wire}`);
});

console.log('\nScenario D: setting = 4_096 + adaptive ON → still 4_096 (max is upper bound)');
await withStore(
  {
    'external.maxResponseTokens': 4_096,
    'external.adaptiveResponseTokens': true,
    'external.minAdaptiveResponseTokens': 1_024,
    'external.adaptiveCharsPerToken': 8,
  },
  async () => {
    const cfg = readConfig();
    const provider = new OpenRouterProvider({
      apiKey: 'demo',
      model: 'google/gemini-2.5-flash-lite',
      maxTokens: cfg.externalMaxResponseTokens,
      adaptiveMaxTokens: cfg.externalAdaptiveResponseTokens,
      minAdaptiveTokens: cfg.externalMinAdaptiveResponseTokens,
      adaptiveCharsPerToken: cfg.externalAdaptiveCharsPerToken,
      structuredOutput: 'schema',
      requestTimeoutMs: 60_000,
      maxRetries: 0,
    });
    const wire = await captureMaxTokens(provider, 'x'.repeat(100_000));
    console.log(`  config.externalMaxResponseTokens = ${cfg.externalMaxResponseTokens}`);
    console.log(`  adaptive = ${cfg.externalAdaptiveResponseTokens}`);
    console.log(`  prompt chars = 100,000`);
    console.log(`  wire max_tokens = ${wire}`);
    console.log(`  (expected: 4_096, since max is upper bound and floor = min(max, minAdaptive) = 1_024)`);
  },
);

// Restore Module._resolveFilename and clean up the shim.
Module.default._resolveFilename = origResolve;
fs.rmSync(tmpDir, { recursive: true, force: true });
