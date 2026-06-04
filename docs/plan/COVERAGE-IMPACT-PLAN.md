# Coverage Impact Plan

## Goal

## Progress update (June 4, 2026)

The two release-gate checks now have real local coverage in the deterministic suite:

- Smoke-validation path: activation wiring now explicitly covers the disabled-extension branch in [src/extension-shell.test.ts](../../src/extension-shell.test.ts), and the extension activation path now exits early when `skillsReviewAndPolish.enable` is false in [src/extension.ts](../../src/extension.ts).
- Fixture-validation path: a seeded-corpus regression test now verifies the fixture inventory and metadata contract in [src/fixture-validation.test.ts](../../src/fixture-validation.test.ts).

These two additions are the first concrete gates for the release-readiness checklist and should be kept as part of the standard test run.

Prioritize the next tests by real coverage value, not by UI churn. The current deterministic suite is already strong in the core analyzer/fixer/provider path, so the highest-return work is now the extension shell and UI layer that users actually interact with.

## Current baseline (verified)

The latest local coverage run reported:

- Statements: 58.09%
- Branches: 53.76%
- Functions: 64.09%
- Lines: 58.71%

The biggest uncovered areas are:

- src/extension.ts: 0% coverage
- src/ui/: 0% coverage
- src/core/analyzer.ts and src/core/fixer.ts: already covered, but still valuable for regression guards
- src/providers/: already healthy at ~91% coverage

## Impact order

### P0 — Extension shell and command wiring (highest leverage)

These paths control the real user entry points, so they are the best next coverage targets.

1. Activation and command registration
   - Verify the extension activates without crashing.
   - Confirm the command palette, status bar, and model-selection commands register.
   - Cover the no-op / early-exit branches when analysis is disabled or no document is open.

2. Analyze / rescan / fix-all / fix-issue command flow
   - Happy path: analyze a real customization document and publish diagnostics.
   - Error path: provider failure, parser failure, and empty/invalid fix payloads.
   - Guard path: skip fixes when the result is not fixable or cannot be applied safely.

3. Model-selection flow
   - Select Analysis Model and Select Fix Model.
   - Safe-tier model listing and expensive-model warnings.
   - Validation / fallback behavior when the selected model is unavailable.

Why this is first:

- It covers the highest-risk user-facing surface.
- It has the biggest blind spots in the current suite.
- It improves confidence in the commands people actually click.

### P1 — UI diagnostics and actions (highest user-value ROI)

These are small, isolated helpers with strong payoff.

1. Diagnostics publishing
   - Severity mapping: error / warning / info / hint.
   - Override handling: severity override and 'off'.
   - Attaching AnalysisResult data to diagnostics for quick-fix and hover access.

2. Code actions
   - Return quick-fix actions only for Skills Review diagnostics.
   - Return ignore-rule actions for diagnostic codes.
   - Ensure fix commands are wired with the correct diagnostic payload.

3. CodeLens and status bar
   - Update / clear behavior for score and issue count.
   - Issue-count label formatting for 0 / 1 / many issues.
   - Idle / analyzing / error / result states.

4. Hover content
   - Show suggestion text from attached result data.
   - Fall back to message parsing when the result payload is missing.

Why this is second:

- These helpers are cheap to test with mocked VS Code APIs.
- They directly protect the visible feedback loop around diagnostics and fixes.

### P2 — Experimental inline rewrite path

This is important but lower priority because it is gated and only runs when the setting is enabled.

1. Provider creation and gating
   - Return no items when the setting is off.
   - Return no items when there are no diagnostics at the cursor.
   - Return no items when the code is not fixable.

2. Fix preview path
   - Accept only valid surgical fixes.
   - Short-circuit when the anchor text is missing or the fix result is rejected.

Why this is third:

- It is valuable, but its risk is narrower than the main command/UI path.

### P3 — Fixture and real-model validation

Keep real-model validation as a small smoke surface, not the main coverage engine.

1. Run the existing fixture corpus against the analyzer.
2. Verify the real extension shell on a real SKILL.md file in VS Code Web.
3. Use these as smoke/regression checks after core logic changes.

Why this is last:

- It is slower and more environment-dependent.
- It should validate behavior after the deterministic local coverage is already stable.

## Proposed test buckets

1. tests/unit/extension-shell.test.ts
   - command registration, activation, analyze/fix model flow, error handling

2. tests/unit/ui-diagnostics.test.ts
   - publishDiagnostics, severity overrides, stored result metadata

3. tests/unit/ui-actions-and-hovers.test.ts
   - CodeActionProvider, CodeLens, HoverProvider, status bar state changes

4. tests/unit/inline-rewrites.test.ts
   - experimental provider gating and fix preview short-circuit paths

## Success criteria

- The extension shell and UI layer move from 0% to a meaningful, explicit test baseline.
- Core regression tests continue to pass unchanged.
- New tests prioritize real user flows over low-value mocks or snapshot-only assertions.

## Recommended execution order

1. P0 extension shell and command wiring
2. P1 diagnostics / actions / hovers / CodeLens / status bar
3. P2 experimental inline rewrites
4. P3 fixture and real-model smoke validation
