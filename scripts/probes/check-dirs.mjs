// scripts/probes/check-dirs.mjs
// What does __dirname resolve to in each runtime context?

import path from 'node:path';
import fs from 'node:fs';

console.log('process.cwd():', process.cwd());
console.log('import.meta.url:', import.meta.url);
console.log('__dirname (file):', path.dirname(new URL(import.meta.url).pathname));

// Where would the fixture live in each scenario?
const scenarios = [
  { name: 'dev vitest (src/)', from: '../../src/modelCatalog.ts' },
  { name: 'prod (out/)', from: '../../out/modelCatalog.js' },
];
for (const s of scenarios) {
  const dir = path.dirname(s.from);
  console.log(`\n${s.name}: __dirname = ${dir}`);
  // Current candidates
  const c1 = path.join(dir, '..', '..', 'tests', 'fixtures', 'openrouter-catalog.json');
  const c2 = path.join(dir, 'fixtures', 'openrouter-catalog.json');
  console.log(`  candidate 1: ${c1} (exists: ${fs.existsSync(c1)})`);
  console.log(`  candidate 2: ${c2} (exists: ${fs.existsSync(c2)})`);
}
