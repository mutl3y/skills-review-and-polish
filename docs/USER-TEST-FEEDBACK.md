# User Test Feedback Log

Use this file to record your smoke test observations. Copy the template below for each test session and fill in your notes.

---

## Template

```markdown
### Test Session — [DATE] [TIME]

**Environment:**
- VS Code version:
- Extension host: F5 / installed from .vsix
- Provider: vscode-lm / openrouter / githubModels
- Model:
- File tested:

**What worked:**
- [ ] Extension activates cleanly
- [ ] Model picker opens and shows models
- [ ] Analysis runs and produces results
- [ ] Score/grade displays correctly
- [ ] Diagnostics appear in Problems panel
- [ ] Code actions (fix/ignore) work
- [ ] Fix preview diff opens
- [ ] Status bar updates correctly

**Issues found:**

| # | Severity | Description | Repro steps | Expected | Actual |
|---|----------|-------------|-------------|----------|--------|
| 1 | critical/high/medium/low | | | | |

**Score/grade observations:**
- Grade shown:
- Issue count:
- Did it match your manual review? (yes/no — explain)

**Rate limit observations:**
- Hit rate limits? (yes/no)
- If yes: which waves failed? Was notification shown?

**Console output (paste relevant lines):**
```

---

## Test Session — 2026-06-10 08:30

**Environment:**
- VS Code version: (user to fill)
- Extension host: F5
- Provider: vscode-lm
- Model: gpt-4o-mini → gpt-5-mini
- File tested: tests/fixtures/primary/mcp-security-audit/SKILL.md (8857 chars)

**Issues found:**

| # | Severity | Description | Repro steps | Expected | Actual |
|---|----------|-------------|-------------|----------|--------|
| 1 | high | F5 opened old project, not fixtures folder | Press F5 | Should open workspace with fixtures | Opened stale project |
| 2 | high | Provider stuck on openrouter after settings change | Changed to copilot in settings | Provider should update | Remained openrouter until restart |
| 3 | medium | "Change provider" command missing | Looked for command in command palette | Command should exist | Had to go into settings manually |
| 4 | critical | Analysis returned grade=A with 0 results | Analyzed SKILL.md with gpt-5-mini | Should find issues | 0 issues, grade A (waves truncated silently) |
| 5 | high | salvageTruncatedJSON recovered data but processors dropped it | Analyzed with gpt-5-mini | Salvaged items should appear | All items dropped by findTextRange |

**Score/grade observations:**
- Grade shown: A / A+
- Issue count: 0
- Match manual review? **No** — file clearly has issues (security audit skill with vague instructions)

**Rate limit observations:**
- Hit rate limits? **Yes** — UserByModelByMinute on gpt-5-mini
- Waves that failed: structural, coverage, hygiene (truncated responses)
- Notification shown? **No** (fixed in commit 7c6302d)

**Console output:**
```
2026-06-10 08:33:51.745 [info] Extension activated — log level: info
2026-06-10 08:36:14.188 [info] analyzeDocument: START mcp-security-audit/SKILL.md (8857 chars)
2026-06-10 08:36:14.210 [info] buildEngine: provider=openrouter standardModel=gpt-4o-mini
2026-06-10 08:36:14.210 [warning] buildEngine: openrouter selected but no API key — falling back to vscode-lm
2026-06-10 08:36:21.374 [info] analyzeDocument: got 0 results
2026-06-10 08:36:21.375 [info] analyzeDocument: score=95 grade=A type=standard
2026-06-10 08:42:45.783 [INFO] salvageTruncatedJSON: recovered ambiguity_issues[5]
2026-06-10 08:42:54.029 [INFO] salvageTruncatedJSON: recovered issues[2]
2026-06-10 08:42:56.772 [info] analyzeDocument: got 0 results ← BUG: salvaged data dropped
```

---

## Test Session — [DATE] [TIME]

*Copy the template above and add your notes here.*
