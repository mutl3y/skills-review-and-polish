import * as vscode from 'vscode';
import { AnalysisResult, Severity } from '../core/types';

const SOURCE = 'Skills Review';

export function createDiagnosticCollection(): vscode.DiagnosticCollection {
  return vscode.languages.createDiagnosticCollection('skillsReviewAndPolish');
}

function toVsSeverity(s: Severity): vscode.DiagnosticSeverity {
  switch (s) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    case 'hint':
      return vscode.DiagnosticSeverity.Hint;
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

/** Higher number = more severe. Used to rank findings when capping (plan item 5). */
const SEVERITY_RANK: Record<Severity, number> = {
  error: 3,
  warning: 2,
  info: 1,
  hint: 0,
};

/**
 * Apply severity overrides (ESLint-style). Returns null when the code is 'off'.
 */
function applyOverride(
  result: AnalysisResult,
  overrides?: Record<string, Severity | 'off'>,
): Severity | null {
  const o = overrides?.[result.code];
  if (!o) {
    return result.severity;
  }
  if (o === 'off') {
    return null;
  }
  return o;
}

export function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  uri: vscode.Uri,
  results: AnalysisResult[],
  overrides?: Record<string, Severity | 'off'>,
  maxDiagnostics = 20,
): void {
  const diagnostics: vscode.Diagnostic[] = [];
  const accepted: AnalysisResult[] = [];
  for (const r of results) {
    const severity = applyOverride(r, overrides);
    if (severity === null) {
      continue;
    }
    accepted.push(r);
  }
  // Cap rendered diagnostics so large skills (e.g. 31 findings on a 294K-char
  // skill) stay responsive in the IDE. Keep the top-N by severity (most
  // severe first), preserving original order as a tiebreak, and surface a
  // single "show all" informational diagnostic for the remainder. Plan item 5 (a).
  const ranked = accepted
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (SEVERITY_RANK[b.r.severity] - SEVERITY_RANK[a.r.severity]) || (a.i - b.i))
    .map(x => x.r);
  const capped = ranked.slice(0, maxDiagnostics);
  const overflow = accepted.length - capped.length;
  for (const r of capped) {
    const severity = applyOverride(r, overrides) ?? r.severity;
    const range = new vscode.Range(
      r.range.start.line,
      r.range.start.character,
      r.range.end.line,
      r.range.end.character,
    );
    const diag = new vscode.Diagnostic(range, r.message, toVsSeverity(severity));
    diag.code = r.code;
    diag.source = `${SOURCE} (${r.analyzer})`;
    // Attach original AnalysisResult for CodeActionProvider and HoverProvider access.
    (diag as vscode.Diagnostic & { data?: AnalysisResult }).data = r;
    diagnostics.push(diag);
  }
  if (overflow > 0) {
    const range = new vscode.Range(0, 0, 0, 0);
    const diag = new vscode.Diagnostic(
      range,
      `${overflow} more finding(s) hidden. Run "Skills Review: Show All Findings" to view them, or raise skillsReviewAndPolish.maxDiagnostics.`,
      vscode.DiagnosticSeverity.Information,
    );
    diag.code = 'findings-truncated';
    diag.source = SOURCE;
    diagnostics.push(diag);
  }
  collection.set(uri, diagnostics);
}
