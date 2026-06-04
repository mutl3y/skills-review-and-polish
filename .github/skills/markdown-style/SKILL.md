---
name: markdown-style
description: Markdown formatting standards and linting rules for project documentation
keywords:
  - markdown
  - linting
  - documentation
  - formatting
  - best-practices
useCase: Ensures all markdown files in the project pass linting and follow consistent formatting standards
---

# Markdown Style Guide

This file is the repo authoring contract for Markdown in the docs folder.
Use it whenever you create or edit Markdown in this repository.

Before you finish, run:

```bash
npm run lint:md
```

Fix every markdownlint error that the command reports before you stop.

## Required Blank Lines

### Blank Lines Around Lists (MD032)

Add blank lines before and after lists.

### Blank Lines Around Headings (MD022)

Add blank lines before and after headings.

### Blank Lines Around Code Blocks (MD031)

Add blank lines before and after code blocks.

## Table Formatting (MD060)

Tables must have consistent spacing.

Rules:

- One space after opening pipe
- One space before closing pipe
- One space around all pipes
- Use three hyphens for separator rows

## Code Block Language Tags

Always specify the language for syntax highlighting. Examples: `typescript`, `bash`, `json`, `markdown`, `text`.

## No Trailing Spaces (MD009)

Remove all spaces at line ends.

Enable detection in VS Code:

```json
{
  "editor.renderWhitespace": "all",
  "files.trimTrailingWhitespace": true
}
```

## Heading Hierarchy

1. Use ATX-style headings (#) not underline style
2. Start with H1 (#) at document start
3. Don't skip levels (H1 → H2 → H3)

## List Formatting

### Unordered Lists

Use minus sign (-) for consistency.

### Ordered Lists

Use numbers with periods.

### Nested Lists

Indent with 2 spaces.

## Link Formatting

Use square brackets for text, parentheses for URL. Avoid spaces around parentheses.

## Inline Code vs Code Blocks

### Use inline code for

- Variable names: `myVar`
- Function names: `myFunction()`
- File paths: `src/file.ts`
- Keywords and brief snippets

### Use code blocks for

- Multi-line examples
- Complete functions or classes
- Configuration files
- Terminal commands

## Emphasis Formatting

- **Bold**: Double asterisks around text
- *Italic*: Single asterisks around text
- Inline code: Backticks around text

## No Trailing Punctuation in Headings (MD026)

Don't end headings with punctuation like `:` or `.`

## Pre-Commit Validation

Before committing markdown files:

- [ ] No trailing spaces
- [ ] Blank line before each heading (except start)
- [ ] Blank line after each heading
- [ ] Blank line before each list
- [ ] Blank line after each list
- [ ] Blank line before code blocks
- [ ] Blank line after code blocks
- [ ] All code blocks have language tags
- [ ] Table pipes aligned
- [ ] No skipped heading levels
- [ ] Lists use minus sign consistently
- [ ] No trailing punctuation in headings

## Common Pitfalls

**Don't do these — they break linting:**

- Nested code blocks: Don't show fenced-code syntax inside a code block (use prose instead)
- Heading + list: Always blank line between heading and list
- Regex in inline code: Avoid patterns with leading/trailing spaces
- Trailing punctuation: Headings can't end with `:` or `.`

## Quick Lint Command

```bash
npm run lint
```

## Resources

- [Markdown spec](https://spec.commonmark.org/)
- [markdownlint rules](https://github.com/DavidAnson/markdownlint/blob/main/README.md)
