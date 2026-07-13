# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (v0.1.37 — 2026-07-13)

- **Multi-model scan recommended configuration** (E53/E54/E56) — `model: google/gemini-2.5-flash-lite` + `deepModel: deepseek/deepseek-chat-v3`. E56 corpus scan on 327 awesome-copilot skills: 8811 findings (vs 1664 in E30 with qwen-only) — a 429% improvement at half the cost ($0.24 vs $0.50). Key wins:
  - **Circular definitions**: 1 → 15 (15x) — deepseek-chat-v3 is 90% on test-circular-hard vs 67% for gemini-flash
  - **Contradictions**: 11 → 35 (3x) — deepseek-chat-v3 deepModel wins the contradictions wave
  - **Dead instructions**: 0 → 29 (new category)
  - **Persona inconsistencies**: 1 → 15 (15x)
  - **Ambiguity**: 939 → 5235 (5.6x)
  - **Coverage gaps**: 323 → 2103 (6.5x)
  - **Hygiene-vague-cognitive-directive**: 1 → 221 (220x)
  - **Hygiene-missing-agent**: 7 → 76 (11x)
- **Updated package.json defaults** to use the new multi-model config:
  - `model` default: `google/gemini-2.5-flash-lite` (was `qwen/qwen3-coder-30b-a3b-instruct`)
  - `deepModel` default: `deepseek/deepseek-chat-v3` (was empty, defaulted to model)
- **Test infrastructure (E50 clean architecture)** — separate the LLM-readable skill body from the expected answer key. The LLM only sees a clean skill body, never the test scaffolding. New scripts:
  - `scripts/e50-clean-architecture.mjs` — test runner using clean fixtures + separate expected files
  - `scripts/e50-generate-clean-fixtures.mjs` — generator that strips test scaffolding from SKILL.md files
  - `tests/fixtures/clean/` — 15 clean skill bodies (no labels, no metadata, no hint comments)
  - `tests/fixtures/expected/` — 15 expected answer files (separate from skill bodies)
- **Hygiene circular rule (E45)** — improved the rule to add near-synonym / reciprocal / 3-hop / tautological-legal patterns. E50 test-circular-hard: 0/7 → 5/7 (0% → 71%).
- **Model selection tools (E52, E53, E54, E55)** — systematic model comparison on clean test fixtures and production skills:
  - `scripts/e51-production-skill-test.mjs` — production skill recall test
  - `scripts/e52-model-comparison.mjs` — Qwen vs Llama-4-scout on focus fixtures
  - `scripts/e53-model-comparison-clean.mjs` — 7 models on clean fixtures
  - `scripts/e54-models-not-yet-tested.mjs` — wildcards (Claude, Gemini Pro, o1/o3, deepseek, Grok, Mistral)
  - `scripts/e55-cost-analysis.mjs` — cost estimates for all 340 awesome-copilot skills per model
  - `scripts/e56-corpus-rescan-multimodel.mjs` — full corpus scan with multi-model mix
- **Calibrated E33 fixture expectations** (e33-calibration.md) — honest review of which expected counts are realistic vs over-claimed. Used to calibrate the E50 test architecture.
- **CHANGELOG** — clear documentation of v0.1.37 improvements with E56 results

### Fixed

- **Test fixture label-leverage** — the old E33 test used fixtures with `[DIRECT-N]` labels and "Test metadata" blocks in the SKILL.md body. The LLM was reading this scaffolding, not analyzing the skill. The E50 clean architecture removes this priming, giving more honest recall measurements.
- **Constraint-overload rule** — updated the structural-quality rule to allow flagging of 5+ simultaneous AND conditions as `deep-decision-tree`. The E50 test-cognitive-structural / cognitive was the only remaining gap after this fix.

### Changed

