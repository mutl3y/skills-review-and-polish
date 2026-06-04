# Engine Reference — Skills Review and Polish

> Self-contained copy of the analyzer/fixer architecture from the source repo
> `vscode-chat-customizations-evaluation`. This is the knowledge you need to port
> the engine into `src/core/` without access to the original repo or chat history.
>
> The actual source files are in `../../reference-engine/`:
>
> - `cli-analyzer.js` — surgical fixer + scoring + 3 providers + battle harness (the richest engine)
> - `llm.ts` — the 6-wave analyzer (originally `src/analyzers/llm.ts`); already uses an `LLMProxyFn` seam
> - `types.ts` — original type defs (imports `Range` from `vscode-languageserver` — must be made vscode-free; already done in `src/core/types.ts`)
> - `fix-utils.ts` — pure fix utilities
> - `extension.legacy.ts` — the old LSP-client extension; reference for vscode integration patterns (model selection, diagnostics, code actions)
> - `llm.test.ts`, `risk-classifier.test.ts` — tests to port

---

## 1. Multi-Wave Analyzer (`llm.ts`)

The analyzer runs **6 parallel specialized LLM "waves"** + a deterministic
composition-conflicts pass. Each wave has a static system prompt (provider prompt
caching → ~50% token discount after first call). Run with `Promise.allSettled`.

| Wave | System Prompt const | Model Tier | JSON field | Output code | Purpose |
| ---- | ------------------- | --------- | ----------- | ----------- | ------- |
| Contradictions | `SYSTEM_PROMPT_CONTRADICTION` | **deep** | `.contradictions[]` | `contradiction` | Direct conflicts, domain-inference, numeric overlaps, enable/disable conflicts |
| Ambiguities | `SYSTEM_PROMPT_AMBIGUITY` | standard | `.ambiguity_issues[]` | `ambiguity-llm` | Material-difference vagueness, weak obligation (try/should/might), delegated decisions |
| Persona | `SYSTEM_PROMPT_PERSONA` | standard | `.persona_issues[]` | `persona-inconsistency` | Role/authority/style/decisiveness conflicts (BOTH sides must be explicit) |
| Structural | `SYSTEM_PROMPT_STRUCTURAL_QUALITY` | standard | `.cognitive_load{}` | `cognitive-*` | Nesting, priority conflicts, double negatives, sequencing, decision delegation |
| Coverage | `SYSTEM_PROMPT_COVERAGE` | standard | `.coverage_analysis{}` | `coverage-gap` | HIGH-impact gaps only, one-per-category cap (see Learnings) |
| Hygiene | `SYSTEM_PROMPT_HYGIENE` | standard | `.hygiene_issues[]` | `hygiene-*` | Redundancy, preamble, vague directives, passive voice, dead code, unordered process, over-specification, circular definitions |
| Composition-Conflicts | (inline, no LLM) | — | — | — | Deterministic cross-wave dedup |

**Call chain:** `analyze(doc)` → parse metadata → run 6 waves + composition in
parallel → each wave calls `callLLM(prompt, systemPrompt, modelTier)` →
`this.proxyFn({ prompt, systemPrompt, modelTier })` → parse JSON →
`processXxx(doc, parsed, results)` locates text via `findTextRange(doc, text)` →
`runConsolidationPass(results)` deterministic dedup → return.

**The seam to reuse:** `callLLM` → `proxyFn` is an `LLMProxyFn`. In the new
extension, replace `proxyFn` with the `LlmProvider.complete()` interface
(`src/core/types.ts`). `modelTier: 'deep'` maps to the `deepModel` setting.

### Cognitive sub-types (from structural wave)

`cognitive-nested-conditions`, `cognitive-priority-conflict`,
`cognitive-delegated-decision`, `cognitive-constraint-overload`,
`cognitive-sequencing`, `cognitive-deep-decision-tree`.

### Hygiene sub-types

`hygiene-redundant-instruction`, `hygiene-non-actionable-preamble`,
`hygiene-vague-directive`, `hygiene-missing-agent`, `hygiene-dead-instruction`,
`hygiene-unordered-process`, `hygiene-over-specification`,
`hygiene-circular-definition`.

### Consolidation (deterministic, NOT an LLM call)

1. Same-code duplicates: same code + same instruction (≤80 normalized chars) → keep first.
2. Contradiction subsumption: a `contradiction` sharing ≥4 6-char word stems with a `cognitive-priority-conflict`/`cognitive-constraint-overload` drops the subordinate.
3. Primary-wave subsumption: cognitive sub-types sharing ≥4 stems with hygiene/ambiguity findings on the same pattern are dropped.

### Infrastructure codes (NOT scored as issues)

`llm-error`, `llm-parse-error`, `llm-disabled`, `llm-loop-detected`,
`contradiction-related`, `high-complexity`.

---

## 2. Quality Scoring (`cli-analyzer.js`)

Deterministic formula:

```text
score = 100 - issuePenalty - lengthPenalty
```

**Issue penalty (severity-weighted):** `error ×15`, `warning ×6`, `info ×2`, `hint ×1`.

**Length penalty (line count):** ≤150 → 0; 151–250 → −5; 251–550 → −12; 551–800 → −22; >800 → −35.

**Grades:** A ≥90, B ≥75, C ≥60, D ≥45, F <45. Complex skills (`workflow`/`meta` type) reduce thresholds by 10–15.

**Pillars:** Contradictions, Clarity (ambiguity/persona/obligation), Completeness (coverage/dead), Structure (cognitive/waste/over-spec).

### Median-of-N penalty (the keep/revert decision) — CRITICAL

