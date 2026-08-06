import * as vscode from 'vscode';
import { redactSecrets } from '../core/redact';

/**
 * A persistent status-bar item that lives in the bottom-left editor section.
 * It shows the last analysis grade + issue count, or a spinner while analysis
 * is running.
 */
export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.name = 'Skills Review';
    this.item.command = 'skillsReviewAndPolish.rescan';
    this.item.tooltip = 'Skills Review and Polish — click to rescan';
    this.showIdle();
    this.item.show();
  }

  /** Call immediately before starting analysis. */
  startAnalyzing(): void {
    this.item.text = '$(sync~spin) Skills Review…';
    this.item.tooltip = 'Analyzing…';
  }

  /**
   * Call after analysis completes.
   * @param grade  Letter grade, e.g. 'A+', 'B', 'F'
   * @param issueCount  Total number of diagnostics published
   */
  showResult(grade: string, issueCount: number): void {
    const issueLabel =
      issueCount === 0
        ? '$(check) No issues'
        : `${issueCount} issue${issueCount === 1 ? '' : 's'}`;
    this.item.text = `$(beaker) ${grade} · ${issueLabel}`;
    this.item.tooltip = `Skills Review: grade ${grade}, ${issueCount} issue${issueCount === 1 ? '' : 's'} — click to rescan`;
  }

  /** Call when the extension encounters an error. */
  showError(message: string): void {
    this.item.text = '$(error) Skills Review';
    this.item.tooltip = `Error: ${redactSecrets(message)}`;
  }

  /** Call when no customization file is open. */
  showIdle(): void {
    this.item.text = '$(beaker) Skills Review';
    this.item.tooltip = 'Skills Review and Polish — click to rescan';
  }

  dispose(): void {
    this.item.dispose();
  }
}
