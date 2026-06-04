# HANDOVER — Skills Review and Polish

> **Historical note:** This document is a pre-build handover from the earlier
> implementation phase. It is useful for context, but it is not the current
> release plan or a live build artifact.
>
> Read it only if you need the original design history. For current release
> readiness, start with [../RELEASE-READINESS.md](../RELEASE-READINESS.md) and
> [PROGRESS.md](PROGRESS.md).
>
> 1. `NEW-EXTENSION-DESIGN.md` — the full design + the 6 locked decisions
> 2. `ENGINE-REFERENCE.md` — how the analyzer/fixer engine works (to port it)
> 3. `LEARNINGS.md` — hard-won lessons; read before touching scoring/fixer/prompts

---

## What this project is

A **new VS Code extension**, `skills-review-and-polish` (display: "Skills Review
and Polish"). It is an **authoring-time linter + surgical fixer for AI
customizations** — `SKILL.md`, `*.instructions.md`, `*.prompt.md`, `*.agent.md`,
`AGENTS.md`. It finds contradictions, ambiguities, coverage gaps, persona
conflicts, structural/cognitive-load problems, and hygiene issues, surfaces them
as squiggles/diagnostics, and offers safe one-click fixes.

It is a fresh, clean re-architecture of an engine proven in the source repo
`/workspace/vscode-chat-customizations-evaluation`. That repo has TWO overlapping
engines: an older LSP-based extension (`client/` + `src/` server) and a newer,
richer CLI engine (`cli-analyzer.js` + `src/analyzers/llm.ts`). **We port FROM
the CLI engine** (it has the surgical fixer, scoring, median-of-N, risk
classifier — everything). Copies are in `../../reference-engine/`.

## The 6 locked decisions (do not relitigate without reason)

1. **Extension, not MCP.** An authoring-time linter needs squiggles, lightbulbs, CodeLens, inline UI — MCP is headless and would reintroduce API keys. Agentic value comes from `contributes.languageModelTools` *in-process*. MCP stays an optional later add-on.
2. **In-process, not LSP.** The engine is IO-bound (it awaits network LLM calls; CPU work is milliseconds), so LSP's off-thread benefit doesn't apply, while LSP's cost (a server process can't reach `vscode.lm`) is paid on every call. In-process aligns with agentic tools + BYO-key. Offload to a `worker_thread` only if a real CPU hotspot ever appears.
3. **Default provider = `vscode.lm`** (Copilot subscription, **no API keys**). External key-based providers (`openrouter`, `githubModels`) are optional, key stored in `SecretStorage`. See `src/providers/vscodeLmProvider.ts`.
4. **Human-in-the-loop fixing by default.** Autonomous `--apply` is NOT production-safe (proven across 100 prod skills — see `LEARNINGS.md`). Default `fixMode = diff` (preview + accept). This is a product decision, not a detail.
5. **Median-of-N scoring at the decision layer.** The analyzer noise floor is ±6 even at temp 0. `scoreSamples` default 3; keep/revert only beyond `PENALTY_NOISE_MARGIN = 6`. Never decide on a single scan.
6. **Waza scoped OUT of v1.** Waza is a separate external Go CLI for behavioral eval suites (graders) — orthogonal to the analyzer, high friction, not the differentiator. Leave a clean seam to re-add later; don't build it now.

## Model-dropdown limitation (known)

`package.json` setting enums are static and can't list live Copilot models. The
solution (already stubbed) is the **`Select Analysis Model` / `Select Fix Model`**
commands: a QuickPick populated from `vscode.lm.selectChatModels()` that writes
the chosen `family` to settings. Don't try to make the enum dynamic.

---

## Historical status (pre-build context)

- **Scaffold complete and should compile:**
  - `package.json` — full manifest: settings, commands, editor-title menus, activation.
  - `tsconfig.json`, `.gitignore`, `.vscodeignore`, `eslint.config.mjs`, `vitest.config.ts`.
  - `src/extension.ts` — activation: diagnostic collection, command registration, context keys, run-on-save wiring, model-select QuickPick, set-API-key (SecretStorage).
  - `src/config.ts` — typed settings reader (`readConfig()`) + `isCustomizationPath()`.
  - `src/core/types.ts` — **vscode-free** types: `AnalysisResult`, `LlmProvider`, `EngineConfig`, wave names. (This is the vscode-free version of `reference-engine/types.ts`.)
  - `src/core/index.ts` — `Engine` class skeleton: `analyze()`, `score()`, `surgicalFix()` all throw "not yet ported" with pointers.
  - `src/providers/vscodeLmProvider.ts` — working `vscode.lm` wrapper implementing `LlmProvider` (model selection, deep-tier, max_tokens 16384, timeout).
  - `src/ui/diagnostics.ts` — `AnalysisResult[]` → `vscode.Diagnostic[]` with severity overrides ('off' drops).
