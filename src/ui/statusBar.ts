import * as vscode from 'vscode';

/**
 * Strip secrets and tokens from error messages before displaying in UI.
 * Prevents leaking Bearer tokens, API keys, or other credentials in tooltips.
 */
function sanitizeForDisplay(message: string): string {
  return message
    // Bearer tokens: "Bearer eyJ..." or "bearer sk-..."
    .replace(/bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED]')
    // Generic API key patterns: sk-..., ghp_..., glpat-..., xox[bpsa]-...
    .replace(/(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9-]{20,}|xox[bpsa]-[A-Za-z0-9-]{20,})/g, '[REDACTED]')
    // Authorization headers
    .replace(/Authorization\s*[:=]\s*\S+/gi, 'Authorization: [REDACTED]');
}

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
   * Call when a batch (slow) analysis job is submitted. Shows that results
   * will populate later (~5 min) and the user can keep editing — avoids the
   * "Analyzing…" state reading like a hang.
   */
  showBatchStarted(estSec = 300): void {
    this.item.text = `$(history) Skills Review: batch ~${Math.round(estSec / 60)}m`;
    this.item.tooltip = `Batch (slow) analysis running — results populate automatically in ~${estSec}s. You can keep editing.`;
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
    this.item.tooltip = `Error: ${sanitizeForDisplay(message)}`;
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
