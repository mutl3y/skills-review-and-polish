# Gilfoyle Code Review — 2026-08-05

**Target:** `skills-review-and-polish` @ `0.1.50`  
**Scope:** live `src/**`, `package.json` contributions. Prior reports and plans ignored.  
**Method:** static review of extension host, MCP server, providers, analyzer, fixer, accepted-findings, catalog/pricing caches.

---

## Verdict

This is not amateur hour. Path guards, secret redaction, structured-output fallback, and surgical fix bounds show someone has been burned before.

It is also not finished. The worst remaining problems are not style. They are: a real local-file read via `references/` symlinks in the fixer, settings that claim behaviors the code never implements, one SecretStorage slot doing two jobs, and cost controls that mostly apologize after the invoice.

---

## Findings

### 1. Fixer reference grounding follows a directory symlink straight out of the workspace

`src/core/fixer.ts` → `loadReferenceGrounding`

- `refDir = path.join(path.dirname(filePath), 'references')`
- existence via `access` / `stat` — **follows** symlinks
- per-file `lstat` only rejects symlink *leaves*
- containment check is **lexical** `path.resolve` against `refDir`, not `realpath`

So:

```text
skill/references  ->  /etc
```

`readdir` lists `/etc`, `readFile('skill/references/passwd')` follows the dir symlink, lexical prefix still looks “inside” `skill/references`, and the contents go into the fix prompt (and then to OpenRouter/Copilot).

The analyzer’s `readLinkedPromptFiles` already does canonical `realpath` re-check. The fixer does not. Same product, two trust models. The weaker one is the one that mutates text.

**Impact:** malicious or careless skill tree → arbitrary local file read into an external LLM. Classic exfil with extra markdown.

**Contrast:** `src/core/analyzer.ts` (`realpath` + within-check) is the competent version of this function. Copy the discipline or delete the feature.

---

### 2. `fixMode: 'loop' | 'chat'` are product fiction

`package.json` and `src/config.ts` advertise:

- `diff` — preview
- `loop` — auto-apply up to `fixLoopMaxIterations`
- `chat` — hand off to Copilot Chat

`src/extension.ts` `runFixAll` only branches:

- `fixMode === 'diff'` → preview
- **else** → `applyFixToDocument` once

No iteration. No chat handoff. `fixLoopMaxIterations` is read and then ignored by the entire `src/` tree (config + a test mock).

**Impact:** users who pick `loop` get silent one-shot apply. Users who pick `chat` get the same. Settings UI as placebo.

---

### 3. One SecretStorage key, two hostile APIs

Slot: `skillsReviewAndPolish.apiKey`

Used for:

- OpenRouter (`sk-or-v1-…`) with a format gate in `buildEngine` / test prompt
- Copilot / GitHub token (`GITHUB_TOKEN` / `COPILOT_TOKEN` / stored key) with **no** reciprocal gate

OpenRouter path correctly refuses non-`sk-or-v1-` keys (does not yeet a GitHub token at openrouter.ai).  
Copilot path will happily send whatever is in the slot — including an OpenRouter key — to `api.githubcopilot.com`.

`setApiKey` does not record which provider the secret belongs to. Provider switch does not clear or re-validate the slot.

**Impact:** auth confusion, failed calls, and a footgun that undoes the one careful cross-provider check you bothered to write.

---

### 4. MCP session budget is a diary, not a governor

`src/mcp/server.ts`

- `reserveTokens` only on `fix`
- `analyze` / `score` / `verify_fix` check `budgetExhausted()` **before** work, then `chargeTokens` **after**
- `chargeTokens` still increments when over cap and still returns the result
- default 500k “tokens” is `chars/4` fiction (`estimate: 'responseChars/4'` in health), not provider usage
- `MCP_MAX_TOKENS=0` disables the guard entirely
- cooldown is 5s between analyzes — cute, not a spend cap
- VS Code LM tools (`registerLanguageModelTools`) have **no** budget or cooldown at all

**Impact:** a stuck agent loop still completes the expensive call that crosses the line. The next call gets the stern error message. Accounting cosplay.

---

### 5. Accepted-findings eviction corrupts the store under pressure

`src/core/acceptedFindings.ts` → `acceptFinding`

When `totalEntries > MAX_ACCEPTED_ENTRIES` (500):

1. flatten `(fileKey, index, acceptedAt)`
2. sort oldest first
3. `splice(index, 1)` in that order **using original indices**

Two oldest rows in the same file at indices `0` and `5`: remove `0`, then splice `5` — you now delete whatever slid into slot 5, not the row you ranked. Repeat across files and you evict the wrong suppressions or leave the store larger than the cap.

**Impact:** silent keep/drop of user-accepted findings; non-deterministic suppression once someone actually hits the ceiling.

---

### 6. Multi-root workspaces: everything is folder[0]

Hard-coded first folder:

- `getAcceptedFindingsPath()` → `folders[0]/.accepted-findings.json`
- `syncMcpConfig` → `folders[0]/.skills-review.json`
- `safeResolveFilePathForTools` → `workspaceFolders?.[0]` as the only root

