# FAQs — Common Questions Answered

Quick answers to the most common questions about **Skills Review and Polish**.

---

## Installation & Setup

### Q: Do I need special permissions to install this?

**A:** No. Just open VS Code's Extensions panel (Ctrl+Shift+X) and install like any other extension. You need a GitHub Copilot subscription (or other supported LLM provider), but the extension itself is free.

### Q: What's the difference between the three LLM providers?

**A:**

- **vscode-lm** (default): Uses GitHub Copilot. No API keys needed. ✅ **Recommended**
- **openrouter**: Allows many different AI models. Requires an OpenRouter API key.
- **githubModels**: Uses GitHub's models. Requires a GitHub personal access token.

**Best for beginners:** Use **vscode-lm** (Copilot). It's the easiest to set up.

### Q: How much does it cost?

**A:** The extension is free. The cost depends on your LLM provider:

- **Copilot**: ~$20/month if you don't have a subscription already
- **OpenRouter**: Pay per request (~$0.001–$0.01 per analysis)
- **GitHub Models**: Currently free during preview

---

## Using the Extension

### Q: How long does analysis take?

**A:** Typically 10–30 seconds for a small file. Larger files (5000+ words) may take 1–2 minutes.

### Q: Why do I get slightly different results each time I analyze?

**A:** The AI model uses randomness. Results can vary slightly between runs. Run analysis 3 times and look for consistent issues.

### Q: Can I analyze files that aren't SKILL.md?

**A:** The extension works on any file, but it's designed for:

- `SKILL.md` — AI skill definitions
- `*.instructions.md` — Instruction files
- `*.prompt.md` — Prompt templates
- `*.agent.md` — Agent files
- `AGENTS.md` — Agent metadata

### Q: Do I have to use the AI's suggested fixes?

**A:** No. You have three options:

1. Use the AI fix → review the diff → click "Accept"
2. Manually edit yourself
3. Ignore it

### Q: What if the fix suggestion is wrong?

**A:** **Reject it** and either:

- Edit manually
- Report the bad fix on GitHub

---

## Understanding Issues

### Q: What's the difference between red, yellow, and blue?

**A:**

- 🔴 **Red (Error)** — Serious problem. Example: two instructions contradict.
- 🟡 **Yellow (Warning)** — Important issue. Example: vague language.
- 🔵 **Blue (Hint)** — Minor suggestion. Example: redundant line.

### Q: Why does it say my instruction is "ambiguous"?

**A:** The instruction could be understood multiple ways.

**Example:**

- ❌ "Check if the tone is professional."
- ✅ "Check if the tone uses formal language (no slang)."

### Q: What's a "coverage gap"?

**A:** Missing important information.

**Example:**

- ❌ "Handle invalid inputs." (How?)
- ✅ "Handle invalid inputs: log the error, return HTTP 400, notify the user."

### Q: Why is it complaining about "persona inconsistency"?

**A:** Your writing style suddenly shifts.

**Example:**

- Line 1: "You are a professional data analyst."
- Line 5: "JUST YEET THE DATA AND LETS GOOOO"

Pick one style and stick with it.

### Q: What does "structural issue" mean?

**A:** Formatting, organization, or logic problems:

- **Redundancy** — Saying the same thing twice
- **Dead code** — Instructions that are no longer used
- **Circular logic** — Definition A refers to B, B refers back to A
- **Missing headings** — Sections aren't organized

### Q: Can I ignore an issue I don't agree with?

**A:** Yes. The analyzer is a tool, not a rule book. You can reject suggestions.

---

## Fixing Issues

### Q: Should I accept all the AI's suggested fixes?

**A:** No. Always review first:

1. Does it preserve your intended meaning?
2. Does it improve the text?
3. Is there anything obviously wrong?

### Q: What if the fix is only partially correct?

**A:** Reject it and manually edit to make it work.

### Q: Can I undo a fix?

**A:** Yes. Press **Ctrl+Z** (or **Cmd+Z** on Mac) to undo.

### Q: How do I know if my fix worked?

