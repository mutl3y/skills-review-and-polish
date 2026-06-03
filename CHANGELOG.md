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
- E2E Playwright tests for model picker UI (model selection, cost warnings, filtering)

### Changed
- Updated README.md to reflect v0.0.1 feature-complete status
- Reorganized documentation under docs/ directory
- Improved vscode.lm streaming implementation with response.stream (not response.text)

### Fixed
- Fixed TypeScript test compilation errors (tier → modelTier field name)
- Response streaming now uses response.stream for unfiltered JSON parsing

### Docs
- Moved extension instructions to docs/DEVELOPMENT-STANDARDS.md
- Created docs/GIT-WORKFLOW.md for Git hooks and quality workflow
- Added docs/VSCODE-LM-STREAMING-FIX.md with comprehensive streaming details

## [0.0.1] - 2026-06-03

### Added

#### Core Analysis Engine
- 6-wave LLM analyzer with specialized prompts:
  - Contradictions (deep model for complex logic)
  - Ambiguities (intent clarity)
  - Persona consistency (voice conflicts)
  - Structural quality (organization, cognitive load)
  - Coverage gaps (completeness)
  - Hygiene (formatting, standards)
- JSON parsing with truncation salvage (handles incomplete LLM responses)
- History tracking and loop detection (prevents feedback cycles)
- Model tier propagation for cost control

#### Surgical Fixer
- Per-issue rewrites with deterministic safety gates
- Risk classification (scope, factual grounding, growth bounds)
- Median-of-N scoring (3 passes by default, configurable 1-5)
- Human-in-the-loop: diff preview with accept/reject for every fix
- Fix-all orchestration with batch application and rollback

#### VS Code Integration
- Diagnostics with issue codes, severity levels, and rationale
- Code actions ("Fix this issue" quick actions)
- CodeLens badges showing overall score and grade
- Hover tooltips with detailed issue explanations
- Status bar showing analysis state and issue count
- Experimental inline rewrites (ghost text preview, feature-gated)

#### LLM Providers
- Default: vscode.lm (GitHub Copilot) via VS Code Language Model API
- Optional: OpenRouter provider with API key configuration
- Optional: GitHub Models provider with token configuration
- Model selection with safe-tier enforcement (≤1x multiplier in tests)

#### Settings & Configuration
- Enable/disable extension
- Provider selection (vscode-lm / openrouter / githubModels)
- Custom model override
- Analysis mode (multiWave / single)
- Enabled waves selection (customize which checks run)
- Score samples (median-of-N, 1-5)
- Run trigger (manual / onSave / onType)
- File inclusion/exclusion patterns
- Diagnostic severity level filtering

#### Agentic Tools
- Registered language model tools for Copilot agent mode
- analyze() tool: Run analysis on any skill/instruction text
- fix() tool: Generate surgical fix for specific issue
- In-process execution (no RPC overhead)

### Testing
- 38 unit tests for analyzer (all 6 waves, JSON parsing, history)
- 22 unit tests for providers (model selection, tier enforcement, streaming)
- 6 E2E tests for model picker UI (Playwright)
- Pre-push hook runs all 60 tests automatically
- Pre-commit hook runs ESLint + TypeScript type-check

### Development
- TypeScript strict mode
- ESLint configuration with TypeScript plugin
- Vitest test framework with isolated unit tests
- Playwright for E2E UI testing
- Git hooks with husky + lint-staged
- Watch mode for development
- Pre-publication build step

### Documentation
- README.md with quick start and feature overview
- Architecture documentation in docs/plan/
- Migration guide from reference engine (docs/plan/HANDOVER.md)
- Development learnings and decisions (docs/plan/LEARNINGS.md)
- This CHANGELOG

### File Support
- SKILL.md (skill definitions)
- *.instructions.md (extension instructions)
- *.prompt.md (custom prompts)
- *.agent.md (agent definitions)
- AGENTS.md (agent catalog)

### Notes
- Early release (v0.0.1) — feature-complete but focused on core logic
- UI integration (CodeLens, hovers) implemented but partially tested
- Fixer tests planned for v1.0 or v1.1
- E2E fix workflow tests planned for v1.1
- MCP server wrapper deferred to v1.1

---

## Legend

- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security fixes or advisories
- **Docs**: Documentation additions or changes
- **Performance**: Performance improvements

---

## How to Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
