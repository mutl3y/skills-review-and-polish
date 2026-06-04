# Tutorials — Learn by Doing

These step-by-step tutorials show you how to use **Skills Review and Polish** for real-world tasks. Each tutorial takes 5–15 minutes.

---

## Tutorial 1: Analyze Your First File (5 minutes)

Learn the basics: open a file, run the analyzer, understand the results.

### What You'll Learn

- How to run the analyzer
- How to read the squiggles and problems
- What the different colors mean

### Steps

#### Step 1: Create a Test File

1. In VS Code, create a new file: **File → New Text File**
2. Paste this content:

```markdown
---
name: customer-support-agent
description: Handles customer support requests and issues
---

# Customer Support Agent

You are a helpful support agent. Always be friendly.

## Your Instructions

1. Read the customer's request carefully and never read the customer's request carefully.
2. Respond quickly, usually within a reasonable timeframe.
3. Escalate important issues to management.
4. Don't escalate any issues unless specifically asked.
5. Keep responses brief but thorough.
```

1. Save it as: `test-skill.md` (File → Save As)

#### Step 2: Run the Analyzer

1. Make sure your new file is open
2. Press **Ctrl+Shift+P** (or **Cmd+Shift+P** on Mac)
3. Type: `Analyze This File`
4. Press **Enter**
5. Wait 10–30 seconds for analysis to complete

#### Step 3: Look at the Results

You should see **red and yellow squiggles**:

