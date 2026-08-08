# Gilfoyle Code Review — 2026-08-06 (pass B)

**Target:** `skills-review-and-polish` @ `0.1.50`  
**Scope:** live `src/**`, `package.json` contributions. Prior reports and plans not used as evidence.  
**Method:** static review of extension host, MCP server, shared core, providers, catalog caches.

---

## Verdict

The security spine is real: shared path containment, key accept-lists, realpath on fixer `references/`, multi-root folder resolution for document-scoped paths. That part is competent.

What is not competent is the half-finished consolidation. There is a shiny `src/core/sessionBudget.ts` whose own header claims both doors use it. Neither door imports it. The MCP server still ships a private clone. The extension LM tools still have no budget at all. And the single-issue fix path still splices on the wrong string while `fixDocument` got the correct one.

You extracted modules. You forgot to plug them in. Classic.

---

## Findings

### 1. `runFixIssue` still replaces `relevantText`, not the guarded anchor

`src/extension.ts` → `runFixIssue` (post-accept path):

```ts
const anchor = result.relevantText ?? '';
// ...
const fixedText = anchor && anchorCount === 1
  ? text.replace(anchor, () => fixResult.fixed)
  : text;
```

`SurgicalFixer.fixIssue` may expand the anchor to a paragraph (`expandToParagraph` / `extractParagraphAtLine`) and returns that as `fixResult.targetText`. The LLM rewrites **that** span.

`fixDocument` already does the right thing:

```ts
const anchor = result.targetText;
```

The interactive single-fix path — the one users click from a code action — does not. When the guarded fragment is longer than `relevantText`, you either paste a paragraph rewrite over a short phrase, or no-op when `relevantText` is ambiguous even though the paragraph was unique.

**Impact:** silent document corruption or false “no change” on the primary UX path. The batch path was fixed. The click path was not. That is not a subtlety.

---

### 2. `src/core/sessionBudget.ts` is dead code; MCP keeps a private twin; LM tools ignore both

`sessionBudget.ts` documents:

> Both the MCP server and the VS Code extension's language-model tools MUST share ONE budget implementation.

Reality on this tree:

| Consumer | Imports `sessionBudget`? | Has budget? |
|---|---|---|
| `src/mcp/server.ts` | **No** — local `_sessionTokens`, `chargeTokens`, `reserveTokens`, … | Yes (local copy) |
| `registerLanguageModelTools` | **No** | **None** |
| Interactive analyze / fix-all / loop | **No** | **None** |

So the “shared” module is a museum piece. Two doors, two (or zero) implementations — exactly the drift pattern `AGENTS.md` pretends to forbid.

MCP behavior of the live copy:

- `reserveTokens` before analyze / score / verify / fix (good)
- `chargeTokens` **after** work; over-cap call still returns full results
- units are `chars/4`, not provider usage
- cap `0` disables the guard

Extension agent tools: unlimited multiWave on a stuck agent. No reserve. No charge. No cooldown.

**Impact:** incomplete spend control, guaranteed future divergence the moment someone “fixes” only one copy, and a shared module that lies in its file comment.

---

### 3. `fixMode: 'chat'` still advertises a feature that applies edits

`package.json`:

> `'chat' hands off to Copilot Chat`

`runFixAll` / `runFixIssue`:

- log that chat is not implemented
- **`applyFixToDocument` anyway**

Honest warning, dishonest setting. Users who pick “hand off to chat” get a direct workspace edit. Delete the enum value or implement the handoff. Do not ship a third mode that means “apply with extra guilt.”

---

### 4. `fixStrategy: 'improved'` is package fiction

`package.json` enum: `subtractive | additive | improved`  
`EngineConfig.fixStrategy` (`types.ts`): `'subtractive' | 'additive'` only  
`asFixStrategy` / engine / extension: `additive === true` else subtractive

Selecting `improved` silently becomes subtractive. Settings UI as placebo, again.

---

### 5. One SecretStorage slot, two providers

Still `skillsReviewAndPolish.apiKey`.

`validateKeyForProvider` correctly blocks cross-sending at use time (OpenRouter needs `sk-or-v1-…`; Copilot rejects that shape).  

`setApiKey` stores an untagged blob. Provider switch does not clear or re-prompt. Failure mode: works until you flip provider.

Wire validation is fine. Credential lifecycle is still a sock drawer.

---

### 6. `exclude` does not exclude on the hot path

`skillsReviewAndPolish.exclude` is loaded.

Honored in: folder analyze (`runAnalyzeFolder` picomatch filter).

**Not** honored in:

- `isCustomizationPath` (include-only)
- `onSave` auto-analyze (`include` match only)
- single-file analyze / fix gates

Exclude `**/vendor/**`, save `vendor/foo/SKILL.md`, pay for a full multiWave run. The setting name is a suggestion.

---

### 7. Optional LLM fix gates fail open when enabled