`medianTotalPenalty(filePath)` runs `SCORE_SAMPLES` (default **3**) independent
analyzer scans and takes the **median** total penalty. This collapses the ±6
noise floor (see Learnings). Keep a fix only if penalty improves by more than
`PENALTY_NOISE_MARGIN = 6`. **Never use a single scan for keep/revert.**

---

## 3. Surgical Fix Pipeline (`cli-analyzer.js`, `surgicalFixFile`)

Per-diagnostic find-and-replace (NOT whole-file rewrite). Only
`SURGICAL_FIXABLE_CODES` are eligible (ambiguity/hygiene mostly; contradictions &
coverage need human judgment).

**Flow per diagnostic:**

1. Locate anchor; protect YAML frontmatter (`frontmatterRange()` skips `---...---`).
2. Build context: `surroundingContext()` read-only window + `skillDomainHint()` + optional `loadReferenceGrounding()` (sibling `references/` dir).
3. Call fix LLM with deterministic system prompt (temp 0, top_p 0; `decodingParams()`).
4. **Deterministic safety gates** (`meaningPreservationReject()`):
   - **Delimiter injection** — reject if fix adds ` ``` ` / `"""` not in original.
   - **Line deletion** — only `hygiene-redundant-instruction` may delete lines.
   - **Obligation loss** — rewrites must preserve modal tokens (must/should/may/consider/optional…).
   - **Factual mutation** — reject concept swaps (e.g. "sequentially"→"in parallel") unless additive.
   - **Growth guard** — upper bound 1.5× (conservative wins; 2× regressed); lower bound 0.5× (don't delete half the content).
   - **Anchor cap** — `MAX_SURGICAL_ANCHOR_CHARS = 350`; skip if exact anchor not found and paragraph huge.
5. **Optional** semantic-equivalence judge (`FIX_SEMANTIC_CHECK`) and factual-drift self-critique (`FIX_SELF_CRITIQUE`, forced for additive).
6. **Median-of-N keep/revert** via `medianTotalPenalty` before/after; revert if not improved beyond margin.

**Fix strategies:**

- **subtractive** (default): tighten by removing vagueness; result ≤ original length.
- **additive** (`FIX_AMBIGUITY_ADDITIVE`, ambiguity-llm only): APPEND-ONLY — reproduce original verbatim, INSERT one concrete clause; enforced by subsequence check (`appendOnlyBreak()` — original tokens must be a subsequence of fixed tokens). Forces self-critique.
- **improved**: scope-capped; blocks fixes to infra codes.

**Risk classifier (`classifyEditRisk`)** for HITL: flags deletion, structure/line-count change, bullet/number-marker change, numeric/threshold change, dropped scope word, obligation/hedge removal, concept swap, and **dropped-detail** (net loss of meaningful content words via multiset counts, minus a filler allowlist). This flag lifts gate coverage 68%→92% (see Learnings). Tested in `risk-classifier.test.ts`.

---

## 4. Providers (CLI — reference only; extension uses vscode.lm)

The CLI supports 3 key-based providers (Copilot API, GitHub Models, OpenRouter)
with split-provider mode (standard waves on one, deep wave on another). The new
extension's **default** provider is `vscode.lm` (no keys). The CLI providers are
the model for the optional `openrouter`/`githubModels` providers later.

### Env var → setting mapping (CLI flag → extension setting)

| CLI env | Extension setting |
| ------- | ---------------- |
| `CLI_MODEL` | `skillsReviewAndPolish.model` |
| `CLI_DEEP_MODEL` | `skillsReviewAndPolish.deepModel` |
| `CLI_FIX_MODEL` | `skillsReviewAndPolish.fixModel` |
| `CLI_PROVIDER` | `skillsReviewAndPolish.provider` |
| `SCORE_SAMPLES` | `skillsReviewAndPolish.scoreSamples` |
| `FIX_STRATEGY` | `skillsReviewAndPolish.fixStrategy` |
| `FIX_SEMANTIC_CHECK` | `skillsReviewAndPolish.fix.semanticCheck` |
| `FIX_SELF_CRITIQUE` | `skillsReviewAndPolish.fix.selfCritique` |
| `FIX_AMBIGUITY_ADDITIVE` | `skillsReviewAndPolish.fixStrategy = additive` |
| `FIX_REFERENCE_GROUNDING` | `skillsReviewAndPolish.fix.referenceGrounding` |
| `CLI_SEED` | `skillsReviewAndPolish.seed` (engine config) |

---

## 5. AnalysisResult shape (the contract)

```jsonc
{
  "code": "contradiction",
  "message": "Contradiction: \"do X\" conflicts with \"do not X\".",
  "severity": "error|warning|info|hint",
  "range": { "start": {"line":10,"character":5}, "end": {"line":10,"character":30} },
  "analyzer": "contradiction-detection",
  "suggestion": "Remove or reconcile one instruction.",
  "relevantText": "exact fragment from doc"
}
```

This maps 1:1 to `AnalysisResult` in `src/core/types.ts` and to a `vscode.Diagnostic`.

---

## 6. Why these choices (rationale)

- **Multi-wave** beats single prompt: 86% vs 82% Jaccard; coverage detection 60% vs 33%. Each focused call reduces FP/FN. Static prompts → caching. Parallel → comparable latency.
- **Deep model for contradictions** only: contradictions need cross-reference + domain reasoning; other waves are focused enough for a standard model.
- **Deterministic consolidation** (not LLM): auditable, reproducible, no probabilistic dedup variance.
- **Safety gates before semantic judge**: deterministic guards catch structural corruption cheaply; the LLM judge is optional (doubles cost).
