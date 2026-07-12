---
name: test-ambiguity-pub-and-empty
description: 'Test fixture: a Document with two deliberately-injected ambiguities. Used to verify the verify-documentation skill detects them and to measure how the Published definition in the skill changes model behavior.'

# Test Ambiguity: Published and Empty Document

This Document contains two known ambiguities. The first is about what "Published" means. The second is about what to do when the Document is empty.

# The "Published" ambiguity

> The component must be published before review.

The Document does not define what "published" means. A model reading this Document could interpret it as:

- the component is committed to a branch,
- the component is merged to main,
- the component is given to a user,
- the component is announced,
- the component passes a release gate.

The Document uses the word once and does not define it.

# The empty-Document ambiguity

This section is intentionally empty. A model reading only this Document has no information about what the Document does or claims.

A model with no rule for empty Documents could:

- emit no report,
- emit a Pass report because no Requirement is violated,
- emit a Pass-with-warnings report because the absence of content is suspicious,
- abort the verification pass.

The Document gives no instruction about which behavior is correct.

# Injected issue table

**Test metadata:** E12-N3 Gemini median across 3 runs:

| Category | Expected count | Detectable? |
| --- | ---: | --- |
| Ambiguities | 2 | YES |
| Coverage gaps | 1 | YES |
| Hygiene | 4 | YES |
| **Total** | **7** | — |

**Expected analyzer category:** `ambiguity` + `coverage`

| # | Section | Category | Expected code | Notes |
|---|---------|----------|---------------|-------|
| 1 | The "Published" ambiguity | ambiguity | `ambiguity-llm` | "Published" is undefined |
| 2 | The empty-Document ambiguity | coverage | `coverage-gap` | No rule for empty Documents |