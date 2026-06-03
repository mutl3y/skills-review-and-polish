import * as vscode from 'vscode';
import { AnalysisResult } from '../core/types';

/**
 * Hover provider that shows the diagnostic suggestion text and a copy of the
 * issue message when the user hovers over a Skills Review–flagged range.
 */
export class SuggestionHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const diags = vscode.languages
      .getDiagnostics(document.uri)
      .filter((d) => d.source?.startsWith('Skills Review') === true)
      .filter((d) => d.range.contains(position));

    if (diags.length === 0) return undefined;

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;

    for (const diag of diags) {
      const result: AnalysisResult | undefined = (
        diag as vscode.Diagnostic & { data?: AnalysisResult }
      ).data;

      const code =
        typeof diag.code === 'string' ? diag.code : diag.code?.toString() ?? '';

      md.appendMarkdown(`**$(beaker) Skills Review** \`${code}\`\n\n`);

      if (result?.suggestion) {
        md.appendMarkdown(`**Suggestion:** ${result.suggestion}\n\n`);
      } else {
        // Fallback: strip "Suggestion: ..." from message and show separately
        const msg = diag.message.replace(/\s*Suggestion:[\s\S]*$/, '').trim();
        const suggestionMatch = diag.message.match(/Suggestion:\s*([\s\S]+)$/);
        if (msg) md.appendMarkdown(`${msg}\n\n`);
        if (suggestionMatch) md.appendMarkdown(`**Suggestion:** ${suggestionMatch[1].trim()}\n\n`);
      }

      md.appendMarkdown('---\n\n');
    }

    return new vscode.Hover(md);
  }
}
