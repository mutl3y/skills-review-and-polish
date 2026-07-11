---
name: documentation-review-v5
description: Verify repository documentation using repository evidence. Produce the minimum set of modifications required to satisfy the verification criteria. Glossary-first with constraint/rule precedence clarified.
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

A statement that permits more than one reasonable interpretation.

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

- **Factual Fix** — a Modification that corrects a Factual Statement using Repository Evidence. A Factual Fix must not change meaning, intent, or scope.
- **Clarification** — a Modification that resolves an Ambiguous Statement by adding the missing disambiguating context. A Clarification may add words but must not add facts unsupported by Repository Evidence.
- **Deletion** — a Modification that removes a Factual Statement that is unsupportable. A Deletion must not remove context required by adjacent statements.
- **Stylistic Rewrite** — a Modification made solely to improve prose style, tone, formatting, or word choice while preserving meaning. A Stylistic Rewrite is **forbidden** (see C4).

---

## D9 Precedence

Precedence between Constraints (C1–C5) and Rule R1 is defined as follows:

1. Constraints always apply. A Modification (D8) that violates any Constraint is forbidden.
2. R1 is the decision procedure. R1 determines whether a Modification is required; the Constraints determine whether a proposed Modification is permitted.
3. When R1 evaluates to TRUE, produce a Modification that satisfies both R1's trigger and every Constraint.
4. When R1 evaluates to TRUE but every candidate Modification would violate a Constraint, leave the affected statement unchanged and report it as Unverifiable.

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

When Verification Decision (D7) evaluates to TRUE:

- Apply a permitted Modification (D8) that satisfies Precedence (D9).

When Verification Decision (D7) evaluates to FALSE:

- Leave the document unchanged.

---

# Procedure

Complete every step in sequence.

## Step 1

Read the complete document.

Identify every Factual Statement (D2).

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

Evaluate R1.

If Verification Decision (D7) evaluates to TRUE:

Apply a permitted Modification (D8) to the statements that satisfy R1, observing Precedence (D9).

Otherwise leave the document unchanged.

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

List significant Behavioural Claims (D3) and Architectural Claims (D4) that were verified.

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
