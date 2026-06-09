# MCP Server Improvement Plan

**Created:** 2026-06-08  
**Updated:** 2026-06-09  
**Status:** ✅ COMPLETE + hardened (post-Gilfoyle review)

## Current State

The MCP server (`src/mcp/server.ts`) exposes 3 tools:

- `analyze` — returns raw JSON diagnostics
- `fix` — surgical fix for one issue
- `accept_finding` — suppress a known finding

## Problems Identified

### P1: Tool descriptions too vague for LLM agents

Current descriptions don't explain what issue codes exist, what `fix` can/can't fix, or the recommended workflow.

### P2: `acceptedFindingsPath` not passed through

The extension passes `acceptedFindingsPath` to `engine.analyze()`, but the MCP server doesn't. Accepted findings never filter in MCP mode.

### P3: No `score` tool

`Engine.score()` returns quality grade (A+ through F) but isn't exposed.

### P4: No `verify_fix` tool

After fixing an issue, there's no easy way to re-analyze and confirm the specific issue is gone. User has to run full `analyze` again and manually compare.

### P5: No `health`/`status` tool

Can't verify provider connectivity or check which model is active.

### P6: Model config is disconnected from VS Code

MCP server reads env vars; VS Code extension reads settings. No sync mechanism.

## Solution: `.skills-review.json`

The extension already has a full settings schema (`skillsReviewAndPolish.*` in `package.json`). Instead of inventing a new format, we mirror those settings to a workspace-root JSON file that the MCP server reads.

```text
┌─────────────────────────────┐
│  VS Code Settings           │
│  skillsReviewAndPolish.*    │──── "Sync MCP Config" command
│  (existing config)          │     writes on demand
└─────────────────────────────┘
              │
              ▼
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  .skills-review.json        │────▶│  MCP Server                 │
│  (workspace root)           │     │  Reads on startup           │
│                             │     │  Falls back to env vars     │
│  {                          │     │                             │
│    "provider": "vscode-lm", │     │  vscode-lm → GitHub Models  │
│    "model": "gpt-4o-mini",  │     │    API path (GITHUB_TOKEN)  │
│    "logLevel": "info"       │     │  openrouter → OpenRouter    │
│  }                          │     │    API path (OPENROUTER_KEY)│
└─────────────────────────────┘     └─────────────────────────────┘
              ▲
              │
┌─────────────────────────────┐
│  Manual edit (headless/CI)  │
│  Same keys, minus prefix    │
└─────────────────────────────┘
```

**Config priority (MCP server startup):**

1. `.skills-review.json` in workspace root (if exists)
2. `GITHUB_TOKEN` + `ANALYSIS_MODEL` env vars (legacy)
3. `OPENROUTER_API_KEY` + `ANALYSIS_MODEL` env vars (legacy fallback)
4. Error: no configuration found

**Provider mapping:**

