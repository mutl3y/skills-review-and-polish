import * as vscode from 'vscode';
import { AnalysisResult } from '../core/types';
import { SURGICAL_FIXABLE_CODES } from '../core/fixer';

/** Retrieves the attached AnalysisResult from a diagnostic's `.data` property. */
function resultFromDiagnostic(diag: vscode.Diagnostic): AnalysisResult | undefined {
  return (diag as vscode.Diagnostic & { data?: AnalysisResult }).data;
}

/**
 * Provides quick-fix and ignore code actions for Skills Review diagnostics.
 */
export class SkillsCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Source,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source?.startsWith('Skills Review') !== true) continue;
      const result = resultFromDiagnostic(diag);
      const code = typeof diag.code === 'string' ? diag.code : diag.code?.toString() ?? '';

      // Quick Fix — surgical fixer (only for fixable codes)
      if (SURGICAL_FIXABLE_CODES.has(code)) {
        const fixAction = new vscode.CodeAction(
          `Skills Review: Fix "${code}"`,
          vscode.CodeActionKind.QuickFix,
        );
        fixAction.diagnostics = [diag];
        fixAction.isPreferred = true;
        fixAction.command = {
          command: 'skillsReviewAndPolish.fixIssue',
          title: `Fix "${code}"`,
          arguments: [document.uri, result ?? diag],
        };
        actions.push(fixAction);
      }

      // Ignore rule — adds a severity override entry to workspace settings
      const ignoreAction = new vscode.CodeAction(
        `Skills Review: Ignore rule "${code}"`,
        vscode.CodeActionKind.QuickFix,
      );
      ignoreAction.diagnostics = [diag];
      ignoreAction.command = {
        command: 'skillsReviewAndPolish.ignoreRule',
        title: `Ignore "${code}"`,
        arguments: [code],
      };
      actions.push(ignoreAction);
    }

    return actions;
  }
}
