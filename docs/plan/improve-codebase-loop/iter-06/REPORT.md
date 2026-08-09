# Iteration 6 — Findings Report (Invariants / First-Principles Pass)

Date: 2026-08-09
Reviewer: gilfoyle-code-review-lean (5th lens — invariants / first-principles
of the shared `src/core/*` modules; different prompt from prior four passes)
Scope: verify each shared module upholds its documented contract, and that both
doors consume it without local reimplementation

## Findings

### All findings below the stop threshold

### K1 — Medium/High claim, REJECTED (factually wrong) — acceptedFindings floor mismatch

`src/core/acceptedFindings.ts` (`validateRelevantText` vs `isFindingAccepted`)

- Reviewer claimed a 5-char acceptance passes the write gate but is skipped by
  the match gate, making it a permanent silent no-op. Reading the actual code:
  - write gate: `if (trimmed.length < MIN_RELEVANT_TEXT_LENGTH) throw` with
    `MIN_RELEVANT_TEXT_LENGTH = 5` → length ≥ 5 passes
  - match gate: `if (pattern.length < 5) return false` → length ≥ 5 proceeds
    to `includes`
  - `normalize()` preserves length (lowercase + whitespace-collapse only)
  Both floors are aligned at 5; `normalize` doesn't change length. The claimed
  asymmetry does not exist. The reviewer's finding is factually wrong (same
  error class as iter-2's G3). Rejected with reason — all evidence cited.

### K2 — Low, Medium confidence — `chargeTokens` is fail-open at the module boundary

`src/core/sessionBudget.ts`

- The doc calls it a "hard cap," but `chargeTokens` increments past the cap and
  returns — the caller must check the return. The reviewer concedes the code
  honors its documented *worded* semantics ("when the charge would exceed the
  cap, the budget is still incremented so usedTokens stays honest"); it's a
  doc/design nuance, not a defect. Both doors gate on `budgetExhausted()`/
  `reserveTokens` first, so real spend is capped. Carried, Low.

### K3 — Low, Medium confidence — `pathSafety` realpaths the root only on the `requireExists=true` branch

`src/core/pathSafety.ts`

- For non-existent store-key paths (`requireExists=false`), the lexical
  `isPathWithin` prefix check doesn't realpath the base, so a symlinked root
  could theoretically let a lexical `..` escape. Consistent across BOTH doors
  (not a divergence), and the requireExists=true read paths are canonical.
  Carried, Low.

## Confirmed sound (contracts upheld)

- **providerKeys:** accept-list semantic verified — rejects everything not
  matching the OpenRouter prefix; copilot case rejects `sk-or-v1-` and never
  sends off-provider. No finding.
- **redact:** ordering sound — labeled keys before unlabeled, `Bearer`
  case-insensitively, quoting rule first catches multiline secrets. No leak
  shape between overlapping regexes. Both doors consistent.
- **sessionBudget reserve-then-charge:** both doors gate before any LLM call and
  charge after; on over-cap, result returned and subsequent requests refused —
  matches documented semantics.
- **Shared-module migration:** both doors import the shared `src/core/*`
  modules; no local reimplementation found.

## Stop-rule status

No finding at or above the stop threshold (Medium). The independent verification
pass (5th distinct lens) found nothing that warrants remediation at Medium+.
Two Low findings (K2, K3) remain carried. Per the loop's stop rule, this
satisfies convergence — pending the lower-threshold question to the user.

## Verification

No code changed this iteration — this was a review-only pass. Prior verified
state (iter-5): compile PASS, 644 tests PASS, lint 0 errors, md lint 0 errors.

## Artifact trail

- **Read (no writes):** `src/core/acceptedFindings.ts`, `src/core/sessionBudget.ts`,
  `src/core/pathSafety.ts`, `src/core/providerKeys.ts`, `src/core/redact.ts`
- **No symbols changed** this iteration.
