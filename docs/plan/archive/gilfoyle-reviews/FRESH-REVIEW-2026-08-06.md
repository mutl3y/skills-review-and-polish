# Fresh Full Codebase Review – 2026-08-06

**Scope**: Entire repository `/workspace/skills-review-and-polish`.

**Methodology**: Manual static analysis of source files, configuration, and scripts. No reliance on prior review artifacts.

## Summary of Findings

| Severity | Category | Description |
|----------|----------|-------------|
| **Critical** | **Security** | `src/core/providerKeys.ts` lacks validation for empty provider strings – could lead to privilege escalation.
| **Critical** | **Duplication** | Identical helper functions (`safeResolveFilePath`, `isPathWithin`) exist in both `src/mcp/server.ts` and `src/extension.ts`. Should be moved to a shared module.
| **High** | **Performance** | `src/core/tokenBudget.ts` uses a naïve loop for token counting; could be replaced with a pre‑computed lookup for O(1) access.
| **High** | **Error Handling** | Many `catch` blocks re‑throw generic `Error` without preserving stack traces, making debugging difficult.
| **Medium** | **Documentation** | README and docs lack a “Getting Started” section for contributors; `docs/plan/LEARNINGS.md` is outdated.
| **Medium** | **Code Style** | Inconsistent use of single vs double quotes across the codebase; `eslint.config.mjs` enforces one style but many files violate it.
| **Low** | **Testing** | Several test files (`tests/**/*.test.ts`) are missing assertions; they only log output.
| **Low** | **Dependencies** | `package.json` includes `lodash` but only a single utility (`_.cloneDeep`) is used – consider replacing with native spread.

## Recommendations

1. **Consolidate Shared Logic** – Create a new module `src/core/shared.ts` and import it in both MCP server and VS Code extension.
2. **Strengthen Provider Validation** – Ensure `validateKeyForProvider` rejects empty or malformed keys.
3. **Optimize Token Budget** – Replace the loop with a constant map or use a library that provides token estimation.
4. **Improve Error Propagation** – Preserve original error objects (`throw new Error(message, { cause: originalError })`).
5. **Update Documentation** – Add a quick‑start guide and keep `LEARNINGS.md` in sync with code changes.
6. **Enforce Linting** – Run `npm run lint:md` and `npm run lint` as part of CI to catch style violations.
7. **Refactor Tests** – Replace console logs with proper assertions using Vitest.
8. **Trim Dependencies** – Remove unused `lodash` or replace with native alternatives.

## Next Steps

- Run `npm run compile` to ensure TypeScript builds after consolidating shared modules.
- Execute `npm run lint:md` and address any formatting issues.
- Add missing tests and improve coverage.
- Commit the changes and re‑run the Gilfoyle review loop for a second iteration.

*Report generated automatically on 2026‑08‑06.*
