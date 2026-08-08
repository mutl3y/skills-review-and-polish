# Full Codebase Review Report — 2026-08-08

**Status:** Validated against current code, remediated, and closed. Each finding
below is annotated with its validation outcome and remediation (if any).

## Findings

### #1 — src/extension.ts:30 — High — `safeResolveFilePathForTools` cwd fallback
**Valid → Remediated.** `safeResolveFilePathForTools` fell back to
`process.cwd()` when `workspaceFolderForPath` returned `undefined`, letting an
agent-driven LM tool resolve paths against an uncontrolled cwd. Now fails
CLOSED: no workspace folder → returns `undefined` (caller refuses the request).

### #2 — src/extension.ts:1475 — Medium — hard-coded 30% shrinkage floor
**Valid → Remediated.** `applyFixToDocument` hard-coded a 0.3 minimum
fixed:original length ratio, discarding legitimate large-scale rewrites. Now
configurable via `fix.guard.applyMinRatio` (default 0.3; 0 disables).

### #3 — src/mcp/server.ts:410 — High — `chargeTokens` result unchecked
**By design — not a bug.** The budget state machine intentionally returns the
result even when the charge exceeds the cap ("the work is done") and marks the
budget exhausted so the *next* request is refused. Documented in
`src/core/sessionBudget.ts`. No change.

### #4 — src/mcp/server.ts:430 — Medium — permissive `line` parsing
**Already fixed.** `handleFix` now parses `line` defensively (rejects NaN /
non-finite) and bounds-checks it against the document line count. No change.

### #5 — src/providers/externalProvider.ts:686 — Medium — unbounded retry loop
**Valid → Remediated.** The `attempt--` on the retry-without-structured-output
path could extend the loop past `maxRetries` indefinitely. Added a hard cap on
total loop iterations (`maxTotalAttempts`).

### #6 — src/core/pathSafety.ts:14 — Low — case-insensitivity only on Windows
**By design.** On case-sensitive filesystems paths are case-sensitive, so a
crafted path cannot escape via case. Standard, correct behavior. No change.

### #7 — src/core/sessionBudget.ts:9 — Medium — default 500K budget
**By design / configurable.** The cap is configurable via `mcpMaxTokensPerSession`
and `MCP_MAX_TOKENS`; 0 disables the guard. Tuning concern, not a bug. No change.

### #8 — src/core/redact.ts:20 — Low — redaction misses underscore keys
**Valid → Remediated.** Added Stripe-style underscore key redaction
(`sk_live_`/`rk_test_`/etc.) plus a regression test.

### #9 — src/core/fixer.ts:35 — Low — anchor-expansion comment, no hard limit
**Already fixed.** `MAX_SURGICAL_ANCHOR_CHARS = 350` is enforced in
`resolveAnchorText` (and configurable via `fix.guard.maxAnchorChars`). No change.

### #10 — src/mcp/server.ts:447 — Medium — negative `line` accepted
**Already fixed.** `handleFix` rejects `line < 0` before conversion. No change.

### #11 — src/extension.ts:2150 — Medium — hard-coded wave count 6
**Valid → Remediated.** The analyze LM tool hard-coded `6` in
`reserveTokens`/`chargeTokens`. Now uses `ALL_WAVES.length` so it stays in sync
if the wave list changes.

### #12 — src/core/logger.ts:19 — Low — default transport without redaction
**Valid → Remediated.** The default transport now redacts defensively via
`redactSecrets` (in addition to `Logger.formatLine`), covering any raw line
written through the transport.
