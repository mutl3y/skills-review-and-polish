/**
 * EXPERIMENTAL: Inline rewrite ghost-text provider (Phase 6).
 *
 * When `skillsReviewAndPolish.experimental.inlineRewrites` is enabled (default:
 * false), this provider offers ghost-text previews of surgical fix proposals at
 * diagnostic positions. The user accepts with Tab.
 *
 * SAFETY NOTE: Unlike the main Fix command which shows a QuickPick diff dialog
 * before applying, inline completions apply directly on Tab accept. This is
 * acceptable because:
 *   1. Ghost text provides a visual preview of the exact change before acceptance
 *   2. The SurgicalFixer safety gates still apply (length bounds, obligation
 *      preservation, fence injection detection)
 *   3. The feature is EXPERIMENTAL and OFF BY DEFAULT
 *   4. Users can undo with Ctrl+Z if the fix is incorrect
 *
 * Implementation constraints:
 * - Runs ONLY when `inlineRewrites = true` (the setting is off by default and
 *   deliberately marked EXPERIMENTAL in the settings description).
 * - Only fires on positions that are directly inside a Skills Review diagnostic range.
 * - One fix LLM call per ghost-text request — no caching, no background pre-fetch.
 * - Uses the same SurgicalFixer safety gates as the Fix commands.
 */

import * as vscode from 'vscode';
import { AnalysisResult } from '../core/types';
import { SurgicalFixer, SURGICAL_FIXABLE_CODES } from '../core/fixer';
import { Engine } from '../core';

/** Cache of recent fix results to avoid redundant LLM calls. */
const fixCache = new Map<string, { result: { accepted: boolean; fixed: string }; timestamp: number }>();
const FIX_CACHE_TTL_MS = 30_000; // 30 seconds
/** Maximum cache entries before oldest are evicted. */
const FIX_CACHE_MAX_SIZE = 50;

/** Simple hash for cache keys — sufficient to prevent collisions on truncated prefixes. */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/** Ensure the cache doesn't exceed MAX_SIZE by evicting oldest entries. */
function enforceCacheMaxSize(): void {
  if (fixCache.size <= FIX_CACHE_MAX_SIZE) return;
  // Map iteration order is insertion order — delete oldest entries first.
  const excess = fixCache.size - FIX_CACHE_MAX_SIZE;
  let deleted = 0;
  for (const key of fixCache.keys()) {
    if (deleted >= excess) break;
    fixCache.delete(key);
    deleted++;
  }
}

/** Clear the fix cache — exported for test isolation. */
export function clearFixCache(): void {
  fixCache.clear();
}

/**
 * Create and register the experimental inline rewrite provider.
 * Returns the disposable so the extension can push it to `context.subscriptions`.
 * Does NOT activate unless `cfg.inlineRewrites` is true at call time — callers
 * should also guard.
 */
export function createInlineRewriteProvider(
  getEngine: () => Promise<Engine>,
  getLastResults: (uri: vscode.Uri) => AnalysisResult[],
): vscode.Disposable {
  const provider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(document, position, _context, _token) {
      // Only fire on customization diagnostics at this position
      const diags = vscode.languages
        .getDiagnostics(document.uri)
        .filter((d) => d.source?.startsWith('Skills Review') === true)
        .filter((d) => d.range.contains(position));

      if (diags.length === 0) return [];

      const diag = diags[0];
      const code = typeof diag.code === 'string' ? diag.code : diag.code?.toString() ?? '';
      if (!SURGICAL_FIXABLE_CODES.has(code)) return [];

      // Retrieve the AnalysisResult backing this diagnostic
      const results = getLastResults(document.uri);
      const result: AnalysisResult | undefined =
        (diag as vscode.Diagnostic & { data?: AnalysisResult }).data ??
        results.find((r) => r.code === code);
      if (!result) return [];

      try {
        const text = document.getText();

        // Check cache first to avoid redundant LLM calls
        // Include a hash of the full relevantText to prevent collisions on truncated prefixes.
        const anchor = result.relevantText ?? '';
        const cacheKey = `${document.uri.toString()}:${code}:${simpleHash(anchor)}:${anchor.slice(0, 50)}`;
        const cached = fixCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < FIX_CACHE_TTL_MS) {
          if (!cached.result.accepted || !cached.result.fixed) return [];
          if (!anchor || !text.includes(anchor)) return [];
          const anchorStart = text.indexOf(anchor);
          const anchorEnd = anchorStart + anchor.length;
          const startPos = document.positionAt(anchorStart);
          const endPos = document.positionAt(anchorEnd);
          const anchorRange = new vscode.Range(startPos, endPos);
          if (!anchorRange.contains(position)) return [];
          return [new vscode.InlineCompletionItem(cached.result.fixed, anchorRange)];
        }

        const engine = await getEngine();
        const fixer = new SurgicalFixer(engine.provider);
        const fixResult = await fixer.fixIssue(text, document.uri.fsPath, result);

        // Cache the result to avoid redundant LLM calls
        fixCache.set(cacheKey, { result: { accepted: fixResult.accepted, fixed: fixResult.fixed }, timestamp: Date.now() });
        enforceCacheMaxSize();

        if (!fixResult.accepted || !fixResult.fixed) return [];

        // Replace just the anchor range with the proposed fix
        if (!anchor || !text.includes(anchor)) return [];

        const anchorStart = text.indexOf(anchor);
        const anchorEnd = anchorStart + anchor.length;
        const startPos = document.positionAt(anchorStart);
        const endPos = document.positionAt(anchorEnd);
        const anchorRange = new vscode.Range(startPos, endPos);

        if (!anchorRange.contains(position)) return [];

        const item = new vscode.InlineCompletionItem(
          fixResult.fixed,
          anchorRange,
        );
        return [item];
      } catch {
        return [];
      }
    },
  };

  return vscode.languages.registerInlineCompletionItemProvider(
    { language: 'markdown' },
    provider,
  );
}
