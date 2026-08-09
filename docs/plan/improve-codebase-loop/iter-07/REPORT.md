# Iteration 7 — Findings Report (Full Unrestricted Independent Review)

Date: 2026-08-09
Reviewer: gilfoyle-code-review-lean (MINIMAL, non-restricting prompt — no lens,
no tool cap, no finding-count cap, no steering)
Scope: whole codebase, free-form. This pass was requested because prior
constrained passes (lens + caps) may have suppressed findings.

## Result

The unrestricted review surfaced ONE genuine new finding — Finding 1 below —
that all five constrained/lensed passes (module, flow-trace, data-flow,
robustness, invariants) missed. This validates that the earlier caps/lenses
were partially suppressing findings. The remaining claimed findings were
corroborated and rejected (factually wrong) or carried as Low/Nit.

### Accepted & Remediated

### L1 — High, High confidence — loop detection false-positives on unchanged documents (REGRESSION-CLASS BUG)

`src/core/analyzer.ts` (`detectLoops`, `convertResultsToRecommendations`)

- `detectLoops` compared current findings against stored history via
  `issueHash`/`message` similarity but never consulted the stored
  `lastFingerprint`. `convertResultsToRecommendations` keys both `relevantText`
  and `issueHash` on `r.message` (identical for deterministic findings every
  run). So re-analyzing a byte-identical unchanged document reproduced the same
  deterministic findings → `exactMatches`/`similarMatches` exceeded the ratio →
  false `llm-loop-detected` warning on stable code that was merely re-reviewed.
- **Fix:** `detectLoops` now takes the current document fingerprint and returns
  "no loop" immediately when the document is unchanged since the last record
  (`history.lastFingerprint === currentFingerprint`). Loop detection now fires
  only on genuine non-convergence: the document CHANGED (remediation happened)
  yet the same findings recur.
- **Tests:** Rewrote the conflicting end-to-end test. New behavior asserted:
  unchanged doc + identical findings → NO loop; changed doc + same finding
  recurs → loop. Updated direct `detectLoops` unit-test calls for the new arg.
- **Confidence:** High. Corroborated by reading the full loop-detection flow;
  `lastFingerprint` is stored (`recordAnalysisHistory`) but was never consulted.

### Recorded, not remediated

### L2 — Low/Nit, Medium confidence — `fetchWithRetry` re-sleeps backoff on `attempt--`

`src/providers/externalProvider.ts:133-176`

- The structured-output retry does `attempt--` then re-sleeps the same backoff
  steps an extra time. Bounded by `maxTotalAttempts` and non-correctness
  (just extra sleeps). Reviewer said "Minor." Carried.

### L3 — Low, Medium confidence — tmp debug log file TOCTOU on a well-known name

`src/extension.ts:112-117`

- `os.tmpdir()/skills-review-debug-<pid>.log` in a world-writable dir; the
  `0o600` init could race a pre-created symlink/file on PID reuse. Hardening
  nit, very unlikely in practice. Carried.

### Rejected after corroboration (reviewer claims factually wrong)

- **L4 (Medium)** accepted-findings raw-vs-normalized mismatch — `isFindingAccepted`
  normalizes the STORED pattern too, so both sides are reconciled at match.
- **L5 (Medium)** budget double-counts self-critique — `estimateFixWaveCount`
  uses OR (`fixSelfCritique || additive` → 1) and the fixer runs self-critique
  once; estimator and fixer agree.
- **L6 (Medium)** env-override splits trust boundary — both the store and
  containment use the same `resolveWorkspaceRoot()`; they agree by design.

## Cross-file consistency confirmed sound

- `safeResolveFilePath` canonical-to-canonical shared by both doors.
- `validateKeyForProvider` accept-list enforced at store + send time.
- `estimateWaveCount`/`estimateFixWaveCount` shared by both doors.
- `MAX_TEXT_LENGTH` (MCP) == `DEFAULT_DOCUMENT_CHARS` == 200K, mirrored by
  `maxTextLengthForContext`.

## Verification (post L1 fix)

- `npm run compile` — PASS
- `npx vitest run --config tests/vitest.config.ts` — 645 passed, 16 skipped
- `npm run lint` — 0 errors (6 pre-existing warnings)
- `npm run lint:md` — 0 errors

## Artifact trail

- **Modified:** `src/core/analyzer.ts` (detectLoops fingerprint guard +
  signature; convertResultsToRecommendations unchanged), `src/core/analyzer.test.ts`
  (rewrote conflicting E2E test, updated direct calls),
  `docs/plan/improve-codebase-loop/iter-05/REPORT.md` + `iter-06/REPORT.md`
  (trailing-newline lint fix)
- **Symbols changed:** `detectLoops`, `analyze` (pipeline call site)
