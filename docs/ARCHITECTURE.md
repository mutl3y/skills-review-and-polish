# Architecture — How Skills Review and Polish Works

**This guide explains the technical decisions behind the extension** — why it works the way it does, what to expect from results, and how to interpret accuracy metrics.

**For end users:** Read this if you want to understand why the analyzer makes the choices it does.
**For developers:** See [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) and [docs/plan/LEARNINGS.md](plan/LEARNINGS.md) for implementation details.

---

## How the Analyzer Works

### The Multi-Wave Architecture

The **Skills Review and Polish** analyzer uses a **6-wave scanning architecture** instead of a single LLM pass. Each wave analyzes your file for a specific category of problems, then passes results forward.

Here's what happens when you run analysis:

| Wave | What It Checks | Example Issues |
| --- | --- | --- |
| **1. Contradictions** | Logical conflicts between instructions | "Always validate" vs. "Never validate" |
| **2. Ambiguities** | Vague or unclear language | "Recently", "appropriate", "significant" |
| **3. Persona** | Inconsistent voice or character | Shifts from formal to casual mid-document |
| **4. Structural** | Organization and cognitive load problems | Redundancy, circular logic, overly complex nesting |
| **5. Coverage** | Missing important information | No error handling guidance |
| **6. Hygiene** | Formatting and dead code | Unused variables, trailing whitespace |

**Why waves instead of one big scan?**

- **Current release baseline:** about 87.3% recall on clean fixtures (schema-mode, 5×3), with 63–73% precision (see README Status)
- **Cost:** Multi-wave uses more LLM requests than single-pass, but gives each category a focused prompt
- **Quality:** Waves make failures easier to diagnose and tune than one large blended prompt
- **Caution:** Historical 82-86% Jaccard experiments are not current release claims unless re-run against the clean-fixture gate

### How Results Are Scored

Each wave produces a list of issues with severity levels (Error/Warning/Hint/Info). The analyzer then:

1. **Deduplicates** issues within the same document
2. **Scores** each issue by category
3. **Applies median-of-N scoring** — `scoreSamples` controls how many analyses are scored, then the median penalty sample is returned
   - This smooths out AI randomness (see "The Noise Floor" below)
   - More consistent results without changing the model

### Why Results Can Vary Slightly

Even at temperature 0 (most deterministic setting), running the analyzer on the **same unchanged file** multiple times can produce slightly different results. This is because:

- The LLM uses a hosted multi-model system (MoE) that has inherent variance
- Each API call can route to a different model instance
- "Randomness" is baked in at the infrastructure level

**Example:** Analyzing the same file 5 times might give these total penalty scores: `30, 32, 38, 38, 42`.

**What to do:**

- Don't worry about small score fluctuations (±3–6 points is normal)
- For comparing before/after fixes, use the median-of-N (run N times, take middle value; N=3 is a good default for fix decisions)
- Only trust changes >10 points as definitely improvements

---

## Why Low-Reasoning Models?

The analyzer uses low-reasoning models (the default Copilot model, or `google/gemini-2.5-flash-lite` on OpenRouter), not reasoning models or Claude Haiku. Here's why:

### The Trade-Offs

| Aspect | Low-Reasoning (default Copilot / gemini-2.5-flash-lite) | Reasoning (o1/o3) | Claude Haiku |
| --- | --- | --- | --- |
| **Speed** | 30 seconds | 2+ minutes | 20 seconds |
| **Cost** | $0.003–$0.01 per call | $0.15–$0.30 per call | $0.001–$0.003 per call |
| **Noise level** | ±6 points | ±8 points | ±12 points |
| **Pattern detection** | Excellent | Excellent | Erratic (6→22 issues on same file) |
| **Determinism** | High | Medium | Low |

### Why Not Reasoning Models?

Reasoning models (o1, o3) are powerful but expensive (~10× cost) and slower. They're better for complex reasoning but add **more variance**, not less. For pattern-matching tasks like detecting contradictions, low-reasoning models are sufficient and more predictable.

