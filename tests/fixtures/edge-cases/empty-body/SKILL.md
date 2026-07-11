---
name: empty-body-skill
description: 'Edge case fixture: a SKILL.md with valid YAML frontmatter but no body content. Stress-tests the analyzer''s handling of empty documents.'
---

> **Test metadata:** 0 expected issues (clean fixture — the analyzer should treat the empty body as gracefully-skipped, not as missing-handling).
> Expected analyzer category: `none` — there is no body to analyze. The gate test in src/fixture-validation.test.ts requires a Test metadata block; this fixture is intentionally clean and serves as a negative-control.
