# Iteration 4 — Findings Report (Data-Flow / Input-Validation Pass)

Date: 2026-08-09
Reviewer: gilfoyle-code-review-lean (third lens — data-flow / input-validation,
different prompt from the module-review and flow-trace passes)
Scope: untrusted input traced through both doors (MCP server + VS Code extension)

## Findings

### Accepted & Remediated

### I1 — Medium, High confidence — extension `fix` LM tool missing the duplicate-anchor guard

`src/extension.ts:2239-2257` (`registerLanguageModelTools` → `fix` tool) vs
`src/mcp/server.ts` (`handleFix`)

- The MCP `fix` handler refuses `relevantText` that appears multiple times in
  the document unless a `line` disambiguates — because `SurgicalFixer.fixIssue`
  does not itself enforce uniqueness (`resolveAnchorText` takes the raw anchor
  verbatim when it appears). The extension `fix` LM tool called
  `fixer.fixIssue(...)` directly with a synthetic diagnostic and no occurrence
  check, so it silently fixed the **first** occurrence of a duplicated
  fragment while the MCP door refused.
- **Fix:** Added a shared `validateFixAnchor(text, relevantText, rawLine)`
  helper in `src/core/fixer.ts` (single canonical form of the duplicate-anchor
  and line-bounds precondition). Both `handleFix` (MCP) and the extension `fix`
  LM tool now call it; the extension passes the validated line into the
  synthetic diagnostic. Added 7 unit tests.
- **Confidence:** High. Corroborated by reading both call-sites,
  `resolveAnchorText`, and the MCP inline guard that was factored out.

### Recorded, not remediated

### I2 — Low, High confidence — extension LM tools have no document-size gate

`src/extension.ts:2180-2186` (analyze), `2232-2239` (fix) vs
`src/mcp/server.ts` (`requireText` + `maxTextLengthForContext`)

- Every MCP paid tool caps input and scales to context length; the extension
  LM `analyze`/`fix` tools take `text` straight into the engine with no length
  bound. The budget reserve is proportional to length so it doesn't blow the
  cap, but it's an asymmetric input-validation gate on the same untrusted
  boundary. Carried forward as Low.

### I3 — Low, Medium confidence — shared budget excludes the extension's interactive spend

`src/extension.ts:2188,2257`

- `chargeTokens`/`reserveTokens`/`budgetExhausted` appear only inside the two
  LM tools. `runFixAll`/`runFixIssue`/`analyzeDocument` make the same paid LLM
  calls and never touch the session budget. May be intentional
  (human-in-the-loop commands), but the shared-guard docs overstate coverage.
  Carried forward as Low (same theme as H2 from iter-3).

## Verification (post I1 fix)

- `npm run compile` — PASS
- `npx vitest run --config tests/vitest.config.ts` — 643 passed, 16 skipped
- `npm run lint` — 0 errors (6 pre-existing warnings)
- `npm run lint:md` — 0 errors

## Artifact trail

- **Created:** `validateFixAnchor` (+ `FixAnchorValidation`) in
  `src/core/fixer.ts`; 7 tests in `src/core/fixer.test.ts`
- **Modified:** `src/mcp/server.ts` (handleFix uses shared helper),
  `src/extension.ts` (fix LM tool uses shared helper + validated line),
  `src/mcp/server.test.ts` / `src/extension-mcp.test.ts` (mocks expose real
  validateFixAnchor via importOriginal)
- **Symbols changed:** `validateFixAnchor`, `FixAnchorValidation`,
  `handleFix` (callers), `registerLanguageModelTools` (fix invoke)