**A:** Run the analyzer again:

1. Save your file
2. Press **Ctrl+Shift+P** → "Analyze This File"
3. Check the results

---

## Troubleshooting

### Q: The analyzer isn't finding any issues. Is my file perfect?

**A:** Maybe! But check:

- Does your file start with `---` (YAML metadata)?
- Does it have at least 100 words?

Try analyzing again. Results can vary.

### Q: I got an "LLM error" message. What's wrong?

**A:** Your LLM provider (Copilot, OpenRouter, GitHub Models) is unavailable.

**What to do:**

1. Try again in a few minutes
2. Check your internet connection
3. Check that your provider is working
4. If using OpenRouter or GitHub Models, check your API key/token
5. Check the Output panel (View → Output → "Skills Review") for details

### Q: Why is analysis taking longer than usual?

**A:** Possible reasons:

- Your internet is slow
- The LLM provider is busy
- Your file is very large (5000+ words)

**What to do:**

- Wait a bit longer (up to 2–3 minutes is normal)
- Check the Output panel if it seems frozen

### Q: Can I speed up the analyzer?

**A:** Not directly, but:

- Analyze smaller files
- Use a faster LLM provider
- Analyze during off-peak hours

### Q: The extension disappeared. Where did it go?

**A:** It might be disabled or uninstalled.

**If disabled:**

1. Open Extensions panel (Ctrl+Shift+X)
2. Search "Skills Review"
3. If you see it with a ⚙️ icon, click it and select "Enable"

**If uninstalled:**

1. Open Extensions panel (Ctrl+Shift+X)
2. Search "Skills Review and Polish"
3. Click "Install"

### Q: Can I turn off specific issue types?

**A:** Yes (advanced users):

1. Open Settings: **Ctrl+,**
2. Search: `Skills Review`
3. Find `Overrides` — set any issue code to `off`, `error`, `warning`, `info`, or `hint`

**Most users:** Just use "Reject" if you don't want a specific fix.

### Q: I found a bug. How do I report it?

**A:**

1. Go to: [github.com/mutl3y/skills-review-and-polish/issues](https://github.com/mutl3y/skills-review-and-polish/issues)
2. Click "New Issue"
3. **Title:** Describe the problem in one line
4. **Description:** Include:
   - What did you do? (step-by-step)
   - What did you expect?
   - What actually happened?
   - Example file (if possible)
   - Error message (if any)
5. Click "Submit"

**We really appreciate bug reports!**

### Q: What if I have a feature request?

**A:**

1. Go to: [github.com/mutl3y/skills-review-and-polish/issues](https://github.com/mutl3y/skills-review-and-polish/issues)
2. Click "New Issue"
3. **Title:** "Feature request: [your idea]"
4. **Description:** Explain what you want and why
5. Click "Submit"

---

## Advanced Questions

### Q: Can I use this in a CI/CD pipeline?

**A:** Yes! There's an MCP (Model Context Protocol) server for automation. See [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md).

### Q: Can I integrate this with my custom LLM?

**A:** If it supports the OpenRouter API, yes. Otherwise, not yet—but it's on the roadmap.

### Q: How is my code analyzed? Is it private?

**A:** Your code is sent to your LLM provider (Copilot, OpenRouter, GitHub Models). Check their privacy policies.

**If you have sensitive code:** Consider analyzing anonymized versions of your files.

### Q: Can I customize the analyzer to fit my style guide?

**A:** Not yet, but the codebase is open-source. You can fork and customize it.

---

## Getting Help

**Still have questions?**

- **[Read the User Guide →](USER-GUIDE.md)** for detailed information
- **[Do the Tutorials →](TUTORIALS.md)** for step-by-step walkthroughs
- **[See Architecture →](ARCHITECTURE.md)** to understand the technical design
- **[Check GitHub Discussions](https://github.com/mutl3y/skills-review-and-polish/discussions)** to ask the community
- **[File an issue on GitHub](https://github.com/mutl3y/skills-review-and-polish/issues)** if you find a bug
