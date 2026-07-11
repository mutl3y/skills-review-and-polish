---
name: simple-greeter
description: 'Edge case fixture: type=simple skill with 50 lines and a single direct task. Stress-tests the analyzer''s handling of small, focused skills.'
type: simple
---

# Simple Greeter

When invoked, produce a friendly greeting in the language of the user's input.

> **Test metadata:** 2 expected issues. The simple-type scoring branch should give this skill a high grade, but the LLM may still flag minor issues.
> Expected analyzer category: `hygiene` — the preamble may be flagged as non-actionable, and the language detection step is underspecified.

## Steps

1. Detect the language of the user's input.
2. Produce a greeting in that language.
3. If the language cannot be detected, produce the greeting in English.
4. Return the greeting as plain text.

## Examples

- Input: "Hello" → Output: "Hello! How can I help you today?"
- Input: "Bonjour" → Output: "Bonjour ! Comment puis-je vous aider aujourd'hui ?"
- Input: "Hola" → Output: "¡Hola! ¿Cómo puedo ayudarte hoy?"

## Notes

The greeting should be warm but professional. Avoid emojis unless the user's input contains emojis.

> **Test metadata:** 2 expected issues. The skill is intentionally minimal to test the noise floor on simple-type skills.
