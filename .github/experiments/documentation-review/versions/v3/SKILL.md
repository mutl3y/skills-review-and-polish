---
name: documentation-review-v3
description: Verify repository documentation using repository evidence. Produce the minimum set of modifications required to satisfy the verification criteria.
---

# Documentation Verification

## Objective

Verify that the supplied document accurately represents the current repository.

Produce the minimum set of modifications required to satisfy the Verification Criteria.

---

# Definitions

The following definitions apply throughout this document.

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

# Constraints

The following constraints apply throughout verification.

## C1

Do not invent repository behaviour.

## C2

Do not strengthen a claim beyond Repository Evidence.

## C3

Do not weaken a supported claim.

## C4

Do not perform stylistic rewrites.

## C5

Every modification must satisfy R1.

---

# Verification Rule

## R1

Verification Decision evaluates to TRUE when one or more of the following conditions are satisfied.

- A Factual Statement is incorrect.
- A Factual Statement cannot be verified.
- An Ambiguous Statement is present.
- Two Factual Statements contradict each other.
- A repository reference does not exist.
- A repository link does not resolve.
- The document no longer represents repository behaviour.

Verification Decision evaluates to FALSE otherwise.

When Verification Decision evaluates to TRUE:

- Modify only the affected statement.

When Verification Decision evaluates to FALSE:

- Leave the document unchanged.

---

# Procedure

Complete every step in sequence.

## Step 1

Read the complete document.

Identify every Factual Statement.

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

If the document contains no Factual Statements:

- Report that no verification was performed.
- Do not modify the document.
- Complete verification.

Otherwise continue to Step 5.

---

## Step 5

Classify every Factual Statement as one of:

- Behavioural Claim
- Architectural Claim
- Repository Navigation
- Installation
- Configuration
- Usage
- Version Information
- Other

---

## Step 6

Verify every Factual Statement using Repository Evidence.

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

Verify every numeric statement using Repository Evidence.

---

## Step 10

Evaluate R1.

If Verification Decision evaluates to TRUE:

Modify only the statements that satisfy R1.

Otherwise leave the document unchanged.

---

# Document-Specific Verification

Perform every Applicable Criterion.

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

For every modification report:

- Location
- Original Statement
- Modified Statement
- Repository Evidence
- Confidence

---

## Unverified Statements

For every unverified statement report:

- Location
- Reason
- Required Repository Evidence

---

## Verified Claims

List significant Behavioural Claims and Architectural Claims that were verified.

---

## Summary

Report:

- Number of Corrections
- Number of Unverified Statements
- Number of Verified Claims

State whether the document is:

- Factually Accurate
- Internally Consistent
- Supported by Repository Evidence

---

# Verification Criteria

Verification is complete after every Applicable Criterion has been evaluated.

## Repository

- [ ] Every referenced file exists.
- [ ] Every repository link resolves.

---

## Accuracy

- [ ] Every Factual Statement has Repository Evidence.
- [ ] Every Behavioural Claim has Repository Evidence.
- [ ] Every Architectural Claim has Repository Evidence.
- [ ] Every numeric statement has Repository Evidence.

---

## Consistency

- [ ] Defined terminology is used consistently.
- [ ] Contradictory statements are absent.
- [ ] Unsupported guarantees are absent.

---

## Document

- [ ] The intended audience is preserved.
- [ ] Every modification satisfies R1.
- [ ] Internal consistency is preserved.

---

## Completion

Verification is complete only after every Applicable Criterion has been evaluated.
