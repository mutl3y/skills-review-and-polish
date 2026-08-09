# Iteration 5 — Findings Report (Robustness / Regression Pass)

Date: 2026-08-09
Reviewer: gilfoyle-code-review-lean (4th lens — robustness + regression of the
recent fixes; different prompt from module, flow-trace, and data-flow passes)
Scope: verify the iter-2..4 fixes (root resolution, budget cap, validateFixAnchor)
and re-check carried Lows for regression

## Findings

### Accepted & Remediated

### J1 — Low/Medium, High confidence — REGRESSION from iter-4: `validLine ?? 0` collapses "no line" into "line 0"

`src/core/fixer.ts` (`validateFixAnchor`) and `src/mcp/server.ts` (`handleFix`)

- In iter-4 I added `validateFixAnchor` returning `validLine = line ?? 0`. When
  no `line` arg was provided to a fix, that returned `0` — a *defined* line — so
  the MCP door passed `line: 0` to `fixIssue`. `resolveAnchorText` checks
  `line !== undefined && line >= 0`, so it took the paragraph-at-line-0 branch
  for every no-line fix, forcing the whole first paragraph as the anchor
  instead of the raw (possibly single-instruction) `relevantText`. A unique
  mini-anchor like "Be concise." would have exploded to the entire opening
  paragraph. This was a behavior change I introduced on the very path iter-4
  touched (the reviewer had not seen this because the old inline MCP code
  returned `undefined` when no line was given).
- **Fix:** `validateFixAnchor` now returns `validLine: line` (undefined when no
  line provided) so `resolveAnchorText`'s raw-anchor/expansion branch stays
  reachable for no-line fixes. The MCP handler's `resolvedLine ?? 0` only feeds
  the synthetic diagnostic's LSP range (which needs a number); the real
  `line:` option to `fixIssue` is `undefined` for no-line fixes. Extension LM
  tool was unaffected (it never passed `line:` to `fixIssue`).
- **Confidence:** High. Corroborated by tracing the MCP `line: validLine`
  option through `resolveAnchorText`; the reviewer flagged the exact
  `line !== undefined` check.

### Recorded, not remediated

### J2 — Low, High confidence — duplicate-anchor guard vs paragraph expansion semantic mismatch

`src/core/fixer.ts:940-951` (`resolveAnchorText`) vs `validateFixAnchor`

- The shared guard counts raw-substring occurrences of `relevantText`, but
  `resolveAnchorText` fixes the *paragraph* at a line — a paragraph can be
  unique even when the raw phrase appears N times. So the guard can over-reject
  a fix the paragraph-anchor would disambiguate. This is pre-existing (the MCP
  inline code had the same raw-count logic) and the interactive `runFixIssue`
  door still disambiguates by paragraph without the guard. A full fix would
  move the uniqueness check into `resolveAnchorText` on the resolved target
  text, affecting all three doors — risky, low real-world value. Carried.

### J3 — Low, Medium confidence — `validLine`/line-bounds plus LSP-range interplay is subtle

`src/core/fixer.ts` (`validateFixAnchor`, `extractParagraphAtLine`)

- The helper's return shape (`error?`/`validLine?`) is compact but the two call
  sites reconcile it into both an LSP range (needs a number) and a `fixIssue`
  `line:` option (needs undefined-when-absent). This is a footgun for future
  callers. Carried as a documentation/robustness note; not a defect.

### J4 — Nit — raw-substring overlap counting in `validateFixAnchor`

`src/core/fixer.ts`

- `text.split(relevantText).length - 1` doesn't skip overlapping occurrences
  (e.g. `relevantText="aa"` against `"aaa"` under-counts). Faithful to the old
  MCP behavior — not a regression. Carried as a note; not worth a change now.

### J5 — Nit — `expandToParagraph` re-scans a validated anchor

`src/core/fixer.ts:352-384`

- On a document with no blank-line paragraph boundaries it can walk to
  end-of-string, though `guardMaxAnchorChars` bounds the LLM call. Note only.

## Confirmed sound (no regression)

- `resolveWorkspaceRoot` unification (iter-2): single definition, single store
  consumer, canonical-to-canonical, pin path works. No leftover derivation.
- Budget cap (iter-3): both LM tools honor `mcpMaxTokensPerSession`, reserve +
  charge with matching wave counts, cap set inside invoke. Consistent with MCP.
- `validateFixAnchor` (iter-4, post-J1): both doors call the shared helper,
  line propagated into the fix via `resolveAnchorText` paragraph extraction.
- Carried Lows (TOCTOU on linked-refs, interactive spend unbudgeted, concurrent
  lost-update, doc-size gate) all confirmed still Low — none rose to Medium+.

## Verification (post J1 fix)

- `npm run compile` — PASS
- `npx vitest run --config tests/vitest.config.ts` — 644 passed, 16 skipped
- `npm run lint` — 0 errors (6 pre-existing warnings)
- `npm run lint:md` — 0 errors

## Artifact trail

- **Modified:** `src/core/fixer.ts` (validateFixAnchor returns undefined
  validLine for no-line — regression fix), `src/core/fixer.test.ts` (updated +
  new no-line-undefined test), `docs/plan/improve-codebase-loop/iter-04/REPORT.md`
  (markdown lint)
- **Symbols changed:** `validateFixAnchor`, `FixAnchorValidation`,
  `handleFix` (callers)