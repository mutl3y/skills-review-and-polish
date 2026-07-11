---
name: meta-skill-coordinator
description: 'Edge case fixture: type=meta skill that documents how other skills should be invoked. Stress-tests the analyzer''s handling of meta-type skills that contain references to other skills rather than direct instructions.'
type: meta
---

# Meta Skill Coordinator

This skill coordinates the invocation of other skills. It does not perform any action directly; it routes work to specialized skills.

> **Test metadata:** 4 expected issues across coverage and persona categories. The meta-type routing pattern is unusual and may confuse heuristics that assume a direct-execution skill.
> Expected analyzer category: `coverage_gap` — the routing rules are incomplete (no fallback for when a target skill is unavailable) and the trigger conditions for each target are vague.

## Routing Rules

**[META-1] Code Review Routing**
If the request mentions "review", "PR", or "pull request", delegate to the code-review skill. If the code-review skill is unavailable, fall back to the inline review procedure.

**[META-2] Documentation Routing**
If the request mentions "document", "README", or "docs", delegate to the documentation-review skill. If the documentation-review skill is unavailable, fall back to the inline documentation review.

**[META-3] Test Routing**
If the request mentions "test", "tests", or "coverage", delegate to the test-generation skill. If the test-generation skill is unavailable, generate tests inline using the standard test template.

**[META-4] Refactor Routing**
If the request mentions "refactor", "cleanup", or "simplify", delegate to the refactor-planner skill. If the refactor-planner skill is unavailable, perform the refactor inline using best judgment.

**[META-5] Ambiguity Fallback**
If the request does not match any of the above routing rules, ask the user to clarify which skill they want to invoke. If the user cannot clarify, attempt the most likely skill and document the assumption.

## Constraints

- This skill MUST NOT execute any direct action; it only routes.
- Routing decisions MUST be logged for audit purposes.
- The skill MUST prefer delegation over inline execution whenever a target skill is available.
- The skill MUST honor the user's explicit skill selection, even if it conflicts with a routing rule.

## Persona

The audience is an experienced developer who knows the available skills by name. Do not over-explain the routing rules.

> **Test metadata:** 4 expected issues. The persona constraint ("experienced developer") and the META-5 ambiguity fallback are the primary targets.
