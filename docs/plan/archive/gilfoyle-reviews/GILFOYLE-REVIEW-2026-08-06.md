# Gilfoyle Code Review — 2026-08-06

**Target:** `skills-review-and-polish` @ `0.1.50`  
**Scope:** live `src/**`, `package.json` contributions only. Prior reports and plans not used as evidence.  
**Method:** static review of extension host, MCP server, shared core (`pathSafety`, `providerKeys`, fixer, analyzer, accepted-findings), providers, catalog caches.

---

## Verdict

Someone actually fixed things. Shared path safety, bidirectional key accept-lists, realpath on fixer `references/`, multi-root folder resolution, loop mode that exists in code, budget reserve before MCP analyze/score/verify — that is not cosplay.

What remains is smaller and meaner: a single-issue apply path that can still rewrite the wrong span, a settings enum that still lies about `chat`, a SecretStorage slot that is one drawer for two credentials, and cost controls that stop the *next* call after the expensive one already ran. Progress. Not done.

---

## Findings

### 1. `runFixIssue` replaces `relevantText`, not the guarded anchor

`src/extension.ts` → `runFixIssue`

After `SurgicalFixer.fixIssue` accepts a fix, the extension does:

- `anchor = result.relevantText`
- if that substring appears exactly once → `text.replace(anchor, fixResult.fixed)`

Meanwhile `fixIssue` / `resolveAnchorText` may expand the anchor to a **paragraph** (`expandToParagraph` / `extractParagraphAtLine`). The LLM rewrites that full `targetText`. `fixDocument` correctly reuses `result.targetText` for the splice.

The interactive single-fix path does not. So when the guarded fragment is longer than `relevantText`:

- you paste a full-paragraph rewrite over a short phrase, or
- you no-op when `relevantText` is ambiguous even though the paragraph anchor was unique

`fixResult.targetText` is already on the result object. Ignoring it is how you reintroduce the bug `fixDocument` just closed.

**Impact:** silent document corruption or false “no change” on the path users actually click.

---

### 2. `fixMode: 'chat'` is still product fiction

`package.json`:

> `'chat' hands off to Copilot Chat`

`runFixAll` / `runFixIssue`:

- log a warning
- **apply the edit directly**
- tell the user chat is not implemented

Better than the old silent apply-with-no-message. Still a settings enum that documents a feature that does not exist. Either implement the handoff or delete the enum value. Shipping a third mode that means “loop’s ugly cousin” is how support tickets are born.

---

### 3. One SecretStorage key, two providers — validation at use, not at store

Slot remains `skillsReviewAndPolish.apiKey`.

`validateKeyForProvider` (shared, good) blocks:

- non-`sk-or-v1-` → OpenRouter
- `sk-or-v1-` → Copilot

`setApiKey` still stores whatever the user typed with **no provider tag**. Provider switch does not clear or re-prompt. Failure mode is “works until you flip provider and every call dies.”

Accept-list at the wire is correct. UX still treats two hostile credentials as one sock drawer.

---

### 4. MCP session budget still charges after the barn burns

`src/mcp/server.ts`

Improvements since the naive version: `reserveTokens` before analyze / score / verify / fix. Good.

Still true:

- `chargeTokens` runs **after** the LLM work; over-cap calls still return full results
- units are `chars/4` fiction (`health.costBudget.estimate: 'responseChars/4'`), not provider usage
- `MCP_MAX_TOKENS=0` / config `0` disables the guard entirely
- VS Code LM tools (`registerLanguageModelTools`) have **no** reserve, charge, or cooldown

So the budget prevents *starting* work that already looks too big. It does not prevent finishing work that crosses the line, and the extension agent door has no line at all.

**Impact:** stuck agent + multiWave still completes the call that blows the soft cap; LM tools are uncapped by design.

---

### 5. `exclude` is mostly decorative on the hot path

`skillsReviewAndPolish.exclude` is read into config.

Used in: folder analyze (`runAnalyzeFolder`) via picomatch.

**Not** used in:

- `isCustomizationPath` (include-only)
- `onSave` auto-analyze
- single-file analyze / fix commands

So a user who excludes `**/vendor/**` still pays for onSave analysis the moment they save a matching include path under vendor. Setting name says exclude. Runtime says “sometimes, if you used the folder command.”

---

### 6. Optional LLM fix gates still fail open

`src/core/fixer.ts` → `fixPreservesMeaning` / `fixIntroducesFact`

On provider error / throw: accept the fix, attach a risk string (`self-critique skipped`, `semantic-check skipped`). Defaults still leave both gates **off** except forced self-critique on additive ambiguity.

Deterministic guards (bounds, obligation tokens, append-only, ambiguous anchor) are the real spine. The LLM judges remain “nice when the network works.” At least the skip is visible in `risks` now. Fail-open is still fail-open.

---

### 7. `loop` mode is real — and it is also an uncapped spend loop in the extension

`runFixAll` with `fixMode === 'loop'`:

