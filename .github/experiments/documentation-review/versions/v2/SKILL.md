---
name: documentation-review-v2
description: 'Verify that repository documentation is factually accurate, internally consistent, and supported by repository evidence.'
---

# Documentation Verification

## Purpose

Verify that a documentation file accurately represents the current repository.

Treat the document as executable documentation.

Every factual statement must be supported by repository evidence.

The objective is to maximise confidence in the document without changing its intended meaning.

---

# Definitions

The following definitions apply throughout this document.

## Repository Evidence

Implementation, tests, specifications, or authoritative documentation that directly supports a factual statement.

## Behavioural Claim

A statement describing observable behaviour of the repository, software, or documentation.

## Architectural Claim

A statement describing repository structure or relationships between components.

## Implementation Detail

A statement describing how behaviour is currently implemented rather than the behaviour itself.

## Factual Statement

A statement that can be verified as true or false using repository evidence.

## Ambiguous Statement

A statement that permits more than one reasonable interpretation without additional repository evidence.

## Authoritative Documentation

Documentation maintained within the repository that defines or explains repository behaviour.

---

# Requirements

## R1 Document Type

Identify the document type before beginning verification.

Examples include:

- README
- llms.txt
- Architecture documentation
- User guide
- Developer guide
- API documentation
- Specification
- Design document
- Tutorial

## R2 Intended Audience

Identify the intended audience before beginning verification.

Examples include:

- End users
- Contributors
- Maintainers
- AI agents
- API consumers

Use the identified audience when evaluating explanations, terminology, and level of detail.

## R3 Evidence

Every factual statement must be verified using Repository Evidence.

Use the first available evidence source in the following order:

1. Implementation
2. Tests
3. Specifications
4. Authoritative Documentation

Do not use a lower-priority source when a higher-priority source is available.

## R4 Modification Rule

Modify the document only when at least one of the following conditions is true.

- A factual statement is incorrect.
- A factual statement cannot be verified.
- An Ambiguous Statement is present.
- Two factual statements contradict each other.
- A referenced file does not exist.
- A link does not resolve.
- The document no longer reflects the repository.

Otherwise leave the document unchanged.

## R5 Scope

Do not introduce new behaviour.

Do not strengthen unsupported claims.

Do not remove supported information.

Do not modify wording solely for style.

Every modification must satisfy R4.

---

# Verification Procedure

Complete every step in sequence.

## Step 1

Read the entire document.

Identify every Factual Statement.

## Step 2

Classify each Factual Statement as one of:

- Behavioural Claim
- Architectural Claim
- Repository Navigation
- Installation or Configuration
- Usage Example
- Version-specific Information
- Other

## Step 3

Verify every Factual Statement using Repository Evidence.

## Step 4

Verify every repository link.

Confirm:

- the target exists
- the link resolves
- the target remains the correct navigation destination

## Step 5

Verify terminology.

Confirm:

- defined terms are used consistently
- identical concepts use identical terminology
- contradictory terminology is absent

## Step 6

Verify numeric statements.

Confirm every numeric value using Repository Evidence.

## Step 7

Apply R4.

Modify only the statements that satisfy R4.

---

# Document-Specific Verification

## README

Verify:

- installation instructions
- prerequisites
- quick-start instructions
- example commands
- supported platforms
- feature descriptions

## llms.txt

Verify:

- compliance with the llms.txt specification
- repository navigation
- referenced documentation
- section organisation
- repository coverage

## API Documentation

Verify:

- API signatures
- parameters
- return values
- examples
- documented error conditions

## Architecture Documentation

Verify:

- component responsibilities
- relationships between components
- data flow descriptions
- implementation alignment

---

# Confidence

Assign one confidence level to every reported issue.

## High

Verified directly from Implementation.

## Medium

Verified from Tests, Specifications, or Authoritative Documentation.

## Low

Supported only by inference.

Do not report a High confidence issue without direct verification.

---

# Verification Report

Produce the following sections.

## Corrections

For every modification include:

- Location
- Original Statement
- Corrected Statement
- Repository Evidence
- Confidence

## Warnings

List every statement that could not be verified.

Include:

- Location
- Reason
- Required Evidence

## Verified Claims

List significant Behavioural Claims and Architectural Claims that were explicitly verified.

## Summary

Include:

- Number of Corrections
- Number of Warnings
- Number of Verified Claims

State whether the document is:

- Factually accurate
- Internally consistent
- Supported by Repository Evidence
- Ready for publication

---

# Acceptance Criteria

Verification is complete only when every applicable condition is satisfied.

## Repository

- [ ] Every referenced file exists.
- [ ] Every referenced link resolves.

## Accuracy

- [ ] Every Factual Statement has Repository Evidence.
- [ ] Every Behavioural Claim has Repository Evidence.
- [ ] Every Architectural Claim has Repository Evidence.
- [ ] Every numeric statement has Repository Evidence.

## Consistency

- [ ] Defined terminology is used consistently.
- [ ] Contradictory statements are absent.
- [ ] Unsupported guarantees are absent.

## Document

- [ ] The intended audience remains unchanged.
- [ ] The document remains internally consistent.
- [ ] Every modification satisfies R4.

## Completion

Complete verification only after every applicable acceptance criterion has been evaluated.