| VS Code Provider | MCP Config | API Used | Auth |
| --- | --- | --- | --- |
| `vscode-lm` (any model) | `githubModels` | `models.inference.ai.azure.com` | `GITHUB_TOKEN` |
| `openrouter` | `openrouter` | `openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `githubModels` | `githubModels` | `models.inference.ai.azure.com` | `GITHUB_TOKEN` |

## Complete MCP Tool Surface

### Existing tools (to improve)

| Tool | Description |
| --- | --- |
| `analyze` | Run all 6 analysis waves on a document. Returns JSON diagnostics with codes, severities, line ranges. |
| `fix` | Surgically fix ONE issue. Returns proposed fix text, accept/reject status, risk flags. Only works on 5 codes: `ambiguity-llm`, `contradiction`, `hygiene-redundant-instruction`, `hygiene-unordered-process`, `hygiene-over-specification`. |
| `accept_finding` | Suppress a specific finding on a specific file so it won't appear in future analyses. |

### New tools to add

| Tool | Description | Why it's needed |
| --- | --- | --- |
| `score` | Compute quality score (0-100), grade (A+ through F), and pillar breakdown for a document. | Lets agents assess overall quality before/after fixes. |
| `verify_fix` | Re-analyze a document and check if a specific issue (by code + text pattern) is still present. Returns `{ fixed: boolean, remaining_issues: [...], new_issues: [...] }`. | Lets agents confirm a fix worked without parsing full analyze output. |
| `health` | Return current provider, model, connectivity status, and config source. | Lets agents verify setup before spending tokens on analysis. |
| `list_accepted_findings` | Return all accepted findings, optionally filtered by file. | Lets agents see what's been suppressed. |

### Complete tool descriptions

```json
{
  "analyze": {
    "description": "Analyze a skill, instructions, or prompt document for quality issues. Runs 6 focused analysis waves: contradictions, ambiguities, persona conflicts, structural/cognitive issues, coverage gaps, and hygiene problems. Returns a JSON array of diagnostics, each with: code (e.g. 'ambiguity-llm', 'contradiction', 'coverage-gap'), severity (error/warning/info), message, range, and optional suggestion. Use 'score' to get an overall quality grade. Use 'fix' to attempt surgical repair of fixable issues (only 5 codes are fixable: ambiguity-llm, contradiction, hygiene-redundant-instruction, hygiene-unordered-process, hygiene-over-specification).",
    "inputSchema": { "text": "string (required)", "filePath": "string (optional)" }
  },
  "fix": {
    "description": "Surgically fix ONE quality issue in a document. Returns the proposed fixed text and whether it was accepted or rejected (with reason). Only works on these 5 codes: ambiguity-llm, contradiction, hygiene-redundant-instruction, hygiene-unordered-process, hygiene-over-specification. All other codes (coverage-gap, persona-inconsistency, cognitive-*, etc.) are NOT fixable — the tool will return 'accepted: false'. Use 'analyze' first to find issues, then 'fix' on each fixable one. Use 'verify_fix' after to confirm the fix worked.",
    "inputSchema": { "text": "string (required)", "filePath": "string (optional)", "diagnosticCode": "string (required)", "relevantText": "string (required)" }
  },
  "accept_finding": {
    "description": "Accept (suppress) a specific finding on a specific file so it will not appear in future analyses. Use this for known/expected issues that are intentional (e.g. self-referential prompt patterns). The finding is matched by code AND text pattern — accepting 'ambiguity-llm' on 'vague or underspecified' in file.md won't suppress a different ambiguity-llm finding in the same file.",
    "inputSchema": { "filePath": "string (required)", "diagnosticCode": "string (required)", "relevantText": "string (required)", "reason": "string (optional)" }
  },
  "score": {
    "description": "Compute the quality score (0-100) and letter grade (A+ through F) for a document. Returns score, grade, penalty breakdown (issues + length), pillar scores (Contradictions, Clarity, Completeness, Structure), skill type, and line count. Use this before/after fixes to measure improvement.",
    "inputSchema": { "text": "string (required)", "filePath": "string (optional)" }
  },
  "verify_fix": {
    "description": "Re-analyze a document and check if a specific issue has been resolved. Provide the original diagnostic code and text pattern. Returns: fixed (boolean), the matching issue if still present, any new issues introduced by the fix, and the new quality score. Use this after 'fix' to confirm the fix worked without side effects.",
    "inputSchema": { "text": "string (required)", "filePath": "string (optional)", "diagnosticCode": "string (required)", "relevantText": "string (required)" }
  },
  "health": {
    "description": "Check the MCP server status. Returns: provider name, model ID, config source (file/env/default), and whether the provider is reachable. Use this first to verify setup before running analyses.",
    "inputSchema": {}
  },
  "list_accepted_findings": {
    "description": "List all accepted (suppressed) findings, optionally filtered by file path. Returns the full store contents with code, textPattern, acceptedAt, and reason for each entry.",
    "inputSchema": { "filePath": "string (optional)" }
  }
}
```

## Implementation Plan

### Wave 1: Core MCP fixes (HIGH priority)

| Task | Status | Files |
| --- | --- | --- |
| Pass `acceptedFindingsPath` to `engine.analyze()` in MCP | ✅ Done | `src/mcp/server.ts` |
| Enrich all tool descriptions | ✅ Done | `src/mcp/server.ts` |
| Add `health` tool | ✅ Done | `src/mcp/server.ts` |

### Wave 2: New tools (MEDIUM priority)

| Task | Status | Files |
| --- | --- | --- |
| Add `score` tool — calls `Engine.score()` | ✅ Done | `src/mcp/server.ts` |
| Add `verify_fix` tool — re-analyze + match specific issue | ✅ Done | `src/mcp/server.ts` |
| Add `list_accepted_findings` tool | ✅ Done | `src/mcp/server.ts` |

### Wave 3: Config sync (HIGH priority)

| Task | Status | Files |
| --- | --- | --- |
| Add `.skills-review.json` writer to extension (on setting change) | ✅ Done | `src/extension.ts` |
| Update `createDefaultEngine()` to read `.skills-review.json` | ✅ Done | `src/mcp/server.ts` |
| Add "Sync MCP Config" VS Code command | ✅ Done | `src/extension.ts`, `package.json` |
| Map `vscode-lm` provider to GitHub Models API in MCP | ✅ Done | `src/mcp/server.ts` |

### Wave 4: Documentation

| Task | Status | Files |
| --- | --- | --- |
| Update `src/mcp/README.md` with full tool docs + client config examples | ✅ Done | `src/mcp/README.md` |
| Update `docs/plan/MCP-IMPROVEMENT-PLAN.md` status | ✅ Done | `docs/plan/` |

## Cost Control

- **No `switch_provider` tool** — model is set by the human (VS Code picker or JSON edit)
- LLM agents can only: analyze, fix, score, verify, accept — not change the model
- `health` tool reports current model so agents can tell users what they're using
- All pricing info lives in the VS Code picker (not exposed to MCP)

## Rescan Workflow (verify_fix)

The `verify_fix` tool is the key missing piece for iterative fixing:

```text
1. analyze(text)           → find 12 issues, 5 fixable
2. fix(text, "ambiguity-llm", "...")  → accepted, fixedText returned
3. verify_fix(text, "ambiguity-llm", "...")  → { fixed: true, newIssues: [] }
4. fix(text, "contradiction", "...")   → accepted
5. verify_fix(text, "contradiction", "...")  → { fixed: true, newIssues: ["ambiguity-llm at L15"] }
   → fix introduced a new issue! Agent can decide to revert.
6. score(text)  → grade improved from C to B+
```

This gives agents a clean loop: fix → verify → score → repeat or stop.
