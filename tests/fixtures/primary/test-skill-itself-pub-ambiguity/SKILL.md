---
name: test-skill-itself-pub-ambiguity
description: 'Test fixture: applies the verify-documentation skill to itself. Used to test whether the skill's Published definition in Definitions makes the "must not be published" rule in R2 unambiguous.'
---

# Verify Documentation

This skill is invoked against one supplied document and produces one verification report.

---

# Purpose

The Purpose of this skill is to verify that the supplied Document is factually correct, internally consistent, and current. The only output is the verification report defined in the Output Format section.

---

# Definitions

The terms below are the only definitions used by this skill. No term has a synonym in this skill. A term that is not listed below has no defined meaning and must not be introduced.

- **Document**: The single file supplied for verification. Nothing else is in scope.
- **Claim**: A factual statement in the Document that asserts something about the repository, its behaviour, its structure, or its public interfaces. A code block that contains an example command or configuration is a Claim. A section heading is not a Claim unless the heading itself asserts a fact.
- **Evidence**: A pointer inside the repository that supports or contradicts a Claim. Evidence has the precedence defined in the Procedure section.
- **Authoritative source**: A file in the repository whose contents are accepted as the definition of the subject of a Claim. The Authoritative source is the implementation file named by a Claim; or, when the Claim is generic, the implementation file that owns the subject of the Claim.
- **Source**: A file in the repository that may serve as Evidence. A Source is either an implementation file, a specification, a test, or another document in the repository.
- **Supportable Claim**: A Claim for which at least one Source of Evidence, at the precedence defined in the Procedure, directly supports the Claim.
- **Unsupportable Claim**: A Claim for which no Source of Evidence, at the precedence defined in the Procedure, supports the Claim.
- **Behavioural Claim**: A Claim that asserts runtime behaviour. A Behavioural Claim includes any Claim about side effects, timing, ordering, or Guarantees.
- **Architectural Claim**: A Claim that asserts a structural relationship between components, files, or modules.
- **Numeric Claim**: A Claim that asserts a count, a version, a size, a range, or any other numeric value.
- **Guarantee**: A Behavioural Claim that asserts the implementation will or will not perform a specific action under specified conditions.
- **Public interface claim**: A Claim that asserts the existence or signature of a public symbol, command, configuration key, MCP tool, or HTTP endpoint.
- **Relative link**: A markdown link whose target is a path relative to the Document, or an anchor within the Document.
- **Modification**: A change to the Document's text. A Modification is either Permitted or Forbidden, as defined in the Editing Rules section.
- **Permitted Modification**: A Modification that satisfies at least one condition in the Permitted list of the Editing Rules section.
- **Forbidden Modification**: A Modification that satisfies at least one condition in the Forbidden list of the Editing Rules section. A Modification that is both Permitted and Forbidden is Forbidden.
- **Verification pass**: One complete execution of the Procedure in this skill against the Document, producing one verification report.
- **Observation**: One entry in the verification report. An Observation is either a Correction, a Warning, or a Verified highlight.
- **Correction**: An Observation that records a Modification made to the Document.
- **Warning**: An Observation that records an Unsupportable Claim that was not Modified. A Warning has one of three Reasons defined in the Output Format section.
- **Verified highlight**: An Observation that records a Claim that the verifier verified directly against the implementation.
- **Confidence**: One of the three values defined in the Confidence levels subsection. Confidence is a property of an Observation.

---

# Requirements

A Document passes verification only if every requirement below is satisfied. Each requirement is a binary rule. There is no "prefer", "consider", or "improve". Every requirement is "must".

## R1. Claims are supported

Every Claim in the Document must have supporting Evidence in the repository.

## R2. Unsupportable Claims are Resolved

If a Claim cannot be supported, the verification report must either:

- modify the Document to weaken the Claim,
- remove the Claim from the Document, or
- record a Warning that the Claim remains unchanged with the reason.

The Document must not be left with an unsupportable Claim without a corresponding Warning or Correction.

## R3. No silent strengthening

The Document must not be modified in a way that makes a Claim stronger than the Evidence supports. Inferring intent, intent-based rewriting, or paraphrase that adds a new assertion are forbidden.

## R4. Numeric claims are exact

Every Numeric Claim in the Document must match the Evidence exactly. If the Evidence shows `6`, the Document must say `6`, not "several" or "multiple".

---

# Injected issue table

| # | Section | Category | Expected code | Notes |
|---|---------|----------|---------------|-------|
| 1 | R2 "must not be published" | ambiguity | `ambiguity-llm` | "Published" is not defined in this version of the skill (Published is removed) |
