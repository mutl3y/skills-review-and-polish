# Skills Review and Polish

**An authoring-time linter and fixer for AI customization files** — helps you catch contradictions, ambiguities, coverage gaps, persona conflicts, and quality issues in your SKILL.md, \*.instructions.md, \*.prompt.md, \*.agent.md, and AGENTS.md files.

Uses your **GitHub Copilot subscription** via the VS Code Language Model API — **no API keys required**.

## Status: v0.1.50 — released

A production-ready authoring-time linter for AI customization files. Current
calibration evidence (clean-fixture, schema-mode, 5×3): **87.3% recall**,
**63–73% precision**, **deterministic output** (10× noise-floor probe: range
3 penalty / 1 finding, 9 of 10 runs identical). Recall and determinism are
solid; ongoing work is **precision hardening** (target ≥85% accepted findings)
to reduce false positives, not a blocker on using it as a linter today. Treat
production-skill counts as coverage evidence, not validated precision/recall.

- **v0.1.50** — Grading + parsing hardening: `scoreSkill` no longer withholds the letter grade when only *legitimate* meta findings are present (`llm-loop-detected`, `high-complexity`, `limited-coverage`) — only true analysis failures (`llm-error`, `llm-parse-error`, `llm-disabled`, `llm-rate-limited`) force `Ungraded`. `extractJSON` now tolerates valid JSON followed by trailing prose (free models that append commentary after the JSON object/array).
- **v0.1.49** — Withholds the letter grade (`Ungraded`) when ANY wave fails or is rate-limited, instead of reporting a misleading letter grade on partial analysis; failed waves now retry once (stream-iteration + same-tier error retry) and the UI warns about failed waves by name.
- **v0.1.48** — Fixed extension activation failure (`Cannot find module 'picomatch'`) caused by a stale `--no-dependencies` publish flag; `verify:vsix` now uses the same vsce packager as publish.
- **v0.1.47** — Fixed vscode-lm context-budget fallback (model now pre-warmed via `warmUp()`) and redundant per-wave prompt rebuilds (per-run prompt cache).
- **v0.1.44** — Added `verify:vsix` runtime-dependency guard to `release:gate` (catches the missing-`picomatch` regression class before publish).
- **v0.1.43** — Re-included `picomatch` in the VSIX so the extension activates.
- **v0.1.42** — Repositioned as a released production linter (no longer beta/RC framing).
- **v0.1.41** — Documentation accuracy pass (removed broken links, fixed recall/precision/FAQ claims).
- **v0.1.40** — Package hygiene: VSIX size cut from ~60 MB to ~272 KB (excludes internal/non-shipped artifacts).
- **v0.1.39** — Precision hardening + output-budget fix for large skills; analyzer no longer head/tail truncates; bundled OpenRouter catalog asset; async `createDefaultEngine`; deterministic retry/merge path (noise floor range 89 → 3).
- **v0.1.38** — Multi-model scan support: `google/gemini-2.5-flash-lite` (standard tier, ⭐ in picker) + `deepseek/deepseek-chat-v3` (`deepModel`, also ⭐). E56 corpus scan found 8811 candidate findings on 327 skills (vs 1664 in E30). Treat this as coverage evidence, not validated precision/recall. See `scripts/e56-corpus-rescan-multimodel.mjs` for the experiment and the [Recommended OpenRouter Models](docs/USER-GUIDE.md#recommended-openrouter-models) table for the full per-model scorecard.
- Core analyzer with 6-wave analysis ✅
- Surgical fixer with safety guards ✅
- VS Code integration (diagnostics, code actions, hovers) ✅
- Multi-provider support (Copilot, OpenRouter) ✅
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
- `provider` — Which LLM to use (Copilot by default, or OpenRouter)
- `model` — Model id (use the **Select Analysis Model** command). For OpenRouter, the recommended configuration is `google/gemini-2.5-flash-lite` for `model` + `deepseek/deepseek-chat-v3` for `deepModel` (see [Recommended OpenRouter Models](docs/USER-GUIDE.md#recommended-openrouter-models))
- `external.structuredOutput` — Optional OpenAI-compatible JSON mode for external providers. Keep off unless you have validated the selected model path.
- `external.requestTimeoutMs` — Per-request timeout for external provider calls
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

The server reads `.skills-review.json` from the workspace root (written by the **Sync MCP Config** command) or falls back to `OPENROUTER_API_KEY` env vars.

See [`src/mcp/README.md`](src/mcp/README.md) for full setup, client config examples, and the recommended agent workflow.

#### MCP Server Security

The MCP server is a headless interface intended for CI/CD and automation. Understand its trust boundary before running it against untrusted input:

- **What it reads:** `.skills-review.json` from the workspace root (or `MCP_SERVER_WORKSPACE`), and the accepted-findings store.
- **What env vars it accesses:** `OPENROUTER_API_KEY`, `MCP_BATCH_API`, `MCP_MAX_OUTPUT_TOKENS`, and the `ANALYSIS_MODEL` / `DEEP_MODEL` / `FIX_MODEL` / `STRUCTURED_OUTPUT` / `REQUEST_TIMEOUT_MS` overrides.
- **Input limits:** `analyze`/`score`/`verify_fix` reject text longer than 100,000 chars (~25k tokens) to prevent runaway LLM costs.
- **Cost controls:** the server tracks cumulative output tokens per session and refuses new analysis requests once the budget is exhausted. Default cap is 50,000 output tokens per session (~$0.01–0.03 at current rates). Configure via `MCP_MAX_OUTPUT_TOKENS` env var, `maxOutputTokensPerSession` in `.skills-review.json`, or the `skillsReviewAndPolish.mcpMaxOutputTokensPerSession` setting. Set to `0` to disable. Check current usage with the `health` tool.
- **Error redaction:** error messages are sanitized to strip Bearer tokens and API keys before being returned to MCP clients.

Treat the MCP server as a trusted, operator-controlled tool — do not expose it to untrusted clients, and keep provider API keys out of any shared config you commit.

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
- `src/providers/` — LLM provider implementations (vscode.lm, OpenRouter)
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
- [Start a discussion](https://github.com/mutl3y/skills-review-and-polish/discussions)

Questions?

- Read [DEVELOPMENT-STANDARDS.md](docs/DEVELOPMENT-STANDARDS.md) for code patterns
- Check [docs/plan/LEARNINGS.md](docs/plan/LEARNINGS.md) for engineering decisions

### Security

This extension handles LLM API interactions and file system access. Security measures applied after [Gilfoyle code review (2026-06-09)](docs/plan/archive/gilfoyle-reviews/20260609-gilfoyle-review-remediation/gilfoyle-review.md):

- **API key redaction** — Bearer tokens and API keys stripped from all error messages and status bar tooltips
- **Path traversal guards** — `references/` directory loader validates resolved paths stay within expected boundary; rejects symlinks
- **Workspace-root anchoring** — Accepted findings and MCP config resolved from workspace root, not `process.cwd()`
- **Input size limits** — MCP tools enforce `MAX_TEXT_LENGTH` to prevent runaway LLM costs
- **Concurrent analysis locks** — Per-URI analysis serialization prevents race conditions on `lastResults`
- **Safe text replacement** — Function-as-replacement prevents `$`-pattern corruption in surgical fixes

Report vulnerabilities to [security@example.com](mailto:security@example.com) rather than the issue tracker.

## License & Conduct

- **License:** MIT — See [LICENSE](LICENSE)
