/**
 * Shared, selection-safe reference-file resolver.
 *
 * Single source of truth for "which files does a skill point to, and what's in
 * them". Used by BOTH the analyzer (`readLinkedPromptFiles`/`readReferenceFiles`)
 * and the fixer's reference grounding (`loadReferenceGrounding`), so the two
 * doors never drift on reference policy.
 *
 * Design constraints (see memory: session plan D2 / D5):
 *  - **Selection-safe, not glob-everything.** Only files the document
 *    explicitly *points to* — via a markdown link `[label](target)` OR an
 *    inline/table backtick path like `` `references/foo.md` `` or
 *    `| references/foo.md |` — are selected. A stray `references/README.md`
 *    or other file that isn't referenced must NOT enter the prompt (a raw glob
 *    would sweep it in and taint the prompt).
 *  - **Path-safe.** Reuses the shared `safeResolveFilePath`/`isPathWithin`
 *    guards (symlink + traversal rejection), canonical-to-canonical.
 *  - **Memoizable.** `resolveSkillsReferences` is a pure read; callers on a
 *    long-running loop can cache the resolved content (the analyzer already
 *    caches prompt building; the fixer should too — see D5).
 */

import * as fs from 'fs';
import * as path from 'path';
import { isPathWithin, safeResolveFilePath } from './pathSafety';

/** The inline/table reference extensions that are valid skill reference files. */
const REF_EXTENSIONS = ['.prompt.md', '.agent.md', '.instructions.md', '.md'];

/** Extensions the fixer historically accepted in its (glob) `references/` dir. */
const LEGACY_FIXER_EXTENSIONS = ['.md', '.mdx', '.txt', '.json', '.yaml', '.yml'];

/** Matches a markdown link target: `[label](./references/foo.md)` or `[x](foo.md)`. */
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Matches a backtick-quoted path to a file: `` `references/foo.md` ``. This is
 * the meta-skill convention (backtick tables/bodies) that the analyzer was
 * previously missing. We deliberately only match *backtick-quoted* tokens and
 * NOT a bare inline `references/...` probe, so plain prose that happens to
 * mention a path doesn't get swept in and taint the prompt (selection-safe).
 */
const BACKTICK_RE = /`([^`\n]+)`/g;

export interface ReferenceSelection {
  /** Content of each selected reference, in document order. */
  items: Array<{ target: string; content: string }>;
  /** Paths the document pointed to that failed path-safety and were rejected. */
  rejectedUnsafe: string[];
  /** Paths the document pointed to that could not be found/read. */
  missing: string[];
}

/**
 * Discover the reference file paths a document points to.
 *
 * Recognises two authoring conventions:
 *  1. Markdown links `[label](target)` (the content-skill convention).
 *  2. Backtick-quoted paths to the skill's own `references/` subtree (the
 *     meta-skill convention the analyzer was missing).
 *
 * Only targets ending in a reference extension and residing under the
 * document's own directory are retained as candidates.
 */
export function collectReferenceTargets(text: string, filePath: string): string[] {
  const docDir = path.dirname(filePath);
  // Dedupe on the RESOLVED path so equivalent spellings of the same file
  // (`references/x.md`, `./references/x.md`) collapse to a single inclusion.
  // First occurrence in document order wins.
  const seen = new Set<string>();
  const out: string[] = [];

  const consider = (raw: string, requireReferencesDir = false) => {
    const target = raw.trim().split('#')[0];
    if (!target) return;
    if (/^(https?:|mailto:)/i.test(target)) return;
    const lower = target.toLowerCase();
    // Meta-skill backtick convention points at the skill's OWN references/
    // subtree — a bare mention like `FINAL-REPORT.md` (an output artifact, not
    // an input reference) must not qualify. Only backtick tokens under
    // `references/` are ever considered.
    if (requireReferencesDir) {
      const noLead = lower.replace(/^\.\//, '');
      if (!noLead.startsWith('references/')) return;
    }
    const isRefExt = REF_EXTENSIONS.some((e) => lower.endsWith(e)) ||
      LEGACY_FIXER_EXTENSIONS.some((e) => lower.endsWith(e));
    if (!isRefExt) return;
    // Resolve path-safely; must stay inside the document's dir.
    const resolved = safeResolveFilePath(target, docDir, false);
    if (!resolved) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    out.push(target);
  };

  // 1) Markdown links — the content-skill convention; any referenced .md.
  let m: RegExpExecArray | null;
  while ((m = MARKDOWN_LINK_RE.exec(text)) !== null) {
    consider(m[2]);
  }
  // 2) Backtick-quoted paths — the meta-skill convention; restricted to the
  //    skill's own `references/` subtree so output artifacts mentioned in
  //    backticks (e.g. `FINAL-REPORT.md`) are not treated as references.
  BACKTICK_RE.lastIndex = 0;
  while ((m = BACKTICK_RE.exec(text)) !== null) {
    consider(m[1], true);
  }
  return out;
}

/**
 * Read the reference files a document points to, selection-safe and path-safe.
 *
 * Returns the content of each selected reference (document order) plus lists of
 * rejected/missing targets for callers that surface them (e.g. the analyzer's
 * `omittedRefs` marker). Hard-rejects symlinks and anything escaping the skill
 * directory (canonical-to-canonical realpath check), matching the existing
 * readers' security posture.
 */
export async function readSkillsReferences(
  text: string,
  filePath: string,
): Promise<ReferenceSelection> {
  const docDir = path.dirname(filePath);
  const targets = collectReferenceTargets(text, filePath);
  const selection: ReferenceSelection = { items: [], rejectedUnsafe: [], missing: [] };

  for (const target of targets) {
    const resolved = safeResolveFilePath(target, docDir, false);
    if (!resolved) {
      selection.rejectedUnsafe.push(target);
      continue;
    }
    // Symlink + escape rejection, canonical-to-canonical (same as existing).
    try {
      const stat = await fs.promises.lstat(resolved);
      if (stat.isSymbolicLink()) {
        selection.rejectedUnsafe.push(target);
        continue;
      }
      const realDocDir = await fs.promises.realpath(docDir);
      const real = await fs.promises.realpath(resolved);
      if (!isPathWithin(realDocDir, real)) {
        selection.rejectedUnsafe.push(target);
        continue;
      }
    } catch {
      selection.missing.push(target);
      continue;
    }
    try {
      const content = await fs.promises.readFile(resolved, 'utf8');
      selection.items.push({ target, content });
    } catch {
      selection.missing.push(target);
    }
  }
  return selection;
}