`fixPreservesMeaning` / `fixIntroducesFact`: provider error or throw → accept fix, push a risk flag (`… skipped (LLM unavailable)`). Defaults leave both off except forced self-critique on additive ambiguity.

Deterministic guards are the real safety net. The optional judges are weather-dependent. At least the skip is visible. Fail-open is still fail-open.

---

### 8. `loop` mode multiplies uncapped extension spend

`runFixAll` with `fixMode === 'loop'`: up to `fixLoopMaxIterations` (default 3, max 10) of surgicalFix + full `engine.analyze` per iteration. No extension budget, no mid-loop confirmation. Intentional power tool if you meant to buy tokens. Quiet footgun if you toggled a dropdown.

---

### 9. MCP trust root remains env-or-cwd

`resolveWorkspaceRoot()` = `MCP_SERVER_WORKSPACE || process.cwd()`.

Shared `safeResolveFilePath` is solid **given** that root. Server launched without the env var trusts cwd. `syncMcpConfig` writes provider/model/budget into `.skills-review.json` and does not pin the workspace root the process must use.

---

### 10. MCP env OpenRouter `configSource` mislabels origin

Env-only OpenRouter branch still sets:

```ts
configSource: `file:${configPath}`
```

Copilot env path correctly says `env:GITHUB_TOKEN`. Health will claim a file source when the engine came from env. Operators debugging the wrong file is free entertainment until it is not.

---

### 11. Multi-root: document paths fixed; ambient paths still folder[0]

`workspaceFolderForPath(filePath)` is used for accepts and LM-tool roots when a path is known. Good.

No-arg call sites still fall back to first folder: `syncMcpConfig()`, `clearAcceptedFindings()`, module `DEFAULT_ACCEPTED_FINDINGS_PATH`. Background sync in a multi-root workspace still writes the wrong tree’s `.skills-review.json`.

---

### 12. Analyzer lexical link check still raw `startsWith` before realpath

`readLinkedPromptFiles` lexical stage does not use `isPathWithin` (Windows case). Canonical stage after `realpath` does. Not an open hole if realpath runs. Residual inconsistency next to the shared helper. Low.

---

### 13. Tmp caches / key-hash filenames

Catalog/pricing caches in `os.tmpdir()` default umask. Copilot cache name embeds `sha256(apiKey).slice(0,16)`. Debug log still `0o600`. Mixed hygiene. Not the headline.

---

## What is annoyingly fine

- `pathSafety.safeResolveFilePath` / `isPathWithin` — one canonical-to-canonical helper, both doors
- `providerKeys.validateKeyForProvider` — accept-list at extension + MCP engine build
- `loadReferenceGrounding` — reject symlink `references/` dir; realpath file containment
- Accepted-findings: identity-based eviction, unique tmp writers, load-time schema filter, shared `validateRelevantText`
- `fixDocument` uses `result.targetText`; random reference delimiters; function-form `replace`
- Fail-open gates surface skip risks instead of lying silently
- `onType` gone from package enum and config union
- External provider timeouts, cancel, non-retry 401/403, structured-output downgrade discipline
- Shared `tokenBudget`, `redact`, `llmText.stripCodeFences`
- Analysis locks per URI; per-run engine config overrides without persisting modal picks

The parts that were finished are finished. The parts that were “extracted for later” are still later.

---

## Architecture snapshot (as implemented)

```text
VS Code extension                              MCP stdio
─────────────────                              ────────
settings + one SecretStorage key               .skills-review.json + env
        │                                             │
        ▼                                             ▼
 validateKeyForProvider ◄──── shared ────► validateKeyForProvider
 safeResolveFilePath    ◄──── shared ────► safeResolveFilePath
 sessionBudget.ts       ◄── imported by nobody ──► (local clone in server.ts)
        │                                             │
        ▼                                             ▼
 Engine → Analyzer + SurgicalFixer
        │                                             │
        ▼                                             ▼
 diagnostics / WorkspaceEdit                   JSON tools + soft budget
 LM tools: no budget
 runFixIssue: wrong anchor string
```

---

## Priority

1. `runFixIssue`: splice with `fixResult.targetText` (mirror `fixDocument`)
2. Wire `sessionBudget` into MCP **and** LM tools, or delete the shared file and stop pretending
3. Remove or implement `fixMode: 'chat'`; remove or implement `fixStrategy: 'improved'`
4. Split secrets by provider (or force re-entry on switch)
5. Honor `exclude` on `onSave` / path gates, or stop advertising global exclude
6. Pin MCP workspace root in synced config; fix env `configSource` label
7. Decide fail-closed vs fail-open when the user explicitly enabled optional fix gates

---

## Out of scope / not claimed

- Did not treat prior gilfoyle reports as a checklist
- Did not run the test suite or live providers
- Did not audit `scripts/` experiment farms beyond runtime imports

— end review
