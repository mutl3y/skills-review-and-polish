# E21 — `analysisWaves` API: clean per-call wave selection

**Date:** 2026-07-11
**Status:** Complete
**Author:** Documentation-review experiment (E21 open follow-up)

## Summary

Adds a new public field `analysisWaves?: WaveName[]` to `EngineConfig`. When
set to a non-empty array, the engine runs exactly those waves and bypasses
the `analysisMode` switch entirely (so it works with `analysisMode: 'single'`
too). When undefined or empty, the existing `analysisMode` logic runs
unchanged. The field is purely additive — no existing call site is affected.

## Wave-selection priority (highest first)

1. `enabledWavesOverride` argument on `Engine.analyze` — per-scan modal / MCP
   override, always honored.
2. `config.analysisWaves` — direct per-call wave list, bypasses `analysisMode`.
3. `config.analysisMode` — the legacy switch (`single` | `focused` | `multiWave`).

## Before / after — `src/core/index.ts`

### Before

```ts
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
  return this.analyzer.analyzeSinglePassWave(/* … */);
} else if (effectiveConfig.analysisMode === 'focused') {
  waves = ['contradictions', 'ambiguities'];
} else {
  waves = effectiveConfig.enabledWaves;
}
```

### After

```ts
// Wave-selection priority (highest first):
//   1. `enabledWavesOverride` — per-scan modal / MCP override, always honored.
//   2. `config.analysisWaves` — direct per-call wave list, bypasses analysisMode.
//   3. `config.analysisMode` — the legacy switch (single | focused | multiWave).
// `analysisWaves` is purely additive: when undefined / empty, the existing
// analysisMode logic runs unchanged. See e21-analysisWaves-api.md.
let waves: WaveName[];
if (enabledWavesOverride) {
  waves = enabledWavesOverride;
} else if (effectiveConfig.analysisWaves && effectiveConfig.analysisWaves.length > 0) {
  const log = createLogger('engine');
  log.info(
    `analysisWaves override active: running waves=${JSON.stringify(effectiveConfig.analysisWaves)} (analysisMode=${effectiveConfig.analysisMode} bypassed)`,
  );
  waves = effectiveConfig.analysisWaves;
} else if (effectiveConfig.analysisMode === 'single') {
  // …unchanged
} else if (effectiveConfig.analysisMode === 'focused') {
  waves = ['contradictions', 'ambiguities'];
} else {
  waves = effectiveConfig.enabledWaves;
}
```

## Before / after — `src/core/types.ts` (`EngineConfig`)

### Before

```ts
export interface EngineConfig {
  analysisMode: 'single' | 'focused' | 'multiWave';
  enabledWaves: WaveName[];
  scoreSamples: number;
  // …
}
```

### After

```ts
export interface EngineConfig {
  analysisMode: 'single' | 'focused' | 'multiWave';
  enabledWaves: WaveName[];
  /**
   * Direct per-call wave list. When set to a non-empty array, the engine
   * runs exactly these waves and bypasses the `analysisMode` switch entirely
   * (i.e. it works with `analysisMode: 'single'` too). When undefined or
   * empty, the existing `analysisMode` logic is used.
   *
   * Precedence (highest first):
   *   1. `enabledWavesOverride` argument on `Engine.analyze` (per-scan modal / MCP).
   *   2. `analysisWaves` (this field).
   *   3. `analysisMode` (legacy switch).
   *
   * Purely additive — leaving it undefined preserves the previous behavior
   * exactly.
   */
  analysisWaves?: WaveName[];
  scoreSamples: number;
  // …
}
```

## New tests in `src/core/index.test.ts`

Four new `it` blocks were added under the `Engine` `describe` (total went from
3 → 7 tests in the file, 448 → 452 in the suite). They follow the existing
naming convention (`it('does X', …)` with a spy on `Analyzer.prototype.analyze`
or `analyzeSinglePassWave`):

1. **`analysisWaves: ['hygiene']` fires only the hygiene wave** — config sets
   `analysisMode: 'multiWave'` with all 6 waves enabled, but `analysisWaves:
   ['hygiene']` overrides; asserts the third arg to `Analyzer.analyze` is
   exactly `['hygiene']`.
