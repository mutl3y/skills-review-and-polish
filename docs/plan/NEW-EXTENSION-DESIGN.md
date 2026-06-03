# New Extension — Design Review, Direction & Options

Status: Draft for decision
Date: 2026-06-01
Owner: (you)

This document reviews the current implementation, evaluates the right delivery
vehicle (VS Code extension vs MCP server vs both), and proposes a concrete
design for a new extension built on the latest fork engine. It ends with a
phased plan and the open decisions that need a call before we write code.

---

## 1. Where we are today (two engines, one repo)

The repo currently contains **two overlapping implementations** of the same
core idea — "lint and fix AI customizations" (skills / instructions / agents /
prompts):

| | **Extension engine** (`client/` + `src/` server) | **CLI engine** (`cli-analyzer.js` + `src/`) |
|---|---|---|
| Shape | LSP client + Node language server | Standalone Node ESM CLI |
| LLM access | `vscode.lm` (no API keys, uses Copilot sub) via an LSP proxy | External providers (GitHub Models, OpenRouter, Copilot API) + API keys |
| Analysis | Server-side analysis, diagnostics published to editor | 6 specialized **multi-wave** passes, or single-prompt baseline |
| Sampling | none | `SCORE_SAMPLES` median penalty scoring |
| Fixing | `fixMode` = diff / loop / chat | Surgical fix with safety gates: delimiter guard, line-deletion guard, obligation-strength preservation, concept-swap detection, append-only verify, semantic check, self-critique, reference grounding |
| UI | Diagnostics, status bar, diff view, title-bar buttons, Waza commands | Tables / JSON / Markdown, battle-test harness, HTML dashboard |
| Maturity | Solid VS Code integration, **older/simpler** analysis | **Newest, richest** analysis + the hardened fixer |

**The gap:** the best analysis + the safest fixer live in `cli-analyzer.js`, but
the best *editor integration* lives in `client/`. The CLI also depends on API
keys, which we do **not** want as the default path for an extension.

**The opportunity:** extract the CLI engine into a shared, provider-agnostic
core library, and wrap it with the extension's `vscode.lm` integration so users
get the advanced engine with **zero API keys**.

---

## 2. The core architectural decision: Extension vs MCP vs both

### What each can and cannot do

| Capability | VS Code Extension | MCP Server |
|---|---|---|
| Diagnostics (squiggles, Problems panel) | ✅ | ❌ |
| Code actions / quick-fix lightbulbs | ✅ | ❌ |
| CodeLens, hovers, status bar, tree views | ✅ | ❌ |
| Inline / diff fix preview in the editor | ✅ | ❌ |
| Use Copilot models with **no API key** (`vscode.lm`) | ✅ | ⚠️ only via client "sampling", limited support |
| Invoked by *any* agent/host (Claude Desktop, CLI, etc.) | ❌ | ✅ |
| Agentic "analyze/fix my skill" from chat | ✅ via chat tools | ✅ |
| Headless / CI usage | ⚠️ awkward | ✅ (but so is the existing CLI) |

### Conclusion

The product is fundamentally an **authoring-time linter + fixer**. Its value is
squiggles, lightbulbs, inline review, and a workspace health view — **none of
which MCP can deliver**. MCP is headless and would also reintroduce the API-key
problem.

**Recommended direction:**

1. **Primary vehicle = VS Code extension** built on a shared core engine, using
   `vscode.lm` so there are no API keys by default.
2. **Agentic surface = `contributes.languageModelTools`** (and optionally a
   `@customizations` chat participant) so Copilot's agent can call
   "analyze/fix customization" in-process — this gives the MCP-style benefit
   **without** a separate server or keys.
3. **Keep the existing CLI** for CI / batch / power users (it already works with
   keys). The shared core means CLI and extension never diverge again.
4. **Drop Waza from v1.** It is a separate external Go binary for *behavioral*
   eval — orthogonal to the analyzer, high setup friction, not our
   differentiator. Keep a clean, lazy-loaded seam to re-add it later as an
   optional "Behavioral Eval" feature if users with task fixtures ask.
5. **MCP server = optional later**, only if there's demand for non-VS-Code
   hosts. It would reuse the same core engine.

```
                 ┌─────────────────────────────┐
                 │   core engine (shared lib)  │  ← from cli-analyzer.js
                 │  analyze() · surgicalFix()  │     provider-agnostic
                 │  waves · sampling · guards  │
                 └──────────────┬──────────────┘
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
  VS Code extension        existing CLI           (optional) MCP
  vscode.lm provider       key-based provider      key/sampling provider
  diagnostics/codeactions  batch / CI              other hosts
  languageModelTools
```

---

## 3. Proposed extension architecture

- **`core/`** — pure TS, no `vscode` import. Houses the analyzer (waves +
  single-prompt), the surgical fixer + all safety gates, scoring/sampling, and a
  small `LlmProvider` interface: `complete(prompt, system, opts) => string`.
