# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Git hooks (husky + lint-staged) for pre-commit linting and pre-push testing
- Comprehensive GitHub documentation: CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- Quick reference guide: MULTIPLIER-ACCESS.md (how to access LLM cost multipliers)
- Development standards guide with code quality and safety patterns
- Release readiness review: docs/RELEASE-READINESS.md
- E2E Playwright tests for model picker UI (model selection, cost warnings, filtering)
- Test file reorganization under tests/ directory

### Changed

- Updated README.md to reflect v0.0.1 public-beta status and release-gate guidance
- Reorganized documentation under docs/ directory for public-facing clarity
- Reorganized testing files under tests/ directory
- Improved vscode.lm streaming implementation with response.stream (not response.text)
- Added docs lint enforcement via `npm run lint:md` for the docs set

### Fixed

- Fixed TypeScript test compilation errors (tier → modelTier field name)
- Response streaming now uses response.stream for unfiltered JSON parsing

## [0.0.1] - 2026-06-03

Initial feature-complete release with 6-wave analyzer, surgical fixer, and VS Code integration.

See full release notes in docs/CHANGELOG.md.
