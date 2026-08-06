# Project Instructions

## Shared logic — do not duplicate

The MCP server and VS Code extension are two doors onto one engine. Logic both
need MUST live in ONE `src/core/*.ts` module imported by both — never copy-pasted
(copies drift apart). Shared modules: `providerKeys`, `pathSafety`, `modelNames`,
`llmText`, `tokenBudget`, `redact`. Consolidate any duplication you find.

## Before committing

`npm run compile` · `npx vitest run --config tests/vitest.config.ts` · `npm run lint:md` · read `docs/plan/LEARNINGS.md` before touching analyzer/fixer/scoring.
