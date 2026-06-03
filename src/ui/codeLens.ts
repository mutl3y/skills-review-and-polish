import * as vscode from 'vscode';
import type { ScoreResult } from '../core/scoring';

/**
 * Provides a score + grade + issue-count CodeLens at the top of customization
 * files. Refreshes whenever the extension publishes new diagnostics.
 */
export class ScoreCodeLensProvider implements vscode.CodeLensProvider {
  private scores = new Map<string, ScoreResult & { issueCount: number }>();
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  /**
   * Update the score for a given URI; fires a refresh.
   */
  update(uri: vscode.Uri, score: ScoreResult, issueCount: number): void {
    this.scores.set(uri.toString(), { ...score, issueCount });
    this._onDidChangeCodeLenses.fire();
  }

  /** Clear data for a URI (e.g. when the file is closed). */
  clear(uri: vscode.Uri): void {
    this.scores.delete(uri.toString());
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const info = this.scores.get(document.uri.toString());
    if (!info) return [];

    const topRange = new vscode.Range(0, 0, 0, 0);
    const issueLabel =
      info.issueCount === 0
        ? 'No issues'
        : `${info.issueCount} issue${info.issueCount === 1 ? '' : 's'}`;

    const scoreLens = new vscode.CodeLens(topRange, {
      title: `$(beaker) Grade ${info.grade} · ${info.score}/100 · ${issueLabel}`,
      command: 'skillsReviewAndPolish.rescan',
      tooltip: `Quality score: ${info.score}/100  (grade ${info.grade})`,
    });

    const fixLens = new vscode.CodeLens(topRange, {
      title: '$(wrench) Fix All',
      command: 'skillsReviewAndPolish.fixAll',
      tooltip: 'Run surgical fixer on all auto-fixable issues',
    });

    return [scoreLens, fixLens];
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}