- **Providers** implement `LlmProvider`:
  - `VsCodeLmProvider` (default) — wraps `vscode.lm.selectChatModels` / `sendRequest`.
  - `ExternalProvider` (opt-in) — OpenRouter / GitHub Models with key from
    **SecretStorage** (never plain settings).
- **Extension layer** (`vscode`-aware): diagnostics, code actions, CodeLens,
  hovers, status bar, tree view, commands, settings, language-model tools.
### Decision: run the engine **in-process** (drop the LSP server)

The current code runs the analyzer in a separate `server.js` process over LSP.
Because that process cannot reach `vscode.lm`, it needs an **LLM proxy
protocol** (server → client → `vscode.lm` → client → server) on *every* call —
6 waves × `scoreSamples` worth of IPC round-trips per file.

This engine is **IO-bound** (it awaits network LLM calls; the CPU work is
milliseconds of regex + JSON on one file), so the LSP split's main benefit
(keeping heavy CPU off the UI thread) does not apply, while its main cost (the
proxy) is paid on every call. In-process also aligns with two locked decisions:
**agentic `languageModelTools`** run in the host and can call the engine
directly, and **BYO-key providers** are simplest to wire from one place.

→ **Run in-process. Remove the LSP server and the LLM proxy.** If a real CPU
hotspot ever appears, offload *that* piece to a `worker_thread` — no full LSP.

---

## 4. VS Code surfaces to hook into

| Surface | Use | Priority |
|---|---|---|
| **Diagnostics** | Squiggles + Problems panel per finding (have it) | P0 |
| **CodeActionProvider** (quick fix) | Lightbulb on each diagnostic: "Apply suggested rewrite", "Fix this contradiction", "Ignore this rule" | **P0 — biggest UX win** |
| **Source action "Fix all"** | One-shot fix of all auto-fixable findings | P1 |
| **CodeLens** | Header line: `Score: B (82) · 5 issues · Rescan · Fix all` | P1 |
| **Hovers** | Rich rationale + before/after suggestion per finding | P1 |
| **Status bar** | Live score / progress (have it) | P1 |
| **Tree view ("Customizations Health")** | Workspace-wide list of all skills with grades, jump-to | P2 |
| **`languageModelTools`** | Agent-callable `analyze`/`fix` tools | P2 |
| **Chat participant `@customizations`** | "analyze this skill", "why is line 20 flagged" | P3 |
| **On-save / on-type (debounced) run** | Config-gated automatic analysis | P1 |
| **Inline suggestions (`InlineCompletionItemProvider`)** | ⚠️ Poor fit — that API is for typing-time completions, not rewriting existing prose. Prefer **Code Actions + diff preview** for rewrites. Revisit only if we want "ghost text" rewrite previews. | P3 / maybe-not |

**Note on "inline suggestions":** the honest answer is that VS Code's inline
completion API is built for autocomplete while typing, not for surgically
rewriting flagged sentences. The native idiom for "here's a better version of
this line" is a **Quick Fix (code action) that opens an inline diff** — which we
already have the fixer for. We'll lead with that and treat ghost-text rewrites
as an experiment, not a v1 commitment.

---

## 5. Settings design (your asks + proposed additions)

### Your three explicit asks

1. **Model choice as dropdowns.** Two-part solution because `package.json`
   enums are *static* and can't list live Copilot models:
   - A **`Select Analysis Model` command** opens a QuickPick populated live from
     `vscode.lm.selectChatModels()` and writes the pick to settings. Same for
     **deep/contradiction model** and **fix model**.
   - Settings still hold the chosen family as a string (with a curated enum of
     common families as a fallback/quick-edit).
2. **Single prompt vs multi-wave.** `analysisMode: "single" | "multiWave"`
   (default `multiWave`). Optionally `enabledWaves` multiselect to disable noisy
   categories.
3. **Samples count.** `scoreSamples: 1–5` (default 3) — drives the median
   penalty scoring used by the keep/revert fix gate.

### Full proposed settings surface

```jsonc
// Models / provider
"…model"                : string  // analysis model family (QuickPick-assisted)
"…deepModel"            : string  // contradictions/deep wave (split provider)
"…fixModel"             : string  // surgical fix model (reasoning model recommended)
"…provider"             : "vscode-lm" | "openrouter" | "githubModels"  // default vscode-lm
//   external API keys live in SecretStorage, NOT settings

// Analysis behaviour
"…analysisMode"         : "single" | "multiWave"      // default multiWave
"…enabledWaves"         : ["contradictions","ambiguities","persona",
                            "structural","coverage","hygiene"]  // toggle categories
"…scoreSamples"         : 1–5            // default 3
"…seed"                 : number | ""    // reproducibility
"…runOn"                : "manual" | "onSave" | "onType"   // default manual/onSave
"…include" / "…exclude" : glob[]         // which files are "customizations"

// Severity tuning (ESLint-style rule levels)
"…severityOverrides"    : { "<diagnostic-code>": "error|warning|info|hint|off" }
"…minSeverityToShow"    : "hint|info|warning|error"

// Fixing
"…fixMode"              : "diff" | "loop" | "chat"   // exists
"…fixStrategy"          : "subtractive" | "additive" | "improved"
"…fixLoopMaxIterations" : 1–10           // exists
"…fix.semanticCheck"    : boolean        // extra equivalence judge
"…fix.selfCritique"     : boolean        // factual-drift audit
"…fix.referenceGrounding": boolean       // ground facts to source
"…fix.ambiguityAdditive": boolean        // append-only clause for ambiguities

// Misc
"…showScoreCodeLens"    : boolean
"…telemetry.enable"     : boolean
"…maxTokens" / "…requestTimeoutMs"
```

