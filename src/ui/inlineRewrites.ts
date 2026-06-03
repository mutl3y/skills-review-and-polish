/**
 * EXPERIMENTAL: Inline rewrite ghost-text provider (Phase 6).
 *
 * When `skillsReviewAndPolish.experimental.inlineRewrites` is enabled (default:
 * false), this provider offers ghost-text previews of surgical fix proposals at
 * diagnostic positions. The user accepts with Tab.
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
        const engine = await getEngine();
        const text = document.getText();
        const fixer = new SurgicalFixer(engine.provider);
        const fixResult = await fixer.fixIssue(text, document.uri.fsPath, result);
        if (!fixResult.accepted || !fixResult.fixed) return [];

        // Replace just the anchor range with the proposed fix
        const anchor = result.relevantText ?? '';
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
