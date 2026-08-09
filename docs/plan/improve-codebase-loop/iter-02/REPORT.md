# Iteration 2 — Findings Report

Date: 2026-08-09
Reviewer: gilfoyle-code-review-lean (broad whole-codebase scan)
Scope: MCP server + VS Code extension reviewed together (shared security logic)

## Findings

### Accepted & Remediated

### G1 — Medium, Medium confidence — root-resolution split in MCP server
`src/mcp/server.ts`
- `resolveAcceptedFindingsPath()` resolved the accepted-findings store path from
  `MCP_SERVER_WORKSPACE || process.cwd()`, while path safety
  (`resolveWorkspaceRoot()`) additionally honors the `workspaceRoot` pinned in
  `.skills-review.json`. When the config pinned a root different from cwd, the
  accepted-findings store rooted in one place while every
  `safeResolveFilePath` containment check ran against another — store keys
  (validated against pinned root) and store lookup files (rooted in cwd)
  silently diverge.
- **Fix:** `resolveAcceptedFindingsPath()` now routes through the single
  `resolveWorkspaceRoot()`, so the store path and path-safety checks share one
  trust boundary. `loadConfig` deliberately keeps reading the config from
  env-or-cwd first because it must read the config before it can pin the root —
  that bootstrap ordering is intentional and was left unchanged.
- **Confidence:** Medium. Corroborated by reading the three call-sites; the
  divergence is real when a config pins a non-cwd root.

### Recorded, not remediated

**G2 — Low, Medium confidence — TOCTOU window on linked-reference reads**
`src/core/analyzer.ts:1365-1394` (`readLinkedPromptFiles`)
- Real but theoretical: `safeResolveFilePath(target, docDir, false)` returns the
  lexical path, then lstat+realpath verify containment, then `readFile` runs on
  the same resolved path. A symlink dropped in between gate and read could
  escape. Requires local write access to the skill directory between two
  adjacent lines, and the graceful-skip path depends on the `requireExists=false`
  semantics. Fixing risks regression for low real-world value. Carried forward.

**G3 — Nit (rejected) — redact regex ordering**
`src/core/redact.ts`
- The reviewer claimed the generic `\bsk-` rule runs before and consumes the
  dedicated `sk-or-v1-` rule, making the latter dead code. The actual code has
  the **opposite** order: the dedicated `sk-or-v1-` rule runs first, then the
  generic `\bsk-` catch-all. Both are needed for distinct key shapes. Claim is
  factually wrong — rejected with reason, not a defect.

**G4 — Low/Nit (note) — extension has no `accept_finding` counterpart**
`src/extension.ts:54`
- Reviewer itself flagged this as "not a defect per se" — the extension has no
  accepted-findings store tool, so nothing diverges today. Recorded as a
  cross-file pattern to keep in mind if an agent-facing store tool is ever
  added. Not acted on.

## Verification

- `npm run compile` — PASS
- `npx vitest run --config tests/vitest.config.ts` — 636 passed, 16 skipped
- `npm run lint` — 0 errors (6 pre-existing warnings, none in changed files)
- `npm run lint:md` — 0 errors (fixed markdown lint in iter-01 REPORT.md)

## Artifact trail

- **Modified:** `src/mcp/server.ts` (resolveAcceptedFindingsPath → use
  resolveWorkspaceRoot), `docs/plan/improve-codebase-loop/iter-01/REPORT.md`
  (markdown lint fixes)
- **Symbols changed:** `resolveAcceptedFindingsPath`, `resolveWorkspaceRoot`
  (callers), `safeResolveFilePath` (unaffected)
