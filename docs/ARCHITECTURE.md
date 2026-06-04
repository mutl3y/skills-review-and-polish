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

- **Single-pass accuracy:** 82% Jaccard score
- **Multi-wave accuracy:** 86% Jaccard score
- **Cost:** Multi-wave uses ~1.5–2× more LLM requests, but with prompt caching, the latency is comparable
- **Quality:** Waves allow for specialized prompts per category, reducing false positives

### How Results Are Scored

Each wave produces a list of issues with severity levels (Error/Warning/Hint/Info). The analyzer then:

1. **Deduplicates** issues within the same document
2. **Scores** each issue by category
3. **Applies median-of-N sampling** — analyzes your file **3 times** and takes the median penalty score
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
- For comparing before/after fixes, use the median-of-3 (run 3 times, take middle value)
- Only trust changes >10 points as definitely improvements

---

## Why Low-Reasoning Models?

The analyzer uses **gpt-4.1** (or equivalent Copilot models), not reasoning models or Claude Haiku. Here's why:

### The Trade-Offs

| Aspect | Low-Reasoning (gpt-4.1) | Reasoning (o1/o3) | Claude Haiku |
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

## The Noise Floor: ±6 Points

**This is the most important fact to understand about analyzer accuracy.**

When we measure the analyzer's performance, we run it multiple times on the same file and compare results. The fundamental baseline measurement is:

> Running the analyzer 5 times on the **same unchanged file** with **temperature 0** and **top_p 0** (most deterministic settings) produces penalty scores: ~30, 32, 38, 38, 42.

**What this means:**

- **±6 points is irreducible variance.** Even with perfect LLM determinism, you can't get tighter than this.
- **Score changes < 6 points are noise, not real improvements.** If you fix something and the score drops from 42 to 40, that could be random variance.
- **Score changes > 10 points are real improvements.** We only accept/reject fixes if the penalty change exceeds the noise margin.

### Implications

1. **Don't chase small gains.** If a fix improves the score by 3 points, run it 3 times. If the median improvement is <6 points, it's probably random variance.

2. **Use median-of-N for reliability.** The analyzer is configured to run **3 passes by default** (configurable via `SCORE_SAMPLES`) and takes the median score. This is your best estimate of the "true" score.

3. **CI/CD and automation need this too.** If you're using the MCP server for CI/CD checks, don't set pass/fail thresholds tighter than ±6 points.

---

## Model Selection

### Default Behavior

When you install **Skills Review and Polish**, it defaults to using **GitHub Copilot** via the `vscode-lm` provider (VS Code's Language Model API).

**Why Copilot?**

- No API keys to manage
- Already trusted by VS Code
- Uses a strong, optimized model (gpt-4.1 family)
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

Based on **100+ skill files** from the test corpus:

- **Overall Jaccard accuracy: 86%**
- **Contradictions: 100%** ✅ Perfect detection
- **Ambiguities: 100%** ✅ Perfect detection
- **Persona: 89%** ⚠️ Occasional subtle shifts missed
- **Structural: 91%** ⚠️ Very complex nesting rarely missed
- **Coverage: 85%** — High confidence for major gaps
- **Hygiene: 88%** — Catches most redundancy

(Jaccard = True Positives / (True Positives + False Positives + False Negatives))

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

## For Developers: Configuration

### Key Settings

```json
{
  "skillsReview.enable": true,
  "skillsReview.provider": "vscode-lm",
  "skillsReview.model": "gpt-4.1",  // Used if provider supports model selection
  "skillsReview.analysisMode": "multiWave",  // or "single"
  "skillsReview.logLevel": "info",  // or "debug"
  "skillsReview.temperature": 0,  // Determinism
  "skillsReview.maxTokens": 16384
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

### MCP Server

For CI/CD and automation, use the **MCP server**:

```bash
node src/mcp/server.ts --provider openrouter --model gpt-4.1
```

See [src/mcp/README.md](../src/mcp/README.md) for details.

---

## See Also

- [USER-GUIDE.md](USER-GUIDE.md) — How to use the extension
- [TUTORIALS.md](TUTORIALS.md) — Step-by-step examples
- [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) — Implementation details
- [docs/plan/LEARNINGS.md](plan/LEARNINGS.md) — Hard-won engineering decisions
