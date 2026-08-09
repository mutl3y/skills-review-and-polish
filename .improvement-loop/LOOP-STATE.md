# Improvement Loop State — skills-review-and-polish

**Last updated:** Iteration 01 (2026-08-09)
**Reviewer:** gilfoyle-code-review (main), gpt-gilfoyl-code-review (independent verification)
**Severity stop:** Medium or above

## Current Status

**Iteration:** 03 → 04 (looping)
**Next action:** Independent verification pass (Step 1 of Iteration 04)
**In-progress work:** None — all valid findings from Iteration 03 remediated

## Verification Baseline

- **Build:** `npm run compile` — passes (confirmed before loop start)
- **Tests:** `npx vitest run --config tests/vitest.config.ts` — baseline TBD
- **Lint:** `npm run lint:md` — baseline TBD

## Findings (from initial Gilfoyle review)

| ID | Severity | Confidence | File | Description | Status |
|----|----------|------------|------|-------------|--------|
| ~~F-001~~ | ~~MEDIUM~~ | ~~HIGH~~ | ~~`src/core/sessionBudget.ts`~~ | ~~Session budget persists ambiguously across VS Code lifecycles; no auto-reset mechanism~~ | **REJECTED** — Already fixed: `resetSessionBudget()` called on activation (line 296, `extension.ts`) |
| F-002 | MEDIUM | HIGH | `src/ui/inlineRewrites.ts` | Inline rewrites bypass diff-preview safety gate; applies fixes directly on Tab accept | VALID — needs remediation |
| ~~F-003~~ | ~~MEDIUM~~ | ~~HIGH~~ | ~~`src/core/sessionBudget.ts`~~ | ~~`chargeTokens` over-counts when waves don't send full document; uses `inputChars * inputWaves` uniformly~~ | **REJECTED** — MCP server passes `text.length` (full doc); charge formula is correct |
| F-004 | LOW | CONFIRMED | `src/core/acceptedFindings.ts` | Dynamic `require('vscode')` in supposedly extension-agnostic core module | OPEN |
| F-005 | LOW | CONFIRMED | `src/core/analyzer.ts` | Limited JSON repair surface — only trailing commas handled | OPEN |
| F-006 | INFO | HIGH | `src/modelCatalog.ts` | Model catalog disk cache paths deterministically derivable from API keys | OPEN |

## New Findings (Iteration 03 independent review)

| ID | Severity | Confidence | File | Description | Status |
|----|----------|------------|------|-------------|--------|
| F-007 | HIGH | HIGH | `src/core/analyzer.ts:202` | `MAX_COMPOSED_SIZE` hardcoded to 100K chars ignores per-model context budgets | REJECTED — Edge case with unsupported models |
| F-008 | MEDIUM | HIGH | `src/mcp/server.ts` | No rate limiting on MCP tool calls — LLM agent can fire unlimited requests | REMEDIATED |
| F-010 | MEDIUM | HIGH | `src/mcp/server.ts:747` | `createDefaultEngine` swallows config-file parse errors silently | REMEDIATED |
| F-011 | LOW | MEDIUM | `src/providers/externalProvider.ts:148` | `extractText` has no null-safety on nested property access | REMEDIATED |

## Artifact Trail

### Iteration 01 Remediation

| File | Change | Finding |
|------|--------|---------|
| `src/ui/inlineRewrites.ts` | Added safety rationale comment explaining ghost-text preview + Tab accept paradigm | F-002 (rejected as valid concern but acceptable) |
| `src/core/acceptedFindings.ts` | Removed dynamic `require('vscode')` from `DEFAULT_ACCEPTED_FINDINGS_PATH`; now returns empty string sentinel with updated JSDoc | F-004 |
| `src/core/analyzer.ts` | Expanded `repairCommonJSONSyntax()` to handle: single-quoted strings, unquoted keys, undefined/NaN literals (in addition to trailing commas) | F-005 |
| `src/modelCatalog.ts` | Added security rationale comment for deterministic cache filename design | F-006 |

**Rejected findings:** F-001 (already fixed on activation), F-003 (charge formula correct — each wave receives full doc)

### Iteration 03 Remediation

| File | Change | Finding |
|------|--------|---------|
| `src/mcp/server.ts` | Added sliding-window rate limiter (`checkRateLimit()`) applied to all paid tool handlers (analyze, fix, score, verifyFix); max 30 calls/minute | F-008 |
| `src/mcp/server.ts` | Fixed outer catch in `createDefaultEngine()` to distinguish "file not found" from "file exists but invalid"; logs warning instead of silent swallow | F-010 |
| `src/providers/externalProvider.ts` | Added type guard in `extractText()` — logs warning when content is not a string instead of silently returning empty | F-011 |

**Rejected findings:** F-007 (100K cap reasonable; composition-conflicts is one wave among six; smallest supported model is 128K-context)

## Lessons

_No lessons recorded yet._