These map 1:1 onto the existing CLI env flags (`CLI_MODEL`, `CLI_DEEP_MODEL`,
`SCORE_SAMPLES`, `FIX_SEMANTIC_CHECK`, `FIX_SELF_CRITIQUE`,
`FIX_REFERENCE_GROUNDING`, `FIX_AMBIGUITY_ADDITIVE`, `FIX_STRATEGY`, `CLI_SEED`),
so the shared core can read a single config object regardless of host.

**Power-user UX option:** a small **webview "Settings / Run" panel** that shows
live model lists, wave toggles, and a "Run with these options" button without
editing JSON. Optional; settings + QuickPick cover the basics.

---

## 6. Phased plan

**Phase 0 — Decisions (this doc).** Locked in §8; only the name is open (§9).

**Phase 1 — Extract shared core.** Move analyzer + surgical fixer + scoring out
of `cli-analyzer.js` into `core/` behind an `LlmProvider` interface. CLI and
extension both consume it. Port the existing unit tests. *No behavior change.*

**Phase 2 — New extension shell, in-process, `vscode.lm` provider.** New
id/name/publisher. Wire the multi-wave engine in-process (no LSP/proxy);
diagnostics + diff fix; settings for `analysisMode`, `scoreSamples`, model.

**Phase 3 — Code Actions + CodeLens + hovers.** Per-finding lightbulbs, "fix
all", header score lens, rich hovers — the big UX upgrade.

**Phase 4 — Providers + model QuickPicks + severity overrides + run-on-save.**
BYO-key external providers via SecretStorage; `Select Model` / `Set API Key`
commands; ESLint-style `severityOverrides`.

**Phase 5 — Agentic surface.** `languageModelTools` (`analyze`, `fix`) +
optional `@customizations` chat participant. Workspace health tree view.

**Phase 6 — Ghost-text experiment.** `InlineCompletionItemProvider` behind
`experimental.inlineRewrites` (default off).

**Phase 7 (optional, later).** MCP server and/or re-introduce Waza behind a flag.

---

## 7. Risks / watch-items

- **`vscode.lm` rate limits & consent** — first call prompts the user; multi-wave
  = up to 6 calls/file × samples. Need batching, caching (the CLI already caches
  by content hash), and a concurrency cap.
- **Static-enum limitation** for model dropdowns → solved via QuickPick command.
- **Determinism** — `vscode.lm` exposes fewer knobs than raw providers (limited
  seed/temperature control); reproducibility will be weaker than the CLI.
- **Scope creep** — resist building the dashboard/battle harness into the
  extension; that stays CLI/CI.

---

## 8. Decisions (locked 2026-06-01)

| # | Decision | Choice |
|---|---|---|
| 1 | Architecture | **In-process** — drop LSP server + LLM proxy (see §3) |
| 2 | Providers in v1 | **`vscode.lm` (default) + BYO-key external** (OpenRouter / GitHub Models) via SecretStorage |
| 3 | Agentic surface | **In v1** — `languageModelTools` (+ optional `@customizations` chat participant) |
| 4 | Identity | **New id / name / publisher** (fresh extension, reuse engine code) |
| 5 | Inline ghost-text rewrites | **Experiment in v1** behind a feature flag (`InlineCompletionItemProvider`), alongside Code Actions + diff |
| 6 | Waza | **Out of v1**, clean seam to re-add later |

### Implications of these choices

- **Providers:** keep the core's multi-provider design. Add a `provider` setting
  and a **`Set API Key` command** that stores keys in **SecretStorage** (never
  in settings JSON). `vscode.lm` is the default so most users need no key.
- **Agentic in v1:** add `contributes.languageModelTools` for `analyze` and
  `fix` (and the chat participant). These run in-process and call the engine
  directly — another reason in-process is the right base.
- **New identity:** new `package.json` (id/name/publisher/icon). The old
  `client/` + `server` wiring is replaced; engine code is reused via `core/`.
  **Needs a name** — see §9.
- **Ghost-text experiment:** add an `InlineCompletionItemProvider` behind
  `experimental.inlineRewrites` (default off) that previews a fixer rewrite as
  ghost text on the flagged line. Treated as an experiment, not a guarantee.

## 9. Resolved

1. **Architecture confirmed in-process.** (The CLI engine existed only so we
   could test the analyzer *before* `vscode.lm` integration was available; it is
   no longer the target runtime.)
2. **Name:** display **"Skills Review and Polish"**, id `skills-review-and-polish`.
   Publisher TBD at publish time.
```
