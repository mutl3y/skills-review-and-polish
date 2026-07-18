#!/usr/bin/env node
/**
 * verify-vsix-deps.mjs
 *
 * Guards against a regression where a runtime dependency required by the
 * VS Code extension is missing from the packaged VSIX. This is what broke
 * v0.1.40–v0.1.42: `.vscodeignore` excluded `node_modules/**` to shrink the
 * package, but `src/config.ts` does `require("picomatch")` at load time, so
 * `activate()` threw `Cannot find module 'picomatch'` and the extension
 * failed to activate (no output window, no editor icons).
 *
 * How it works:
 *   1. Resolve the extension entry from package.json `main` (out/extension.js).
 *   2. Walk its local require graph (./ and ../ only — NOT the standalone
 *      out/mcp/server.js entry point, which is run via `npm run mcp` and is
 *      allowed to depend on the excluded MCP SDK / mcp-remote).
 *   3. Collect every bare (non-relative, non-node-builtin) specifier the graph
 *      requires, and reduce each to its package name.
 *   4. Ask `vsce ls` what would actually ship, and assert each required package
 *      is present under node_modules/ in the VSIX.
 *
 * Exits non-zero (with a clear message) if any required runtime dependency is
 * missing from the package.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Node.js core modules — never resolved from node_modules.
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
  'domain', 'events', 'fs', 'http', 'http2', 'https', 'net', 'os', 'path',
  'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8',
  'vm', 'worker_threads', 'zlib', 'async_hooks', 'constants', 'module',
  'sys', 'freelist', 'smalloc', 'colorette', 'vscode',
]);

/** Extract the package name from a bare specifier (handles scoped + subpaths). */
function packageName(spec) {
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.slice(0, 2).join('/'); // @scope/name
  }
  return spec.split('/')[0];
}

/** Find all require("...") specifiers in a JS source string. */
const REQUIRE_RE = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
function findRequires(source) {
  const out = [];
  let m;
  while ((m = REQUIRE_RE.exec(source)) !== null) out.push(m[1]);
  return out;
}

/** Resolve a local require specifier to an existing file path, or null. */
function resolveLocal(spec, fromFile) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    base + '.js',
    base + '.json',
    path.join(base, 'index.js'),
    path.join(base, 'index.json'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Walk the local require graph from the entry, returning bare specifiers. */
function collectBareSpecifiers(entry) {
  const bare = new Set();
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const spec of findRequires(source)) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const resolved = resolveLocal(spec, file);
        if (resolved) queue.push(resolved);
      } else if (!NODE_BUILTINS.has(spec)) {
        bare.add(spec);
      }
    }
  }
  return [...bare];
}

/** Get the list of files `vsce` would package (source of truth for the VSIX). */
function vsceFileList() {
  const out = execFileSync('npx', ['vsce', 'ls'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const main = pkg.main ?? 'out/extension.js';
  const entry = path.resolve(root, main);
  if (!fs.existsSync(entry)) {
    console.error(`[verify-vsix-deps] Extension entry not found: ${entry}`);
    console.error('[verify-vsix-deps] Run `npm run compile` first.');
    process.exit(1);
  }

  const bareSpecifiers = collectBareSpecifiers(entry);
  const requiredPackages = [...new Set(bareSpecifiers.map(packageName))].sort();

  console.log(`[verify-vsix-deps] Extension entry: ${main}`);
  console.log(`[verify-vsix-deps] Runtime packages required by the extension host:`);
  for (const p of requiredPackages) console.log(`[verify-vsix-deps]   - ${p}`);

  const files = vsceFileList();
  const missing = [];
  for (const pkgName of requiredPackages) {
    const re = new RegExp('node_modules/' + pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(/|$)');
    const present = files.some((f) => re.test(f));
    if (!present) missing.push(pkgName);
  }

  if (missing.length) {
    console.error('');
    console.error('[verify-vsix-deps] FAIL: the following runtime dependencies are');
    console.error('[verify-vsix-deps] required by the extension host but MISSING from the VSIX:');
    for (const p of missing) console.error(`[verify-vsix-deps]   - ${p}`);
    console.error('');
    console.error('[verify-vsix-deps] Fix: add an exception to .vscodeignore, e.g.');
    console.error('[verify-vsix-deps]   !node_modules/' + missing[0] + '/');
    console.error('[verify-vsix-deps]   !node_modules/' + missing[0] + '/**');
    process.exit(1);
  }

  console.log('[verify-vsix-deps] PASS: all runtime dependencies are present in the VSIX.');
  process.exit(0);
}

main();
