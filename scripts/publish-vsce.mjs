#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const version = process.argv[2]?.trim() || '';
const pat = process.env.VSCE_PAT?.trim() || process.env.VCSE_PAT?.trim() || '';

if (!pat) {
  console.error('VSCE_PAT (or VCSE_PAT) is required to publish in this environment. Set it to your marketplace personal access token and retry.');
  process.exit(1);
}

const gate = spawnSync('npm', ['run', 'release:gate'], { stdio: 'inherit' });
if (gate.status !== 0) {
  process.exit(gate.status ?? 1);
}

const args = ['exec', '--', '@vscode/vsce', 'publish'];
if (version) {
  args.push(version);
}
args.push('--no-dependencies', '--no-yarn', '--allow-missing-repository', '--pat', pat);

const publish = spawnSync('npm', args, { stdio: 'inherit' });
process.exit(publish.status ?? 1);