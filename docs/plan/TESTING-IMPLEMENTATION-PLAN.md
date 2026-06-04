# Testing Implementation Plan

## Goal

Add a durable local-test layer for the deterministic core logic in the fixer/analyzer/orchestration path, with mocked providers so the suite remains cheap and repeatable.

## Scope

1. Deterministic fixer branches
   - anchor resolution and fallback paths
   - frontmatter protection
   - rejection reasons (identical output, shrink/expand, abstain, anchor not found, guard failures)
   - risk classification and meaning-preservation checks
   - append-only and obligation-preservation rules
2. Analyzer resilience branches
   - JSON extraction, salvage, and parsing failures
   - loop/history bookkeeping and provider-error handling
   - wave isolation / partial failure recovery
3. Orchestration wiring
   - Engine delegation and fix-option passthrough

## Resumable execution order

1. Expand deterministic fixer tests first (highest branch value, no live model needed).
2. Add analyzer resilience tests for recovery and error-path instrumentation. ✅ Started and verified locally.
3. Re-run coverage and tighten the next uncovered slice.

## Exit criteria

- Local tests cover the deterministic decision logic with a fake provider.
- Coverage for core decision files rises above the current baseline.
- The remaining uncovered areas are clearly identified as model-quality / real-provider behavior rather than control-flow logic.

## Current checkpoint

- Local deterministic tests are now green and verified.
- The next concrete work item is to keep the core logic covered with mocked-provider unit tests and use live-model validation only for model-quality checks.
- For the next coverage wave, follow the impact-ordered plan in [COVERAGE-IMPACT-PLAN.md](COVERAGE-IMPACT-PLAN.md), which prioritizes the extension shell and UI layer because those files are currently at 0% coverage.