2. **`analysisWaves: [cognitive_load family proxies] fires both cognitive_load
   and persona waves`** — uses the realistic use case `analysisWaves:
   ['structural', 'persona']` (the `cognitive-*` family is emitted by the
   `structural` wave); asserts both are passed through and the resulting
   codes are `[cognitive-load, persona-inconsistency]`.
3. **`analysisWaves: undefined` falls back to the existing analysisMode
   logic** — `analysisMode: 'multiWave'` with the full 6-wave list and
   `analysisWaves` omitted; asserts `Analyzer.analyze` receives the full
   6-wave list and the effective config does not have `analysisWaves`.
4. **`analysisWaves` overrides `analysisMode: 'single'`** — config sets
   `analysisMode: 'single'` (which would normally take the single-pass
   branch) AND `analysisWaves: ['hygiene']`; asserts `analyzeSinglePassWave`
   is **not** called and `analyze` is called with `['hygiene']`.

## Could existing scripts be simplified?

Yes — and they should be in a future PR (not done here, to keep E21
scope-minimal and per the E20/E19 preservation constraints).

| Script | Current | Could become |
| --- | --- | --- |
| `scripts/e18-focused-suite.mjs` | `analysisMode: 'multiWave'` + `enabledWaves: [...]` (4 fixtures) | `analysisWaves: [...]` only — drop the `analysisMode: 'multiWave'` line. The wave list already drives the behavior; `multiWave` is implicit. |
| `scripts/e19-focused-suite.mjs` | same pattern as e18, with `enabledWaves` set to a single wave in some fixtures | same simplification. The fact that `multiWave` is the only mode that respects `enabledWaves` is a footgun the new field removes. |
| `scripts/baseline-fork.mjs` | `analysisMode: 'single'` (no per-wave override) | no change — already a single-pass baseline. |

For now, the E19 scripts (which were just touched) are **not** modified, per
the E21 constraint. The E18 script (older, less actively maintained) is also
left alone for consistency. A small follow-up PR can sweep both.

## Recommended VS Code command / menu updates

The `analysisWaves` field unlocks two UX improvements that are out of scope
for E21 (the API change is the foundation):

1. **Per-scan modal — single-wave quick run.** The current VS Code scan-modal
   flow already passes an `enabledWavesOverride` (highest priority). With
   `analysisWaves` available on `EngineConfig`, the same modal could also be
   backed by `config.analysisWaves` for a one-line code path when no modal
   override is supplied. No UX change is required.
2. **New "Analyze cognitive_load only" command.** A new VS Code command
   (e.g. `skillsReviewAndPolish.analyzeCognitiveLoad`) that constructs an
   `Engine` with `analysisWaves: ['structural', 'persona']` (the waves that
   emit the `cognitive-*` family) and runs a single analysis pass. Currently
   this requires `analysisMode: 'multiWave'` + a 6-element `enabledWaves`
   list, which is error-prone. With the new field it becomes a 2-liner.
3. **MCP server `analyze` tool — additive `analysisWaves` parameter.** The
   MCP `analyze` tool already supports an `enabledWaves` array. Adding
   `analysisWaves` as an alias / passthrough is mechanical and gives
   agent-mode callers the same one-line ergonomics as the VS Code UI.

These are recommendations only — none of them are implemented in E21.

## Verification

- `npm run compile` → clean.
- `npx vitest run --config tests/vitest.config.ts --exclude="**/server.integration.test.ts"` →
  22 test files, **452 tests** (was 448 before E21; +4 new E21 tests).
- `npm run lint:md` → no new errors from E21 files. The pre-existing
  `MD060`/`MD009`/`MD012` errors in `docs/`, `docs/plan/`, and
  `.github/experiments/` versions are unchanged.
- E20 fixture changes: untouched (no edits in `tests/fixtures/`).
- E19 scripts: untouched (no edits in `scripts/e19*`).
- Analyzer behavior: unchanged when `analysisWaves` is undefined.