### Why Not Claude?

During tuning, **Claude Haiku was tested and rejected:**

- Detection counts were erratic (same file might report 6 issues one run, 22 another)
- Noise floor was ±12 (vs. ±6 for gpt-4.1)
- Not suitable for deterministic extension behavior

---

## The Noise Floor: Per-Sample Variance vs. Retry/Merge Range

**This is the most important fact to understand about analyzer accuracy.**

The analyzer runs under greedy decoding (temperature 0). Two distinct
phenomena are often conflated, and keeping them separate is essential:

1. **Per-sample variance (±6).** Each individual LLM call is subject to
   irreducible variance because the model runs on a hosted multi-model system
   (MoE) that can route to different instances. Even at temperature 0, a single
   scan of the same unchanged file can land anywhere in a ±6 penalty band. This
   is the *noise floor* — it applies to every individual sample and cannot be
   eliminated by changing the model or prompt.

2. **Retry/merge range (collapsed to ±3).** The v0.1.39 deterministic
   retry/merge fix (first response wins unless a clean retry recovery occurs)
   reduces the *range* of that variance. A 10× noise-floor probe now shows
   **range 3 penalty / 1 finding, with 9 of 10 runs identical**. This is a real
   improvement, but it narrows the spread of samples — it does **not** remove
   the per-sample ±6 floor.

**What this means:**

- **Output is largely deterministic.** Re-running the analyzer on the same unchanged file usually reproduces the same findings (greedy decoding makes `seed` inert — it was prototyped and rejected). The retry/merge fix collapses the observable range from ±6 to ±3.
- **Score changes < 3 points are noise, not real improvements.**
- **Score changes > 10 points are real improvements.** We only accept/reject fixes if the penalty change exceeds the noise margin.

### Implications

1. **Don't chase small gains.** If a fix improves the score by 1–2 points, run it 3 times. If the median improvement is <3 points, it's probably random variance.

2. **Use median-of-N for reliability.** The analyzer can be configured to run multiple passes (configurable via `scoreSamples`) and takes the median score. This is your best estimate of the "true" score. The default is 1 pass for efficiency; use 3+ for critical keep/revert decisions. Median-of-N is the *durable* fix for the noise floor — the retry/merge path only narrows the range, it does not eliminate per-sample variance.

3. **CI/CD and automation need this too.** If you're using the MCP server for CI/CD checks, don't set pass/fail thresholds tighter than the residual noise margin.

---

## Variance Architecture: Honest Disclosure

The analyzer is an **authoring-time guidance tool**, not a production-grade
verification system. Its confidence claims are bounded by the following
structural facts, which are by design and not bugs:

- **The core sensor is nondeterministic.** The analyzer runs an LLM at
  temperature 0 on a hosted multi-model system (MoE). Routing variance means
  the same input can produce slightly different output across calls. This is
  irreducible at the infrastructure level.
- **Median-of-N, finding filters, and retry/merge are damage control, not
  elimination.** They narrow the observable range of variance (retry/merge:
  ±6 → ±3) and stabilize scores (median-of-N), but they do not remove the
  underlying per-sample noise floor.
- **Every keep/revert decision is a statistical judgment, not a deterministic
  one.** A single before/after scan cannot reliably detect a fix worth less
  than the noise margin (~±6 per sample, ~±3 post-retry/merge). Treat score
  deltas below the margin as noise.
- **The system is designed for authoring-time guidance, not production-grade
  verification.** Use it to catch contradictions, ambiguities, and coverage
  gaps while writing — not as a pass/fail gate with tight thresholds in CI/CD
  unless you account for the residual noise margin.

This disclosure exists so the product's confidence claims match its actual
capabilities: the analyzer provides guidance with **quantified uncertainty**,
not deterministic truth.

---

## Model Selection

### Default Behavior

