# Plan: Docs Hygiene & Gilfoyle Review — 2026-06-09

**Plan ID:** `20260609-docs-hygiene-and-gilfoyle-review`
**Status:** Complete
**Created:** June 9, 2026
**Author:** gem-planner

---

## Objective

Archive completed plan files, update documentation, run a fresh Gilfoyle code review, and address all findings in severity-ordered waves.

## Waves Overview

| Wave | Name | Tasks | Agent | Dependencies |
| --- | --- | --- | --- | --- |
| 1 | Archive and Documentation | 4 | implementer, doc-writer | None |
| 2 | Gilfoyle Code Review | 1 | critic | Wave 1 |
| 3 | Critical and High Fixes | 2 | implementer, reviewer | Wave 2 |
| 4 | Medium and Low Fixes | 1 | implementer | Wave 3 |
| 5 | Verification | 3 | implementer, critic | Wave 4 |

## Wave Details

### Wave 1: Archive and Documentation

1. Move completed plans to `docs/plan/archive/` (3 subdirectories)
2. Determine status of `GILFOYLE-REMEDIATION.md` (30 issues, status unclear)
3. Update `AGENTS.md`, `docs/plan/README.md`, `docs/plan/PROGRESS.md`
4. Verify compilation and tests still pass

### Wave 2: Gilfoyle Code Review

- Fresh review of entire codebase
- Output: `GILFOYLE-REVIEW-FRESH.md`
- Cross-reference with prior reviews for regressions

### Wave 3: Critical and High Fixes

- Fix all Critical and High severity issues from fresh review
- Review fixes with gem-reviewer
- Full test suite verification

### Wave 4: Medium and Low Fixes

- Fix all Medium and Low/Nit severity issues
- No new tests required for Nit fixes

### Wave 5: Verification

- Run full test suite (compile, lint, vitest, e2e)
- Re-run Gilfoyle review to confirm all fixes effective
- Final documentation update with results

## Archive Structure

```text
docs/plan/archive/
+-- gilfoyle-reviews/
|   +-- GILFOYLE-REVIEW-2026-06-09.md
|   +-- GILFOYLE-FIXES-ITERATION.md
|   +-- GILFOYLE-REVIEW-FIXES.md
|   +-- GILFOYLE-REMEDIATION.md
|   +-- 20260609-gilfoyle-full-remediation/
|   +-- 20260609-gilfoyle-review-remediation/
|   +-- 20260609-gilfoyle-remediation/
+-- releases/
|   +-- RELEASE-IMPLEMENTATION-PLAN.md
+-- infrastructure/
    +-- MCP-IMPROVEMENT-PLAN.md
```

## Files Updated by This Plan

| File | Change |
| --- | --- |
| `AGENTS.md` | Expanded from 2-line stub to full conventions doc |
| `docs/plan/README.md` | Archive section plus updated document table |
| `docs/plan/PROGRESS.md` | June 9 status update |
| `docs/CHANGELOG.md` | Maintenance cycle entry |
| `docs/DEVELOPER-GUIDE.md` | Updated directory tree and cross-references |

## Success Criteria

- [x] All 9 completed plans archived in structured directories
- [x] `AGENTS.md` expanded with project conventions
- [x] `docs/plan/README.md` updated with archive section
- [x] `docs/plan/PROGRESS.md` reflects June 9 state
- [x] Fresh Gilfoyle review completed (23 issues found)
- [x] All Critical/High issues fixed and verified (5 issues)
- [x] All Medium/Low issues addressed (16 issues, 2 deferred)
- [x] Full test suite passes (compile plus 335/335 tests plus lint)
- [x] Documentation final and consistent

## Results Summary

| Metric | Before | After |
| --- | --- | --- |
| Plans in docs/plan/ | 11 files | 4 files (9 archived) |
| AGENTS.md lines | 2 lines | 30+ lines |
| Critical issues | 1 | 0 |
| High issues | 4 | 0 |
| Medium issues | 9 | 0 |
| Low/Nit issues | 9 | 2 deferred |
| Test count | 299 | 335 |
