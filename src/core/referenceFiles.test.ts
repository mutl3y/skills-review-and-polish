import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectReferenceTargets,
  readSkillsReferences,
} from './referenceFiles';

let tempDirs: string[] = [];

function makeSkill(files: Record<string, string>, skillName = 'SKILL.md'): { skillPath: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-files-'));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return { skillPath: path.join(dir, skillName), dir };
}

afterEach(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('collectReferenceTargets', () => {
  it('collects markdown link targets', () => {
    const { skillPath } = makeSkill({
      'SKILL.md': 'See [Notes](./references/notes.md) for details and [Cases](./references/case-studies.md).',
    });
    const targets = collectReferenceTargets(
      fs.readFileSync(skillPath, 'utf8'),
      skillPath,
    );
    expect(targets).toContain('./references/notes.md');
    expect(targets).toContain('./references/case-studies.md');
  });

  it('collects backtick-quoted reference paths (meta-skill table convention)', () => {
    const { skillPath } = makeSkill({
      'SKILL.md': '| `references/setup.md` | Setup |\n| `references/practice.md` | Practice |',
      'references/setup.md': 'setup',
      'references/practice.md': 'practice',
    });
    const targets = collectReferenceTargets(
      fs.readFileSync(skillPath, 'utf8'),
      skillPath,
    );
    expect(targets).toContain('references/setup.md');
    expect(targets).toContain('references/practice.md');
  });

  it('does not treat bare backtick output artifacts as references', () => {
    const { skillPath } = makeSkill({
      // `FINAL-REPORT.md` is an output artifact the loop WRITES, not an input
      // reference — it must not be collected. Other backtick references under
      // references/ still are.
      'SKILL.md': 'Record convergence, write `FINAL-REPORT.md`, and stop. See `references/practice.md`.',
      'references/practice.md': 'practice',
    });
    const targets = collectReferenceTargets(
      fs.readFileSync(skillPath, 'utf8'),
      skillPath,
    );
    expect(targets).toContain('references/practice.md');
    expect(targets).not.toContain('FINAL-REPORT.md');
    // It also should not be a missing/rejected reference on read.
  });

  it('does not report output artifacts as missing references on read', async () => {
    const { skillPath } = makeSkill({
      'SKILL.md': 'write `FINAL-REPORT.md`, then commit.',
    });
    const sel = await readSkillsReferences(fs.readFileSync(skillPath, 'utf8'), skillPath);
    expect(sel.items.length).toBe(0);
    expect(sel.missing).not.toContain('FINAL-REPORT.md');
    expect(sel.missing.length).toBe(0);
  });
});

describe('readSkillsReferences', () => {
  it('reads only referenced files, in document order', async () => {
    const { skillPath } = makeSkill({
      'SKILL.md': 'See [A](./references/a.md) then [B](./references/b.md).',
      'references/a.md': 'content-a',
      'references/b.md': 'content-b',
      'references/README.md': 'stray must not be read',
    });
    const sel = await readSkillsReferences(fs.readFileSync(skillPath, 'utf8'), skillPath);
    expect(sel.items.map((i) => i.target)).toEqual(['./references/a.md', './references/b.md']);
    expect(sel.items.map((i) => i.content)).toEqual(['content-a', 'content-b']);
    // The unlinked README stays out (selection-safe).
    expect(sel.items.some((i) => i.content.includes('stray'))).toBe(false);
  });

  it('rejects path traversal (..)', async () => {
    const { skillPath } = makeSkill({
      'SKILL.md': 'See [Esc](./../../../etc/passwd.md).',
    });
    const sel = await readSkillsReferences(fs.readFileSync(skillPath, 'utf8'), skillPath);
    // Traversal targets are dropped at collection, never read.
    expect(sel.items.length).toBe(0);
    expect(sel.missing.length).toBe(0);
  });

  it('rejects absolute paths', async () => {
    const { skillPath } = makeSkill({
      'SKILL.md': `See [Abs](/etc/passwd.md).`,
    });
    const sel = await readSkillsReferences(fs.readFileSync(skillPath, 'utf8'), skillPath);
    expect(sel.items.length).toBe(0);
  });

  it('rejects symlinked references', async () => {
    const { skillPath, dir } = makeSkill({
      'SKILL.md': 'See [Link](./references/link.md).',
    });
    // Create a symlink reference that points outside the skill dir.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-outside-'));
    tempDirs.push(outside);
    const secret = path.join(outside, 'secret.md');
    fs.writeFileSync(secret, 'secret');
    fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
    try {
      fs.symlinkSync(secret, path.join(dir, 'references', 'link.md'));
    } catch {
      // Symlinks may be unsupported on some platforms — skip.
      return;
    }
    const sel = await readSkillsReferences(fs.readFileSync(skillPath, 'utf8'), skillPath);
    expect(sel.items.length).toBe(0);
    expect(sel.rejectedUnsafe.length).toBeGreaterThan(0);
  });

  it('reports missing files', async () => {
    const { skillPath } = makeSkill({
      'SKILL.md': 'See [Gone](./references/gone.md).',
    });
    const sel = await readSkillsReferences(fs.readFileSync(skillPath, 'utf8'), skillPath);
    expect(sel.items.length).toBe(0);
    expect(sel.missing).toContain('./references/gone.md');
  });
});
