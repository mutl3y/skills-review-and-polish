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
): void {
  const diagnostics: vscode.Diagnostic[] = [];
  for (const r of results) {
    const severity = applyOverride(r, overrides);
    if (severity === null) {
      continue;
    }
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
  collection.set(uri, diagnostics);
}