Analyze/fix on a doc in folder B still keys accepts and MCP config against folder A, and LM-tool path checks against A’s root.

**Impact:** wrong suppressions, wrong MCP config, false path rejects/allows in any real multi-root setup.

---

### 7. MCP path guard is weaker than the extension’s on Windows

Extension `safeResolveFilePathForTools`: case-folded prefix on `win32`, `realpath` of root and target.  
MCP `safeResolveFilePath`: raw `startsWith(root + sep)`, no case fold.

Same codebase, same attack story (`FilePath` from an agent), different outcomes depending on which door you used.

Also: MCP trust root is `MCP_SERVER_WORKSPACE || cwd`. Mis-launched server without the env var → cwd becomes the universe. `syncMcpConfig` writes provider/model only; it does not make the server’s root explicit.

---

### 8. Optional fix gates fail open — and defaults leave them off

`src/core/fixer.ts`

- `fixPreservesMeaning` / `fixIntroducesFact`: any provider error → allow (`return true` / `''`)
- defaults: `fix.semanticCheck=false`, `fix.selfCritique=false` (forced on only for additive ambiguity)

Deterministic guards (bounds, obligation tokens, append-only) are real. The LLM judges are decorative under the exact conditions you need them — outage, rate limit, empty response.

**Impact:** the marketing says “safety gates”; the code says “hope, with a try/catch.”

---

### 9. `onType` analysis is a loaded gun with a 2s debounce

Default `runOn` is `manual` — good.  
If set to `onType`, every customization buffer schedules `analyzeDocument` after 2000ms with no local coalescing beyond per-URI debounce, no spend cap, multiWave × N models.

Combined with external providers, that is a background subscription to your own API bill.

---

### 10. Shared in-flight Copilot catalog fetch is not keyed by token

`src/modelCatalog.ts` → `fetchCopilotContextLengths`

- in-memory cache correctly includes `apiKey`
- `copilotFetchInFlight` is a single promise: second caller with a **different** token awaits the first fetch

**Impact:** token rotation / concurrent MCP+extension paths can observe the wrong catalog completion or stick to the first failure. Lesser than #1; still sloppy.

---

### 11. Tmp caches and debug logs: mixed hygiene

Good: debug log created with `mode: 0o600`.  
Meh: OpenRouter/Copilot context and pricing caches in `os.tmpdir()` via `writeFileSync` with default umask — no secret material in body, but Copilot cache **filename** embeds `sha256(apiKey).slice(0,16)` (oracle for token equality across local users).

Not critical. Not invisible either.

---

### 12. Analyzer link reject `target.includes('..')` is blunt

Rejects any link path containing `..`, including silly but legitimate names. Security-wise the later `resolve`+`realpath` chain is what matters; this is belt-and-suspenders that mostly produces false skips. Fine. Not a finding worth a meeting — noted so nobody “fixes” it by removing the realpath check.

---

## What is annoyingly fine

- OpenRouter key shape check before calling openrouter.ai
- `redactSecrets` shared across logger, MCP errors, LM tool errors
- Surgical fixer: anchor size, frontmatter range, ambiguous-anchor skip, `replace` with function (no `$` reinterpretation), random reference delimiter ids
- External provider: timeouts, cancel hooks, non-retry of 401/403, structured-output downgrade on real schema errors only
- Engine config override path that avoids persisting modal picks into Global settings mid-flight
- Analysis locks per URI
- Finding filter as pure post-pass (when left on)

Someone on this repo has read production logs. Keep them.

---

## Architecture snapshot (as implemented)

```text
VS Code extension                          MCP stdio server
─────────────────                          ────────────────
settings + SecretStorage                   .skills-review.json + env keys
    │                                           │
    ▼                                           ▼
buildEngine / createDefaultEngine ──► Engine → Analyzer (waves)
                                   └► SurgicalFixer
    │                                           │
    ▼                                           ▼
diagnostics / diff apply                 JSON tool results
LM tools (analyze/fix)                  budget theater
```

Providers: `vscode.lm` | OpenRouter HTTP | Copilot HTTP.  
Post: `findingFilter` + accepted-findings store.

---

## Priority order (if anyone fixes anything)

1. Realpath/containment for `loadReferenceGrounding` (and refuse symlink `references/` dirs)
2. Implement or delete `fixMode` `loop`/`chat` and `fixLoopMaxIterations`
3. Split secrets by provider; validate on switch
4. Fix accepted-findings eviction (delete by identity, not stale index)
5. Budget: reserve before analyze/score/verify; don’t charge after the barn burned
6. Multi-root: resolve roots from the document URI, not `folders[0]`
7. Align MCP path canonicalization with the extension

---

## Out of scope / not claimed

- Did not re-read archived gilfoyle plans
- Did not run the test suite or live providers
- Did not audit `scripts/` experiment farms except as referenced by runtime

— end review
