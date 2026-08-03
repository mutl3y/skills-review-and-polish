# User Guide — How to Use Skills Review and Polish

Welcome! This guide helps you use the **Skills Review and Polish** VS Code extension to improve your AI prompt files, skill definitions, and instructions.

## What Does This Extension Do?

**In simple terms:** It's like a spell-checker for AI instructions. When you write rules for AI (called skills, prompts, or instructions), this extension reads your file and points out problems—like contradictions, unclear instructions, or missing information.

Then it can suggest fixes, which you can review and apply safely.

## The 5-Minute Setup

### Install the Extension

1. Open VS Code
2. Go to **Extensions** (Ctrl+Shift+X or Cmd+Shift+X)
3. Search for: `Skills Review and Polish`
4. Click **Install**
5. Wait for it to say "Installed"

That's it! The extension is now active.

### Optional: Configure Your LLM Provider

The extension uses an AI model to analyze your files. By default, it uses **GitHub Copilot** (if you have it).

You can also use other providers:

1. Press **Ctrl+,** (or **Cmd+,** on Mac) to open Settings
2. Search for: `Skills Review`
3. You'll see a `Provider` dropdown with options:
   - **vscode-lm** (Copilot, recommended)
   - **openrouter** (need API key)
   - **githubModels** (need token)

Leave it as **vscode-lm** if you have Copilot. Otherwise, pick your provider.

### Recommended OpenRouter Models

If you use **openrouter**, these are the current recommended models for cost/coverage (from the 2026-07-13 E27/E28/E53/E54/E55/E56 experiments on production skills and calibration fixtures):

| Use case | Model | Cost (per 340 skills) | Why |
| --- | --- | ---: | --- |
| **Best overall (recommended for `model`)** | `google/gemini-2.5-flash-lite` | **$0.15** | Best current cost/coverage trade-off. The latest clean-fixture gate is 73.1% capped recall with a 65.4% precision proxy; precision hardening (target ≥85%) is ongoing improvement, not a blocker on using it as a linter today. |
| **Best for `deepModel` (contradictions wave)** | `deepseek/deepseek-chat-v3` | **$0.59** (1 wave only) | 90% on test-circular-hard (vs 67% for gemini), 3x improvement on contradictions. |
| **Free tier** | `poolside/laguna-xs-2.1:free` | **$0.00** | 32% recall. 8 RPM rate limit, 25s avg. |
| **High-stakes audits** | `meta-llama/llama-4-scout` | $0.65 | 17% recall but generates more findings. |
| **Avoid** | `qwen/qwen3-coder-30b-a3b-instruct` | $0.52 | Was previous default but only 21% recall on test fixtures. E56 found 5x more findings with gemini-flash. |

**Recommended multi-model configuration** (the E56 winner):

```json
{
  "skillsReviewAndPolish.provider": "openrouter",
  "skillsReviewAndPolish.model": "google/gemini-2.5-flash-lite",
  "skillsReviewAndPolish.deepModel": "deepseek/deepseek-chat-v3",
  "skillsReviewAndPolish.external.structuredOutput": "schema"
}
```

This configuration scanned 327 production skills and found **8811 candidate issues** (vs 1664 with qwen-only) at **half the cost** ($0.24 vs $0.50). Treat that as a coverage signal, not as validated precision. Key areas with more candidates:

- Circular definitions: 1 → 15 (15x)
- Contradictions: 11 → 35 (3x)
- Dead instructions: 0 → 29 (new category)
- Persona inconsistencies: 1 → 15 (15x)

### Recommended Adaptive Output-Budget Settings (2026-07-17)

For production skills with structured-output mode on OpenRouter, use these adaptive settings so long prompts get enough room to emit full JSON responses:

```json
{
  "skillsReviewAndPolish.external.adaptiveResponseTokens": true,
  "skillsReviewAndPolish.external.adaptiveMaxResponseTokens": 131072,
  "skillsReviewAndPolish.external.minAdaptiveResponseTokens": 16384,
  "skillsReviewAndPolish.external.adaptiveCharsPerToken": 4
}
```

Why these values (from `scripts/demos/adaptive-quality-playbook-live.mjs`, 2026-07-17):

- `adaptiveCharsPerToken=4` — the default `8` asks for so few output tokens that real prompts get less room than the fixed 16K ceiling. `4` matches the structured-JSON output density better.
- `minAdaptiveResponseTokens=4096` — never request less than the fixed-mode ceiling so adaptive mode never regresses vs fixed mode.
- `adaptiveMaxResponseTokens=131072` — headroom for 1M-context Gemini. The default `65536` is enough for most production skills; raise this if you see `finish_reason: length` on long skills.
- `adaptiveResponseTokens=true` — opt in. Off by default.

