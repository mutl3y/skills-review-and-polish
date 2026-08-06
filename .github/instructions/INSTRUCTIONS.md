# Project Instructions

Concise rules for AI agents working in this repo. Keep this file short — it is
loaded into context.

## Shared logic — do not duplicate

The MCP server (`src/mcp/server.ts`) and the VS Code extension
(`src/extension.ts`) are two doors onto the same engine. Logic both need MUST
live in ONE shared module under `src/core/` and be imported by both — never
copy-pasted. Duplicated copies drift apart (one validates, the other doesn't).

Canonical shared modules (import these; do NOT reimplement):

- `src/core/providerKeys.ts` — `validateKeyForProvider` (provider-key accept-list)
- `src/core/pathSafety.ts` — `safeResolveFilePath`, `isPathWithin` (path containment)
- `src/core/modelNames.ts` — `normalizeModelName`, `normalizeModelId`
- `src/core/llmText.ts` — `stripCodeFences`
- `src/core/tokenBudget.ts` — `CHARS_PER_TOKEN`, `DEFAULT_DOCUMENT_CHARS`
- `src/core/redact.ts` — `redactSecrets` (secret redaction)

When you find duplicated logic, consolidate it into a shared module. Keep the
MCP server and extension on the same shared code.

## Before committing

- `npm run compile`
- `npx vitest run --config tests/vitest.config.ts`
- `npm run lint:md`
- Read `docs/plan/LEARNINGS.md` before modifying analyzer, fixer, or scoring code.
