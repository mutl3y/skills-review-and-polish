# Skills Review and Polish

An authoring-time linter and surgical fixer for AI customizations — `SKILL.md`, `*.instructions.md`, `*.prompt.md`, `*.agent.md`, and `AGENTS.md`. Finds contradictions, ambiguities, coverage gaps, persona conflicts, structural/cognitive load problems, and hygiene issues. Surfaces findings as VS Code diagnostics and offers safe, human-in-the-loop fixes.

Uses your **GitHub Copilot** subscription via the VS Code Language Model API — **no API keys required**. Optional external providers (OpenRouter, GitHub Models) supported.

## Status

✅ **v0.0.1** — Public beta candidate (feature-complete core, release gates still required)
- Core 6-wave analyzer ✅
- Surgical fixer with safety gates ✅
- VS Code UI (diagnostics, code actions, CodeLens, hovers) ✅
- Agentic tools exposure ✅
- Multi-provider support (vscode.lm, OpenRouter, GitHub Models) ✅
- Git hooks and docs lint enforcement ✅

See [CHANGELOG.md](CHANGELOG.md) for version history, [docs/RELEASE-READINESS.md](docs/RELEASE-READINESS.md) for the current release gate, and [docs/plan/PROGRESS.md](docs/plan/PROGRESS.md) for detailed implementation status.

### Release readiness

Before publishing a public build, complete the release checklist in [docs/RELEASE-READINESS.md](docs/RELEASE-READINESS.md):

1. Run `npm run compile` and `npm test`.
2. Run `npm run lint` and `npm run lint:md`.
3. Smoke-test the extension in VS Code and validate the seeded fixtures.
4. Verify packaging and marketplace publish steps.

## Features

### Analysis
- **6-wave focused analysis**: contradictions (deep model), ambiguities, persona consistency, structural quality, coverage gaps, hygiene
- **Real-time diagnostics**: Issues surface as VS Code squiggles with codes, severity, and rationale
- **Multi-pass safety**: Median-of-N scoring reduces false positives
- **Skill-aware**: Detects scope based on YAML frontmatter

### Fixing
- **Surgical rewrites**: Per-issue fixes guarded by deterministic safety gates
- **Risk classification**: Evaluates edit scope, factual grounding, growth bounds
- **Human-in-the-loop**: Diff preview with accept/reject for every fix
- **Fix-all orchestration**: Batch fixes with incremental application and rollback

### Integration
- **VS Code UI**: Code actions ("Fix this issue"), CodeLens badges, hover tooltips, status bar
- **Agentic tools**: Analyze/fix callable from Copilot agent mode
- **MCP seam**: Headless stdio server for CI, automation, and external MCP clients
- **Markdown linting**: ESLint plugin for documentation quality checks
- **Git hooks**: Pre-commit linting, pre-push tests (via husky + lint-staged)

### LLM Providers
- **Default**: vscode.lm (GitHub Copilot) — no setup required
- **Optional**: OpenRouter, GitHub Models — configure API keys via extension UI

## Quick Start

### Installation
1. Clone: `git clone https://github.com/mutl3y/skills-review-and-polish.git`
2. Install: `npm install`
3. Build: `npm run compile`
4. Debug: Press **F5** in VS Code to launch Extension Development Host

### Usage
1. Open a `SKILL.md`, `*.instructions.md`, `*.prompt.md`, or `*.agent.md` file
2. Run command: **Skills Review: Analyze This File** (Cmd/Ctrl+Shift+P)
3. View diagnostics in the editor (squiggles + issue codes)
4. Click **"Fix this issue"** → review diff → accept/reject

### Configuration
Open VS Code Settings and search for "Skills Review":
- `enable` — Enable/disable the extension
- `provider` — LLM provider (`vscode-lm` / `openrouter` / `githubModels`)
- `model` — Override default model selection
- `analysisMode` — `multiWave` (6 focused passes) or `single` (combined prompt)
- `runOn` — `manual` / `onSave` / `onType`
- `logLevel` — `info` (default) or `debug` for verbose LM prompt/response tracing and the debug log file

## Development

### Scripts
```bash
npm install            # Install dependencies
npm run compile        # TypeScript compilation
npm run lint           # ESLint check
npm run lint:md        # Markdown lint for docs/
npm run test           # Run 60/60 unit tests
npm run watch          # Watch mode
npm run test:e2e       # Playwright E2E tests (model picker)
npm run vscode:prepublish  # Build for publication
```

### Git Workflow
Hooks auto-enforce quality on every commit/push:
```bash
git add src/file.ts
git commit                    # Pre-commit: lint + type-check
git push                      # Pre-push: run all tests
```

See [docs/GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md) for details. Use `--no-verify` to bypass (rare).

