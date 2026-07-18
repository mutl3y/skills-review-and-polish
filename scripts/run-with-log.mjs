#!/usr/bin/env node
/**
 * Run a long npm/node command and tee stdout+stderr to a timestamped log file
 * under /tmp. The script prints the log path as it starts so you can
 * `tail -f` it in another shell.
 *
 * Usage:
 *   node scripts/run-with-log.mjs <name> -- <command...>
 *
 * Examples:
 *   node scripts/run-with-log.mjs e50-schema -- npm run test:calibration
 *   node scripts/run-with-log.mjs e2e        -- npm run test:e2e
 *   node scripts/run-with-log.mjs vitest     -- npx vitest run --config tests/vitest.config.ts
 *
 * Log location: /tmp/<name>-<ISO-timestamp>.log
 * Symlink for convenience: /tmp/<name>.log -> latest
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const sepIdx = args.indexOf('--');
if (sepIdx < 0 || sepIdx === args.length - 1) {
  console.error('usage: run-with-log.mjs <name> -- <command...>');
  process.exit(2);
}

const name = args[0];
const cmd = args[sepIdx + 1];
const cmdArgs = args.slice(sepIdx + 2);

if (!name || !/^[a-z0-9._-]+$/i.test(name)) {
  console.error(`invalid name "${name}" — use [a-z0-9._-]+`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join('/tmp', `${name}-${stamp}.log`);
const linkPath = path.join('/tmp', `${name}.log`);

fs.mkdirSync(path.dirname(logPath), { recursive: true });
try { fs.unlinkSync(linkPath); } catch { /* not present */ }
try { fs.symlinkSync(logPath, linkPath); } catch { /* best effort */ }

const out = fs.openSync(logPath, 'a');
console.error(`[run-with-log] ${cmd} ${cmdArgs.join(' ')}`);
console.error(`[run-with-log] log: ${logPath}`);
console.error(`[run-with-log] tail: tail -f ${linkPath}`);

const child = spawn(cmd, cmdArgs, {
  stdio: ['ignore', out, out],
  env: process.env,
});

const sigintHandler = () => { child.kill('SIGINT'); };
const sigtermHandler = () => { child.kill('SIGTERM'); };
process.on('SIGINT', sigintHandler);
process.on('SIGTERM', sigtermHandler);

child.on('exit', (code, signal) => {
  process.removeListener('SIGINT', sigintHandler);
  process.removeListener('SIGTERM', sigtermHandler);
  try { fs.closeSync(out); } catch { /* already closed */ }
  if (signal) {
    console.error(`[run-with-log] killed by ${signal}`);
    process.exit(130);
  }
  console.error(`[run-with-log] exit=${code} log=${logPath}`);
  process.exit(code ?? 1);
});