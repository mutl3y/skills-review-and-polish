/**
 * Core engine entry point.
 *
 * Keep this file extension-agnostic. All LLM access goes through `provider`.
 */

import {
  AnalysisResult,
  CancellationToken,
  EngineConfig,
  DEFAULT_ENGINE_CONFIG,
  LlmProvider,
  WaveName,
} from './types';
import { Analyzer, CustomDiagnosticConfig } from './analyzer';
import { scoreSkill, parseSkillType, ScoreResult } from './scoring';
import { SurgicalFixer, SurgicalFixOptions } from './fixer';
import { createLogger } from './logger';

export * from './types';
export * from './analyzer';
export * from './scoring';
export * from './fixer';
export * from './logger';
export * from './prompts';
export * from './acceptedFindings';

export interface AnalyzeInput {
  /** Full document text. */
  text: string;
  /** Absolute path (used for composition-conflicts / domain hints). Optional. */
  filePath?: string;
  /** Optional custom diagnostics to add as an extra wave. */
  customDiagnostics?: CustomDiagnosticConfig[];
  /** Optional path to the accepted findings store JSON file. */
  acceptedFindingsPath?: string;
  /** Optional cancellation token — allows the caller to abort in-flight analysis. */
  token?: CancellationToken;
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
   * @param enabledWavesOverride Optional override for enabled waves (from per-scan modal or MCP).
   * @param configOverride Optional override of the engine's stored config. Used
   *   by callers (MCP, scanner modal) that want to flip a single setting like
   *   `filterFindings` for one call without mutating the engine's stored config.
   */
  async analyze(
    input: AnalyzeInput,
    customDiagnostics?: CustomDiagnosticConfig[],
    enabledWavesOverride?: WaveName[],
    configOverride?: Partial<EngineConfig>,
  ): Promise<AnalysisResult[]> {
    // The effective config is the stored config merged with the per-call
    // override. Override is shallow: it replaces individual fields.
    const effectiveConfig: EngineConfig = configOverride
      ? { ...this.config, ...configOverride }
      : this.config;
    // If an explicit override was provided (e.g. from the wave-picker modal or MCP),
    // always honour it regardless of analysisMode.
    let waves: WaveName[];
    if (enabledWavesOverride) {
      waves = enabledWavesOverride;
    } else if (effectiveConfig.analysisMode === 'single') {
      // 'single' mode: one combined LLM call covering all 6 categories.
      // Lower recall than multiWave but only 1 API call.
      const log = createLogger('engine');
      log.info('analysisMode=single: running combined single-pass wave');
      return this.analyzer.analyzeSinglePassWave(
        {
          text: input.text,
          filePath: input.filePath,
          acceptedFindingsPath: input.acceptedFindingsPath,
          token: input.token,
        },
      );
    } else if (effectiveConfig.analysisMode === 'focused') {
      // 'focused' mode: 2 focused calls for the highest-signal waves.
      const log = createLogger('engine');
      log.info('analysisMode=focused: restricting to contradictions+ambiguities waves');
      waves = ['contradictions', 'ambiguities'];
    } else {
      waves = effectiveConfig.enabledWaves;
    }
    return this.analyzer.analyze(
      {
        text: input.text,
        filePath: input.filePath,
        acceptedFindingsPath: input.acceptedFindingsPath,
        token: input.token,
      },
      customDiagnostics,
      waves,
      effectiveConfig,
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
  ): Promise<{ fixedText: string; applied: number; skipped: number; skippedReasons: string[] }> {
    const fixer = new SurgicalFixer(this.provider);
    // Skip reference grounding for untitled documents (no real file path)
    const filePath = input.filePath ?? '';
    const isUntitled = !filePath || filePath.trim() === '';
    return fixer.fixDocument(
      input.text,
      filePath,
      diagnostics,
      {
        additive: this.config.fixStrategy === 'additive',
        semanticCheck: this.config.fixSemanticCheck,
        selfCritique: this.config.fixSelfCritique,
        referenceGrounding: this.config.fixReferenceGrounding,
        ...options,
        // Untitled documents have no real path — always skip reference grounding
        ...(isUntitled ? { referenceGrounding: false } : {}),
      },
      {
        upperBoundMultiplier: this.config.fixGuardUpperBoundMultiplier,
        lowerBoundMultiplier: this.config.fixGuardLowerBoundMultiplier,
        maxAnchorChars: this.config.fixGuardMaxAnchorChars,
      },
    );
  }
}
