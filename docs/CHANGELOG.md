# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Per-file accepted findings** (`src/core/acceptedFindings.ts`) — suppress known/expected issues per document with `accept_finding`, `list_accepted_findings` MCP tools
- **Prompts as .md files** (`src/core/prompts/`) — all 8 wave/fix prompts now load from editable `.md` files (contradiction, ambiguity, persona, structural-quality, coverage, hygiene, surgical-fix, custom-diagnostics, composition-conflicts)
- **Structured logging** (`src/core/logger.ts`) — `createLogger()` with structured JSON output, log levels, and VS Code transport
- **External pricing** (`src/pricing.ts`) — `fetchPricing()` fetches live model costs from GitHub Docs, with static fallback; `formatPricing()` for human-readable cost display
- **Copilot model pricing** (`src/copilotPricing.ts`) — static Copilot-specific pricing table for offline use
- MCP `score` tool — quality score (0–100) and letter grade (A+ through F)
- MCP `verify_fix` tool — re-analyze to confirm a fix resolved a specific issue
- MCP `list_accepted_findings` tool — view suppressed findings, filter by file
- MCP `health` tool — check provider, model, and config source
- `.skills-review.json` config file — VS Code settings synced to workspace root for MCP server
- `Skills Review: Sync MCP Config` command — writes `.skills-review.json` from current settings
- MCP server integration tests — real end-to-end MCP protocol tests using `InMemoryTransport`
- Enriched MCP tool descriptions with fixable codes, recommended workflow, and input schemas
- MCP improvement plan with 6 identified problems and fixes (`docs/plan/MCP-IMPROVEMENT-PLAN.md`)

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
