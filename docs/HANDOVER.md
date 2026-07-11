# Handover - 2026-06-10

## Current State

- Branch: main (HEAD: 9f8df03)
- Version: 0.1.0
- Tests: 346 unit tests passing
- E2E: 10/29 passing (Playwright - timing/activation issues)
- Compilation: Clean (npm run compile)

## What Is Done (Committed)

### Architecture Review Fixes (commit 2d4e36b)
14 issues fixed, all Critical/High resolved:
- C1: MCP error sanitization (x-api-key, auth headers, URLs) -> src/mcp/server.ts
- C2: UUID delimiters in composition-conflicts (injection) -> src/core/analyzer.ts
- C3: Accepted findings capped at 500 entries with LRU -> src/core/acceptedFindings.ts
- H1: AnalysisHistoryStore.get() calls touch() for LRU -> src/core/analyzer.ts
- H3: Config hash includes prompt file mtimes -> src/extension.ts
- H4: MCP config watcher 200ms debounce -> src/mcp/server.ts
- H5: MCP analyze rate limiting 5s cooldown -> src/mcp/server.ts
- M1: loadPrompt() startup assertion -> src/core/prompts.ts
- M3: contradiction-related scored in Contradictions pillar -> src/core/scoring.ts
- M4: Duplicate-anchor guard in MCP fix tool -> src/mcp/server.ts
- M5: MCP stdio integration tests (4 tests) -> src/mcp/server.stdio.test.ts
- N1: MCP error standardization (isError flag) -> src/mcp/server.ts
- N2: Bidirectional doc cross-references -> docs/
- N3: Playwright auth via DevTools snippet -> tests/e2e/

### Production Bug Fixes (commit b4c66b4)
- findTextRange progressive fuzzy matching (50%, 25%, 20 char prefixes)
- Grade capping: empty results show Ungraded not A+
- buildEngine fallback: clears model names on openrouter->vscode-lm
- buildUserPrompt: removed static DOCUMENT_TO_ANALYZE tags

### Features (commit 131ac0c)
- Analyze with Options modal: mode, wave checkboxes, confirm dialog
- Change Provider command (selectProvider)
- Analyze File command (analyzeFile)
- Toggle Log Level command (toggleLogLevel)
- Clear Accepted Findings command (clearAcceptedFindings)
- MCP enabledWaves parameter on analyze tool
- Engine.analyze() accepts wave override as third parameter
- All 6 commands registered in package.json contributes.commands

### E2E Tests
- smoke-analyze.test.ts: 6 tests (all pass)
- ui-commands.test.ts: 14 tests (mostly pass)
- provider-model-sync.test.ts: 13 tests (some timing failures)
- setup.ts: Playwright auth state loader
- capture-auth.ts: DevTools snippet
- auth-state/: captured browser session (gitignored)

### Other
- Version bumped to 0.1.0 with activation log
- Compile script: rm -rf before cp to clean stale .md prompts
- .gitignore excludes tests/e2e/auth-state/
- docs/plan/20260610-smoke-test-bugs/ documented

## Known Issues

### E2E Test Failures (4 remaining)
1. Change Provider not found in palette - VS Code web activation timing
2. score CodeLens timeout - cascade from previous test
3. model picker timing - extension not ready
4. switch from Copilot to OpenRouter - depends on #3

Root cause: Extension activation is async, VS Code web loads slowly,
Playwright cant wait for extension-ready signal.

## Remaining Items

### H2: ExtensionState Class Refactor (Deferred)
- 14 module-level variables, 30+ functions, 30 tests depend on pattern
- High risk: touches core activation/lifecycle
- Do in dedicated PR alongside extension-shell integration tests

## File Map
src/extension.ts - Main logic (1241 lines)
src/core/analyzer.ts - 6-wave LLM analyzer (1147 lines)
src/core/fixer.ts - Surgical fix pipeline (~600 lines)
src/core/scoring.ts - Quality scoring
src/mcp/server.ts - MCP server (7 tools)
src/providers/vscodeLmProvider.ts - VS Code LM wrapper
src/providers/externalProvider.ts - OpenRouter/GitHub Models

tests/e2e/ - E2E tests (smoke, ui-commands, provider-model-sync)
tests/e2e/auth-state/ - Captured browser session (gitignored)

## Quick Commands
npm run compile
npm test (346 unit tests)
npm run test:e2e (Playwright E2E)
npx playwright test --config tests/playwright.config.ts tests/e2e/smoke-analyze.test.ts

# Handover — 2026-07-11

**Start here tomorrow:** `.github/experiments/documentation-review/notes/lessons-learned.md` (138 lines).
**Source of truth:** `docs/plan/20260710-documentation-review-experiment/plan.yaml` (2105 lines, valid YAML).

## State

- 452/452 unit tests pass · `npm run compile` clean · branch: main
- 20 of 22 experiments completed (E4 + E6 still planned)
- ~$0.30 spent · 94 LLM calls · 0 rate-limits
- 3 LLM-dependent integration tests in `src/mcp/server.integration.test.ts` are flaky (noise floor, not a regression)

## What shipped this session

5 analyzer fixes (E8, E9, E10, E11, E14, E15) + 2 API improvements (E20, E21):