When you install **Skills Review and Polish**, it defaults to using **GitHub Copilot** via the `vscode-lm` provider (VS Code's Language Model API).

**Why Copilot?**

- No API keys to manage
- Already trusted by VS Code
- Uses a strong, optimized model (the selected Copilot model by default; `google/gemini-2.5-flash-lite` recommended on OpenRouter)
- Familiar to most VS Code users

### Changing the Model

You can override the provider in VS Code Settings:

1. Open Settings: **Ctrl+,** (or **Cmd+,** on Mac)
2. Search: `Skills Review Provider`
3. Pick from:
   - **vscode-lm** (Copilot, default) ← Recommended
   - **openrouter** (requires API key)
   - **githubModels** (requires token)

### Cost Implications

| Provider | Setup | Cost | Speed |
| --- | --- | --- | --- |
| **vscode-lm** (Copilot) | Subscription | ~$20/month* | Fast |
| **openrouter** | API key | ~$0.001–0.01 per analysis | Medium |
| **githubModels** | Personal token | Free (preview) | Varies |

*If you already have Copilot for your subscription, no additional cost.

### Using a Specific Model

If you use **openrouter**, you can pick any model:

```json
"skillsReview.provider": "openrouter",
"skillsReview.model": "anthropic/claude-3.5-sonnet",  // or gpt-4-turbo, etc.
```

**Recommendation:** Stick with low-reasoning models (gpt-4.1, Claude 3.5 Sonnet) for fastest results. Reasoning models (o1, o3) are overkill and expensive.

---

## Accuracy & Limitations

### What the Analyzer Does Well

✅ **Contradictions** — Detects logical conflicts (instructions that contradict each other)
✅ **Ambiguities** — Flags vague language that could be misunderstood
✅ **Persona issues** — Catches inconsistent voice or character shifts
✅ **Structural problems** — Finds redundancy, over-nesting, dead code
✅ **Coverage gaps** — Identifies missing important information
✅ **Hygiene issues** — Spots formatting, redundancy, and dead code

### Current Accuracy

The current honest release baseline is:

- **Clean fixtures:** about 87.3% recall (schema-mode, 5×3)
- **Precision:** 63–73% (precision hardening to ≥85% is the remaining gate to formal release)
- **Determinism:** noise floor collapsed to range 3 penalty / 1 finding (9 of 10 runs identical) after the v0.1.39 deterministic retry/merge fix

The analyzer is useful as a reviewer and teaching aid, and is released as a
production-ready linter. Formal accuracy certification (e.g. unattended release
blocking on a fixed precision threshold) remains future work; precision
hardening is ongoing, not a blocker on using it as a linter today. Historical
fixture-specific runs found much higher category recall in some focused modes,
but those results are model-dependent and must be revalidated before being used
as public claims.

### What It Might Miss

⚠️ **Very subtle persona shifts** — If the voice changes gradually, might not be caught
⚠️ **Context-dependent ambiguities** — If ambiguity is only a problem in specific use cases
⚠️ **Domain-specific knowledge** — If your field has specialized terminology the analyzer doesn't know
⚠️ **Intentional vagueness** — Sometimes you *want* to be vague (e.g., creative prompts)

### When to Trust the Analyzer

✅ **Trust it when:** You're writing technical instructions, prompt templates, or skill definitions
✅ **Trust it when:** You want a fast first pass at quality before human review
✅ **Trust it when:** You're building a corpus of consistent, well-written instructions

⚠️ **Don't trust it when:** Writing creative or artistic prompts where vagueness is intentional
⚠️ **Don't trust it when:** Your domain has very specialized terminology or context

### False Positives and False Negatives

The analyzer occasionally flags issues that aren't really problems (false positives) or misses issues that are real problems (false negatives).

**If you see a false positive:**

1. Read the explanation
2. If you disagree, reject the issue (you can dismiss it in the Problems panel)
3. Open a GitHub issue with the example — helps us improve

**If you find a false negative (something it missed):**

1. Open a GitHub issue with the example
2. This helps us retrain and improve future versions

---

## Performance & Latency

### Analysis Time

Typical analysis times:

- **Small file (< 1000 words):** 10–20 seconds
- **Medium file (1000–5000 words):** 20–40 seconds
- **Large file (> 5000 words):** 40–120 seconds

Times include:

- LLM round-trips (3 passes for median scoring)
- JSON parsing and deduplication
- UI refresh

### Latency Breakdown

For a typical 2000-word file:

| Phase | Time |
| --- | --- |
| Request building | 0.5s |
| LLM API call (Wave 1) | 8s |
| LLM API call (Wave 2) | 7s |
| LLM API call (Wave 3) | 7s |
| JSON parsing | 1s |
| Deduplication & scoring | 1s |
| **Total** | **~24s** |

With **prompt caching** enabled (automatic in Copilot), repeat analyses on the same file are ~50% faster.

### Optimization Tips

**To speed up analysis:**

- Analyze smaller files separately (< 2000 words each)
- Use prompt caching (enabled by default for Copilot)
- Analyze during off-peak hours (if using OpenRouter or similar)

---

## Architecture Diagram

```text
┌─────────────────────────────────────────┐
│  User selects "Analyze This File"       │
└─────────────┬───────────────────────────┘
              │
              ▼
    ┌─────────────────────────────┐
    │ VS Code Extension           │
    │ (ui/diagnostics.ts)         │
    └─────────────┬───────────────┘
                  │
                  ▼
    ┌─────────────────────────────┐
    │ Multi-Wave Analyzer         │
    │ (core/analyzer.ts)          │
    └─────────────┬───────────────┘
                  │
        ┌─────────┼─────────┬─────────┬─────────┐
        │         │         │         │         │
        ▼         ▼         ▼         ▼         ▼
    Wave 1    Wave 2    Wave 3    Wave 4    Wave 5-6
   (Contra)  (Ambig)   (Person)  (Struct)  (Cov/Hyg)
        │         │         │         │         │
        └─────────┴─────────┴─────────┴─────────┘
                  │
                  ▼
    ┌─────────────────────────────┐
    │ Deduplication & Scoring     │
    │ (core/scoring.ts)           │
    └─────────────┬───────────────┘
                  │
                  ▼
    ┌─────────────────────────────┐
    │ Results Display             │
    │ (Squiggles + Problems panel)│
    └─────────────────────────────┘
```

---

## Batch API Transport (OpenRouter)

When the analyzer runs many requests against a single OpenRouter model, it can
submit them as a single Batch API job (`/api/beta/batches`) instead of N
sequential chat completions. This is cheaper and avoids rate limits, but not
every model supports batch mode — and some models are *batch-only* (they 404
on the standard chat endpoint with "This model is only available through the
Batch API").

The capability decision lives in `src/core/batchTransport.ts`, which wraps
`OpenRouterProvider.submitBatch` / `pollBatch` with a model-capability filter
and a single-request fallback:

```mermaid
flowchart TD
  A[Wave requests] --> B{isBatchSupported modelId?}
  B -- no --> C[Concurrent single requests<br/>provider.complete]
  B -- yes --> D[submitBatch → batch id]
  D --> E[pollBatch until terminal]
  E -- completed --> F[correlate results by custom_id]
  E -- failed/timeout --> C
  D -- error --> C
  C --> G[LlmResponse[] aligned 1:1]
  F --> G
```

- **Capability source**: `modelCatalog.isBatchSupported(modelId)` reads the
  `batchSupported` allowlist in `assets/openrouter-catalog.json`. Unknown
  models default to the safe single-request path.
- **Fallback**: any batch submission error, non-`completed` status, or missing
  results falls back to concurrent `provider.complete` and logs
  `batch_not_supported` / `batch_failed` / `batch_error`.
- **Schema**: the per-item `response_format` is identical to single-request
  mode (`LLM_RESPONSE_JSON_SCHEMA_BODY`); only the transport envelope differs
  (per-item `custom_id` correlation).
- **Gated (off by default)**: batch mode is controlled by the
  `skillsReviewAndPolish.batchEnabled` setting (default `false`). When off,
  `runAnalyzeFolder` never sets `useBatch` and `buildEngine` does not wrap the
  provider in `BatchAwareOpenRouterProvider`, so folder scans run synchronously
  like single-file analysis. The `:batch`-suffixed models are also filtered out
  of the model picker (`selectModel`) because they 404 on the standard chat
  endpoint. **As of 2026-07-30 the OpenRouter Batch API submission endpoint
  (`POST /api/beta/batches`) is down (returns an HTML 404 page) and the Batch
  API uses a 24-hour completion window, so batch mode should remain disabled
  until OpenRouter restores the endpoint and the latency is acceptable.** The
  batch code is retained but dormant.

---

## For Developers: Configuration

### Key Settings

```json
{
  "skillsReview.enable": true,
  "skillsReview.provider": "vscode-lm",
  "skillsReview.model": "",  // Empty = provider default / selected Copilot model (recommended). OpenRouter: "google/gemini-2.5-flash-lite"
  "skillsReview.analysisMode": "multiWave",  // or "single" / "focused"
  "skillsReview.logLevel": "info"  // or "debug" / "trace"
}
```

### Environment Variables

```bash
# Use a specific LLM provider
SKILLS_REVIEW_PROVIDER=openrouter

# Set OpenRouter API key
OPENROUTER_API_KEY=sk-...

# Enable debug logging
DEBUG=skills-review:*
```

### Model Catalog & Context-Length Resolution

The analyzer's document budget comes from the model's context window,
resolved via a three-tier lookup at `src/modelCatalog.ts`. As of
2026-07-17 there is no hard char cap on the analyzer; the budget is
`max(MIN, ctxTokens × 4 × CONTEXT_FRACTION)` (default
`MIN_DOCUMENT_CHARS = 8_000`, `CONTEXT_FRACTION = 0.8`).

| Tier | Source | When used |
| --- | --- | --- |
| 1 | Live OpenRouter `/models` catalog (~1,215 entries) | When OpenRouter is reachable. Cached 1h in-memory. |
| 2 | Bundled `assets/openrouter-catalog.json` (top-75 popular models, ~4.5KB) | Cold start, offline, or any time tier 1 fails. Ships inside the .vsix. |
| 3 | Static table (5 entries: `gpt-4o mini`, `gemini 2.0 flash`, `gemini 3.0 pro`, `mistral-small-2503`, `phi-3.5-mini-instruct`) | Niche Copilot display names and GitHub Models IDs not in the OpenRouter catalog. |
| Fallback | `undefined` → analyzer 200K-char fallback with `info`-level warning | When all lookups miss. |

Refresh maintenance: `npm run refresh-fixtures` re-pulls the live catalog
and rewrites both `assets/openrouter-catalog.json` (bundled subset,
~4.5KB) and `tests/fixtures/openrouter-catalog.json` (full 1,215-entry
catalog for test drift detection at `src/modelCatalog.test.ts`).

Provider interface: `LlmProvider.getContextLength()` is a **required**
method. `VsCodeLmProvider` reads `maxInputTokens` from the cached
`vscode.LanguageModelChat`. `OpenRouterProvider` /
`GitHubModelsProvider` accept a `contextLength` constructor opt. The
picker UI surfaces `· ctx=200K` on each model's detail line via the
same lookup.

### MCP Server

For CI/CD and automation, use the **MCP server**:

```bash
npm run mcp   # compiles (if needed) and starts the stdio server: node out/mcp/server.js
```

`createDefaultEngine` is **async** and awaits `pickSmallestContextLength`
at startup before serving the first analyze request.

See [src/mcp/README.md](../src/mcp/README.md) for details.

---

## See Also

- [USER-GUIDE.md](USER-GUIDE.md) — How to use the extension
- [TUTORIALS.md](TUTORIALS.md) — Step-by-step examples
- [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) — Implementation details
- [docs/plan/LEARNINGS.md](plan/LEARNINGS.md) — Hard-won engineering decisions
