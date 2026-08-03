---
name: documentation-review
description: Verify repository documentation using repository evidence. Produce the minimum set of modifications required to satisfy the verification criteria. Glossary-first with constraint/rule precedence and modification taxonomy clarified.
---

# Documentation Verification

## Objective

Verify that the supplied document accurately represents the current repository.

Produce the minimum set of modifications required to satisfy the Verification Criteria.

---

# Definitions

The following definitions apply throughout this document.

Every term used by a Constraint, a Rule, or a Procedure step is defined here.

A term that is not listed below has no defined meaning in this document and must not be introduced.

## D1 Repository Evidence

Implementation, tests, specifications, or authoritative documentation that directly supports a factual statement.

Evidence priority:

1. Implementation
2. Tests
3. Specifications
4. Authoritative documentation

Use the highest-priority available evidence.

---

## D2 Factual Statement

A statement that can be verified as true or false using Repository Evidence.

---

## D3 Behavioural Claim

A Factual Statement describing observable repository behaviour.

---

## D4 Architectural Claim

A Factual Statement describing repository structure or relationships between repository components.

---

## D5 Ambiguous Statement

A statement that permits more than one interpretation that a competent reader could plausibly hold given the surrounding context.

---

## D6 Applicable Criterion

A Verification Criterion relevant to the identified document type.

Ignore Verification Criteria that are not applicable.

---

## D7 Verification Decision

Verification Decision evaluates to TRUE when one or more conditions in R1 are satisfied.

Verification Decision evaluates to FALSE otherwise.

---

## D8 Modification

A change to the text of the supplied document.

A Modification is one of:

- **Factual Fix** — a Modification that corrects a Factual Statement using Repository Evidence. A Factual Fix changes only the words used to express a fact that is already supported by Repository Evidence. A Factual Fix that strengthens a claim (Constraint C2) or weakens a claim (Constraint C3) is NOT a Factual Fix; see C2 and C3 for the precise definitions of "strengthen" and "weaken" in terms of meaning, intent, and scope.
- **Clarification** — a Modification that resolves an Ambiguous Statement by adding the missing disambiguating context. A Clarification may add words but must not add facts unsupported by Repository Evidence (Constraint C1).
- **Deletion** — a Modification that removes a Factual Statement that is unsupportable. A Deletion must not remove context required by adjacent statements.

**Relationship to Constraints (C1–C5):** D8 defines the SHAPE of a permitted Modification. Satisfying the shape constraints above is NECESSARY but not SUFFICIENT: every Modification must ALSO satisfy all five Constraints. The three "forbidden-changes" enumerated below (Meaning, Intent, Scope change) are the same three properties already named in this D8 entry; they are restated below as a precise reference vocabulary that Constraints C2 (no strengthen) and C3 (no weaken) reference. D8 does not duplicate C2 or C3 — it provides the terms they reference.

The three forbidden-changes above are defined precisely:

- **Meaning change**: the modified Statement asserts any fact not present in the original Statement AND supported by Repository Evidence, OR removes any fact present in the original Statement AND supported by Repository Evidence.
- **Intent change**: the modified Statement directs the reader to perform, omit, or interpret an action differently than the original Statement.
- **Scope change**: the modified Statement applies the claim to a different set of subjects, files, commands, or conditions than the original Statement.

**Stylistic Rewrites (forbidden):** A Modification made solely to improve prose style, tone, formatting, or word choice while preserving meaning is a **Stylistic Rewrite** and is forbidden by Constraint C4. A Stylistic Rewrite is NOT a permitted Modification type — it is listed here only to name what C4 prohibits. Do not enumerate it as a fourth type when applying D8.

---

## D9 Precedence

Precedence between Constraints (C1–C5) and Rule R1 is defined as follows:

1. Constraints always apply. A Modification (D8) that violates any Constraint is forbidden.
2. R1 is the decision procedure. R1 determines whether a Modification is required; the Constraints determine whether a proposed Modification is permitted.
3. When R1 evaluates to TRUE, search for a permitted Modification (D8) that satisfies every Constraint. If at least one permitted Modification exists, apply the Modification with the smallest scope of text changed.
4. **Search-empty case:** If the search in step 3 finds no permitted Modification (every candidate would violate at least one Constraint), apply the formal fallback: leave the affected statement unchanged and report it as Unverifiable. Step 4 is reached ONLY when step 3's search space is empty — it is the formal completion of step 3, not a contradictory alternative.

---

# Constraints

The following constraints apply throughout verification.

