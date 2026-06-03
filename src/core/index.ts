/**
 * Core engine entry point.
 *
 * Keep this file vscode-free. All LLM access goes through `provider`.
 */

import {
  AnalysisResult,
  EngineConfig,
  DEFAULT_ENGINE_CONFIG,
  LlmProvider,
} from './types';
import { Analyzer, CustomDiagnosticConfig } from './analyzer';
import { scoreSkill, parseSkillType, ScoreResult } from './scoring';
import { SurgicalFixer, SurgicalFixOptions } from './fixer';

export * from './types';
export * from './analyzer';
export * from './scoring';
export * from './fixer';

export interface AnalyzeInput {
  /** Full document text. */
  text: string;
  /** Absolute path (used for composition-conflicts / domain hints). Optional. */
  filePath?: string;
  /** Optional custom diagnostics to add as an extra wave. */
  customDiagnostics?: CustomDiagnosticConfig[];
}

export class Engine {
  private analyzer: Analyzer;

  constructor(
    readonly provider: LlmProvider,
    private readonly config: EngineConfig = DEFAULT_ENGINE_CONFIG,
  ) {
    this.analyzer = new Analyzer(provider);
  }

  /**
   * Analyze a customization document and return findings.
   * Runs all enabled waves in parallel and applies deterministic consolidation.
   */
  async analyze(input: AnalyzeInput): Promise<AnalysisResult[]> {
    return this.analyzer.analyze(
      { text: input.text, filePath: input.filePath },
      input.customDiagnostics,
    );
  }

  /**
   * Compute the quality score (0-100), penalty, and grade for a document.
   * For keep/revert decisions use scoreSamples >= 3 (median-of-N) — single
   * scan variance is ±6 (see docs/plan/LEARNINGS.md).
   */
  async score(input: AnalyzeInput): Promise<ScoreResult & { penalty: number }> {
    const results = await this.analyze(input);
    const lineCount = input.text.split('\n').length;
    const skillType = parseSkillType(input.text);
    const result = scoreSkill(results, lineCount, skillType);
    return { ...result, penalty: result.issuePenalty + result.lengthPenalty };
  }

  /**
   * Surgically fix flagged issues with safety gates.
   * The extension is responsible for HITL confirmation before writing changes.
   * Returns the proposed fixed document text and counts.
   */
  async surgicalFix(
    input: AnalyzeInput,
    diagnostics: AnalysisResult[],
    options: SurgicalFixOptions = {},
  ): Promise<{ fixedText: string; applied: number; skipped: number }> {
    const fixer = new SurgicalFixer(this.provider);
    return fixer.fixDocument(
      input.text,
      input.filePath ?? '',
      diagnostics,
      {
        additive: this.config.fixStrategy === 'additive',
        semanticCheck: this.config.fixSemanticCheck,
        selfCritique: this.config.fixSelfCritique,
        referenceGrounding: this.config.fixReferenceGrounding,
        ...options,
      },
    );
  }
}
