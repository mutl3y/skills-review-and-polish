# Gilfoyle Remediation — Fresh Review (2026-06-09)

**Source:** `GILFOYLE-REVIEW-FRESH.md`
**Total Issues:** 23 (1 Critical, 4 High, 9 Medium, 6 Low, 3 Nit)
**Regressions from prior fixes:** None

---

## Wave 1 — Critical and High (5 issues)

| Number | Severity | Issue | File | Fix |
| --- | --- | --- | --- | --- |
| 1 | Critical | Static analysisHistory shared across imports | src/core/analyzer.ts | Injectable AnalysisHistoryStore |
| 2 | High | copilotPricing.ts dead code | src/copilotPricing.ts | Delete file |
| 3 | High | fixStrategy improved declared but never handled | src/core/types.ts | Remove from union type |
| 4 | High | enabledWaves parsed but never used to filter | src/config.ts, src/core/analyzer.ts | Filter phases array against config |
| 5 | High | readLinkedPromptFiles uses sync I/O in async path | src/core/analyzer.ts | Convert to fs.promises |

## Wave 2 — Medium (9 issues)

| Number | Severity | Issue | File | Fix |
| --- | --- | --- | --- | --- |
| 6 | Medium | test-api-inspection.ts debug-only file in bundle | src/extension.ts | Remove import and command registration |
| 7 | Medium | findTextRange first-match-only for ambiguous text | src/core/analyzer.ts | Add hintLine parameter |
| 8 | Medium | scoreSkill defeats exhaustiveness checking | src/core/scoring.ts | Use proper switch or typed Record |
| 9 | Medium | configHash uses last-4-chars API key discriminator | src/extension.ts | Use SHA-256 hash of full key |
| 10 | Medium | salvageTruncatedJSON needs edge-case test coverage | src/core/analyzer.ts | Add test cases |
| 11 | Medium | extensionContext could be undefined during early buildEngine | src/extension.ts | Accept as parameter |
| 12 | Medium | DEFAULT_ACCEPTED_FINDINGS_PATH falls back to home | src/core/acceptedFindings.ts | Ensure callers pass explicit path |
| 13 | Medium | runFixIssue no staleness check vs modified document | src/extension.ts | Add staleness detection |
| 14 | Medium | Debounce timer not cancelled safely on deactivate | src/extension.ts | Add disposed flag |

## Wave 3 — Low and Nit (9 issues)

| Number | Severity | Issue | File | Fix |
| --- | --- | --- | --- | --- |
| 15 | Low | loadReferenceGrounding redundant double-check | src/core/fixer.ts | Clarify comment |
| 16 | Low | OBLIGATION_TOKENS belongs in shared constants | src/core/fixer.ts | Deferred |
| 17 | Low | Hover MarkdownString has isTrusted true | src/ui/hover.ts | Set to false |
| 18 | Low | fixPreviewContent never cleaned on forced reload | src/extension.ts | Add MAX_AGE_MS eviction |
| 19 | Low | COGNITIVE_DOWNGRADE_CODES incomplete | src/core/types.ts | Add missing codes |
| 20 | Low | runAnalyzeFolder picks up non-customization files | src/extension.ts | Apply isCustomizationPath filter |
| 21 | Nit | Inconsistent log vs createLogger patterns | src/extension.ts | Migrate to structured logger |
| 22 | Nit | normalizeModelName vs copilotPricing inconsistency | src/pricing.ts | Addressed by deletion |
| 23 | Nit | MAX_COMPOSED_SIZE undocumented magic number | src/core/analyzer.ts | Add rationale comment |

---

## Execution Status

- [x] Wave 1 — Critical and High (5 issues)
- [x] Wave 2 — Medium (9 issues)
- [x] Wave 3 — Low and Nit (9 issues)

## Delegation

| Wave | Agent | Tasks |
| --- | --- | --- |
| 1 | gem-implementer | 1 through 5 (Critical plus High) |
| 2 | gem-reviewer | Review Wave 1 fixes |
| 3 | gem-implementer | 6 through 14 (Medium) |
| 4 | gem-reviewer | Review Wave 2 fixes |
| 5 | gem-implementer | 15 through 23 (Low plus Nit) |
| 6 | gem-critic | Final Gilfoyle re-review |
