# Learnings — carried over from the source project

> Hard-won lessons from building/tuning the analyzer + surgical fixer in
> `vscode-chat-customizations-evaluation`. Copied here so the new project keeps
> them even without access to saved memories. **Read before changing scoring,
> the fixer, or the analyzer prompts.**

## Table of contents

- **[Priority list](#priority-list)** — read this first
- [The single most important fact: the noise floor is ±6](#the-single-most-important-fact-the-noise-floor-is-6)
- [Model choice: gpt-4.1 stays as the analyzer](#model-choice-gpt-41-stays-as-the-analyzer)
- [Surgical fixer: what's safe and what's not](#surgical-fixer-whats-safe-and-whats-not)
- [Fix QUALITY is the real bottleneck (detection is solved)](#fix-quality-is-the-real-bottleneck-detection-is-solved)
- [Autonomous --apply is NOT production-safe without HITL](#autonomous---apply-is-not-production-safe-without-hitl)
- [The risk classifier + dropped-detail flag](#the-risk-classifier--dropped-detail-flag)
- [Three-layer fix safety architecture (proven)](#three-layer-fix-safety-architecture-proven)
- [Determinism: pin params, rely on guards](#determinism-pin-params-rely-on-guards)
- [Process learnings](#process-learnings)
- [Playwright E2E test learnings (2026-06-27)](#playwright-e2e-test-learnings-2026-06-27)
- [Finding post-processor: deterministic suppression of LLM self-reference false positives](#finding-post-processor-deterministic-suppression-of-llm-self-reference-false-positives)
- [Pointer to experiment folder](#pointer-to-experiment-folder)
- [Never head/tail slice a document the analyzer is supposed to review in full](#never-headtail-slice-a-document-the-analyzer-is-supposed-to-review-in-full)
- [Adaptive response-token sizing needs two budgets, not one](#adaptive-response-token-sizing-needs-two-budgets-not-one)
- [Adaptive output budgeting is not the same as prompt-budgeting](#adaptive-output-budgeting-is-not-the-same-as-prompt-budgeting)
- [Calibration & noise sections (moved out)](#calibration--noise-sections-moved-out)

## Priority list

If you only read three things, read these — they are load-bearing for any
future prompt/analyzer work and the most common sources of regressions:

1. **The noise floor is ±6** (median-of-N at the scoring layer, not per-prompt
   gates). Never chase score gains below the margin.
2. **Never head/tail slice a document** the analyzer must review in full —
   the input budget must come from the model's context window, and slicing
   must drop whole files, never truncate mid-content.
3. **The finding post-processor is the only fix for finding variance** (not
   sample variance). Keep its rules conservative and rule-specific.
4. **Surgical-fixer safety rules** (YAML protection, 1.5× growth guard,
   anti-hallucination, penalty-revert safety net) are non-negotiable.

> Calibration-noise detail, the Gilfoyle review section, and the pricing-cache
> incident were moved to [`LEARNINGS-CALIBRATION.md`](./LEARNINGS-CALIBRATION.md)
> to keep this file navigable. They are coherent as a unit and only needed for
> calibration/noise-floor work.

## The single most important fact: the noise floor is ±6

- Scanning the SAME unchanged file 5× (gpt-4.1) gives penalties like 30/32/38/38/42. This is irreducible LLM variance even at temperature 0 / top_p 0.
- **Consequence:** a single before/after scan cannot reliably detect a fix worth < ~12 points. Do **not** chase small score gains — that's chasing randomness.
- Encoded as `PENALTY_NOISE_MARGIN = 6`. Keep/revert/converge only on changes beyond the margin.
- **The durable fix is median-of-N at the SCORING layer** (`medianTotalPenalty`, `SCORE_SAMPLES`), not changing the model or prompt. It's model/prompt-agnostic and doesn't suppress detection. Keep/revert SHOULD run `SCORE_SAMPLES >= 3` (N=1 is acceptable for cheap scans; default is 1 for efficiency, use 3+ for critical decisions). The deterministic retry/merge fix (v0.1.39) narrows the *observable range* of that variance to ±3 (10× probe: range 3 / 1 finding, 9 of 10 identical), but the per-sample ±6 floor still applies to each individual scan — median-of-N remains the durable fix, not the retry/merge path.

## Model choice: gpt-4.1 stays as the analyzer

- **Claude Haiku 4.5 was tested and REJECTED**: noisier and its detection count is erratic (6→22 issues on the same file vs gpt-4.1's tight 10–12).
- A severity rubric prompt was tested and **NOT shipped** (recalibrated harsher without clearly cutting noise).
- For the extension, the equivalent is: let `vscode.lm` pick a strong Copilot model (e.g. gpt-4.1 family) for analysis; allow override via the model settings.

## Surgical fixer: what's safe and what's not

- Per-diagnostic find-and-replace, `SURGICAL_FIXABLE_CODES` only. NOT whole-file rewrite.
- **Conservative wins:** 1.5× growth guard is empirically best; loosening to 2× regressed B-71→D-49. Also guard the 0.5× lower bound (a real bug deleted entire YAML frontmatter on a 786→140 "fix").
- **Always protect YAML frontmatter** — never let a fix touch name/description/keywords.
- **Anti-hallucination:** the system prompt must forbid inventing concrete values/names/URLs/versions (model invented fake `server1.example.com` otherwise).
- **Penalty-revert safety net** runs even on single-pass: measure penalty before/after, revert if worse beyond margin. The tool can never make a file worse — this was verified repeatedly (every penalty-raising pass reverted correctly).

## Fix QUALITY is the real bottleneck (detection is solved)

- Deletions (`hygiene-redundant-instruction`) are the reliably-positive fix (shrink text + remove issue).
- `ambiguity-llm` fixes ALWAYS expand the fragment (+20–40 chars) — making a vague qualifier concrete inherently adds words. On ambiguity-heavy skills with nothing to delete, cumulative inflation raises length/over-spec penalty → revert. Net flat.
- **Append-only ambiguity fixing is SAFETY, not YIELD.** Lifting the length cap did NOT convert expansion-rejects into applies — they moved to concept-swap/self-critique rejects. The length cap was a crude proxy for what the semantic guards catch properly. Append-only buys safety + a touch more consistency, not a yield breakthrough.

## Autonomous --apply is NOT production-safe without HITL

- Across 100 prod skills / 3 disjoint batches, the fixer's edits are overwhelmingly subtractive specificity-erosions the penalty model *rewards* but which are detrimental: numeric changes ("5-7 cases"→"5"), concept swaps ("edge cases"→"error cases"), dropped scope ("Scan ALL files"→"Scan files"), invented constraints, markdown structure corruption.
- Safe autonomous yield is only ~10–13% of skills; the rest need human review.
- **Therefore the extension MUST default to a human-in-the-loop fix UX** (diff/preview + per-edit accept), not silent auto-apply. This is a core product decision.

## The risk classifier + dropped-detail flag

- `classifyEditRisk` flags risky edits for HITL. The **dropped-detail flag** (net loss of meaningful content words, multiset counts, minus a filler allowlist) is the single biggest contributor — lifts gate coverage **68%→92%** with zero confirmed false negatives.
- Validate classifiers on a **disjoint batch** — the subtractive-deletion false-negative class only surfaced on batch 2.

## Three-layer fix safety architecture (proven)

1. **Mechanical guards** (deterministic): fence injection, line deletion, obligation-word drops, numeric change, concept swap.
2. **Heuristic filter** (pattern-based): skip the judge for safe cases, flag red flags. Should *reduce* judge calls, not prevent them.
3. **LLM judge** (semantic): validate flagged cases with a domain-aware prompt. Judge prompt wording matters hugely — "LEGITIMATE TIGHTENING?" → 20% rejection (usable); "preserve SAME meaning" → 100% rejection (useless). Obligation-preservation ≠ exact semantic equivalence.

## Determinism: pin params, rely on guards

- Pin temperature 0, top_p 0. The Copilot endpoint accepts `seed` but IGNORES it (hosted-MoE nondeterminism survives temp 0). Final on-disk output is byte-identical because the deterministic GUARDS make the accept/reject verdict reproducible — don't chase a "deterministic model." For reproducible generation you'd need a seed-capable endpoint (Azure/OpenAI direct).

## Wave architecture decision (benchmark)

- Wave **86% Jaccard** vs single-prompt **82%**; coverage detection 60% vs 33%. Cost ≈ 1.5–2× with prompt caching; parallel keeps latency comparable. **Keep multi-wave as the default.**

## Process learnings

- Always `npm run build && npm run lint` before testing.
- Fast unit-test harness (1s/test) beats full scans (15min) for iterating on the fixer/classifier — `test → improve → test` 1s cycle.
- A standalone analyzer test (no extension F5 reload) is the fastest debug loop.
- The POST-grade single-scan column is noisy and misleading on reverted runs — trust the median-of-3 penalty transitions, always diff the actual file bytes.

---

## Playwright E2E test learnings (2026-06-27)

> All 43 e2e tests were broken after re-capturing auth state. Root cause was a
> mismatch between the browser origin and the test origin. Key takeaways below.

### Auth state origin must match the test target URL exactly

- Playwright's `storageState` captures cookies with their **domain, secure flag, and origin**. Cookies set on `https://192.168.0.29:8550` will NOT be sent to `http://localhost:9200` — different domain, different protocol, different port.
- **Symptom:** Extension commands don't appear in the command palette. The extension loads (VS Code server serves it) but Copilot auth fails silently, so `vscode.lm.selectChatModels()` returns 0 models and the model picker closes immediately.
- **Fix:** Point tests at the same origin the browser uses. If your browser opens `https://192.168.0.29:8550`, the tests must too. Don't try to "fix" the storage-state file by editing domain/origin — the `secrets.provider` localStorage value is encrypted per-origin and won't decrypt on a different origin.
- **General principle:** When Playwright tests interact with authenticated web apps, the test `baseURL` must be byte-identical to the origin where auth was captured. Protocol, hostname, and port all matter.

### Centralize test URLs in one place

- The test URL was hardcoded in 6 files (4 test files + `capture-auth.ts` + `playwright.config.ts`). Changing it required editing all 6.
- **Fix:** Define `BASE_URL`, `TOKEN_FILE`, `FOLDER`, and `VSCODE_URL` in `setup.ts` and import them everywhere. One place to change.
- **General principle:** Any constant shared across test files belongs in a shared setup module. Hardcoded URLs in test files are a maintenance trap.

### The extension must be installed on the VS Code server, not just loaded via `extensionDevelopmentPath`

- VS Code's `extensionDevelopmentPath` (used by F5 debug) loads the extension from disk for the debug session only. The VS Code server process on a different port doesn't have it.
- **Symptom:** Same as auth failure — commands don't appear — but the cause is different. The extension simply isn't installed.
- **Fix:** Run `scripts/rebuild-ext.sh` to compile, package, and install the VSIX. The VS Code server auto-detects newly installed extensions.
- **General principle:** E2E tests run against the installed extension, not the dev-mode extension. Always install the VSIX before running Playwright tests.

### `OPENROUTER_API_KEY` must be sourced from `.bashrc` before running tests

- The key was added to `~/.bashrc` via `export`, but existing terminal sessions don't pick up new exports.
- **Fix:** `source ~/.bashrc && npm run test:e2e` in the terminal command. Or use a `.env` file with Playwright's `dotenv` support.
- **General principle:** Environment variables added to shell config files don't propagate to already-running shells. Always source or restart.

### The model picker only lists `vscode.lm` models — external providers need their own model list

- `selectModel()` calls `vscode.lm.selectChatModels()` which returns Copilot models only. Setting the provider to OpenRouter and storing an API key doesn't populate the picker.
- **Fix:** When `vscode.lm` returns 0 models and an external provider has an API key, fetch models from that provider's API (e.g., `GET /api/v1/models` for OpenRouter) and display them in the picker.
- **General principle:** The model picker and the analysis engine are separate concerns. The picker must independently discover available models regardless of which provider is configured for analysis.

---

## Finding post-processor: deterministic suppression of LLM self-reference false positives

> Added 2026-07-10. The ±6 noise floor describes *sample variance* (different
> calls produce different scores). A separate problem is *finding variance*:
> the same call surfaces findings that are not actually ambiguous when read in
> context. Median-of-N helps the score; it does not help the finding list.

### What we observed

Across all 6 waves, the LLM repeatedly flagged the same patterns on the
verify-documentation skill itself:

- The word `may` flagged as weak obligation, even though the fixer's
  `OBLIGATION_TOKENS` list in `src/core/fixer.ts` explicitly protects `may`
  as part of the deliberate vocabulary.
- `must not`, `may only` flagged as ambiguous, even though the file's own
  preamble defines these as the approved Requirement verbs.
- A 1-sentence Purpose flagged as non-actionable preamble, even though the
  hygiene prompt's own threshold is 2–3 sentences.
- A procedure section that uses `Step 1`, `Step 2`, ... flagged as having
  no numbered ordering, even though the headings are explicitly numbered.

These are not finding noise — the median across N=3 samples is the same
finding every time. The LLM is consistently misreading the rules. Median-of-N
does not help. The post-processor is the only fix.

### The fix

`src/core/findingFilter.ts` is a pure function that runs after the analyzer
and before the report. Each rule is a deterministic check that re-reads
the source document and either matches (suppress) or doesn't. No LLM calls,
no randomness. Source of authority for each rule is either `OBLIGATION_TOKENS`
in `src/core/fixer.ts` or the file's own preamble text.

- **Rule 1 — `severityOverrideRule`**: implements the existing
  `EngineConfig.severityOverrides` field. `'off'` suppresses; other values
  override severity. This was declared in `src/core/types.ts` but never
  wired into the finding pipeline before.
- **Rule 2 — `obligationTokenRule`**: suppresses `ambiguity-llm` whose
  flagged text contains only obligation/scope words from the protected
  vocabulary list. The fixer's `OBLIGATION_TOKENS` and `EMPHASIS_SCOPE_WORDS`
  lists are the source of authority.
- **Rule 3 — `requirementVerbRule`**: suppresses `ambiguity-llm` whose
  flagged text uses only approved Requirement verbs (`must`, `must not`,
  `may only`).
- **Rule 4 — `contradictionCrossReferenceRule`**: re-reads the message,
  extracts both quoted phrases, and suppresses if either cannot be located in
  the source document. Catches the fabricated-side case the wave produced
  during the 2026-07-09 verification session.
- **Rule 5 — `definitionsSelfReferenceRule`**: placeholder for v2 (demote
  contradiction findings inside Definitions sections).
- **Rule 6 — `preambleLengthRule`**: suppresses
  `hygiene-non-actionable-preamble` when the flagged text is at or below
  the 3-sentence threshold the wave itself defines.
- **Rule 7 — `numberedProcedureRule`**: suppresses
  `hygiene-unordered-process` when the document contains at least 2
  numbered procedure steps (`Step N` headings).

### Wiring

- The `filterFindings` config field defaults to `true`. Users can opt out
  via the `skillsReviewAndPolish.filterFindings` setting.
- The post-processor runs after the consolidation pass in
  `src/core/analyzer.ts`, before the accepted-findings filter, before the
  loop detection.
- The MCP server and the language-model tool both pass the same
  `configOverride` so the user setting flows through to all callers.

### Why this matters more than median-of-N for finding lists

Median-of-N addresses sample variance: the same call sampled N times gives
N close scores. The post-processor addresses finding variance: the same
call surfaces the same N findings, but N-7 of them are false positives.
Median-of-N is a *score-layer* fix; the post-processor is a *finding-layer*
fix. Both are needed.

### Lessons

- **Score noise and finding noise are different layers.** Per-prompt
  confidence gates have been tried twice (Exp2, Exp4) and over-suppressed
  real signal. The post-processor is structured the opposite way: rules
  are conservative and rule-specific, not blanket probability cutoffs.
- **The fixer's `OBLIGATION_TOKENS` is also the analyzer's protected
  vocabulary.** Anything the fixer refuses to drop, the analyzer should
  refuse to flag. Both lists now live in `src/core/vocabulary.ts` as a
  single source of truth.
- **The pre-processor and post-processor are different.** The
  `pre-process` step (in the wave prompt) is about how the wave is asked.
  The post-processor is about how the output is filtered. The wave prompt
  has been "do not flag `may` as weak obligation" multiple times and
  failed. The post-processor is the only fix that worked.

## Pointer to experiment folder

The `.github/experiments/` folder is where ongoing prompt-iteration
experiments live. The post-processor's long-term vision ("diagnostic
refinement, not suppression") is captured in
`.github/experiments/documentation-review/POST-PROCESSOR-NOTES.md`.
The gap between the v1 implementation and that vision is intentional
and tracked: v1 only suppresses; rank/merge/reclassify are future work.

For experiments on the analyzer itself (not prompts), use the same
protocol: change one thing, measure the delta, record Resolved / New /
Unchanged / Regression.

## Never head/tail slice a document the analyzer is supposed to review in full

**Discovery date:** 2026-07-17 (caught while re-running E50 schema-mode validation).
**Impact:** High — silently destroyed analyzer quality on any skill over 60K chars.

The original `MAX_ANALYSIS_DOCUMENT_CHARS = 60_000` cap and the head/tail
slicing helper ("take the first 30K + last 30K chars") were invisible in
testing because every fixture in the calibration corpus is well under 60K
chars. But **real skills blow past 60K constantly**: `quality-playbook` is
294K chars / 2,739 lines, `multilingualy-foreman` is 7K + 63 references.
On those skills, lines 256-2262 of `quality-playbook` — the actual quality
protocols, decision trees, and verification logic — were **never sent to
the model**. The contradiction wave would systematically miss cross-section
findings because the middle of the document never reached the LLM.

The probe that caught it (`scripts/probes/verify-full-doc.mjs`): build the analyzer
prompt for a 292K skill on a 1M-context gemini. The prompt came back at
293K chars (whole skill + 6 reference files), no head/tail marker. Before
the fix it was 60K chars, head marker + last 30K, with a `[... middle
elided ...]` marker in the middle that the model dutifully read.

**Lesson 1: don't cap the analyzer's input by a global char budget.**
The budget must come from the model's context window. Today the chain is
`provider.getContextLength()` → `max(MIN, ctxTokens × 4 × 0.8)`. If the
provider doesn't know its context length, use a 200K fallback and warn.

**Lesson 2: slicing should always drop, never truncate mid-content.**
If you can't fit the whole document + references, drop individual
files with a clear marker (`<!-- reference not loaded: too large -->`)
rather than slicing in the middle. The slice silently destroys finding
quality; the drop tells the model which sections are out of scope.

**Lesson 3: probe prompts, not fixtures.** Fixture scale tests pass
because fixtures are small. The 60K cap was wrong but invisible because
fixtures fit. Probe the analyzer's actual prompt for a real production
skill before trusting the recall/precision numbers.

**Encoded as:** `src/core/analyzer.ts` no longer has a hard cap;
`provider.getContextLength()` is a required interface method;
`src/modelCatalog.ts` is the three-tier lookup (live OpenRouter →
bundled asset → static fallback).

## Adaptive response-token sizing needs two budgets, not one

**Discovery date:** 2026-07-17.
**Impact:** First version of adaptive budgeting silently capped output at the
fixed `maxResponseTokens` (16384). For long prompts, that meant adaptive mode
delivered *less* output than fixed mode — silent regression masked by an
intuitive-looking formula.

The original formula was
`clamp(ceil(promptChars / adaptiveCharsPerToken), minAdaptive, maxTokens)`.
For a 50K-char prompt with `charsPerToken=8`, desired = 6250 → sent on the
wire as 6250. The fixed ceiling of 16384 was never reachable, because
`clamp(desired, …, maxTokens)` always uses `maxTokens` as the upper bound.

The two-budget fix is
`clamp(ceil(promptChars / charsPerToken), min(minAdaptive, cap), max(maxTokens, cap))`.
A new `adaptiveMaxResponseTokens` setting (default 65536) sits above the
fixed `maxResponseTokens` so long prompts can request more output than the
fixed-mode ceiling, but `max(maxTokens, cap)` still respects the user's
fixed-mode preference.

**Lesson 1: adaptive scaling always needs a separate upper bound.**
Don't reuse the fixed-mode ceiling as the adaptive cap. They answer
different questions — "what should I never ask for" vs "what is the
heuristic upper bound for prompt-sensitive sizing".

**Lesson 2: validate on real prompts at production scale.** The unit
test only checked the clamp arithmetic with synthetic prompts. The
quality-playbook live demo on a real 292K-char skill surfaced the issue
immediately: default knobs requested fewer output tokens than fixed mode.

**Recommended starting knobs for OpenRouter + schema mode:**

```json
{
  "external.adaptiveResponseTokens": true,
  "external.adaptiveMaxResponseTokens": 131072,
  "external.minAdaptiveResponseTokens": 16384,
  "external.adaptiveCharsPerToken": 4
}
```

Validated by `scripts/demos/adaptive-quality-playbook-live.mjs`.

**Encoded as:** `resolveMaxTokens` in `src/providers/externalProvider.ts`
now uses `floor = min(minAdaptive, adaptiveMaxTokensCap)` and
`cap = max(maxTokens, adaptiveMaxTokensCap)`. New setting
`skillsReviewAndPolish.external.adaptiveMaxResponseTokens` (default 65536,
schema max 262144).

## Adaptive output budgeting is not the same as prompt-budgeting

**Discovery date:** 2026-07-17.
**Impact:** The analyzer's input budget (`provider.getContextLength()` →
`max(MIN, ctxTokens × 4 × CONTEXT_FRACTION)`) and the LLM's *output* budget
are different concerns that share the word "budget". They used to be
silently conflated in code review.

- Input budget: "how much can we send to the model?" — bounded by the model's
  context window. Required to be ≥ the whole skill + references.
- Output budget: "how many output tokens can we ask for?" — bounded by
  what the user is willing to pay and what the model needs to fully
  emit the JSON. Independent of input budget; small inputs can need huge
  outputs (e.g. "list every ambiguity in this 10K-char document").

Adaptive output budgeting *is* useful; what mattered was capping it by the
fixed ceiling. Default values reflect that 1M-context Gemini users want
up to 131K output tokens, but a 128K-context model user wants no more than
32768. Both are reachable with the new `adaptiveMaxResponseTokens` knob
plus `external.maxResponseTokens` as the lower cap.

**Encoded as:** settings schema in `package.json` and `config.ts`,
productionised by `scripts/demos/adaptive-quality-playbook-live.mjs`.

---

## Calibration & noise sections (moved out)

The following sections were extracted to [`LEARNINGS-CALIBRATION.md`](./LEARNINGS-CALIBRATION.md)
during the 2026-07-17 "Restructure + trim" pass to keep this file navigable:

- Two systematic noise drivers (coverage-gap, llm-parse-error fence bug)
- Per-prompt determinism gates (rejected twice)
- Wave architecture decision (benchmark)
- Gilfoyle review learnings (2026-06-09)
- OpenRouter pricing cache corruption incident (2026-07-08)

They are coherent as a unit and only needed for calibration / noise-floor
work. The load-bearing rules for future prompt/analyzer work (surgical-fixer
safety, post-processor, "never head/tail slice") remain inline above.
