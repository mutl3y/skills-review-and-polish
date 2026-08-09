# Improvement Loop State — skills-review-and-polish

**Updated:** 2026-08-09
**Reviewer (main + independent):** Gilfoyle Code Review Mode Original

## Current Status

**Iteration:** Independent-pass remediation (unguided review)
**Next action:** Tighten the independent-review contract in the skill; verify; commit
**In-progress work:** None

## Process correction (important)

Prior independent passes were INVALID: they were self-guided checklists ("verify F-008, F-010, F-011") that confirmed my own fixes rather than independently reviewing. Per `practice.md` Step 1, the independent pass must use a DIFFERENT prompt than the loop reviewer and must NOT be steered toward a verdict.

The corrected independent pass used an unguided, no-cap review prompt. It returned 8 findings. The strongest were genuinely new and contradicted earlier assumptions.

---

## GENUINE independent review findings (unguided, no cap)

| ID | Sev | Conf | File | Description | Status |
|----|-----|------|------|-------------|--------|
| F-101 | Medium | High | `src/core/providerKeys.ts:48` | `validateKeyForProvider('copilot')` is a reject-list (only rejects sk-or-v1-), not an accept-list. Private OpenAI/Google/AWS/arbitrary keys pass and get shipped as Bearer tokens to api.githubcopilot.com. Breaks the module's own stated guarantee. | **REMEDIATED** — Copilot case now accepts only `ghp_/ghu_/ghs_/gho_/ghr_/github_pat_`; tests expanded |
| F-102 | Medium | Med-High | `analyzer.ts buildAnalysisDocument` vs `sessionBudget.ts chargeTokens` | Session budget charges `text.length` only, ignoring reference files the analyzer composes into the LLM input. Reference-heavy skills under-reserve the guard. | **DEFERRED (recorded)** — Requires plumbing composed input size through `Engine.analyze` return (affects CLI/MCP/ext/tests). Larger refactor; tracked for a future iteration. |
| F-103 | Low | Medium | `src/modelCatalog.ts copilotCacheFile` | SHA256(API key) prefix in world-readable `/tmp` filename; 64-bit deterministic fingerprint of a structured, low-entropy token is a weak side channel; justification overstates entropy. | **RECORDED** — Salted cache ID would break offline-cache design; accepted known limitation, documented. |
| F-104 | Low | High | `src/extension.ts FixToolInput` | LM `fix` tool can't disambiguate duplicate anchors (no `line` param), while MCP `fix` tool can. Cross-door inconsistency defeats the shared-helper refactor. | **REMEDIATED** — Added `line?: number` to `FixToolInput`, passed to `validateFixAnchor` and `fixIssue`, mirroring MCP. |
| F-105 | Low | Medium | `src/core/fixer.ts loadReferenceGrounding` | Cache key ignores `budgetChars`; a later larger-budget call returns earlier truncated content until dir mtime changes. | **REMEDIATED** — `budgetChars` folded into cache key. |
| F-106 | Low | Medium | `analyzer.ts sendLLMRequestWithFinishRetry` | deep→standard + same-tier retry reuse stale `disableStructuredOutput`; only finish-retry recomputes it. Latent trap. | **REMEDIATED** — Recomputed once as `effectiveDisableStructuredOutput`, used in all 3 branches. |
| F-107 | Nit | Medium | `waveCount.ts estimateFixWaveCount` | Over-reserves self-critique when edit adds no auditable content. Safe direction (over-reserve). | **RECORDED** — Safe skew, not a spend leak. |
| F-108 | Nit | High | `mcp/server.ts MIN_DOCUMENT_CHARS` | Hardcoded 8_000 "mirrors Analyzer" duplicate — exactly the drift the shared-constant refactor eliminates. | **REMEDIATED** — Moved `MIN_DOCUMENT_CHARS` to `tokenBudget.ts`, imported by analyzer + MCP server. |

## Prior iterations (for the record — earlier iterations' fixes remain valid)

- F-004/F-005/F-006 (iter-01): removed vscode require from core, expanded JSON repair, documented cache security.
- F-008/F-010/F-011 (iter-03): rate limiter on MCP tools, config error swallowing, extractText type guard (later superseded by F-101 structured content handling).
- F-103/F-105 (early iter-05): cycle detection optimization, cache key hash.

## Artifact Trail (this pass)

| File | Change |
|------|--------|
| `src/core/providerKeys.ts` | Copilot case is now a genuine accept-list (GitHub token shapes) |
| `src/core/providerKeys.test.ts` | Added accept/reject cases incl. private keys, AIza, arbitrary strings |
| `src/core/tokenBudget.ts` | Added `MIN_DOCUMENT_CHARS` shared constant |
| `src/core/analyzer.ts` | Import shared `MIN_DOCUMENT_CHARS`; recompute structured-output flag once (`effectiveDisableStructuredOutput`) |
| `src/mcp/server.ts` | Import shared `MIN_DOCUMENT_CHARS` (removed duplicate) |
| `src/core/fixer.ts` | Grounding cache key includes `budgetChars` |
| `src/extension.ts` | `FixToolInput.line?` passed to validateFixAnchor + fixIssue |

## Lessons (append-only)

1. **Independent pass must be unguided and uncapped** — self-verification checklists are not independence and produce false convergence.
2. **A "shared constant" module only works if every "mirrors X" comment is eliminated** — F-108 was the exact drift pattern the module exists to prevent.
3. **Accept-lists must actually enumerate accepted shapes**, not reject one known bad one.
4. When a fix requires changing a public return shape across many callers, defer + record rather than force an unsafe mid-loop refactor.
