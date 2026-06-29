# Skills Review and Polish

**An authoring-time linter and fixer for AI customization files** — helps you catch contradictions, ambiguities, coverage gaps, persona conflicts, and quality issues in your SKILL.md, \*.instructions.md, \*.prompt.md, \*.agent.md, and AGENTS.md files.

Uses your **GitHub Copilot subscription** via the VS Code Language Model API — **no API keys required**.

## ✅ Status: Published v0.1.3

- **v0.1.3** — Published to VS Code Marketplace (June 29, 2026)
- Core analyzer with 6-wave analysis ✅
- Surgical fixer with safety guards ✅
- VS Code integration (diagnostics, code actions, hovers) ✅
- Multi-provider support (Copilot, OpenRouter, GitHub Models) ✅
- MCP server with 7 tools ✅
- Analysis mode comparison (single/focused/multiWave) ✅
- Trace logging for LLM debugging ✅

## Features

### Analysis

- Detects contradictions, ambiguities, persona conflicts, structural issues, coverage gaps, and hygiene problems
- Real-time VS Code diagnostics with severity levels and explanations
- Smart multi-pass analysis with noise reduction (median-of-N scoring)
- **Analyze With Options** — two-step modal: choose mode (Single / Focused / Multi-Wave) then toggle individual waves with checkboxes
- **Cancel** — analysis can be cancelled any time via the VS Code progress notification Cancel button

### Fixing

- One-issue-at-a-time surgical fixes with safety guards
- Human-in-the-loop: review each fix with a diff before applying
- Intelligent risk classification prevents over-correction

### Integration

- Live VS Code squiggles, quick fixes ("Fix this issue"), and hover explanations
- Full MCP server with 7 tools (analyze, fix, score, verify_fix, accept_finding, list_accepted_findings, health)
- `.skills-review.json` config sync from VS Code settings
- Markdown linting for documentation quality
- Git hooks for pre-commit/pre-push validation

## Quick Start

### Install & Run

1. Clone: `git clone https://github.com/mutl3y/skills-review-and-polish.git`
2. Install: `npm install`
3. Debug: `npm run compile` then press **F5** in VS Code

### Analyze Your Files

1. Open any `SKILL.md`, `*.instructions.md`, `*.prompt.md`, or `*.agent.md`
2. Run: **Skills Review: Analyze This File** (Cmd/Ctrl+Shift+P)
3. View issues as VS Code squiggles
4. Click **"Fix this issue"** to preview and apply fixes

### Configuration

Open VS Code Settings and search "Skills Review":

- `enable` — Turn on/off
- `provider` — Which LLM to use (Copilot by default, or OpenRouter/GitHub Models)
- `analysisMode` — `multiWave` (recommended), `focused` (contradictions + ambiguities), or `single` combined pass
- `logLevel` — `info` (default), `debug` for detailed tracing, or `trace` for full LLM prompt/response logging

> **Tip:** Use **Analyze With Options** (Command Palette) to pick mode and waves per-run without changing your settings.

## Learn More

### For End Users

- **[User Guide →](docs/USER-GUIDE.md)** — Complete guide on how to use the extension (best starting point)
- **[Tutorials →](docs/TUTORIALS.md)** — Step-by-step walkthroughs (5–15 min each)
- **[FAQs →](docs/FAQS.md)** — Common questions and answers
- **[Architecture →](docs/ARCHITECTURE.md)** — How the analyzer works and why we made these choices

### MCP Server

The extension ships with a headless [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for CI/CD, automation, and external tooling.

| Tool | Description |
| --- | --- |
| `analyze` | Run analysis waves, return JSON diagnostics. Use `enabledWaves` to select specific waves (contradictions, ambiguities, persona, structural, coverage, hygiene) or omit for all 6 waves. |
| `fix` | Surgical fix for one issue (5 fixable codes) |
| `score` | Quality score (0–100) + letter grade (A+ through F) |
| `verify_fix` | Re-analyze to confirm a specific fix worked |
| `accept_finding` | Suppress a known/expected finding |
| `list_accepted_findings` | View all suppressed findings |
| `health` | Check provider, model, and config source |

**Quick start:**

```bash
npm run compile
npm run mcp   # starts stdio server
```

The server reads `.skills-review.json` from the workspace root (written by the **Sync MCP Config** command) or falls back to `GITHUB_TOKEN` env vars.

See [`src/mcp/README.md`](src/mcp/README.md) for full setup, client config examples, and the recommended agent workflow.

### For Developers

#### Scripts

```bash
npm run compile        # TypeScript compilation
npm run lint           # ESLint check
npm run lint:md        # Markdown documentation lint
npm run test           # Run unit tests
npm run test:fixtures  # Regression suite on test corpus
npm run test:e2e       # Playwright smoke tests
npm run watch          # Watch mode
```

#### Core Modules

- `src/core/` — Analysis engine (6-wave analyzer, scoring, surgical fixer)
- `src/providers/` — LLM provider implementations (vscode.lm, OpenRouter, GitHub Models)
- `src/ui/` — VS Code integration (diagnostics, code actions, hovers)
- `src/extension.ts` — Main activation and command wiring
- `tests/` — Unit and E2E test suites

#### Git Workflow

- Pre-commit hooks enforce linting and type-checking
- Pre-push hooks run the full test suite
- Use `git commit --no-verify` only in emergencies

See [DEVELOPMENT-STANDARDS.md](docs/DEVELOPMENT-STANDARDS.md) for code quality guidelines, [GIT-WORKFLOW.md](docs/GIT-WORKFLOW.md) for detailed git setup, and [docs/plan/LEARNINGS.md](docs/plan/LEARNINGS.md) for engineering context.

## Contributing & Support

Report issues, request features, or contribute:

- [Open an issue](https://github.com/mutl3y/skills-review-and-polish/issues)
- [See CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines

Questions?

- [Start a discussion](https://github.com/mutl3y/skills-review-and-polish/discussions)
- Read [DEVELOPMENT-STANDARDS.md](docs/DEVELOPMENT-STANDARDS.md) for code patterns
- Check [docs/plan/LEARNINGS.md](docs/plan/LEARNINGS.md) for engineering decisions

### Security

This extension handles LLM API interactions and file system access. Security measures applied after [Gilfoyle code review (2026-06-09)](docs/plan/20260609-gilfoyle-review-remediation/gilfoyle-review.md):

- **API key redaction** — Bearer tokens and API keys stripped from all error messages and status bar tooltips
- **Path traversal guards** — `references/` directory loader validates resolved paths stay within expected boundary; rejects symlinks
- **Workspace-root anchoring** — Accepted findings and MCP config resolved from workspace root, not `process.cwd()`
- **Input size limits** — MCP tools enforce `MAX_TEXT_LENGTH` to prevent runaway LLM costs
- **Concurrent analysis locks** — Per-URI analysis serialization prevents race conditions on `lastResults`
- **Safe text replacement** — Function-as-replacement prevents `$`-pattern corruption in surgical fixes

Report vulnerabilities to [security@example.com](mailto:security@example.com) rather than the issue tracker. See [SECURITY.md](SECURITY.md).

## License & Conduct

- **License:** MIT — See [LICENSE](LICENSE)
- **Code of Conduct:** [Contributor Covenant](CODE_OF_CONDUCT.md)