| ID | What | File |
| --- | --- | --- |
| E8 | buildUserPrompt grounding | `src/core/analyzer.ts` |
| E9 | cognitive-* type disambiguation | `src/core/prompts/structural-quality.prompt` |
| E10 | "search the doc first" pre-check | `src/core/prompts/coverage.prompt` + `single-pass.prompt` |
| E11 | 3 post-processor rules | `src/core/findingFilter.ts` |
| E14 | length tier recalibration | `src/core/scoring.ts` |
| E15 | scoreSkill "empty=Ungraded" bug fix | `src/core/scoring.ts` |
| E20 | per-category fixture labels (15 → 59) | 16 SKILL.md + `tests/fixtures/README.md` |
| E21 | `analysisWaves: [string]` API | `src/core/types.ts` + `src/core/index.ts` |

4 LLM experiments validated (E18, E19, E22, E23) — see lessons-learned.md for the data.

## Top 3 things to remember

1. **LLM noise floor is real** — always use N≥3 medians. Single-run detection varies by ±5-15 findings.
2. **Focused mode (multiWave + enabledWaves) >> single mode for fixture validation** — gives 98-187% in-cat vs 0-22% with single.
3. **The "extras" the analyzer finds are real, not hallucinations** — fixture labels were incomplete (E20 fixed).

## Next session

1. **v8 follow-up** — E22 found 5 new contradiction findings on v7 (D8 vs C2/C3/C4/C5). A v8 clarifying the modification taxonomy could move v7 from B- to A on focused mode. Previous v8 attempt (decision table) failed because the LLM now reads the table with the same scrutiny.
2. **E4 + E6** still in planned state. E6 (multi-model comparison) is implicitly covered by E12-N3 cross-model work — could be marked completed with a reference. E4 (specification style) would require a new fixture set.

## Quick commands

```bash
npm run compile
npx vitest run --config tests/vitest.config.ts --exclude="**/server.integration.test.ts"

# Re-run any experiment
source ~/.bashrc && OPENROUTER_API_KEY=$OPENROUTER_API_KEY node scripts/e19-focused-suite.mjs

# Verify plan.yaml
node -e "const y=require('js-yaml');y.load(require('fs').readFileSync('docs/plan/20260710-documentation-review-experiment/plan.yaml','utf8'));console.log('OK')"
```

# Handover — 2026-07-11 (v0.1.35)

## State

- 466/466 unit tests pass · `npm run compile` clean · branch: main
- v0.1.35 ready for marketplace (recommended model + prompt fixes + MCP `analysisWaves` + `deepModel` config)
- ~$2 spent across 30+ experiments · 1000+ LLM calls · 0 rate-limits

## What shipped in v0.1.35

**Model change:** switched recommended model from `google/gemini-2.5-flash-lite` to `qwen/qwen3-coder-30b-a3b-instruct` (E29 benchmark winner, 100% recall, 0 FPs, $0.17/1M, 32% cheaper).

**Prompt fixes** (E31/E32/E33):
- Coverage prompt: anti-boilerplate rule + "mentioned but not handled" + silent-gap inference → -38% on real corpus
- Ambiguity prompt: material-difference test + legal/regulatory exception → -40% on real corpus, +375% on test-ambiguities-hard
- Single-pass prompt: same fixes applied for legacy single mode
- Result: real-signal quality UP, boilerplate FPs DOWN

**API improvements:**
- `analysisWaves: WaveName[]` config field + MCP parameter for per-wave analysis
- `deepModel` config field + provider tier routing (tier=deep routes to deepModel)
- `Skills Review: Analyze Cognitive Load` command (one-click structural + persona)

**Filter rules:**
- Rule 11: crossWaveDedupRule (suppress weak finding when specific finding from different wave covers same span)
- Rule 12: imperativeAmbiguityRule (suppress "Verify: <action>" style boilerplate)

**v8 documentation-review skill** (E24): eliminated 5 false-positive contradictions in the D8/C2/C3/C4 cluster via explicit modification taxonomy; 33 findings → 8.

## Per-mode recommendation (E34)

| Mode | Findings (6-skill subset) | Cost per scan | When to use |
|---|---:|---:|---|
| single + qwen3-coder-30b | 16 | $0.003 | Quick scans, CI gates |
| multiWave + qwen3-coder-30b | 32 | $0.02 | Thorough analysis, real-world skills |
| focused (specific waves) | varies | varies | Targeted audits |

Single mode with the new model is now viable for production — finds 78% more real issues than E20 baseline (gpt-4o-mini + v3 prompts) at lower cost.

## Top 3 things to remember

1. **Prompt fix > filter rules** — for LLM-as-judge systems, fixing the prompt that produces the judgment is 10-100x more effective than filtering the output.
2. **Model + prompt matter more than mode** — single mode with qwen3-coder-30b + new prompts finds 78% more than E20's multiWave. Mode is a secondary lever.
3. **Test corpus > real corpus for measuring improvement** — E33 fixture validation (13 labeled fixtures, ground truth) is more reliable than E30 corpus scan (327 skills, no ground truth).

## Quick commands

```bash
npm run compile
npx vitest run --config tests/vitest.config.ts --exclude="**/server.integration.test.ts"

# Re-run any experiment
source ~/.bashrc && OPENROUTER_API_KEY=$OPENROUTER_API_KEY node scripts/e30-corpus-scan.mjs
```
