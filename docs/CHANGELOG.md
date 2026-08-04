# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **GitHub Copilot API provider (`copilot`).** The MCP server can now use the
  Copilot API (`api.githubcopilot.com`) with a `GITHUB_TOKEN` — no separate API
  key, draws on your Copilot subscription. Model IDs are Copilot IDs (e.g.
  `gpt-5-mini`, `gpt-4.1`, `claude-sonnet-4.5`). Configure via
  `"provider": "copilot"` in `.skills-review.json` or `GITHUB_TOKEN` env.
- **Live Copilot context-length resolution.** The Copilot provider resolves
  `max_context_window_tokens` from `api.githubcopilot.com/models` (1h in-memory
  + 15min disk cache) so new models are picked up automatically — no static
  table. Large production skills (e.g. 292KB) now analyze correctly.
- **Dynamic MCP text-length limit.** The MCP `analyze`/`score`/`fix`/
  `verify_fix` text guard is now derived from the provider's context length
  (mirroring the analyzer's budget math), so large-context models accept larger
  documents. Fixed fallback raised from 100K to 200K chars.
- **Progress notifications during long analysis.** The MCP server emits
  `notifications/progress` every ~15s while a synchronous `analyze` runs, so
  clients that set `resetTimeoutOnProgress` keep the request alive past the
  default 60s timeout.

### Fixed

- **Copilot output truncation on large documents.** `resolveMaxTokens` is now a
  shared helper used by both OpenRouter and Copilot providers — the Copilot
  copy was missing the `Math.max(desired, scaledCap)` fix that prevents
  mid-JSON truncation.
- **Copilot context cache keyed by token** (no cross-token reuse) and **disk
  cache** for offline resilience.
- **Copilot config no longer depends on OpenRouter** — it resolves its own
  context first and only falls back to the OpenRouter catalog if the Copilot
  fetch fails.
- **Budget guard off-by-one** — a charge landing exactly on the cap is now
  accepted consistently.

## [0.1.50] — 2026-07-19 (marketplace publish)

### Fixed

- **Letter grade wrongly withheld on successful analysis.** `scoreSkill` treated `llm-loop-detected`, `high-complexity`, and `limited-coverage` as analysis failures (they were in `INFRA_SKIP`), so any run that produced those *legitimate* meta findings — e.g. re-analyzing the same file (loop detection fires) — was forced to `Ungraded` even when all 6 waves succeeded with real findings. Only true failures (`llm-error`, `llm-parse-error`, `llm-disabled`, `llm-rate-limited`) now force `Ungraded`; the meta findings are still excluded from the penalty but no longer suppress the grade.
- **Free models that append prose after JSON failed to parse.** `extractJSON` threw when the model returned a valid JSON object/array followed by trailing commentary (e.g. `"But ensure format: exactly as specified..."`). `parsePossiblyRepairableJSON` now trims trailing non-JSON text after the first complete top-level value before falling back to the salvage/error paths, so those waves recover instead of producing `llm-parse-error` diagnostics.

## [0.1.49] — 2026-07-19 (marketplace publish)

### Fixed

- **Misleading letter grade on partially-failed analysis.** A run with real findings plus a failed wave (e.g. coverage wave dying on a mid-stream network abort) reported a confident letter grade — 5 findings + 1 dead wave graded A-. `scoreSkill` now marks analysis incomplete whenever ANY infra code is present (not only when every result is infra) and withholds the letter grade (`Ungraded`); the numeric score is still computed and shown.
- **Failed analysis waves got no retry.** Two gaps aligned: `vscodeLmProvider.complete` only retried *thrown* `sendRequest` errors, while a mid-stream abort ("network request aborted") is *returned* from stream iteration; and `callLLM` only retried degraded-but-successful responses or deep-tier failures. Stream-iteration errors now retry once with a fresh stream in the provider, and `callLLM` retries once on the same tier for any non-rate-limit provider error. A transient transport failure now gets multiple chances before a wave fails.
- **Silent wave failures in the UI.** `analyzeDocument` only warned about rate limits; failed waves now produce a warning naming the failed wave(s) (e.g. "1 analysis wave(s) failed (coverage) after retry…").

## [0.1.48] — 2026-07-19 (marketplace publish)

### Fixed

- **Extension failed to activate: `Cannot find module 'picomatch'`.** The v0.1.47 VSIX shipped without any `node_modules`. Root cause: `scripts/publish-vsce.mjs` passed `--no-dependencies` to `@vscode/vsce` 3.x, which strips *all* `node_modules` from the package — including the `!node_modules/picomatch/` re-inclusion in `.vscodeignore` (in vsce 2.x the flag only skipped dependency pruning, so the wrapper's flags were stale after the vsce 3.x upgrade). The flag is removed; vsce 3.x prunes devDependencies by default.
- **`verify:vsix` false PASS.** The guard listed files via `npx vsce ls`, which resolved to a globally installed vsce 2.15.0 — a different packager than the `@vscode/vsce` 3.9.2 used for publishing, with different `node_modules` handling. The guard now invokes the same `@vscode/vsce` 3.x via `npm exec --yes -- @vscode/vsce ls`.
- **Publish wrapper hang in headless shells.** `npm exec` prompted `Ok to proceed? (y)` to install `@vscode/vsce` with no visible output when stdout was redirected. The wrapper now passes `--yes`.

## [0.1.47] — 2026-07-19 (marketplace publish)

### Fixed

- **Context budget always fell back to 200K chars (vscode-lm provider).** Model selection in `VsCodeLmProvider` was lazy (first `complete()` call), but every analysis wave builds its prompt *before* calling the model — so `getContextLength()` returned `undefined` for the entire run and every wave used the conservative 200K-char fallback budget regardless of the real model's context size. Reference files that would have fit (e.g. 128K-token models → ~409K-char budget) were silently omitted. `buildEngine` now pre-warms model selection via a new `VsCodeLmProvider.warmUp()`, so the real `maxInputTokens` is known from the first wave onward.
- **Redundant per-wave prompt builds.** All six analysis waves independently rebuilt the identical user prompt — re-reading reference files from disk and re-logging the context-budget fallback warning six times per document. The built prompt is now cached per `analyze()` run (keyed on entry text + file path; the in-flight promise is shared so concurrent waves build exactly once).

## [0.1.46] — 2026-07-19 (marketplace publish)

### Changed

- **Release notes polish.** Added concise Marketplace-facing release notes and kept the package metadata aligned with the published version.

## [0.1.45] — 2026-07-19 (marketplace publish)

### Added

- **Release wrapper (`publish:vsce`).** Added `npm run publish:vsce -- 0.1.45`, which runs `release:gate` and publishes with an explicit `VCSE_PAT`/`VSCE_PAT` token. This avoids the Linux keyring blocker in headless shells and gives the publish flow a repeatable entry point.

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

### Breaking changes (added in v0.1.39 unreleased)

- **Analyzer no longer head/tail truncates** the entry file. The legacy 60K-char cap (`MAX_ANALYSIS_DOCUMENT_CHARS`) and head/tail slicing are removed. The analyzer now sends the entry file whole to the model and sources its document budget from `provider.getContextLength()` (per-model). This fixes a long-standing analyzer-quality regression where the contradictions wave would silently miss cross-section findings because the middle of the document was invisible. The instruction "Read the ENTIRE document below" is now literal.

- **Reference files now included for all 6 waves.** The composition-conflicts wave was already reading linked `.prompt.md` / `.agent.md` / `.instructions.md` files; the rest of the waves now read every `.md` reference linked from the skill. Files that would overflow the per-model budget are dropped (with a marker) rather than truncated mid-content.

- **`LlmProvider.getContextLength()` is a required interface method.** `VsCodeLmProvider` reads `maxInputTokens` from the cached `vscode.LanguageModelChat`; `OpenRouterProvider` accepts a `contextLength` constructor option. Callers that don't populate it get a 200K-char fallback and an `info`-level warning.

### Added (v0.1.39 unreleased)

- **Bundled OpenRouter catalog asset** — `assets/openrouter-catalog.json` (top-75 popular models, ~4.5KB) ships inside the .vsix so the analyzer works offline for the most common models. Refreshed by `node scripts/refresh-openrouter-catalog.mjs` (auto-runs on `vscode:prepublish`).
- **`scripts/refresh-openrouter-catalog.mjs`** — maintenance script that fetches the live OpenRouter `/models` catalog (140ms cold, 1h cached) and writes both `assets/openrouter-catalog.json` (bundled subset, top-75) and `tests/fixtures/openrouter-catalog.json` (full 1,215-entry catalog for test drift detection).
- **`npm run release:gate`** — single command for pre-flight: refresh fixtures + compile + test + lint + lint:md. `vscode:prepublish` runs the refresh-then-compile half automatically before every `vsce package` / `vsce publish`.
- **Model catalog chain**: live OpenRouter catalog → bundled asset → 3-entry static table (for niche Copilot display names not in the OpenRouter catalog).
- **Model picker** surfaces `· ctx=200K` on each model's detail line (powered by the same catalog lookup).
- **MCP `createDefaultEngine` is now async** — fetches the OpenRouter catalog at startup (140ms cold, ~5ms warm, 1h cached in-memory) so the analyzer's budget is resolved before the first analyze call. No more 200K fallback hits on the cold path.

### Changed (v0.1.39 unreleased)

- **`Analyzer.buildUserPrompt` is async** — reads linked reference files in document order, includes them greedily until the per-model budget would overflow. Reference files that don't fit are dropped with a clear marker.
- **Static `MAX_ANALYSIS_DOCUMENT_CHARS` constant removed** — replaced by `FALLBACK_DOCUMENT_CHARS = 200_000`, `CONTEXT_FRACTION = 0.8`, and `MIN_DOCUMENT_CHARS = 8_000`, computed dynamically from the provider's context length.
- **Static context-length table slimmed** from 38 entries (mostly dead code already covered by the OpenRouter catalog) to 3 entries (niche Copilot display names that genuinely aren't in OpenRouter). Drift detection now runs against the fixture.
- **`scripts/e50-clean-architecture.mjs` `STRUCTURED_OUTPUT` env parser** widened to accept `schema|json|off` (default `schema`). Legacy `1`/`0` boolean aliases preserved.

### Fixed (v0.1.39 unreleased)

- **Analyzer truncation was destroying analyzer quality.** The 60K-char cap was forcing head/tail slicing on any skill over 60K chars (lines 256-2262 of `quality-playbook` were entirely invisible to the model). The probe (`scripts/probes/verify-full-doc.mjs`) shows the new behavior: a 292K-char skill now produces a 293K-char prompt including 6 reference files, no head/tail marker.
- **Output-budget under-sizing on large skills (root cause of `finish_reason: length`).** `resolveMaxTokens` derived the output budget from *input length* (`ceil(prompt.length / adaptiveCharsPerToken)`), which for a 293K-char skill yielded only ~73K output tokens — far below the model's real generation cap. `OpenRouterProvider` now sizes the budget from the model's generation cap (`adaptiveMaxTokensCap * multiplier`) via `desired = max(inputDerived, scaledCap)`, so large skills get the full budget. Verified: the contradiction wave on `quality-playbook` now requests 768K tokens (was 73K) and completes without truncation. Residual `finish_reason: length` on `quality-playbook`'s hygiene/coverage/ambiguity waves is the model's *realized* generation limit (~73K tokens / ~293K chars) even at `max_tokens=384000` — a model behavior limit, not a code defect; `salvageTruncatedJSON` recovers partial findings. Skill chunking is explicitly deferred (long skills are rare; authors should split them). See `docs/plan/archive/releases/20260717-handling-noise-floor-and-release-blockers.md` → "Model output-cap limitations".
- **Deterministic retry/merge path (schema-mode noise-floor fix).** When a wave got a non-stop finish reason and retried, the merge previously kept whichever degraded response was *longer* — a non-deterministic signal that injected run-to-run variance. The merge now keeps the **first** response unless the retry is a *clean* recovery (stop finish, no error, passes `shouldRetryFinishResponse`); under greedy decoding (temperature 0) the first response is the deterministic result. This collapsed the 10× noise-floor probe from range 89 → range 3 (9 of 10 runs identical). `seed` was prototyped and **rejected** (greedy decoding makes it inert) and fully reverted. See `docs/plan/archive/releases/20260718-determinism-and-noise-floor-resolution.md`.

## [0.1.44] — 2026-07-18 (marketplace publish)

### Added

- **VSIX runtime-dependency guard (`verify:vsix`).** New `scripts/verify-vsix-deps.mjs` walks the extension entry's local require graph, collects the bare runtime packages the extension host actually needs, and asserts each is present in the packaged VSIX via `vsce ls`. Wired into `release:gate`. Catches the v0.1.40–v0.1.42 regression class (`Cannot find module 'picomatch'`) without false-positives on the intentionally-excluded MCP SDK / `mcp-remote` (only used by the standalone `out/mcp/server.js`).

## [0.1.43] — 2026-07-18 (marketplace publish)

### Fixed

- **Extension failed to activate after install (`Cannot find module 'picomatch'`).** The v0.1.40 `.vscodeignore` change added `node_modules/**` to shrink the VSIX, but `src/config.ts` requires `picomatch` at load time, so excluding all of `node_modules` stripped a runtime dependency and `activate()` threw — no output window and no editor icons. Re-included `node_modules/picomatch` (self-contained, +27 KB). The MCP SDK / `mcp-remote` remain excluded because they are only used by the standalone `out/mcp/server.js`, not the extension host.

## [0.1.42] — 2026-07-18 (marketplace publish)

### Changed

- **Positioning — released as a production linter.** `README.md` Status no longer frames the project as beta / release-candidate. It is described as a production-ready authoring-time linter, with the calibration evidence (87.3% recall, 63–73% precision, deterministic output) retained as an honest maturity note. Precision hardening (target ≥85% accepted findings) is framed as ongoing improvement, not a release blocker.

## [0.1.41] — 2026-07-18 (marketplace publish)

### Changed (documentation accuracy)

- **Documentation review pass** — corrected factual inaccuracies across user-facing docs per the `documentation-review` skill (accuracy-only):
  - `README.md` — removed 3 broken links to non-existent `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.
  - `AGENTS.md` — fixed experiment `POST-PROCESSOR-NOTES.md` path and the claim that each experiment has its own `SKILL.md` folder (artifact lives in `.github/skills/`, notes in `.github/experiments/`).
  - `docs/USER-GUIDE.md` — fixed `minAdaptiveResponseTokens` default (16384 → 4096); corrected the "results vary due to randomness" FAQ to reflect deterministic output (noise floor range 3, 9/10 identical).
  - `docs/ARCHITECTURE.md` — fixed stale recall (47%/42% → 87.3%), replaced `gpt-4.1` model references with current default/recommended model, removed non-existent `temperature`/`maxTokens` settings, fixed MCP invocation, and corrected the superseded "±6 points irreducible variance" noise-floor section to current determinism.
  - `docs/DEVELOPER-GUIDE.md` — fixed prompt file extensions (`.md` → `.prompt`) and accurate listing, primary fixture count, removed stale MCP test counts, and removed a reference to the non-existent `docs/plan/ENGINE-REFERENCE.md`.

## [0.1.40] — 2026-07-18 (marketplace publish)

### Changed

- **Package hygiene — VSIX size cut from ~60 MB to ~272 KB.** `.vscodeignore` now excludes internal/non-shipped artifacts (`.github/**`, `.archive/**`, `logs/**`, `.husky/**`, `.openmcp/**`, `node_modules/**`, `scripts/**`) and the regenerable experiment `data/` + `logs/` JSON checkpoints. Previously `vsce` packaged by `.gitignore` rules, so gitignored experiment data (62 MB of run checkpoints) and the full `.github/experiments` tree were bundled into every release.

### Changed (repo hygiene, not shipped behavior)

- **Archived pre-20260716 plan dirs** into `docs/plan/archive/{releases,infrastructure,gilfoyle-reviews}` per the `AGENTS.md` plan-file convention. Updated references in `README.md`, `src/core/scoring.ts`, `scripts/fix-markdown.mjs`, `.markdownlint-cli2.jsonc`, and `.markdownlintignore`; dropped now-obsolete ignore globs.

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