### Project Structure
```
src/core/              Core engine (vscode-free, reusable)
├── analyzer.ts        6-wave LLM analysis
├── scoring.ts         Penalty calculation, median-of-N
├── fixer.ts           Surgical fixer + safety gates
├── index.ts           Engine orchestrator
└── types.ts           Shared types

src/providers/         LLM provider implementations
├── vscodeLmProvider.ts    vscode.lm (default)
└── externalProvider.ts    OpenRouter, GitHub Models

src/ui/                VS Code UI
├── diagnostics.ts     Issue publishing
├── codeActions.ts     "Fix this issue" quick actions
├── codeLens.ts        Score badges
├── hover.ts           Rationale tooltips
├── statusBar.ts       Analysis state
└── inlineRewrites.ts  Experimental ghost text

src/extension.ts       Activation + command wiring

docs/                  Documentation
├── GIT-WORKFLOW.md    Git hooks guide
├── DEVELOPMENT-STANDARDS.md    Code quality standards
├── MULTIPLIER-ACCESS.md        How to access cost multipliers
├── VSCODE-LM-STREAMING-FIX.md  vscode.lm streaming details
└── plan/              Design docs and handover
```

### Testing (60/60 passing)
```bash
npm test              # Run all tests
npm test -- --ui      # Watch mode with UI
npm test -- src/core/analyzer.test.ts  # Single file
```

**Coverage**: ~28% by LOC (core logic 100%, UI integration partial)
- ✅ Analyzer: All 6 waves + JSON parsing
- ✅ Provider: Model selection, tier enforcement, streaming
- ✅ Model picker UI: Appearance, filtering, cost warnings
- ⏳ Fixer: Risk classification (unit tests planned v1.1)
- ⏳ E2E: Fix workflow (Playwright planned v1.1)

See [docs/DEVELOPMENT-STANDARDS.md](docs/DEVELOPMENT-STANDARDS.md) for coding patterns and safety standards.

### LLM Provider Details
By default, the extension uses your **Copilot subscription** (no cost, no setup). To use external providers:

1. Run: **Skills Review: Set API Key** (Cmd/Ctrl+Shift+P)
2. Choose provider (OpenRouter / GitHub Models)
3. Paste your API key (stored in VS Code SecretStorage)
4. Change provider in Settings

**Cost Control**: Extension enforces "safe-tier" models by default (multiplier ≤1x). See [docs/MULTIPLIER-ACCESS.md](docs/MULTIPLIER-ACCESS.md) for cost multiplier reference.

### MCP Server Setup
The repository also ships a headless MCP seam in [src/mcp/server.ts](src/mcp/server.ts) so the engine can be used from external MCP clients and automation pipelines.

How it works:
- The MCP server exposes two tools: `analyze` and `fix`.
- It uses the same core engine as the VS Code extension, so the analysis logic is shared.
- The default provider path prefers `GITHUB_TOKEN` + GitHub Models, matching the CLI analyzer flow.
- If no GitHub token is present, it falls back to `OPENROUTER_API_KEY`.

Quick start:
1. Install dependencies: `npm install`
2. Build the server entry point: `npm run compile`
3. Run the MCP server: `npm run mcp`
4. Point your MCP client at the compiled server binary (`node ./out/mcp/server.js`) with the env vars below.

Example MCP client config:
```json
{
  "mcpServers": {
    "skills-review": {
      "command": "node",
      "args": ["/workspace/skills-review-and-polish/out/mcp/server.js"],
      "env": {
        "GITHUB_TOKEN": "<your-github-token>",
        "ANALYSIS_MODEL": "gpt-4o-mini"
      }
    }
  }
}
```

Notes:
- `GITHUB_TOKEN` is the preferred path for this repo because it matches the CLI analyzer.
- `ANALYSIS_MODEL` is optional; if omitted, the server defaults to `gpt-4o-mini` for GitHub Models and `openai/gpt-4o-mini` for OpenRouter.
- For a real proof run, the server can be invoked through an MCP client and the `analyze` tool against any `SKILL.md` / prompt file.

See [src/mcp/README.md](src/mcp/README.md) for the full protocol and wiring notes.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, development setup, and how to submit pull requests.

**Quick links:**
- [Open issues](https://github.com/mutl3y/skills-review-and-polish/issues)
- [Pull requests](https://github.com/mutl3y/skills-review-and-polish/pulls)
- [Discussions](https://github.com/mutl3y/skills-review-and-polish/discussions)

## Security

Please report security vulnerabilities to [security@example.com](mailto:security@example.com) rather than using the issue tracker. See [SECURITY.md](SECURITY.md) for details.

## Code of Conduct

This project adheres to the [Contributor Covenant](https://www.contributor-covenant.org/). See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

MIT — See [LICENSE](LICENSE) for details.

## Acknowledgments

- VS Code Language Model API and Copilot team
- Vitest testing framework
- Playwright for E2E testing
- ESLint and TypeScript communities
