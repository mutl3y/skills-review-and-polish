# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
