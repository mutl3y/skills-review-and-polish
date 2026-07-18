# Learnings — Calibration & Noise (moved out of LEARNINGS.md)

> This file holds the calibration-noise, Gilfoyle-review, and pricing-cache
> incident sections that were extracted from `LEARNINGS.md` during the
> 2026-07-17 "Restructure + trim" pass. They are kept as a coherent unit here
> so the main LEARNINGS file stays focused on load-bearing rules for future
> prompt/analyzer work (surgical-fixer rules, post-processor, "never
> head/tail slice"). Read this when doing calibration or noise-floor work.

## Two systematic noise drivers were found and FIXED

1. **`coverage-gap` was the #1 noise driver** — open-ended gap brainstorming emitted a variable-length list each run. FIX (commit bd3615b): coverage prompt = HIGH-impact-only + one-gap-per-category cap. coverage-gap count range → 0 on all skills, **sensitivity preserved** (genuinely gappy skills still report many gaps deterministically).
2. **`llm-parse-error` root cause was a fence-regex bug, NOT truncation** (commit f2f7438). The `extractJSON` fence regex matched an INNER ```` ```python ```` example embedded inside a JSON string value. FIX: strip a code fence ONLY when it wraps the WHOLE response (anchored leading/trailing), never an inner fence. Applied in both `llm.ts` and `cli-analyzer.js`. Kept `max_tokens: 16384` + a `salvageTruncatedJSON` helper as harmless defense-in-depth.
   - **LESSON:** when `llm-parse-error` flickers, FIRST capture raw responses and check `finish_reason` before assuming truncation — fence/parse bugs look identical at the score layer.

## Per-prompt determinism gates DON'T work — rejected twice

- Adding "confidence gates" to the contradiction wave (Exp2) and ambiguity wave (Exp4) both **recalibrated harder or over-suppressed real signal** without cutting range. Conservation of difficulty. **Do not add more per-prompt confidence gates.** Use median-of-N instead.

## Wave architecture decision (benchmark)

- Wave **86% Jaccard** vs single-prompt **82%**; coverage detection 60% vs 33%. Cost ≈ 1.5–2× with prompt caching; parallel keeps latency comparable. **Keep multi-wave as the default.**

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

   ```text
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