- **Reference engine copied** to `../../reference-engine/` (port FROM these).
- **Test fixtures seeded** in `test/fixtures/` — PRIMARY (`mock_skill`, 91 known issues) + ADVERSARIAL (`mock_skills_4`, camouflaged), with an expected-counts manifest in `test/fixtures/README.md`. Ground truth for validating the Phase 1 port.
- **Docs written:** this file, `NEW-EXTENSION-DESIGN.md`, `ENGINE-REFERENCE.md`, `LEARNINGS.md`.

**What is NOT done:** the actual engine port. `Engine.analyze/score/surgicalFix`
are stubs. `fixAll` shows a "not yet ported" message. No code actions, CodeLens,
hovers, tree view, or languageModelTools yet. No `node_modules` (run `npm install`).

---

## Historical phased plan

### Phase 1 — Extract the core engine (vscode-free)

- Port `reference-engine/llm.ts` into `src/core/` as the analyzer. Replace its `LLMProxyFn` calls with `LlmProvider.complete()`. Make it fully vscode-free (the `Range` import is already solved in `core/types.ts`). Map `modelTier: 'deep'` → `deepModel`.
- Port the scoring + `medianTotalPenalty` from `cli-analyzer.js` into `Engine.score()`.
- Port the 6 wave system prompts verbatim (they're tuned — see LEARNINGS: coverage HIGH-only, fence-strip fix).
- Bring over `llm.test.ts` / `risk-classifier.test.ts`; get `npm test` green.
- **Validate detection against the seeded fixtures** in `test/fixtures/` (PRIMARY = 91 known issues, ADVERSARIAL = camouflaged). See `test/fixtures/README.md` for expected per-category counts. Build the tiny median-of-3 vitest harness described there as the analyzer regression gate (in-repo replacement for the source repo's battle harness).

### Phase 2 — Extension shell (in-process, vscode.lm)

- Wire `Engine` + `VsCodeLmProvider` into `analyzeDocument()` (already stubbed in `extension.ts`). Publish diagnostics. Handle the "no models / not signed in" case gracefully (provider already returns a friendly error).

### Phase 3 — Code actions / CodeLens / hovers + Fix

- `CodeActionProvider`: per-diagnostic "Fix this issue" quick fix → `Engine.surgicalFix()` with the safety gates + median-of-N keep/revert. Default `fixMode = diff` (preview via `vscode.diff` or inline accept).
- Port the surgical fixer + ALL safety gates from `cli-analyzer.js` (`surgicalFixFile`, `meaningPreservationReject`, `classifyEditRisk`, frontmatter protection, growth guards). Surface `classifyEditRisk` flags in the fix UI.
- CodeLens at top of file: score + grade + issue count (gated by `showScoreCodeLens`).
- Hovers with `suggestion` text.

### Phase 4 — Providers, QuickPicks, severity, run-on-save

- Implement `openrouter`/`githubModels` providers (key from `SecretStorage`) behind the `provider` setting, mirroring the CLI providers.
- Finish `severityOverrides` (already applied in diagnostics) and `minSeverityToShow`.
- `runOn: onSave|onType` (onSave already wired; debounce onType).

### Phase 5 — Agentic surface

- `contributes.languageModelTools`: expose `analyze` and `fix` as in-process LM tools so Copilot agent mode can call them.
- Optional: a chat participant (`@skills`) and a tree view of issues across the workspace.

### Phase 6 — Experimental

- `experimental.inlineRewrites`: preview surgical rewrites as inline ghost text (setting already exists, default off).

### Phase 7 — Optional later

- MCP server wrapper around `core/` (the vscode-free core makes this clean).
- Waza behavioral-eval integration (external Go CLI) behind a clear seam.

---

## Settings surface (already in package.json, maps 1:1 to CLI env)

`enable, provider (vscode-lm|openrouter|githubModels), model, deepModel,
fixModel, analysisMode (single|multiWave=default), enabledWaves (6),
scoreSamples (1-5, def 3), runOn (manual|onSave|onType), include/exclude globs,
severityOverrides (per-code error|warning|info|hint|off), fixMode
(diff|loop|chat), fixStrategy (subtractive|additive|improved),
fixLoopMaxIterations, fix.semanticCheck, fix.selfCritique,
fix.referenceGrounding, showScoreCodeLens, experimental.inlineRewrites,
telemetry.enable`. The CLI-env→setting table is in `ENGINE-REFERENCE.md §4`.

---

## How to verify the scaffold

```bash
cd /workspace/skills-review-and-polish
npm install
npm run compile   # tsc — should pass (engine stubs throw at runtime, not compile time)
npm run lint
# F5 in VS Code to launch the Extension Development Host
```

Note: `reference-engine/` is excluded from `tsconfig` and `.vscodeignore` — it is
reference material, not part of the build. Port code OUT of it into `src/`.

## Guardrails

- Do NOT modify or commit the source repo `/workspace/vscode-chat-customizations-evaluation`.
- Keep `src/core/` free of any `vscode` import (so CLI/MCP/tests can reuse it).
- Read `LEARNINGS.md` before changing scoring, the fixer, or any wave prompt — several "obvious improvements" were tried there and regressed.
