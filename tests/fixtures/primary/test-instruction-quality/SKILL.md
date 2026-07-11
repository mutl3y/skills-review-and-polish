---
name: documentation-generator
description: Generates technical documentation for APIs, services, and code changes from source artefacts.
---

# Documentation Generator

Use this skill to produce technical documentation for engineering teams from OpenAPI specs, code, or change descriptions.

> **Test metadata:** 15 injected instruction quality issues (QUALITY-1 through QUALITY-15).
>
> | Category | Expected count | Detectable? |
> | --- | ---: | --- |
> | Ambiguities | 8 | YES |
> | Hygiene | 7 | YES |
> | Coverage gaps | 2 | YES |
> | Contradictions | 1 | YES |
> | Cognitive | 4 | YES |
> | Dead | 1 | MAYBE (qualifies as dead-instruction) |
> | **Total** | **23** | — |
>
> | Label | Pattern | Expected analyzer category | Detectable? |
> |---|---|---|---|
> | QUALITY-1 | "try to include" — weak directive | ambiguity (unclear obligation) | MAYBE |
> | QUALITY-2 | "should explain" — soft obligation | ambiguity | MAYBE |
> | QUALITY-3 | "might want to include" — too soft | ambiguity | MAYBE |
> | QUALITY-4 | Double negative: "not required unless not deprecated" | cognitive_load | YES |
> | QUALITY-5 | Passive voice obscures responsibility: "will be reviewed" | NEW: responsibility-ambiguity | NO |
> | QUALITY-6 | Hedged example: "something like this" | NEW: underdefined-example | NO |
> | QUALITY-7 | Delegates back to model: "use your judgment" without criteria | ambiguity / coverage_gap | MAYBE |
> | QUALITY-8 | Undefined escalation path: "consult appropriate expert" | ambiguity / coverage_gap | MAYBE |
> | QUALITY-9 | "consider whether needed" without decision criteria | ambiguity | MAYBE |
> | QUALITY-10 | Over-specifies trivial formatting (exactly N spaces/chars) | NEW: over-specification | NO |
> | QUALITY-11 | Unreachable instruction (references removed feature) | NEW: dead-instruction | NO |
> | QUALITY-12 | Excessive hedging stack: "in some cases, it may sometimes possibly" | ambiguity | MAYBE |
> | QUALITY-13 | Competing scope directives: be concise vs be comprehensive | contradiction | YES |
> | QUALITY-14 | Prerequisite mentioned after the step that depends on it | cognitive_load | YES |
> | QUALITY-15 | "it depends" without specifying on what | ambiguity / coverage_gap | MAYBE |

## Writing Instructions

### [QUALITY-1] Error Examples
When documenting error responses, try to include a concrete example for each error code listed in the spec.

---

### [QUALITY-2] Introduction Section
The introduction section should explain the API's purpose, primary use cases, and intended audience at a high level.

---

### [QUALITY-3] Version History
You might want to include a version history section if the API has undergone breaking changes in the past.

---

### [QUALITY-4] Parameter Documentation Scope
Do not document parameters that are not required unless they are not deprecated.

---

### [QUALITY-5] Review Gate
Before this documentation is published, it will be reviewed for technical accuracy and completeness.

---

### [QUALITY-6] API Reference Structure
Structure the API reference section something like this:

```
# API Name (or whatever is appropriate)
Brief description here (a paragraph or so, give or take)

## Endpoints
(list them out somehow)
```

---

### [QUALITY-7] Detail Level
Use your best judgment to determine the appropriate level of technical detail for each section, based on the complexity and audience of the component being documented.

---

### [QUALITY-8] Unfamiliar Components
If you are unsure how to document a particular component or integration, consult the appropriate expert before proceeding.

---

### [QUALITY-9] Security Considerations
Consider whether a security considerations section is needed for this API.

---

### [QUALITY-10] Heading Format
All section headings must use exactly two pound signs (`##`) followed by exactly one space, then the title written in title case, followed by exactly one blank line before the body content begins and exactly one blank line after the body content ends before the next heading.

---

### [QUALITY-11] Legacy Authentication
If the service uses the `LEGACY_AUTH` authentication scheme, document the full authentication flow using the deprecated auth documentation template located at `/templates/legacy/auth.md`.

*(Note: `LEGACY_AUTH` was removed in service platform v2.0. No service in the organisation uses this scheme. This instruction is unreachable.)*

---

### [QUALITY-12] Conditional Notes
In some cases, it may sometimes be possible that certain endpoints could potentially benefit from additional clarifying notes under certain circumstances.

---

### [QUALITY-13] Length and Completeness
**Be concise** — documentation should be as brief as possible. Readers are busy; respect their time by cutting everything that is not essential.

**Be comprehensive** — documentation must cover every parameter, every error code, every edge case, and every integration scenario without omission, so teams can rely on it as the single source of truth.

---

### [QUALITY-14] API Reference Generation
Generate the full API reference by iterating over every endpoint in the OpenAPI spec, expanding each operation into a documentation entry with parameters, request/response examples, and error codes.

First, confirm that the OpenAPI specification file exists at `./api/openapi.yaml` and is valid, parseable JSON or YAML before beginning any generation step.

---

### [QUALITY-15] Section Detail Level
The appropriate level of detail for each section depends on the complexity of the component being documented.