- **package.json** — `model` and `deepModel` defaults changed from `qwen/qwen3-coder-30b-a3b-instruct` (single-model) to `google/gemini-2.5-flash-lite` + `deepseek/deepseek-chat-v3` (multi-model mix).
- **README.md** — updated to reflect v0.1.37 with the multi-model recommendation.
- **docs/USER-GUIDE.md** — updated "Recommended OpenRouter Models" table with E56 results, marked `qwen/qwen3-coder-30b` as "Avoid" (only 21% recall on test fixtures, 5x fewer findings than gemini-flash).

## [0.1.38] — 2026-07-13 (marketplace publish)

### Note

v0.1.37 is the substantive release with the multi-model configuration. v0.1.38 is a version bump because the marketplace already had v0.1.37 registered from a prior session, so the publish required a fresh version number. The package.json defaults and all behavior are identical to v0.1.37.

- **Published to VS Code marketplace** as `mutl3y.skills-review-and-polish` v0.1.38
- All v0.1.37 changes (multi-model config, E56 corpus scan, E58 quality-playbook review, new scripts) are in v0.1.38

## [0.1.36] — 2026-07-12

### Added (v0.1.36 — 2026-07-12)

- **Ambiguity prompt v4** (commit `ec3333a`) — replaces the E33 v5/E38 prompt with a simpler, more effective structure. Uses "Default: FLAG" + "Aim for high recall" + flat criteria. Long positive example list of concrete terms (appropriate team, high-throughput, etc.). Verified at fixture scale: 8/10 ambiguity fixtures improved, 0 regressed. Overall 17/47 → 21/47 PASS.
- **Test fixture redesign: test-contradictions-direct** (commit `38bf829`) — splits each rule's contradiction and ambiguous term into separate sentences within the same paragraph. The v1 fixture stacked both in the same sentence, which caused the LLM in multiWave mode to context-shift into suppression. v2 surfaces REAL findings the v1 was hiding ("staging", "production", "developer convenience credentials" undefined terms; multiple hygiene issues). Results (6-run aggregate): ambiguity-llm 0/11 → 2/11, hygiene 0/5 → 4/5, contradiction 45/15 → 42/15.
- **E33 dedup fix** (commit `aace2c7`) — fixes a counting bug where the `contradiction` category was double-counting each `contradiction` + `contradiction-related` finding pair. Uses a Set so each finding is counted at most once. Reduces reported contradiction inflation from 280-300% to 186-200% (closer to the natural ratio from the analyzer's intentional two-line design).
- **E40 evaluation scripts** (commit `ec3333a`) — `scripts/e40b-ambiguity-probe.mjs` (3-run probe), `scripts/e40c-ambiguity-probe.mjs` (multi-fixture probe), `scripts/e40e-realworld-skill.mjs` (evaluate on any SKILL.md), `scripts/e40f-multi-skill-batch.mjs` (multi-skill batch).
- **E40 experiment notes** (commits `ec3333a`, `38bf829`, `e03c8d9`) — `notes/e40b-ambiguity-prompt-fix.md`, `e40d-ambiguity-prompt-fix.md`, `e40d-validation-report.md`, `e40g-prompt-v5-regression.md`, `e41-fixture-redesign.md`, `e42-dedup-fix.md`.
- **Tests/fixtures/README.md** updated with E40d v4 + redesigned fixture results (commit `1ca9ec2`).

### Fixed

- **E33 contradiction double-counting** — the `countByCategory` function was adding `contradiction` and `contradiction-related` counts separately, inflating detection rates. Now uses a Set so each finding is counted at most once per category.

- **`analysisWaves` config field** — clean per-call wave selection that bypasses `analysisMode`. New `Engine.analyze(input, customDiags, enabledWavesOverride, configOverride)` signature.
- **MCP `analysisWaves` parameter** — per-wave analysis from MCP server (`qwen/qwen3-coder-30b-a3b-instruct` recommended in package.json description).
- **`deepModel` config field + provider tier routing** — use a stronger reasoning model for the contradictions wave without changing the analysis model. `OpenRouterProvider` now supports `deepModel` option and routes `modelTier: 'deep'` to it.
- **Recommended model: `qwen/qwen3-coder-30b-a3b-instruct`** — marked with ⭐ in model picker, added to `model`/`deepModel` config descriptions. Cost $0.17/1M (vs $0.25/1M for gemini-flash-lite), 100% recall on labeled fixtures (E29).
- **`Skills Review: Analyze Cognitive Load` command** — quick one-click for structural + persona waves via `analysisWaves: ['structural', 'persona']`.
- **Finding post-processor Rule 12: `imperativeAmbiguityRule`** — suppresses `ambiguity-llm` on well-known `<verb>:` imperative patterns ("Verify:", "Run:", "Document:"). 7 new unit tests.
- **Finding post-processor Rule 11: `crossWaveDedupRule`** — suppresses a weak/broad finding (`ambiguity-llm`, `hygiene-*`) when a more specific finding from a different wave covers the same span.
- **Coverage prompt anti-boilerplate rule** — forbids "What if user provides empty input?" coverage gaps for skills that don't accept user input. Verified at corpus scale: 36% reduction in findings on 327 real-world skills (E30 → E32).
- **Ambiguity prompt material-difference test** — strengthened the quality bar to require the LLM to flag only when two competent models would produce materially different actions, not just different wording. Special exception for legal/regulatory words ("appropriate", "timely", "material", "reasonable") which DO pass the material-difference test in compliance contexts. Verified at fixture scale: test-ambiguities-hard went from 4/20 to 19/20 (E33 v4).
- **Coverage prompt "mentioned but not handled" rule** — distinguishes between a body that mentions a topic vs a body that provides operational guidance. Topics that are only mentioned (no procedural instruction) are still coverage gaps.
- **E26-E33 experiment notes + scripts** — 8 new experiment scripts (e26 cheaper-models, e27 paid-leaderboard, e28 free-leaderboard, e29 realworld-benchmark, e30 corpus-scan, e31 prompt-fix-eval, e32 corpus-rescan, e33 fixture-validation), 7 new experiment notes documenting methodology and results.
- **`versions/v8/SKILL.md`** for the documentation-review skill — resolves 5 false-positive contradictions (D8 vs C2/C3/C4) by clarifying the modification taxonomy and the D9.3/D9.4 precedence rule. 33 → 8 findings on the v7 → v8 transition (E24).

### Changed

- `package.json` recommends `qwen/qwen3-coder-30b-a3b-instruct` for `model` and `deepModel` config fields.
- `src/extension.ts` model picker marks the recommended model with a ⭐ indicator.
- `docs/USER-GUIDE.md` adds a "Recommended OpenRouter Models" section with the E29 cost/quality table.
- `docs/FAQS.md` adds a "Which OpenRouter model should I use?" FAQ entry.
- `tests/fixtures/README.md` adds the E33 detection-rate table documenting current 14/47 (30%) PASS rate and known limitations.
- `src/extension.ts` `analyzeDocument()` accepts an optional `configOverride` parameter for per-call config changes (used by MCP `analysisWaves` parameter).
- Bumped version to **0.1.35**.

### Changed

- MCP `analyze` now passes `acceptedFindingsPath` so accepted findings are filtered in MCP mode
- MCP server reads `.skills-review.json` on startup (priority over env vars)
- `src/mcp/README.md` rewritten with full 7-tool reference, config docs, and agent workflow
- `readConfig()` now caches for one event-loop tick to avoid repeated `getConfiguration()` calls
- Engine cache key (`computeConfigHash`) now includes all engine-relevant config fields
- `expandToParagraph()` uses tighter whitespace matching (`\s{1,3}`) to prevent false paragraph matches

### Fixed (Gilfoyle review — 25 issues)

- **[CRITICAL]** `String.replace()` used for anchored text replacement — switched to function-as-replacement to prevent `$`-pattern corruption and added occurrence-count guard to prevent replacing wrong instance
- **[CRITICAL]** `loadPrompt()` no error handling at module load — wrapped in try/catch with safe fallback to prevent extension activation failure
- **[CRITICAL]** Extension mutable state race conditions — added per-URI analysis locks to serialize concurrent analyses
- **[HIGH]** `DEFAULT_ACCEPTED_FINDINGS_PATH` used `process.cwd()` (wrong in extension host) — now resolves from workspace root via `vscode.workspace.workspaceFolders`
- **[HIGH]** `fixPreviewContent` memory leak — added LRU-style eviction (max 20 entries, same-URI prefix clearing)
- **[HIGH]** Model reference not disposed on retry in `VsCodeLmProvider` — added `model.dispose()` call before invalidation
- **[HIGH]** `loadReferenceGrounding()` path traversal via `references/` directory — added symlink rejection and path-boundary validation
- **[HIGH]** MCP server accepted-findings path resolved to wrong location — now uses `MCP_SERVER_WORKSPACE` env var
- **[MEDIUM]** `EngineConfig` interface defined twice — renamed MCP version to `McpEngineConfig`
- **[MEDIUM]** `out.show(false)` steals focus on automatic triggers — now only shows output panel on manual trigger
- **[MEDIUM]** `findTextRange()` wrong fallback for empty search — returns `null` instead of misleading line 0
- **[MEDIUM]** `salvageTruncatedJSON()` only recovered first array key — now recovers all array keys and logs warning
- **[MEDIUM]** `testModelSimplePrompt()` only worked with vscode-lm — now supports external providers
- **[LOW]** Duplicate comment block in `analyzer.ts` removed
- **[LOW]** `copilotPricing.ts` identified as dead code, annotated with note
- **[LOW]** `tokenPresent()` word boundary fixed for tokens with spaces
- **[LOW]** `isFindingAccepted()` bi-directional matching tightened to forward-only + minimum length
- **[LOW]** `statusBar.showError()` sanitized to strip Bearer tokens and API key patterns
- **[LOW]** `inlineRewrites.ts` fix cache now evicts by max size (50 entries)

## [0.0.1-beta] - 2026-06-04

Release-ready for controlled beta preview.

### Added

- Git hooks (husky + lint-staged) for pre-commit linting and pre-push testing
- Comprehensive GitHub documentation: CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- Quick reference guide: MULTIPLIER-ACCESS.md (how to access LLM cost multipliers)
- Development standards guide with code quality and safety patterns
- Release readiness verification with all gates documented and passing
- E2E Playwright tests for model picker UI (model selection, cost warnings, filtering)
- Fixture-validation regression gate (`npm run test:fixtures`)
- Developer guide consolidating project structure, workflows, and architectural decisions
- Release implementation plan with 5 verified phases and release procedures

### Changed

- Updated README.md for user-friendliness with streamlined sections
- Reorganized documentation with clearer user/developer separation
- Consolidated RELEASE-READINESS.md to reflect current status
- Enhanced docs lint enforcement via `npm run lint:md`

### Fixed

- Fixed TypeScript test compilation errors (tier → modelTier field name)
- Response streaming now uses response.stream for unfiltered JSON parsing
- ESLint generator function compliance in vscodeLmProvider.test.ts

### Verified ✅

- Packaging reproducibility (VSIX 3.2 MB)
- Smoke validation (11/11 E2E tests passing)
- Fixture regression (4/4 tests passing on 6-fixture corpus)
- Documentation quality (0 markdown lint errors)
- Full release command stack (5/5 commands passing)

## Previous Work

Earlier phases: Core analyzer, surgical fixer, VS Code integration, provider support, and agentic tools. See [plan/PROGRESS.md](plan/PROGRESS.md) for detailed implementation history.
