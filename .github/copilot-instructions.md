<!-- faf:start -->
# GitHub Copilot Instructions — skills-review-and-polish

> Generated from project.faf by claude-faf-mcp. Copilot reads these instructions on every request in this repository — keep them short and broadly applicable.

Authoring-time linter and fixer for AI customization files (SKILL.md, AGENTS.md, instructions) — catches contradictions, ambiguities, coverage gaps, and structural issues via a 6-wave LLM analyzer with surgical fixes.

## Tech stack

- Frontend: VS Code UI (webview/diagnostics)
- Backend: VS Code extension (no server)
- Runtime: Node.js (VS Code extension host)
- Database: N/A (no database)
- Hosting: VS Code marketplace

## Build & run

- Build with `TypeScript + esbuild/tsc`.
- CI runs on Vitest.

## Project context

- **Who:** Developers
- **What:** Authoring-time linter and fixer for AI customization files. Catches contradictions, ambiguities, coverage gaps, and structural issues. VS Code extension provides AI-suggested fixes with diff preview for human review.
- **Why:** Improve AI prompt quality
- **Where:** <https://github.com/mutl3y/skills-review-and-polish>
- **When:** Active dev, v0.1.51
- **How:** 6-wave LLM analyzer + surgical fixer
<!-- faf:end -->
