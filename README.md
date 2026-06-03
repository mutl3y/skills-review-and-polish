# Skills Review and Polish

An authoring-time linter and surgical fixer for AI customizations — `SKILL.md`,
`*.instructions.md`, `*.prompt.md`, `*.agent.md`, and `AGENTS.md`. It finds
contradictions, ambiguities, coverage gaps, persona conflicts, structural /
cognitive-load problems, and hygiene issues, surfaces them as diagnostics, and
offers safe, human-in-the-loop fixes.

By default it uses your **GitHub Copilot** subscription via the VS Code Language
Model API — **no API keys required**.

## Status

🚧 Early scaffold. The extension shell, settings, commands, and the LLM provider
seam are in place; the analysis/fix engine is being ported from a proven CLI
engine. See `docs/plan/HANDOVER.md` for the full plan and current state.

## Features (planned)

- **6-wave analysis** — focused passes for contradictions (deep model),
  ambiguities, persona, structural/cognitive load, coverage, and hygiene.
- **Surgical fixes** — per-issue rewrites guarded by deterministic safety gates,
  a risk classifier, and median-of-N keep/revert scoring.
- **Diagnostics, CodeLens, code actions, hovers** for inline authoring feedback.
- **Agentic tools** — analyze/fix exposed to Copilot agent mode in-process.
- **Bring-your-own provider** — optional OpenRouter / GitHub Models with keys in
  SecretStorage.

## Development

```bash
npm install
npm run compile     # tsc
npm run lint
npm test            # vitest
# Press F5 to launch the Extension Development Host
```

## Architecture

- `src/core/` — vscode-free analysis/fix engine (reusable by CLI/MCP/tests).
- `src/providers/` — `LlmProvider` implementations (default: `vscode.lm`).
- `src/ui/` — diagnostics, code actions, CodeLens.
- `src/extension.ts` — in-process activation and command wiring.
- `reference-engine/` — read-only copies of the proven engine to port from
  (excluded from the build).

See `docs/plan/` for the design, engine reference, learnings, and handover.

## License

MIT
