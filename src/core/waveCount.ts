/**
 * Shared LLM-wave accounting.
 *
 * Both the MCP server (`src/mcp/server.ts`) and the VS Code extension's
 * language-model tools (`src/extension.ts`) drive the same paid engine and
 * share one session budget. They MUST agree on how many LLM waves an
 * operation will run, or one door under-reserves/under-charges the shared
 * budget while the other doesn't — the exact drift this module exists to
 * prevent.
 */

import { ALL_WAVES, DEFAULT_ENGINE_CONFIG, EngineConfig } from './types';

/**
 * Estimate how many LLM waves an analysis will run, so the cost budget
 * charges the input per wave (not a flat 6). Mirrors the engine's mode logic:
 * single=1, focused=2, multiWave=enabledWaves.length (default 6). A direct
 * `analysisWaves` list (argument or engine config) overrides the mode.
 */
export function estimateWaveCount(
  engineConfig: EngineConfig | undefined,
  analysisWaves: string[] | undefined,
): number {
  // The engine's precedence is: configOverride (the analysisWaves argument
  // here) > engineConfig.analysisWaves > analysisMode. So check the argument
  // FIRST — it represents the per-call override that wins in the engine.
  if (analysisWaves && analysisWaves.length > 0) return analysisWaves.length;
  const configWaves = engineConfig?.analysisWaves;
  if (configWaves && configWaves.length > 0) return configWaves.length;
  const mode = engineConfig?.analysisMode ?? DEFAULT_ENGINE_CONFIG.analysisMode;
  if (mode === 'single') return 1;
  if (mode === 'focused') return 2;
  return engineConfig?.enabledWaves?.length ?? ALL_WAVES.length;
}

/**
 * Estimate how many LLM waves a fix will run, so the cost budget charges the
 * input per wave. The fixer makes up to 3 LLM calls: the fix itself, plus the
 * semantic check and self-critique gates when enabled. The fixer FORCES
 * self-critique for additive ambiguity fixes even when `fixSelfCritique` is
 * off, so account for that here or the budget under-reserves/under-charges
 * the common additive path.
 */
export function estimateFixWaveCount(engineConfig: EngineConfig | undefined): number {
  const cfg = engineConfig ?? DEFAULT_ENGINE_CONFIG;
  const isAdditiveFix = cfg.fixStrategy === 'additive';
  const selfCritiqueCalls = (cfg.fixSelfCritique || isAdditiveFix) ? 1 : 0;
  return 1 + (cfg.fixSemanticCheck ? 1 : 0) + selfCritiqueCalls;
}
