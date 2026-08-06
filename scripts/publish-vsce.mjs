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

// NOTE: do NOT pass --no-dependencies. In vsce 3.x that flag strips ALL
// node_modules from the package — including the !node_modules/picomatch/
// re-inclusion in .vscodeignore — which shipped a broken VSIX in v0.1.47
// ("Cannot find module 'picomatch'" on activation). vsce 3.x already prunes
// devDependencies by default, so the flag is unnecessary. --yes avoids the
// interactive "Ok to proceed?" npm-exec install prompt in headless shells.
//
// The PAT is passed via the VSCE_PAT env var (which vsce reads natively)
// rather than a --pat CLI arg, so the secret never appears in the process
// list or captured logs.
const args = ['exec', '--yes', '--', '@vscode/vsce', 'publish'];
if (version) {
  args.push(version);
}
args.push('--no-yarn', '--allow-missing-repository');

const publish = spawnSync('npm', args, {
  stdio: 'inherit',
  env: { ...process.env, VSCE_PAT: pat },
});
process.exit(publish.status ?? 1);