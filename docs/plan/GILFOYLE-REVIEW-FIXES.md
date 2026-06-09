# Gilfoyle Code Review Fixes

**Created:** 2026-06-09
**Source:** Gilfoyle Code Review of MCP server
**Status:** In Progress

## Wave 1: Critical Bugs ✅

| # | Issue | Fix | Status |
| --- | --- | --- | --- |
| 1 | `health` tool lies about config source/model | `createDefaultEngine` returns `{ engine, config }`; health uses stored config | ✅ Done |
| 2 | `DEFAULT_ACCEPTED_FINDINGS_PATH` inside `out/` | Changed to `path.join(process.cwd(), '.accepted-findings.json')` | ✅ Done |
| 3 | `process.cwd()` unreliable for config | Added `MCP_SERVER_WORKSPACE` env var fallback | ✅ Done |

## Wave 2: Design & Security ✅

| # | Issue | Fix | Status |
| --- | --- | --- | --- |
| 4 | `callTool` 200-line if/else chain | Extract to dispatch table of handler functions | ✅ Done |
| 5 | `Promise.resolve()` wrapping sync code | Make `createDefaultEngine` sync | ✅ Done |
| 6 | `verify_fix` burns 13+ LLM calls | Removed `engine.score()` call, returns `issueCount` instead | ✅ Done |
| 7 | No input size limits on `text` | Added `MAX_TEXT_LENGTH = 100_000` + `requireText` helper | ✅ Done |
| 8 | `syncMcpConfig` non-atomic writes | Write to temp file then rename | ✅ Done |

## Wave 3: Test Hardening ✅

| # | Issue | Fix | Status |
| --- | --- | --- | --- |
| 11 | Mock doesn't verify critical args | 5 new error-path tests with arg validation | ✅ Done |
| 12 | Missing error path tests | Empty text, missing args, unknown tool, text too long | ✅ Done |
| 13 | Rate-limited analyze passes when broken | Added `{ retry: 1 }` to flaky test | ✅ Done |
| 14 | Test cleanup in afterAll | Cleans up `.accepted-findings.json` after run | ✅ Done |

## Out of Scope (acknowledged)

| # | Issue | Rationale |
| --- | --- | --- |
| 9 | No rate limiting on MCP calls | Infrastructure concern — needs semaphore/throttle, separate PR |
| 10 | Accepted findings shared globally | Already fixed in Wave 1 (#2) |
| 15 | `require.main === module` CJS pattern | Low priority, works fine |
| 16 | No pagination on `list_accepted_findings` | Premature optimization — stores are small |
| 17 | No `additionalProperties: false` in schemas | LLM agents ignore extra fields anyway |
| 18 | Return type fiction on `McpToolCallResult` | TypeScript structural typing is sufficient |
