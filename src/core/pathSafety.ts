/**
 * Shared path-safety helpers.
 *
 * Single source of truth for workspace-root containment. Both the VS Code
 * extension (`src/extension.ts`) and the MCP server (`src/mcp/server.ts`) MUST
 * use these — duplicating path-containment in two places is how the two doors
 * diverge (e.g. one checks the realpath against the lexical root while the
 * other checks against the realpath of the root, so a symlinked workspace root
 * behaves differently depending on which door you used).
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Case-insensitive prefix check on Windows (path.resolve doesn't normalize
 * case). On other platforms it's a plain prefix check. `p` is within `base`
 * when it equals `base` or starts with `base + path.sep`.
 */
export function isPathWithin(base: string, p: string): boolean {
  const b = process.platform === 'win32' ? base.toLowerCase() : base;
  const q = process.platform === 'win32' ? p.toLowerCase() : p;
  return q === b || q.startsWith(b + path.sep);
}

/**
 * Validate and resolve a `filePath` against a workspace root.
 *
 * This is the canonical-to-canonical version: it realpaths BOTH the root and
 * the resolved path and re-checks containment against the realpath of the
 * root, so a symlinked workspace root doesn't false-reject legitimate files.
 *
 * `requireExists` controls whether the path must exist on disk:
 *   - `true` (default): reject non-existent paths. Used by read operations
 *     (fix/analyze/score) where the path is later read from disk — returning
 *     an unresolved lexical path would open a TOCTOU hole (an attacker could
 *     create a symlink at that path between check and use).
 *   - `false`: resolve lexically against the root and reject escapes, but do
 *     NOT require the file to exist. Used by store-key operations
 *     (accept_finding / list_accepted_findings) where the path is only a key
 *     and is never read from disk.
 *
 * Returns the resolved absolute path, or `undefined` when the path escapes the
 * workspace root (or, when `requireExists`, is missing).
 */
export function safeResolveFilePath(
  filePath: string | undefined,
  root: string,
  requireExists = true,
): string | undefined {
  if (!filePath || filePath.trim() === '') return undefined;
  const resolved = path.resolve(root, filePath);
  // Reject paths that escape the workspace root lexically (absolute paths,
  // .. traversal).
  if (!isPathWithin(root, resolved)) {
    return undefined;
  }
  // Store-key operations don't read the path from disk, so the lexical check
  // above is sufficient — no need to require existence or resolve symlinks.
  if (!requireExists) {
    return resolved;
  }
  // Resolve symlinks and re-check the realpath against the REALPATH of the
  // root (canonical-to-canonical) — a symlink inside the workspace could point
  // outside it, and a symlinked root shouldn't false-reject legitimate files.
  // If realpath fails (path missing / permission), reject rather than
  // returning the unresolved lexical path — a TOCTOU attacker could create a
  // symlink at that path between check and use, bypassing the guard.
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(resolved);
    if (!isPathWithin(realRoot, real)) {
      return undefined;
    }
    return real;
  } catch {
    return undefined;
  }
}