- up to `fixLoopMaxIterations` (default 3, max 10)
- each iteration: surgicalFix + full `engine.analyze` re-scan
- then apply (or diff once at the end for `diff` mode — loop applies via the non-diff branch)

No extension-side token budget. No confirmation between iterations. Combined with external providers this is intentional power-user behavior that will happily multiply wave cost by iterations. Fine if documented as “I accept the bill.” Less fine as a quiet default someone toggles once.

---

### 8. MCP trust root is still env-or-cwd

`resolveWorkspaceRoot()` = `MCP_SERVER_WORKSPACE || process.cwd()`.

Shared `safeResolveFilePath` is solid **given** that root. Mis-launched server without the env var makes cwd the universe. `syncMcpConfig` writes provider/model/budget into `.skills-review.json` but does not pin or document the workspace root the server must use. Config and trust boundary live in different rooms.

---

### 9. `syncMcpConfig` / default accepted-findings still prefer “some” folder

`workspaceFolderForPath(filePath?)` is the right idea and is used for per-doc accepts and LM-tool paths.

Call sites that pass **no** path:

- `syncMcpConfig()` → first folder
- `clearAcceptedFindings()` / `getAcceptedFindingsPath()` with no arg → first folder
- `DEFAULT_ACCEPTED_FINDINGS_PATH` module init → `folders[0]` if vscode is present

Multi-root is fixed for the analyze/fix-with-uri path. Background “sync MCP” and module-level default still assume folder zero is destiny.

---

### 10. Analyzer link lexical check still uses raw `startsWith` before realpath

`readLinkedPromptFiles`: lexical escape check is `resolved.startsWith(docDir + sep)` without `isPathWithin` (Windows case). Canonical stage uses `isPathWithin` after `realpath`. Not an open hole if realpath runs; it is a residual inconsistency next to the shared helper you already extracted. Low. Do not “fix” it by deleting the realpath pass.

---

### 11. Tmp catalog caches

OpenRouter/Copilot context and pricing caches in `os.tmpdir()` with default umask. Copilot cache filename still embeds `sha256(apiKey).slice(0,16)`. Debug log still `0o600`. Same mixed hygiene as before — not a headline, not invisible.

---

### 12. MCP env openrouter `configSource` label lies

When engine is built from env vars only (no usable file provider branch), openrouter path still sets `configSource: \`file:${configPath}\``. Copilot env path correctly says `env:GITHUB_TOKEN`. Health output will gaslight operators about where config came from. Nit with operational teeth.

---

## What is annoyingly fine

- `src/core/pathSafety.ts` — one canonical-to-canonical resolver for extension + MCP
- `src/core/providerKeys.ts` — accept-list, both doors
- `loadReferenceGrounding` — reject symlink `references/` dir, realpath file containment via `isPathWithin`
- Accepted-findings eviction by entry identity (not stale indices); unique tmp names for concurrent writers; store schema validation on load
- `validateRelevantText` shared; verify_fix uses it (no more 1-char “fixed: true”)
- Fixer returns `targetText`; `fixDocument` uses it; random reference delimiters; function-form `replace`
- Fail-open gates at least surface skip risks
- `onType` removed from package enum and config union
- External provider timeouts, cancel, non-retry 401/403, structured-output downgrade discipline
- Shared `tokenBudget` / `redact` / `llmText.stripCodeFences`
- Analysis locks per URI; engine config overrides without persisting modal picks mid-flight

This tree has been through a real remediation pass. It shows.

---

## Architecture snapshot (as implemented)

```text
VS Code extension                         MCP stdio server
─────────────────                         ────────────────
settings + SecretStorage                  .skills-review.json + env keys
        │                                        │
        ▼                                        ▼
   validateKeyForProvider ◄──────── shared ──────► validateKeyForProvider
   safeResolveFilePath    ◄──────── shared ──────► safeResolveFilePath
        │                                        │
        ▼                                        ▼
   Engine → Analyzer (waves) + SurgicalFixer
        │                                        │
        ▼                                        ▼
 diagnostics / WorkspaceEdit              JSON tools + soft token budget
 LM tools (no budget)
```

Providers: `vscode-lm` | OpenRouter HTTP | Copilot HTTP.  
Post: `findingFilter` + accepted-findings store.

---

## Priority (if anyone still ships patches)

1. `runFixIssue`: apply using `fixResult.targetText`, same as `fixDocument`
2. Remove or implement `fixMode: 'chat'`; stop advertising Copilot Chat handoff
3. Split SecretStorage by provider (or force re-entry on provider change)
4. Extension-side spend guard for LM tools + loop mode (or hard-require confirmation)
5. Honor `exclude` on `onSave` / `isCustomizationPath` (or stop exposing the setting as global)
6. MCP: pin workspace root in synced config; fix env `configSource` label
7. Decide fail-closed vs fail-open for optional fix gates when the user enabled them

---

## Out of scope / not claimed

- Did not use prior gilfoyle reports as a checklist (re-verified against current sources)
- Did not run the test suite or live providers
- Did not audit `scripts/` experiment farms beyond runtime imports

— end review
