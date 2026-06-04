# Enhancement Plan — Control-Flow Refactor & Coverage Lift

## Goal

Make the non-UI core path easier to reason about, test, and extend by splitting the currently coupled control-flow into small, deterministic helpers.

## Why this matters

The current branch-heavy paths in the fixer and provider modules are mostly simple `if` / ternary logic, but they are tightly interleaved with UI, LLM, and fallback behavior. That makes the uncovered paths harder to exercise cleanly.

## Planned work

1. Extract small helper functions for the fixer pipeline:
   - anchor resolution
   - fix request construction
   - guard evaluation / rejection reasons
2. Extract small helper functions for the LM provider pipeline:
   - model selection
   - pricing validation
   - streamed response handling
3. Add focused tests for the new helper boundaries and the previously uncovered fallback branches.
4. Re-run the deterministic suite and coverage snapshot to confirm the refactor is behavior-preserving.

## Progress tracking

- [x] Identify the branch-heavy paths to target
- [x] Extract fixer helper boundaries
- [x] Extract provider helper boundaries
- [x] Add focused fallback-path tests
- [x] Verify tests + coverage impact

## Definition of done

- The core logic still passes the existing deterministic suite.
- The refactor introduces no behavior change beyond better testability.
- The next uncovered branches are easier to target with focused tests.
