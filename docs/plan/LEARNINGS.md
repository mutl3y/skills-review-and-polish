# Learnings — carried over from the source project

> Hard-won lessons from building/tuning the analyzer + surgical fixer in
> `vscode-chat-customizations-evaluation`. Copied here so the new project keeps
> them even without access to saved memories. **Read before changing scoring,
> the fixer, or the analyzer prompts.**

## The single most important fact: the noise floor is ±6

- Scanning the SAME unchanged file 5× (gpt-4.1) gives penalties like 30/32/38/38/42. This is irreducible LLM variance even at temperature 0 / top_p 0.
- **Consequence:** a single before/after scan cannot reliably detect a fix worth < ~12 points. Do **not** chase small score gains — that's chasing randomness.
- Encoded as `PENALTY_NOISE_MARGIN = 6`. Keep/revert/converge only on changes beyond the margin.
- **The durable fix is median-of-N at the SCORING layer** (`medianTotalPenalty`, `SCORE_SAMPLES` default 3), not changing the model or prompt. It's model/prompt-agnostic and doesn't suppress detection. Keep/revert MUST run `SCORE_SAMPLES >= 3` (N=1 is only for cheap bulk scans).

## Model choice: gpt-4.1 stays as the analyzer

- **Claude Haiku 4.5 was tested and REJECTED**: noisier and its detection count is erratic (6→22 issues on the same file vs gpt-4.1's tight 10–12).
- A severity rubric prompt was tested and **NOT shipped** (recalibrated harsher without clearly cutting noise).
- For the extension, the equivalent is: let `vscode.lm` pick a strong Copilot model (e.g. gpt-4.1 family) for analysis; allow override via the model settings.

## Two systematic noise drivers were found and FIXED

1. **`coverage-gap` was the #1 noise driver** — open-ended gap brainstorming emitted a variable-length list each run. FIX (commit bd3615b): coverage prompt = HIGH-impact-only + one-gap-per-category cap. coverage-gap count range → 0 on all skills, **sensitivity preserved** (genuinely gappy skills still report many gaps deterministically).
2. **`llm-parse-error` root cause was a fence-regex bug, NOT truncation** (commit f2f7438). The `extractJSON` fence regex matched an INNER ```` ```python ```` example embedded inside a JSON string value. FIX: strip a code fence ONLY when it wraps the WHOLE response (anchored leading/trailing), never an inner fence. Applied in both `llm.ts` and `cli-analyzer.js`. Kept `max_tokens: 16384` + a `salvageTruncatedJSON` helper as harmless defense-in-depth.
   - **LESSON:** when `llm-parse-error` flickers, FIRST capture raw responses and check `finish_reason` before assuming truncation — fence/parse bugs look identical at the score layer.

## Per-prompt determinism gates DON'T work — rejected twice

- Adding "confidence gates" to the contradiction wave (Exp2) and ambiguity wave (Exp4) both **recalibrated harder or over-suppressed real signal** without cutting range. Conservation of difficulty. **Do not add more per-prompt confidence gates.** Use median-of-N instead.

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

## Gilfoyle review learnings (2026-06-09)

> 25 issues found across CRITICAL/HIGH/MEDIUM/LOW. All fixed. Key takeaways.

### `String.replace()` is a trap for text editing

- Using `String.replace(anchor, replacement)` with a string first arg has TWO failure modes:
  1. Replaces the **first** occurrence, not the intended one if anchor appears multiple times
  2. `$` characters in the replacement string (`$&`, `$'`, `` $` ``) are interpreted as replacement patterns, silently corrupting output
- **Fix:** Always use `text.replace(anchor, () => replacement)` — the function-as-replacement form prevents `$` interpretation. Add an occurrence-count check (`countOf(content, anchor) === 1`) before replacing.
- This affected both `fixer.ts` (fixDocument) and `extension.ts` (runFixIssue). It's a systemic pattern — any future text-replacement code must use this form.

### Module-load-time I/O is fragile

- `loadPrompt()` was called as `const SYSTEM_PROMPT = loadPrompt('name')` at module import time. If the file was missing (path wrong after bundling, file renamed), the entire module threw and the extension refused to activate.
- **Fix:** Wrap `loadPrompt()` in try/catch with a safe fallback string. Log the error but never throw at import time. Lazy-load is better but try/catch is the minimal fix.
- **General principle:** Extension activation code must never throw on I/O. The user loses the entire extension because one file is missing.

### Module-level mutable state needs per-key locks

- `lastResults` Map was shared across all commands. If "Analyze" fires twice quickly (manual + onSave), the second call overwrites `lastResults` mid-fix, and the user applies a fix based on stale results.
- **Fix:** Add `analysisLocks` Map (`Map<string, Promise<void>>`) keyed by URI. Before starting analysis, await any in-flight analysis for the same URI. Clean up in `finally` block.
- **General principle:** Any module-level Map that stores per-document state needs concurrency serialization. This is the VS Code extension equivalent of a database row lock.

### `process.cwd()` is never the workspace root

- In the VS Code extension host, `process.cwd()` is the Electron binary directory (`/usr/share/code/`), not the workspace root.
- **Fix:** Always use `vscode.workspace.workspaceFolders[0].uri.fsPath` for workspace-relative paths. For MCP server context, use the `MCP_SERVER_WORKSPACE` env var.
- This is a recurring trap — at least 3 separate issues (acceptedFindings path, MCP server path, config sync) were caused by the same wrong assumption.

### `model.dispose()` matters for native resources

- `VsCodeLmProvider` cached model references but never disposed them on retry/invalidation. VS Code language model objects may hold native resources.
- **Fix:** Call `(model as any).dispose?.()` before setting to undefined. The optional chaining is necessary because dispose may not exist on all implementations.
- **General principle:** Any cached native-ish resource needs explicit cleanup on invalidation, not just nullification.

### Path traversal in file loaders is a real attack vector

- `loadReferenceGrounding()` read any file in a sibling `references/` directory. A malicious SKILL.md could symlink to sensitive files, which get fed to the LLM as context and returned in diagnostics.
- **Fix:** Two guards: (1) `fs.lstatSync().isSymbolicLink()` to reject symlinks, (2) `path.resolve(full).startsWith(path.resolve(refDir))` to enforce directory boundary.
- **General principle:** Any `readdirSync` + `readFileSync` loop over user-controlled directories needs both symlink rejection and path-boundary validation.

### Error messages leak secrets

- API keys, Bearer tokens, and auth headers were surfacing in: error messages from `fetchWithRetry`, VS Code status bar tooltips, and MCP tool responses.
- **Fix:** `sanitizeErrorMessage()` function that strips Bearer tokens, known key prefixes (`sk-`, `ghp_`, `glpat-`, `xox[bpsa]-`), and Authorization header values. Apply at the boundary before returning to user.
- **General principle:** Error messages from HTTP clients are NOT safe for display. Always sanitize at the presentation boundary.

### Config caching needs event-loop tick TTL

- `readConfig()` called `vscode.workspace.getConfiguration()` on every keystroke. Not slow per call, but unnecessary repeated work.
- **Fix:** Cache config for one event-loop tick (`setTimeout(() => cache = null, 0)`). Multiple synchronous reads in the same tick share the cache; next user action gets fresh config.
- **General principle:** For VS Code settings, a tick-long cache prevents redundant reads without risking stale data across user actions.

### `out.show()` should respect trigger source

- `out.show(false)` resizes the editor to make room for the output panel, causing visible flicker during onType analysis (every 2 seconds of typing).
- **Fix:** Only call `out.show()` when `triggerSource === 'manual'`. Pass trigger source through the call chain.
- **General principle:** UI side effects (panels, notifications, status changes) should be gated on user intent, not code-triggered events.

### The bi-directional `includes()` trap in fuzzy matching

- `isFindingAccepted()` used `resultText.includes(pattern) || pattern.includes(resultText)`. A 3-character pattern like "vague" would suppress any finding shorter than "vague" that contains it — nearly everything.
- **Fix:** Forward-only matching (`resultText.includes(pattern)`) with minimum pattern length (5 chars).
- **General principle:** Bidirectional string containment is almost never the right semantics for matching. Short patterns match everything.

### `configHash` must cover all engine-relevant fields

- `computeConfigHash()` only hashed `provider:model:deepModel:fixModel`. Changing `enabledWaves`, `fixStrategy`, `fixSemanticCheck`, etc. didn't invalidate the cached engine.
- **Fix:** Include all fields that affect analysis behavior in the hash. If in doubt, include it.
- **General principle:** Cache invalidation is hard. When the cost of a false cache hit (stale engine) is worse than the cost of a rebuild, err toward including more fields.

### `salvageTruncatedJSON` must recover all arrays, not just the first

- The JSON recovery only found and recovered the first array key from truncated output. If the LLM truncated after `{"coverage_analysis": [...]}` but before `"hygiene_issues": [...]`, 30-40% of results were silently dropped.
- **Fix:** Use regex with `g` flag to find and recover all array keys. Log a warning listing recovered keys when truncation recovery is used.
- **General principle:** Truncation recovery that only partially recovers data is worse than no recovery — it gives false confidence in incomplete results. Either recover everything or report the failure.

### Duplicate interfaces are a maintenance hazard

- `EngineConfig` was defined in both `src/core/types.ts` and `src/mcp/server.ts` with different shapes. Someone will inevitably import the wrong one.
- **Fix:** Rename the MCP-local version to `McpEngineConfig`.
- **General principle:** Two types with the same name in the same codebase is a bug waiting to happen. Rename immediately.

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

## OpenRouter pricing cache corruption (2026-07-08)

> Spent ~5 hours debugging why OpenRouter-only models showed no pricing while
> Copilot models did. Root cause was a stale disk cache populated by test mocks.

### The symptom was misleading

- Models also in Copilot showed `💰 $X.XX/M in` correctly.
- OpenRouter-only models showed `❓ cost unknown`.
- Initial assumption: "the matching logic is broken for OpenRouter-only models."

### The real cause was upstream

- The OpenRouter pricing disk cache (`/tmp/skills-review-and-polish-openrouter-pricing-cache-v1.json`) had **6 entries** instead of the expected **~1000** (340 models × 3 keys each).
- The cache was written by a test run that used a mock `fetch` returning 2 models.
- The 15-minute disk cache TTL meant all subsequent fetches within that window returned the truncated dataset.
- `Promise.allSettled` in `fetchPricing()` masked the failure — the fetch "succeeded" (it read from cache) and the merged map just had fewer entries.

### How to diagnose "missing pricing" in the future

1. **Check cache file entry count first:**
   ```bash
   cat /tmp/skills-review-and-polish-openrouter-pricing-cache-v1.json | jq '.entries | length'
   ```
   Should be ~1000+ for a healthy cache.

2. **Verify the raw API has pricing for the model:**
   ```bash
   curl -s https://openrouter.ai/api/v1/models | jq '.data[] | select(.id | contains("poolside")) | {id, name, pricing}'
   ```

3. **Check the extension log for pricing map size:**
   ```
   selectModel: fetched N pricing entries, ...
   ```
   A healthy `N` is ~1000+.

### The fix

- Delete the cache file and reload VS Code:
  ```bash
  rm /tmp/skills-review-and-polish-openrouter-pricing-cache-v1.json
  ```
- No code change needed — the pricing fetch and matching logic were correct.

### Lessons

- **Disk caches populated by test mocks are a trap.** Tests that use `vi.mock` or stubbed `fetch` can still write to real disk caches if they don't mock the cache-write path. The cache will then poison production until the TTL expires.
- **`Promise.allSettled` hides partial failures.** When one source fails, the merged map silently has fewer entries. Consider adding a size check or logging the per-source entry count.
- **"Missing data" symptoms often point to the data source, not the matching logic.** Before debugging matching code, verify the data is actually present and complete. See [docs/PRICING.md](../PRICING.md) for full details.

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
