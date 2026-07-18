// scripts/probes/measure-tokens.mjs
// Use real model probes with max_tokens=1 to read usage.prompt_tokens.
// Cited from docs/plan/archive/releases/20260716-release-readiness-remediation/plan.yaml
// ("2026-07-17 measured real-world token costs (probe
// /tmp/measure-tokens.mjs): quality-playbook SKILL.md alone = 70K
// tokens (fits all viable models); quality-playbook + 28 references =
// 155K tokens").

import fs from 'node:fs';
import path from 'node:path';

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }

const SKILLS = [
  {
    name: 'quality-playbook',
    root: process.env.SKILLS_REVIEW_PROBE_REF_ROOT
      || '/workspace/awesome-copilot-fork/skills/quality-playbook',
    entry: 'SKILL.md',
  },
  {
    name: 'mutl3y-foreman',
    root: process.env.SKILLS_REVIEW_PROBE_MUTL3Y_ROOT
      || '/workspace/mutl3y_review_workflow_development/skills/mutl3y-foreman',
    entry: 'SKILL.disabled.md',
  },
];

async function readDirRecursive(root, exts) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (['node_modules', '.git', '__pycache__', '.venv'].includes(e.name)) continue;
        stack.push(full);
      } else if (e.isFile() && exts.some(x => e.name.toLowerCase().endsWith(x))) {
        try {
          const stat = fs.statSync(full);
          out.push({ path: full, size: stat.size, rel: path.relative(root, full) });
        } catch {}
      }
    }
  }
  return out;
}

async function probeModel(modelId, prompt) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'vscode://skills-review-and-polish',
      'X-Title': 'Token Measure',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1,
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    return { error: `HTTP ${resp.status}: ${err.slice(0, 200)}` };
  }
  const data = await resp.json();
  if (data.error) return { error: data.error.message ?? JSON.stringify(data.error).slice(0, 200) };
  return { tokens: data.usage?.prompt_tokens };
}

const MODELS = [
  { id: 'meta-llama/llama-3.1-8b-instruct',     ctx: 128_000, costPerM: 0.05 },
  { id: 'google/gemini-2.5-flash-lite',         ctx: 1_000_000, costPerM: 0.10 },
];

console.log('='.repeat(80));
console.log('TOKEN COUNT MEASUREMENT');
console.log('Using real model probe with max_tokens=1 to read usage.prompt_tokens');
console.log('='.repeat(80));

for (const skill of SKILLS) {
  console.log(`\n📁 ${skill.name}`);
  if (!fs.existsSync(skill.root)) { console.log('  missing'); continue; }
  const entryFile = path.join(skill.root, skill.entry);
  if (!fs.existsSync(entryFile)) { console.log(`  no ${skill.entry}`); continue; }
  const skillText = fs.readFileSync(entryFile, 'utf8');
  const refFiles = (await readDirRecursive(skill.root, ['.md', '.yaml', '.yml']))
    .filter(f => !f.path.endsWith(skill.entry));

  const totalRefBytes = refFiles.reduce((s, f) => s + f.size, 0);
  const allRefsText = refFiles.map(f => `\n\n--- ${f.rel} ---\n${fs.readFileSync(f.path, 'utf8')}`).join('');
  const combinedText = skillText + allRefsText;

  console.log(`  Entry file: ${skill.entry} = ${skillText.length.toLocaleString()} chars`);
  console.log(`  Refs: ${refFiles.length} files, ${(totalRefBytes / 1024).toFixed(1)} KB total`);

  console.log(`\n  --- Just ${skill.entry} (${skillText.length.toLocaleString()} chars) ---`);
  for (const m of MODELS) {
    const t = await probeModel(m.id, skillText);
    if (t.error) { console.log(`    ${m.id.padEnd(40)} ${t.error}`); continue; }
    const cap = Math.floor(m.ctx * 0.8);
    const cost = (t.tokens / 1_000_000) * m.costPerM;
    const fits = t.tokens <= cap ? '✓' : '✗';
    console.log(`    ${m.id.padEnd(40)} ${String(t.tokens).padStart(7)} tokens  $${cost.toFixed(4)}  ${fits} fits in ${m.ctx.toLocaleString()} ctx (cap ${cap.toLocaleString()})`);
  }

  console.log(`\n  --- Combined with refs (${combinedText.length.toLocaleString()} chars) ---`);
  for (const m of MODELS) {
    const t = await probeModel(m.id, combinedText);
    if (t.error) { console.log(`    ${m.id.padEnd(40)} ${t.error}`); continue; }
    const cap = Math.floor(m.ctx * 0.8);
    const cost = (t.tokens / 1_000_000) * m.costPerM;
    const fits = t.tokens <= cap ? '✓' : '✗';
    console.log(`    ${m.id.padEnd(40)} ${String(t.tokens).padStart(7)} tokens  $${cost.toFixed(4)}  ${fits} fits in ${m.ctx.toLocaleString()} ctx (cap ${cap.toLocaleString()})`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('200K-CHAR FALLBACK = 200,000 chars ≈ 50,000 tokens');
console.log('Real token counts above are ground truth from the providers.');
