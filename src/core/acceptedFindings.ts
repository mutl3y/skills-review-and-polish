/**
 * Per-file accepted findings — allows suppressing known/expected issues.
 * Extension-agnostic (no vscode imports).
 * @module acceptedFindings
 */

import * as fs from 'fs';
import * as path from 'path';
import { AnalysisResult } from './types';
import { createLogger } from './logger';

const log = createLogger('accepted-findings');

export interface AcceptedFinding {
  /** The diagnostic code (e.g. 'ambiguity-llm', 'coverage-gap') */
  code: string;
  /** Normalized substring of the relevant text for fuzzy matching */
  textPattern: string;
  /** When it was accepted */
  acceptedAt: string;
  /** Optional reason */
  reason?: string;
}

export interface AcceptedFindingsStore {
  entries: Record<string, AcceptedFinding[]>;
}

/** Maximum total accepted findings entries to prevent unbounded store growth. */
const MAX_ACCEPTED_ENTRIES = 500;

/**
 * Default path: tries workspace root via `vscode.workspace.workspaceFolders`.
 *
 * IMPORTANT: This constant is ONLY for use by callers that have confirmed a
 * workspace folder exists. In the MCP server context (no vscode module), callers
 * MUST always pass an explicit path — this fallback is intentionally absent to
 * prevent accidental writes to the user's home directory.
 */
export const DEFAULT_ACCEPTED_FINDINGS_PATH = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscode = require('vscode') as typeof import('vscode');
    const folders = vscode.workspace?.workspaceFolders;
    if (folders && folders.length > 0) {
      return path.join(folders[0].uri.fsPath, '.accepted-findings.json');
    }
  } catch {
    /* not running inside VS Code extension host — fall through */
  }
  // No workspace available — return empty string as a sentinel.
  // Callers that need a valid path must provide one explicitly.
  return '';
})();

// ─── File-name sanitization ──────────────────────────────────────────────────

/**
 * Sanitize a file name for use as a key in the accepted-findings store.
 *
 * Normalizes path separators to forward slashes and strips common prefixes
 * (absolute paths, tilde, etc.) so that the same file produces the same key
 * regardless of how it is referenced.
 */
export function sanitizeFileName(fileName: string): string {
  // Normalize to forward slashes
  let normalized = fileName.replace(/\\/g, '/');
  // Strip drive letter prefix on Windows (e.g. "C:/")
  normalized = normalized.replace(/^[A-Za-z]:\//, '/');
  // Strip tilde prefix
  normalized = normalized.replace(/^~\//, '/');
  return normalized;
}

// ─── Normalization helpers ────────────────────────────────────────────────────

/**
 * Normalize text for fuzzy matching: lowercase and collapse all whitespace.
 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ─── Store operations ─────────────────────────────────────────────────────────

/**
 * Load the accepted findings store from disk.
 * Returns an empty store if the file doesn't exist or is malformed.
 */
export function loadAcceptedFindings(storePath: string): AcceptedFindingsStore {
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
      return parsed as AcceptedFindingsStore;
    }
    log.debug('Store file exists but has invalid structure, returning empty store');
    return { entries: {} };
  } catch {
    // File doesn't exist or can't be read — return empty store
    return { entries: {} };
  }
}

/**
 * Save the accepted findings store to disk.
 * Uses an atomic write (temp file + rename) so a crash mid-write can't
 * corrupt the store.
 */
export function saveAcceptedFindings(storePath: string, store: AcceptedFindingsStore): void {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = storePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2) + '\n', 'utf8');
  try {
    fs.renameSync(tmpPath, storePath);
  } catch (err) {
    // Clean up the temp file if rename failed, then rethrow.
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Add a new accepted finding for a specific file.
 * Creates the store file lazily (only when first acceptance is added).
 */
export function acceptFinding(
  storePath: string,
  fileName: string,
  finding: AcceptedFinding,
): void {
  const store = loadAcceptedFindings(storePath);
  const key = sanitizeFileName(fileName);

  if (!store.entries[key]) {
    store.entries[key] = [];
  }

  // Avoid duplicates: same code + same textPattern
  const exists = store.entries[key].some(
    (e) => e.code === finding.code && e.textPattern === finding.textPattern,
  );
  if (!exists) {
    store.entries[key].push(finding);

    // Enforce max entries — evict oldest across all files when cap exceeded
    const totalEntries = Object.values(store.entries).reduce((sum, arr) => sum + arr.length, 0);
    if (totalEntries > MAX_ACCEPTED_ENTRIES) {
      const flat: Array<{ fileKey: string; index: number; acceptedAt: string }> = [];
      for (const [fk, entries] of Object.entries(store.entries)) {
        for (let i = 0; i < entries.length; i++) {
          flat.push({ fileKey: fk, index: i, acceptedAt: entries[i].acceptedAt });
        }
      }
      flat.sort((a, b) => (a.acceptedAt < b.acceptedAt ? -1 : a.acceptedAt > b.acceptedAt ? 1 : 0));
      const toRemove = totalEntries - MAX_ACCEPTED_ENTRIES;
      for (let i = 0; i < toRemove && i < flat.length; i++) {
        const { fileKey, index } = flat[i];
        store.entries[fileKey]?.splice(index, 1);
        if (store.entries[fileKey]?.length === 0) delete store.entries[fileKey];
      }
      log.debug('Accepted findings store evicted oldest entries', { removed: toRemove });
    }

    saveAcceptedFindings(storePath, store);
    log.debug('Accepted finding', { fileName: key, code: finding.code });
  } else {
    log.debug('Finding already accepted, skipping', { fileName: key, code: finding.code });
  }
}

/**
 * Check if a specific result matches any accepted entry.
 *
 * Matching logic:
 * 1. Match on `code` exactly
 * 2. Match on `relevantText` using normalized substring containment
 *    — "vague or underspecified" matches text containing
 *    "vague or underspecified instructions where different interpretations"
 */
export function isFindingAccepted(
  result: AnalysisResult,
  accepted: AcceptedFinding[],
): boolean {
  if (!accepted.length) return false;

  const resultText = normalize(result.relevantText ?? result.message);

  return accepted.some((entry) => {
    if (entry.code !== result.code) return false;

    const pattern = normalize(entry.textPattern);
    // Forward substring containment only: the accepted pattern must be a
    // normalized substring found within the result's text. Short patterns
    // (< 5 chars) are ignored to avoid false positives from overly permissive
    // reverse matching (e.g. "yes" suppressing an unrelated finding).
    if (pattern.length < 5) return false;
    return resultText.includes(pattern);
  });
}

/**
 * Filter out accepted findings from analysis results.
 */
export function filterAcceptedResults(
  results: AnalysisResult[],
  fileName: string,
  storePath: string,
): AnalysisResult[] {
  // Guard: empty path sentinel (no workspace available) — return unfiltered.
  if (!storePath) return results;
  const store = loadAcceptedFindings(storePath);
  const key = sanitizeFileName(fileName);
  const accepted = store.entries[key];

  if (!accepted || accepted.length === 0) {
    return results;
  }

  const filtered = results.filter((r) => !isFindingAccepted(r, accepted));
  const suppressed = results.length - filtered.length;

  if (suppressed > 0) {
    log.debug(`Suppressed ${suppressed} accepted finding(s) for ${fileName}`);
  }

  return filtered;
}
