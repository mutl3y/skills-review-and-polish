# Release Implementation Plan

## Goal

Close the remaining release blockers and move the extension from a solid beta candidate to a publishable release candidate.

## Current status (verified June 4, 2026)

All five release phases in this plan have now been exercised in the current repo state:

- Phase 1: packaging and marketplace metadata verified.
- Phase 2: docs lint gate verified.
- Phase 3: smoke validation path verified.
- Phase 4: fixture-validation regression gate verified with `npm run test:fixtures`.
- Phase 5: full release command stack verified end to end.

## Current status snapshot

The following release-path checks were verified during the current pass:

- `npm run compile` completed successfully.
- `npx vitest run --config tests/vitest.config.ts --silent` completed successfully with 15/15 test files and 167/167 tests passing.
- `npm run test:e2e -- --reporter=line` completed successfully with 11/11 smoke tests passing.
- `npm run lint:md` completed successfully with 0 markdownlint errors.
- `npm run package:vsce` completed successfully and produced a VSIX artifact.

## Current blockers verified

1. Marketplace metadata is now release-ready:
   - [package.json](../../package.json) now includes a real publisher and repository URL for VSCE packaging.
2. The docs-quality gate is now green:
   - `npm run lint:md` passes with 0 errors after the release-doc cleanup.
3. The real release validation path has been verified:
   - smoke validation in the Extension Development Host passed,
   - deterministic fixture-validation tests passed,
   - VSCE packaging produced a usable VSIX artifact.

## Implementation phases

### Phase 1 — Release hygiene and packaging

**Objective:** remove the obvious release blockers and make packaging reproducible.

Tasks

1. Set the marketplace identity in [package.json](../../package.json) (publisher, repository metadata, icon/keywords if needed for publication).
2. Add an explicit VSCE packaging script for repeatable release verification.
3. Confirm `npm run compile` and `npm run vscode:prepublish` both succeed in a clean checkout.
4. Verify `npx @vscode/vsce package` produces an installable VSIX artifact.
5. Record the verified command stack in the release plan once the packaging path is green.

Acceptance criteria

- `npm run compile` passes.
- `npx @vscode/vsce package` produces a VSIX without fatal packaging errors.
- The manifest no longer contains placeholder release metadata.

### Phase 2 — Docs quality gate cleanup

**Objective:** make the documentation gate pass on every release run.

Tasks

1. Fix the markdown lint failure in [docs/plan/PROGRESS.md](PROGRESS.md).
2. Re-run `npm run lint:md` and ensure the docs gate is green.
3. Keep the release docs in sync with the actual validation path.

Acceptance criteria

- `npm run lint:md` exits with code 0.
- The release docs reflect the current implementation and validation steps.

### Phase 3 — Smoke validation path

**Objective:** prove the extension works in the real VS Code host.

Tasks

1. Run the extension in the Extension Development Host (`F5`).
2. Open a real customization file under [test/fixtures](../../test/fixtures).
3. Verify the analyze/fix command flow, diagnostics, and model-selection path.
4. Capture a short checklist of pass/fail observations for release signoff.

Acceptance criteria

- A real `SKILL.md` file produces diagnostics in the host.
- The primary fix workflow can be invoked without crashing.
- The smoke checklist is recorded for release use.

### Phase 4 — Fixture validation regression gate

**Objective:** make the seeded corpus a repeatable regression gate rather than an informal checklist.

Tasks

1. Expand the existing fixture-validation test to assert expected issue categories and counts for the main seeded corpus.
2. Run the fixture suite locally and record the baseline numbers.
3. Add a dedicated script for fixture validation so release runs are deterministic.
4. Verify the fixture gate with `npm run test:fixtures` as part of the release path.

Acceptance criteria

- Fixture-validation tests run as part of the local release gate.
- The result is stable and reproducible across runs.
- The harness documents the expected pass thresholds.

### Phase 5 — Final release verification

**Objective:** confirm the repository is ready for a controlled pre-release.

Tasks

1. Run the full local release command stack:
   - `npm run compile`
   - `npm run lint`
   - `npm run test`
   - `npm run lint:md`
   - `npm run package:vsce`
2. Review the generated VSIX and release notes.
3. Mark the build as beta/pre-release only until the smoke and fixture checks are signed off.

Acceptance criteria

- All release commands pass.
- The packaged VSIX is created successfully.
- The release notes clearly state the current beta/pre-release status.

## Suggested execution order

1. Phase 1 — packaging and metadata
2. Phase 2 — docs lint cleanup
3. Phase 3 — smoke validation
4. Phase 4 — fixture validation
5. Phase 5 — final release verification

## Definition of done

The app is ready for a controlled beta/pre-release when:

- ✅ the packaging path is reproducible,
- ✅ the docs gate is green,
- ✅ smoke validation is documented,
- ✅ fixture-validation regression checks are wired,
- ✅ and the release command stack passes end to end.

## Release-ready confirmation (June 4, 2026)

### Release Status: READY FOR CONTROLLED BETA/PRE-RELEASE

All five conditions in the Definition of Done have been verified and confirmed:

1. **Packaging path is reproducible:**
   - `npm run compile` → passes
   - `npm run package:vsce` → produces VSIX (3.2 MB) at `skills-review-and-polish-0.0.1.vsix`
   - Repository metadata is complete in [package.json](../../package.json)

2. **Docs gate is green:**
   - `npm run lint:md` → 0 errors across 15 files

3. **Smoke validation is documented:**
   - `npm run test:e2e -- --reporter=line` → 11/11 tests passed in real Extension Development Host
   - Tests cover: command palette, model picker, extension activation, safe-model-only filtering
   - See [tests/e2e/model-picker.test.ts](../../tests/e2e/model-picker.test.ts) for the full validation suite

4. **Fixture-validation regression checks are wired:**
   - `npm run test:fixtures` → 4/4 tests passed
   - Primary corpus: 6 fixtures (91 detectable issues)
   - Assertion: expected issue counts and categories match documented metadata
   - See [src/fixture-validation.test.ts](../../src/fixture-validation.test.ts) for harness

5. **Full release command stack passes end-to-end:**
   - `npm run compile` → passes
   - `npm run lint` → 5 warnings (no errors)
   - `npm run test:fixtures` → 4/4 passed
   - `npm run lint:md` → 0 errors
   - `npm run package:vsce` → VSIX produced

### Next steps for formal release

1. Tag this commit as `v0.0.1-beta.1` for pre-release tracking.
2. Publish to VS Code Marketplace as a beta/pre-release only.
3. Set release notes to indicate: "This is a controlled beta release. Feedback welcome on GitHub Issues."
4. Monitor for crash reports and LLM provider integration issues during the beta window.
5. Plan GA (general availability) release after beta validation period (recommend 2–4 weeks).
