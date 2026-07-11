---
name: frontmatter-only-skill
description: 'Edge case fixture: 30-line YAML frontmatter (name, description, license, metadata with many version stamps) plus a minimal 2-line body. Stress-tests the analyzer''s handling of frontmatter-heavy skills.'
license: Apache-2.0
allowed-tools: Read
metadata:
  version: 1.4.2
  author: skills-team
  category: utility
  tags:
    - edge-case
    - fixture
  revision-history:
    - version: 1.0.0
      date: 2025-01-15
      note: Initial release
    - version: 1.1.0
      date: 2025-03-22
      note: Added metadata
    - version: 1.2.0
      date: 2025-06-10
      note: Added tags
    - version: 1.3.0
      date: 2025-09-01
      note: Added license
    - version: 1.3.1
      date: 2025-09-15
      note: License tweak
    - version: 1.4.0
      date: 2025-12-01
      note: Edge case fixture
    - version: 1.4.1
      date: 2026-02-15
      note: Pre-release
    - version: 1.4.2
      date: 2026-05-01
      note: Final
  compatibility: copilot
---

# Frontmatter Only

Short body.

> **Test metadata:** 1 expected issue — the analyzer may flag the rich YAML frontmatter (many version stamps, redundant license + metadata) as `hygiene-redundant-instruction` or `cognitive-deep-decision-tree` when the LLM scans the frontmatter despite the "do NOT analyze the frontmatter" instruction.
> Expected analyzer category: `hygiene` — the frontmatter is the surface area being stressed.
