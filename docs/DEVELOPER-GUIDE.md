# Developer Guide

This guide covers project structure, development workflows, testing, and key architectural decisions for contributors.

## Quick Reference

| Need | See |
| --- | --- |
| Code quality standards | [DEVELOPMENT-STANDARDS.md](DEVELOPMENT-STANDARDS.md) |
| Git workflow (hooks, branching) | [GIT-WORKFLOW.md](GIT-WORKFLOW.md) |
| LLM provider details | [MULTIPLIER-ACCESS.md](MULTIPLIER-ACCESS.md) and [VSCODE-LM-STREAMING-FIX.md](VSCODE-LM-STREAMING-FIX.md) |
| Engineering decisions & lessons learned | [plan/LEARNINGS.md](plan/LEARNINGS.md) |
| Implementation & release status | [plan/PROGRESS.md](plan/PROGRESS.md) and [plan/RELEASE-IMPLEMENTATION-PLAN.md](plan/RELEASE-IMPLEMENTATION-PLAN.md) |

## Project Structure

```text
src/
├── core/                    # Core engine (LLM-free, reusable)
│   ├── analyzer.ts          # 6-wave analyzer
│   ├── scoring.ts           # Penalty calculation, median-of-N
│   ├── fixer.ts             # Surgical fixer + safety gates
│   ├── types.ts             # Shared type definitions
│   └── index.ts             # Engine orchestrator
│
├── providers/               # LLM provider implementations
│   ├── vscodeLmProvider.ts  # VS Code LM API (Copilot)
│   └── externalProvider.ts  # OpenRouter, GitHub Models
│
├── ui/                      # VS Code integration
│   ├── diagnostics.ts       # Issue publishing
│   ├── codeActions.ts       # Quick fixes
│   ├── codeLens.ts          # Score badges
│   ├── hover.ts             # Rationale tooltips
│   ├── statusBar.ts         # Analysis state
│   └── inlineRewrites.ts    # Ghost text (experimental)
│
├── mcp/                     # MCP server (headless seam)
│   └── server.ts
│
└── extension.ts             # Main activation + command wiring

tests/
├── fixtures/                # Test corpus (primary + adversarial)
│   ├── primary/             # 6 core fixtures (91 issues)
│   └── adversarial/         # 7 hard cases
│
├── e2e/                     # Playwright smoke tests
│   └── model-picker.test.ts
│
└── **/*.test.ts             # Unit tests (core, providers, UI)

docs/
├── plan/                    # Design docs & implementation notes
│   ├── RELEASE-IMPLEMENTATION-PLAN.md  # Release gates & phases
│   ├── LEARNINGS.md         # Hard-won lessons from analyzer tuning
│   ├── PROGRESS.md          # Implementation status summary
│   ├── ENGINE-REFERENCE.md  # Deep dive into analyzer architecture
│   ├── HANDOVER.md          # Context for new contributors
│   └── ...
│
└── *.md                     # User-facing guides & standards
```

## Development Workflow

### Setup

```bash
git clone https://github.com/mutl3y/skills-review-and-polish.git
cd skills-review-and-polish
npm install
npm run compile
npm run lint
npm test
```

### Making Changes

1. **Create a feature branch** (or work on main for internal PRs)
2. **Edit source files** in `src/`
3. **Run locally:**

   ```bash
   npm run compile        # Compile changes
   npm run lint           # Check linting
   npm test               # Run unit tests (watch mode: npm test -- --ui)
   npm run test:fixtures  # Regression on test corpus
   ```

4. **Test in VS Code:**
   - Press **F5** to launch Extension Development Host
   - Open a `SKILL.md` and run **Skills Review: Analyze This File**
5. **Commit & push** — Pre-commit/pre-push hooks run automatically
   - To bypass: `git push --no-verify` (rarely needed)

### Git Hooks

- **Pre-commit:** ESLint + TypeScript type-check
- **Pre-push:** Full test suite + fixture validation
- Configured via husky + lint-staged (see `.husky/` and `lint-staged` in package.json)

## Testing

### Unit Tests (60+ tests)

```bash
npm test                    # Run all tests
npm test -- --ui            # Watch mode with UI
npm test -- src/core/analyzer.test.ts  # Single file
```

**Coverage areas:**

- Analyzer: All 6 waves, JSON parsing, edge cases
- Provider: Model selection, tier enforcement, streaming
- Model picker: Appearance, filtering, cost warnings
- Fixer: Risk classification, safety gates

### Fixture Validation (regression gate)

```bash
npm run test:fixtures
```

Tests that the seeded corpus (6 primary fixtures + 7 adversarial) remains wired and produces expected categories/counts.

**Primary corpus:**

- `test-contradictions-direct`: 15 issues
- `test-contradictions-subtle`: 12 issues
- `test-ambiguities`: 20 issues
- `test-cognitive-structural`: 13 issues
- `test-coverage-gaps`: 15 issues
- `test-instruction-quality`: 13 issues

### E2E Tests (smoke validation)

```bash
npm run test:e2e
```

Playwright tests running in real Extension Development Host. Tests model picker, command palette, cost warnings, activation.

## Key Architectural Decisions

Read [plan/LEARNINGS.md](plan/LEARNINGS.md) for detailed engineering context. Key takeaways:

1. **Median-of-N scoring** — Reduces LLM variance more reliably than prompt engineering
2. **Surgical fixes only** — Per-issue fixes are safer than whole-file rewrites
3. **Human-in-the-loop** — Diff preview required; no silent auto-apply
4. **6-wave analysis** — Focused passes outperform single combined prompt
5. **Safety gates everywhere** — Risk classification + penalty revert + YAML protection

## Release & Packaging

Before releasing, ensure all gates pass:

```bash
npm run compile
npm run lint
npm run test
npm run test:fixtures
npm run lint:md
npm run package:vsce
```

For detailed release procedures, see [plan/RELEASE-IMPLEMENTATION-PLAN.md](plan/RELEASE-IMPLEMENTATION-PLAN.md).

## Contributing

- See [CONTRIBUTING.md](../CONTRIBUTING.md) for PR guidelines
- Follow [DEVELOPMENT-STANDARDS.md](DEVELOPMENT-STANDARDS.md) for code patterns
- Run git hooks locally (they're also enforced in CI)
- Open issues for bugs/features: [GitHub Issues](https://github.com/mutl3y/skills-review-and-polish/issues)

## Questions?

- **How does the analyzer work?** → [plan/ENGINE-REFERENCE.md](plan/ENGINE-REFERENCE.md)
- **How do I add a new issue type?** → [DEVELOPMENT-STANDARDS.md](DEVELOPMENT-STANDARDS.md) (extension patterns)
- **Why does my fix sometimes revert?** → [plan/LEARNINGS.md](plan/LEARNINGS.md) (penalty-revert safety net)
- **What are the LLM constraints?** → [plan/LEARNINGS.md](plan/LEARNINGS.md) (noise floor, model choice)