Each Constraint uses a term defined in the Definitions section.

## C1

Do not invent repository behaviour.

## C2

Do not strengthen a claim beyond Repository Evidence.

## C3

Do not weaken a supported claim.

## C4

Do not perform a Stylistic Rewrite (D8).

## C5

Every Modification (D8) must satisfy R1.

---

# Verification Rule

## R1

Verification Decision (D7) evaluates to TRUE when one or more of the following conditions are satisfied.

- A Factual Statement (D2) is incorrect.
- A Factual Statement (D2) cannot be verified.
- An Ambiguous Statement (D5) is present.
- Two Factual Statements (D2) contradict each other.
- A repository reference does not exist.
- A repository link does not resolve.
- The document no longer represents repository behaviour.

Verification Decision (D7) evaluates to FALSE otherwise.

When Verification Decision (D7) evaluates to TRUE, apply a permitted Modification (D8) that satisfies Precedence (D9). When it evaluates to FALSE, leave the document unchanged. See D9 step 4 for the no-permitted-Modification fallback.

---

# Procedure

Complete every step in sequence.

## Step 1

Read the complete document.

Identify every Factual Statement (D2).

A Factual Statement (D2) is any contiguous span of text that satisfies ALL of the following:

- It asserts something verifiable (a fact, a count, a command, a path, a behaviour, a structure, or a property of the repository).
- It is not contained inside a code block (fenced or indented) UNLESS the code block is a runnable example (introduced by text instructing the user to run it) or a build instruction (naming a build command the user is expected to execute).
- It is not a procedural reference to a Definition in this document (e.g. "see D2", "per R1", "as defined in C4") — those are instructions, not facts.

The following syntactic patterns are Factual Statements (D2):

- A complete sentence ending with a period, question mark, or exclamation point that makes a verifiable claim.
- A complete imperative sentence ending with a period or a code-formatted command (e.g. "Run `npm run compile`.").
- A bullet item that asserts a fact (e.g. "- Supports 6 analysis waves.").
- A code block that is presented as a runnable example or build instruction.

The following are NOT Factual Statements (D2):

- A section heading (e.g. "Installation") unless the heading itself asserts a fact.
- A bullet item that contains only a category label with no assertion (e.g. "- README", "- llms.txt").
- A question, suggestion, or example that does not assert repository state.
- A reference to a definition in this document (e.g. "D2" in the body) — those are procedural, not factual, and are not subject to verification.

Examples of Factual Statements (D2):

- "The analyzer supports six analysis waves." — counts as one Factual Statement.
- "Run `npm run compile` to build the project." — the embedded command is a Factual Statement asserting the build entry point exists.
- "The MCP server exposes seven tools." — both the count and the existence claim are Factual Statements.

---

## Step 2

Identify the document type.

Examples include:

- README
- llms.txt
- Architecture
- User Guide
- Developer Guide
- Specification
- Tutorial
- API Documentation
- CHANGELOG
- CONTRIBUTING.md
- LICENSE

If the document type is not listed, classify by closest match and apply the most relevant Document-Specific Verification criteria, or report the type as unsupported.

---

## Step 3

Identify the intended audience.

Examples include:

- End Users
- Contributors
- Maintainers
- AI Agents
- API Consumers

---

## Step 4

If the document contains no Factual Statements (D2):

- Report that no verification was performed.
- Do not modify the document.
- Complete verification.

Otherwise continue to Step 5.

Note: Steps 7 (repository references) and 8 (terminology) are independent of Factual Statements and must still be executed even when Step 4 exits early.

---

## Step 5

Classify every Factual Statement (D2) as one of:

- Behavioural Claim (D3)
- Architectural Claim (D4)
- Repository Navigation
- Installation
- Configuration
- Usage
- Version Information
- Other

---

## Step 6

Verify every Factual Statement (D2) using Repository Evidence (D1).

If no repository evidence is accessible (private repo, missing access, empty repo), report all statements as Unverifiable with the reason "Repository evidence unavailable" and halt modifications.

If repository evidence sources contradict each other, report the conflict as an Unverified Statement and cite both conflicting sources with their evidence types.

---

## Step 7

Verify every repository reference.

Confirm:

- the referenced file exists
- every repository link resolves
- every destination is correct

---

## Step 8

Verify terminology.

Confirm:

- every defined term is used consistently
- identical concepts use identical terminology
- contradictory terminology is absent

---

## Step 9

Verify every numeric statement using Repository Evidence (D1).

---

## Step 10