If you don't use adaptive mode, the fixed budget defaults remain:

- `external.maxResponseTokens`: 16384 (fixed-mode ceiling)
- `external.requestTimeoutMs`: 120000 (per-request wall-clock)

See [E2E tuning note](docs/plan/archive/releases/20260716-release-readiness-remediation/plan.yaml#notes-added-2026-07-17-adaptive-quality-playbook-live) for full evidence.

> **Methodology:** Historical model experiments used labeled fixtures, clean fixtures, and production-skill corpus scans. The current formal release baseline should use clean fixtures as the primary recall benchmark and a manual production sample for precision; total finding count alone is not an accuracy metric.

## Batch Mode (Experimental — Off by Default)

The extension can submit folder scans as OpenRouter Batch API jobs instead of
sequential requests. This is cheaper for bulk work but has two current
limitations:

- The OpenRouter Batch API submission endpoint (`POST /api/beta/batches`) is
  currently unreliable (returns an HTML 404 page as of 2026-07-30), so batch
  jobs fail.
- The Batch API uses a **24-hour completion window**, which is unsuitable for
  interactive analysis.

Because of this, batch mode is **disabled by default** and the Batch-API-only
models (those with a `:batch` suffix, e.g. `google/gemini-3.5-flash-lite:batch`)
are **hidden from the model picker** — they cannot run on the standard chat
endpoint, so selecting them would just fail.

If you want to experiment later (once the endpoint is healthy), enable it:

```json
{
  "skillsReviewAndPolish.batchEnabled": true
}
```

When enabled, folder scans against a batch-capable OpenRouter model submit as a
single deferred batch job and populate results asynchronously (~minutes to
hours later). Leave it `false` for normal use. See
[ARCHITECTURE.md → Batch API Transport](docs/ARCHITECTURE.md#batch-api-transport-openrouter)
for the internal flow.

## How to Analyze a File

### Step 1: Open a File

Open any of these file types:

- `SKILL.md` — AI skill definitions
- `something.instructions.md` — Instructions for an agent
- `something.prompt.md` — Prompt templates
- `something.agent.md` — Agent configurations
- `AGENTS.md` — Agent metadata

### Step 2: Run the Analyzer

1. Press **Ctrl+Shift+P** (or **Cmd+Shift+P** on Mac) to open the Command Palette
2. Type: `Analyze This File`
3. Press **Enter**

Wait 10–30 seconds while the extension reads your file.

### Step 3: See the Results

When analysis is done, you'll see **squiggles** (colored underlines) in your file:

- 🔴 **Red squiggles** = Errors (serious issues)
- 🟡 **Yellow squiggles** = Warnings (problems to consider)
- 🔵 **Blue squiggles** = Hints (suggestions)

At the bottom of VS Code, you'll see a **status message** showing how many issues were found.

## Understanding the Squiggles

### What the Colors Mean

| Color | Type | Example | Severity |
| --- | --- | --- | --- |
| 🔴 Red | Error | Two instructions contradict each other | HIGH |
| 🟡 Yellow | Warning | An instruction uses vague language | MEDIUM |
| 🔵 Blue | Hint | This section could be clearer | LOW |
| ⚪ Gray | Info | Minor formatting suggestion | INFO |

### How to See What an Issue Is

1. **Hover over a squiggle** — A tooltip appears showing the issue and why it's a problem
2. **Click on a squiggle** — The problem appears in the **Problems** panel (at the bottom)
3. **Read the message** — It explains what's wrong in plain English

Example hover message:

```text
Ambiguity: "Recently" is unclear
This instruction says "flag any recent changes" but doesn't define what
"recent" means (1 day? 1 week?). Pick a specific timeframe.
```

## Fixing Issues

### Option 1: Let the AI Suggest a Fix

Most issues have an AI-suggested fix ready to go.

1. **Hover over a squiggle** or **click on it in the Problems panel**
2. You'll see a **"Fix this issue"** option
3. Click it

A **diff preview** opens showing:

- **Left side** = Your current text (red)
- **Right side** = Suggested fix (green)

Diff preview is the supported default. Automatic fix-loop mode is experimental
and should not be used unattended for release decisions.

### Option 2: Review the Diff, Then Apply

1. Read the suggested fix carefully
2. If it looks good, click **"Apply Fix"** (or **"Accept"** button)
3. If you don't like it, click **"Reject"** or close the preview
4. You can always manually edit your text instead

### Option 3: Fix It Yourself

You don't have to use the AI's suggestion. You can:

1. Read the issue explanation
2. Manually edit your text in the editor
3. Save your file
4. Run **"Analyze This File"** again to see if it's fixed

## Common Scenarios

### Scenario 1: Contradictory Instructions

**You see:**

```text
Contradiction: Instructions 1 and 3 conflict
Instruction 1: "Always validate input"
Instruction 3: "Skip validation for performance"
```

**What to do:**

- Decide which is more important (validation or speed)
- Remove or clarify one of them
- Use the AI's suggestion to pick consistent language

### Scenario 2: Vague Instructions

**You see:**

```text
Ambiguity: "Appropriate size" is unclear
The term "appropriate" means different things to different people.
```

**What to do:**

- Replace vague words with specific ones
- Instead of "appropriate size," say "less than 5 MB"
- The AI can suggest specific alternatives

### Scenario 3: Missing Information

**You see:**

```text
Coverage Gap: No guidance on error handling
Your skill doesn't explain what to do when something fails.
```

**What to do:**

- Add a section explaining error handling
- Or clarify that error handling is out of scope
- The AI can suggest what information to add

### Scenario 4: Too Complex

**You see:**

```text
High Complexity: This instruction has many nested conditions
```

**What to do:**

- Break it into smaller, simpler instructions
- Use numbered lists or bullet points
- The AI can help restructure it

## What If...?

### "Analysis is taking a long time"

- Analysis usually takes 10–30 seconds (depends on file size and AI model)
- If it's been >1 minute, the AI service might be having issues
- Try again in a few minutes

### "I see an error message"

Check the **Output** panel (View → Output, then select "Skills Review"):

```text
If you see "LLM error" → Your LLM provider (Copilot, OpenRouter, etc.) is unavailable. Try again later.
If you see "Parse error" → The AI response was malformed. This is rare. Report it on GitHub.
If you see "Extension disabled" → Check your VS Code Settings and ensure `skillsReviewAndPolish.enable` is set to `true`.
```

### "It found issues I don't agree with"

That's okay! The analyzer is a tool, not a rule book:

- You can **ignore** suggestions you disagree with
- You can **manually edit** your text instead of using the AI's fix
- You can **turn off specific issue types** in settings (advanced users only)

### "It didn't find an issue I expected"

Possible reasons:

- The analyzer only looks for specific types of issues (see the list below)
- The issue might be too subtle or require context outside the file
- The AI model is not perfect and occasionally misses things

Try running **"Analyze This File"** again. Under greedy decoding (temperature 0) the analyzer is deterministic — the 10× noise-floor probe shows range 3 penalty / 1 finding with 9 of 10 runs identical — so a re-run on the same unchanged file should reproduce the same findings. If an expected issue is still missing, it is a genuine false negative to report, not run-to-run variance.

### "The fix suggestion looks wrong"

Always review fixes before applying them:

- If a fix looks bad, **reject it** and manually edit instead
- If a fix is wrong, **report it** on GitHub with an example
- The fixes are suggestions, not automatic changes

### "How do I turn off the extension?"

1. Press **Ctrl+,** (Settings)
2. Search for: `Skills Review`
3. Find `Enable` and uncheck it
4. Or disable the extension entirely: Extensions panel → right-click → **Disable**

### "Does the extension send telemetry?"

No. The telemetry setting is reserved for possible future anonymous usage
metrics, but it is disabled by default and the current extension does not send
telemetry.

## Issue Types Explained

Here are all the types of issues the extension detects:

| Issue Type | What It Means | Example |
| --- | --- | --- |
| **Contradiction** | Two instructions conflict | "Always validate" vs. "Skip validation" |
| **Ambiguity** | Unclear language that could be interpreted different ways | "Recently," "appropriate," "reasonable" |
| **Persona Inconsistency** | The tone/style changes dramatically | Formal intro, then ultra-casual instructions |
| **High Complexity** | An instruction is too complicated or has too many nested conditions | Giant if/then/else with 5+ levels |
| **Coverage Gap** | Missing important information | No guidance on what to do when errors occur |
| **Hygiene Problem** | Structure, formatting, or logic issue | Dead code, redundant definitions, circular logic |

## Tips for Best Results

1. **Be specific** — Use exact words instead of vague ones. "5 MB" instead of "appropriate size."
2. **Be consistent** — Use the same terms for the same concepts throughout.
3. **Be clear about edge cases** — Explain what to do when something unusual happens.
4. **Run analysis multiple times** — After you fix issues, run it again to check your work.
5. **Review AI suggestions carefully** — Don't blindly accept them. Use them as a starting point.

## Next Steps

- **[See Tutorials →](TUTORIALS.md)** for step-by-step walkthroughs of common tasks
- **[See FAQs →](FAQS.md)** for answers to common questions
- **[See Architecture →](ARCHITECTURE.md)** to understand how the analyzer works
- **[Report issues on GitHub](https://github.com/mutl3y/skills-review-and-polish/issues)** if you find bugs
