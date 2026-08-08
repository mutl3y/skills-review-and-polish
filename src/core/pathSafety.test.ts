// /workspace/skills-review-and-polish/src/core/pathSafety.test.ts
//
// Validates the shared path-containment helpers — the trust boundary for both
// the VS Code extension and the MCP server. `safeResolveFilePath` decides
// which on-disk files the engine is allowed to touch, so the TOCTOU / symlink
// cases here are the exact ones an attacker targeting this extension would
// probe first.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeResolveFilePath, isPathWithin } from './pathSafety.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'path-safety-'));
});

afterEach(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('isPathWithin', () => {
  it('returns true when p equals base', () => {
    expect(isPathWithin(root, root)).toBe(true);
  });

  it('returns true for a direct child', () => {
    expect(isPathWithin(root, path.join(root, 'file.md'))).toBe(true);
  });

  it('returns true for a nested descendant', () => {
    expect(isPathWithin(root, path.join(root, 'a', 'b', 'c.md'))).toBe(true);
  });

  it('returns false for a sibling directory', () => {
    expect(isPathWithin('/root', '/root2/file.md')).toBe(false);
  });

  it('returns false when p is only a string prefix but not a path boundary', () => {
    // '/root' must not contain '/root-evil' — the check is boundary-aware.
    expect(isPathWithin('/root', '/root-evil/file.md')).toBe(false);
  });
});

describe('safeResolveFilePath', () => {
  it('returns undefined for empty, undefined, or whitespace paths', () => {
    expect(safeResolveFilePath(undefined, root)).toBeUndefined();
    expect(safeResolveFilePath('', root)).toBeUndefined();
    expect(safeResolveFilePath('   ', root)).toBeUndefined();
  });

  describe('requireExists = true (read operations)', () => {
    it('resolves an existing file inside the workspace to its canonical path', () => {
      const file = path.join(root, 'skill.md');
      fs.writeFileSync(file, '# hi');
      const resolved = safeResolveFilePath(file, root);
      expect(resolved).toBeTruthy();
      expect(fs.existsSync(resolved as string)).toBe(true);
    });

    it('resolves a relative path against the root', () => {
      fs.writeFileSync(path.join(root, 'a.md'), '# a');
      const resolved = safeResolveFilePath('a.md', root);
      expect(resolved).toBe(path.join(root, 'a.md'));
    });

    it('returns undefined for a nonexistent file', () => {
      expect(safeResolveFilePath(path.join(root, 'nope.md'), root)).toBeUndefined();
    });

    it('rejects absolute paths outside the workspace', () => {
      const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')), 'x.md');
      fs.writeFileSync(outside, '# x');
      expect(safeResolveFilePath(outside, root)).toBeUndefined();
    });

    it('rejects .. traversal that escapes the workspace', () => {
      expect(safeResolveFilePath(path.join(root, '..', 'evil.txt'), root)).toBeUndefined();
    });

    it('rejects a symlink that points outside the workspace (TOCTOU)', () => {
      const outsideTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')), 'secret.md');
      fs.writeFileSync(outsideTarget, 'secret');
      const link = path.join(root, 'link.md');
      try { fs.symlinkSync(outsideTarget, link); } catch { return; /* platform lacks symlink */ }
      expect(safeResolveFilePath(link, root)).toBeUndefined();
    });

    it('resolves a symlink that points inside the workspace (allowed)', () => {
      fs.writeFileSync(path.join(root, 'real.md'), '# real');
      const link = path.join(root, 'alias.md');
      try { fs.symlinkSync('real.md', link); } catch { return; }
      const resolved = safeResolveFilePath(link, root);
      expect(resolved).toBeTruthy();
      expect(fs.readFileSync(resolved as string, 'utf8')).toBe('# real');
    });
  });

  describe('requireExists = false (store-key operations)', () => {
    it('resolves lexically without requiring the file to exist', () => {
      const resolved = safeResolveFilePath(path.join(root, 'not-yet.md'), root, false);
      expect(resolved).toBe(path.join(root, 'not-yet.md'));
      expect(fs.existsSync(resolved as string)).toBe(false);
    });

    it('rejects .. traversal even when requireExists is false', () => {
      expect(safeResolveFilePath('../evil.md', root, false)).toBeUndefined();
      expect(safeResolveFilePath(path.join(root, '..', 'evil.md'), root, false)).toBeUndefined();
    });

    it('rejects absolute paths outside the workspace even when requireExists is false', () => {
      expect(safeResolveFilePath('/etc/passwd', root, false)).toBeUndefined();
    });
  });
});