import { describe, it, expect } from 'vitest';
import { estimateWaveCount, estimateFixWaveCount } from './waveCount';
import { DEFAULT_ENGINE_CONFIG, EngineConfig } from './types';

const base: EngineConfig = { ...DEFAULT_ENGINE_CONFIG };

describe('estimateWaveCount', () => {
  it('returns 1 for single mode', () => {
    expect(estimateWaveCount({ ...base, analysisMode: 'single' as const }, undefined)).toBe(1);
  });

  it('returns 2 for focused mode', () => {
    expect(estimateWaveCount({ ...base, analysisMode: 'focused' as const }, undefined)).toBe(2);
  });

  it('returns enabledWaves length for multiWave', () => {
    const cfg = { ...base, analysisMode: 'multiWave' as const, enabledWaves: ['structural', 'persona'] as EngineConfig['enabledWaves'] };
    expect(estimateWaveCount(cfg, undefined)).toBe(2);
  });

  it('uses DEFAULT_ENGINE_CONFIG mode (focused=2) when no config given', () => {
    expect(estimateWaveCount(undefined, undefined)).toBe(2);
  });

  it('analysisWaves argument overrides mode', () => {
    expect(estimateWaveCount({ ...base, analysisMode: 'single' as const }, ['structural'])).toBe(1);
    expect(estimateWaveCount({ ...base, analysisMode: 'single' as const }, ['structural', 'persona'])).toBe(2);
  });

  it('engineConfig.analysisWaves overrides mode', () => {
    const cfg = { ...base, analysisMode: 'single' as const, analysisWaves: ['structural', 'persona', 'coverage'] as EngineConfig['analysisWaves'] };
    expect(estimateWaveCount(cfg, undefined)).toBe(3);
  });
});

describe('estimateFixWaveCount', () => {
  it('counts fix + semantic + self-critique when both gates on', () => {
    const cfg = { ...base, fixSemanticCheck: true, fixSelfCritique: true, fixStrategy: 'subtractive' as const };
    expect(estimateFixWaveCount(cfg)).toBe(3);
  });

  it('counts fix + semantic only when self-critique off and subtractive', () => {
    const cfg = { ...base, fixSemanticCheck: true, fixSelfCritique: false, fixStrategy: 'subtractive' as const };
    expect(estimateFixWaveCount(cfg)).toBe(2);
  });

  it('forces self-critique for additive fixes even when fixSelfCritique off', () => {
    const cfg = { ...base, fixSemanticCheck: false, fixSelfCritique: false, fixStrategy: 'additive' as const };
    expect(estimateFixWaveCount(cfg)).toBe(2); // fix + forced self-critique
  });

  it('defaults to 3 for the default config', () => {
    expect(estimateFixWaveCount(undefined)).toBe(3);
  });
});