- Line 8: **Instruction 1 contradicts itself** (reads twice vs. never reads)
- Line 9: **"Reasonable timeframe" is vague** (yellow)
- Lines 11–12: **Instructions contradict** (escalate vs. don't escalate)

At the bottom of the screen, you should see: **"5 issues found"**

#### Step 4: Explore an Issue

1. **Hover over the red squiggle on line 8**
2. Read the tooltip that appears
3. Look at the **Problems** panel (bottom of screen) to see all issues listed

#### Step 5: Try a Fix

1. Hover over the red squiggle on line 11 (escalation contradiction)
2. Click **"Fix this issue"**
3. A diff preview opens showing the suggested fix
4. Read both sides (left = current, right = suggested)
5. Click **"Accept"** to apply it, or **"Reject"** to skip it

**You're done!** You've successfully analyzed a file and reviewed a fix suggestion.

---

## Tutorial 2: Fix Ambiguity Issues (8 minutes)

Learn how to identify and fix vague language.

### What You'll Learn (Ambiguity)

- What makes language ambiguous
- How to write clearer instructions
- When to use specific numbers instead of vague words

### Tutorial 2 Steps

#### Step 1: Create a File with Ambiguous Language

1. Create a new file: **File → New Text File**
2. Paste this content:

```markdown
---
name: document-reviewer
description: Reviews documents for quality
---

# Document Reviewer

## Review Guidelines

1. Flag any grammar issues that are significant.
2. Ensure the document is an appropriate length.
3. Check if the tone is professional.
4. Suggest improvements where relevant.
5. Focus on the most important feedback.
```

1. Save it as: `test-ambiguous.md`

#### Step 2: Analyze and Identify Ambiguities

1. Run the analyzer: **Ctrl+Shift+P → Analyze This File**
2. Wait for results
3. Look for **yellow squiggles** (these are typically ambiguities)

You should see issues like:

- "Significant" — How significant? What's the threshold?
- "Appropriate length" — How long is appropriate?
- "Professional" — What does professional mean to the AI?
- "Most important" — How do we rank importance?

#### Step 3: Fix One Ambiguity Manually

Let's fix line 6: "significant grammar issues" → specific levels

1. Click at the end of "significant" on line 6
2. Replace it with: `clear` (as in: "Flag any grammar issues that are clear mistakes")
3. Or be even more specific: `errors that a typical reader would notice`

#### Step 4: Fix Another Ambiguity Using AI

1. Hover over the yellow squiggle for "appropriate length" (line 7)
2. Click **"Fix this issue"**
3. The AI will suggest specific guidance like: "Ensure the document is between 500–2000 words"
4. Read the suggestion carefully
5. If it makes sense, click **"Accept"**; if not, click **"Reject"** and edit manually

#### Step 5: Verify Your Fixes

1. Save your file
2. Run the analyzer again: **Ctrl+Shift+P → Analyze This File**
3. You should see fewer ambiguity issues (or they should be on different lines)

**You're done!** You've learned how to identify and fix vague language.

---

## Tutorial 3: Use the AI Fixer Safely (10 minutes)

Learn how to review and apply AI-suggested fixes without breaking things.

### What You'll Learn (Fixer)

- How to read diff previews (left side = old, right side = new)
- Why you should review before applying
- How to reject bad suggestions
- When to edit manually instead

### Tutorial 3 Steps

#### Step 1: Create a File with Problems

1. Create a new file: **File → New Text File**
2. Paste this content:

```markdown
---
name: code-reviewer
description: Reviews source code
---

# Code Reviewer

## Your Role

When someone asks you to review code, do the following things:
1. Never look at the code.
2. Always look at the code carefully.
3. Check if the logic makes sense.
4. Check the performance.
5. Check the security.
6. Do a check.

The purpose of this role is to provide feedback. Make sure feedback is good.
```

1. Save it as: `test-fixer.md`

#### Step 2 (Fixer): Run the Analyzer

1. Run the analyzer: **Ctrl+Shift+P → Analyze This File**
2. Wait for results
3. You should see **multiple red squiggles** (contradictions and redundancy)

#### Step 3 (Fixer): Review a Diff (The Safe Way)

1. Hover over the **first red squiggle** (line 11–12: "Never look" vs. "Always look")
2. Click **"Fix this issue"**
3. A **diff preview** opens showing two columns:
   - **Left side (red)** = Your current text
   - **Right side (green)** = Suggested replacement
4. **Read both carefully:**
   - Does the suggestion make sense?
   - Does it preserve your intended meaning?
   - Is there anything obviously wrong?

#### Step 4: Accept or Reject

1. If the fix looks good, click **"Accept"** (✓)
2. If it looks bad or incomplete, click **"Reject"** (✗)
3. The diff preview closes

#### Step 5: Try Rejecting a Fix

1. Hover over another red squiggle
2. Click **"Fix this issue"**
3. Read the diff **carefully**
4. Even if the fix looks reasonable, click **"Reject"** this time to practice
5. The preview closes without changing your file

#### Step 6: Manually Fix an Issue

Instead of using the AI's suggestion, let's manually fix one:

1. Look at line 6: "do the following things:" — this is vague
2. Click after "following" and delete "things:"
3. Type: "steps:"
4. Now it reads: "do the following steps:" (clearer)

#### Step 7: Re-Analyze to Verify

1. Save your file
2. Run the analyzer again: **Ctrl+Shift+P → Analyze This File**
3. Some issues should be gone; others might change or stay the same
4. The contradictions you fixed should no longer appear

**You're done!** You've learned how to review diffs and use the fixer safely.

---

## Tutorial 4: Understand Different Issue Types (12 minutes)

Learn what each type of issue means and how to fix it.

### What You'll Learn (Issue Types)

- The 6 main issue types
- Why each one matters
- How to recognize each type
- Quick fixes for each

### Tutorial 4 Steps

#### Step 1: Create a File with Multiple Issue Types

1. Create a new file: **File → New Text File**
2. Paste this content:

```markdown
---
name: data-analyzer
description: Analyzes datasets for insights
---

# Data Analyzer

## Instructions

### [CONTRADICTION-1] Invalid Format
Always save data in JSON format.
Never use JSON format for storage.

### [AMBIGUITY-1] Time Window
Analyze recent data to identify trends.

### [AMBIGUITY-2] Quality Metric
Ensure data quality is high before processing.

### [COMPLEXITY-1] Nested Conditions
If the data contains nulls, and the schema is valid, and the size is within limits, and the user requested caching, then cache; otherwise, if the priority is high and the timestamp is recent, then escalate; otherwise, log and continue.

### [COVERAGE-1] Missing Error Cases
Handle missing fields by removing them.

### [HYGIENE-1] Redundancy
Log all outputs. Log outputs.

### [PERSONA-1] Tone Shift
You are a professional data analyst. ALWAYS USE ALL CAPS WHEN TALKING ABOUT DATA!!!

## Done

That's it. Our tool is complete and requires no further development.
```

1. Save it as: `test-all-issues.md`

#### Step 2: Analyze the File

1. Run the analyzer: **Ctrl+Shift+P → Analyze This File**
2. Wait for results
3. You should see **many squiggles** of different colors

#### Step 3: Study Each Issue Type

**In the Problems panel (bottom of screen), you'll see issues like:**

| Issue | Type | What It Means | How to Fix |
| --- | --- | --- | --- |
| `CONTRADICTION-1` | Red | Two instructions directly oppose each other | Pick one; remove the other |
| `AMBIGUITY-1` | Yellow | "Recent" could mean different things | Replace with specific timeframe (e.g., "last 7 days") |
| `AMBIGUITY-2` | Yellow | "High" is subjective | Use measurable criteria (e.g., "accuracy > 95%") |
| `HIGH-COMPLEXITY` | Yellow | Instruction has too many nested conditions | Break it into separate steps |
| `COVERAGE-GAP` | Blue | Missing guidance on edge cases | Add: "If X happens, then..." |
| `HYGIENE-*` | Blue | Redundancy or dead code | Remove duplicate: "Log all outputs" |
| `PERSONA-*` | Yellow | Tone suddenly changes | Keep style consistent (professional throughout) |

#### Step 4: Fix One of Each Type

Let's manually fix one issue from each category:

#### Fix 1: CONTRADICTION

- Line 13–14 says both "Always use JSON" and "Never use JSON"
- Change line 14 to: `Use JSON format for API responses.`

#### Fix 2: AMBIGUITY (time window)

- Line 17 says "recent data" but doesn't define "recent"
- Change to: `Analyze data from the last 30 days to identify trends.`

#### Fix 3: AMBIGUITY (quality)

- Line 20 says "high" quality but doesn't define it
- Change to: `Ensure data quality meets the minimum 80% accuracy threshold before processing.`

#### Fix 4: COMPLEXITY

- Line 23–24 is a massive if/then/else chain
- Change to simpler steps like:

```text
1. Check if data is valid (has required fields, correct schema, within size limits).
2. If valid and user requested caching, cache it.
3. Otherwise, check priority and timestamp.
4. If high priority and recent, escalate.
5. Otherwise, log and continue.
```

#### Fix 5: COVERAGE-GAP

- Line 27 says "remove" missing fields but doesn't explain when/why
- Change to: `Handle missing fields by: a) Remove if optional, b) Flag as error if required, c) Use default value if available.`

#### Fix 6: HYGIENE (redundancy)

- Lines 31–32 both say "log"
- Delete line 32 entirely

#### Fix 7: PERSONA (tone shift)

- Line 35: tone is professional
- Line 36: tone suddenly changes to SHOUTY ALL CAPS
- Change line 36 to: `Always use clear, structured language when describing data.`

#### Step 5: Re-Analyze to Verify

1. Save your file
2. Run the analyzer again: **Ctrl+Shift+P → Analyze This File**
3. Most squiggles should be gone
4. Any remaining issues are likely new detections or issues you intentionally want to keep

**You're done!** You now understand all 6 issue types and know how to fix them.

---

## Tutorial 5: Troubleshoot Common Problems (8 minutes)

Learn what to do when something goes wrong.

### Scenario 1: Analysis is Slow

**What you see:** You click "Analyze" and wait... and wait... nothing happens for 2+ minutes.

**What to try:**

1. Wait a bit longer (sometimes it just takes time)
2. Check your internet connection (the analyzer needs to talk to Copilot/OpenRouter/GitHub Models)
3. Open the **Output** panel (View → Output) and select "Skills Review"
4. Look for error messages
5. If you see errors, try again in a few minutes
6. If errors persist, check GitHub Issues to report it

### Scenario 2: No Issues Found (But You Expected Some)

**What you see:** Analyzer runs, but finds 0 issues on a file you know has problems.

**What to try:**

1. The analyzer only finds specific types of issues (see the list in the User Guide)
2. Your issues might be outside the scope of what it detects
3. Try running the analyzer again—results can vary slightly due to AI randomness
4. Check that your file is in the right format (starts with `---` metadata block)
5. If it still finds nothing, your file might just be well-written! 🎉

### Scenario 3: Fix Suggestion Looks Wrong

**What you see:** You click "Fix this issue" and the suggested change looks incorrect or nonsensical.

**What to try:**

1. **Always reject fixes that look wrong** — Click "Reject"
2. Edit the text manually instead
3. Report the bad suggestion on GitHub (with an example)
4. Remember: the AI is helpful but not perfect

### Scenario 4: Extension Isn't Working at All

**What you see:** No squiggles appear, analyzer doesn't run, or you get an error.

**What to try:**

1. Check that the extension is enabled:
   - Extensions panel → right-click "Skills Review" → ensure "Enable" is checked
   - Or: Settings → search "Skills Review" → ensure `Enable` checkbox is on

2. Check your LLM provider:
   - Settings → search "Skills Review Provider"
   - Make sure your provider is working (e.g., Copilot is available)
   - If using OpenRouter or GitHub Models, check your API key/token

3. Try restarting VS Code:
   - Close VS Code completely
   - Reopen it
   - Try again

4. Check the Output panel:
   - View → Output → "Skills Review"
   - Look for error messages (red text)
   - Common errors: "Provider unavailable," "LLM error," "Rate limited"

5. If nothing works, report on GitHub with:
   - Your VS Code version
   - Your extension version (Extensions panel)
   - The error message from the Output panel
   - A minimal example file that reproduces the issue

**You're done!** You now know how to troubleshoot common problems.

---

## What's Next?

- **[Back to User Guide →](USER-GUIDE.md)** for detailed reference information
- **[See FAQs →](FAQS.md)** for quick answers to common questions
- **[See Architecture →](ARCHITECTURE.md)** to understand how the multi-wave analyzer works
- **[Report issues on GitHub](https://github.com/mutl3y/skills-review-and-polish/issues)** if you get stuck