Evaluate R1 and apply the result. See R1 for the decision procedure and D9 step 4 for the no-permitted-Modification fallback.

---

# Document-Specific Verification

Perform every Applicable Criterion (D6).

## README

Verify:

- installation instructions
- prerequisites
- quick-start instructions
- supported platforms
- feature descriptions

---

## llms.txt

Verify:

- compliance with the llms.txt specification
- repository navigation
- referenced documents
- section organisation
- repository coverage

---

## API Documentation

Verify:

- API signatures
- parameters
- return values
- examples
- documented errors

---

## Architecture Documentation

Verify:

- component responsibilities
- component relationships
- data flow
- repository alignment

---

# Confidence

Assign one confidence level to every reported issue.

## High

Verified directly from Implementation.

## Medium

Verified from Tests, Specifications, or Authoritative Documentation.

## Low

Supported only by indirect repository evidence.

Do not assign High confidence without Implementation evidence.

---

# Verification Report

Produce the following sections.

## Corrections

For every Modification (D8) report:

- Location
- Original Statement
- Modified Statement
- Repository Evidence (D1)
- Confidence

---

## Unverified Statements

For every unverified statement report:

- Location
- Reason
- Required Repository Evidence (D1)

---

## Verified Claims

List all Behavioural Claims (D3) and Architectural Claims (D4) that were verified and have Repository Evidence confidence of High or Medium.

---

## Summary

Report:

- Number of Corrections
- Number of Unverified Statements
- Number of Verified Claims

State whether the document is:

- Factually Accurate
- Internally Consistent
- Supported by Repository Evidence (D1)

---

# Verification Criteria

Verification is complete after every Applicable Criterion (D6) has been evaluated.

## Repository

- [ ] Every referenced file exists.
- [ ] Every repository link resolves.

---

## Accuracy

- [ ] Every Factual Statement (D2) has Repository Evidence (D1).
- [ ] Every Behavioural Claim (D3) has Repository Evidence (D1).
- [ ] Every Architectural Claim (D4) has Repository Evidence (D1).
- [ ] Every numeric statement has Repository Evidence (D1).

---

## Consistency

- [ ] Defined terminology is used consistently.
- [ ] Contradictory statements are absent.
- [ ] Unsupported guarantees are absent.

---

## Document

- [ ] The intended audience is preserved.
- [ ] Every Modification (D8) satisfies R1 and Precedence (D9).
- [ ] Internal consistency is preserved.

---

## Completion

After all Applicable Criteria (D6) have been evaluated, state whether all applicable criteria passed, list which criteria failed, and specify whether the document requires modifications before it can be considered verified.

---

# Cross-Reference Summary

The following table maps each Definition, Constraint, and Rule to the Procedure steps and Verification Criteria that reference it. This is the single source of truth for the cross-reference graph. If a cross-reference is added or removed, update this table in the same change.

| Reference | Type | Referenced by |
| --- | --- | --- |
| D1 Repository Evidence | Definition | Step 6, Step 9, Accuracy criteria, Unverified Statements, Verified Claims, Summary |
| D2 Factual Statement | Definition | R1, Step 1, Step 4, Step 5, Step 6, Accuracy criteria |
| D3 Behavioural Claim | Definition | Step 5, Verified Claims, Summary, Accuracy criteria |
| D4 Architectural Claim | Definition | Step 5, Verified Claims, Summary, Accuracy criteria |
| D5 Ambiguous Statement | Definition | R1 |
| D6 Applicable Criterion | Definition | Document-Specific Verification, Verification Criteria |
| D7 Verification Decision | Definition | R1, Step 10 |
| D8 Modification | Definition | C4, C5, Step 10, Corrections, Document criteria |
| D9 Precedence | Definition | R1, Step 10, Document criteria |
| C1 No invention | Constraint | D9, all Modifications |
| C2 No strengthening | Constraint | D9, all Modifications |
| C3 No weakening | Constraint | D9, all Modifications |
| C4 No stylistic rewrite | Constraint | D8 (forbidden list) |
| C5 Satisfies R1 | Constraint | D9, Step 10 |
| R1 Verification Decision | Rule | C5, Step 10, Document criteria |

Single-source-of-truth rules:

- R1 is the ONLY rule that determines whether verification requires a Modification (D8).
- D9 is the ONLY definition that determines Constraint/Rule precedence.
- C4 is the ONLY constraint that defines a forbidden Modification (D8) kind.
- The Cross-Reference Summary (this section) is the ONLY table that lists all cross-references.
