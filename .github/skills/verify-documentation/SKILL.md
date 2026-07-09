---
name: verify-documentation
description: 'Verify that documentation accurately reflects the repository by checking every factual statement against the implementation and authoritative documentation.'
---

# Verify Documentation

This skill is invoked against one supplied document and produces one verification report.

---

# Purpose

The Purpose of this skill is to verify that the supplied Document is factually correct, internally consistent, and current.

The Purpose is not to improve prose. The Purpose is not to reorganise sections. The Purpose is not to add Claims. The Purpose is not to remove Claims that are Supportable. The Purpose is not to strengthen a Claim beyond what its Evidence supports.

The only output is the verification report defined in the Output Format section.

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

The Requirements section is the single source of truth for what the Document must satisfy. Every Requirement is a binary rule. Every Requirement uses one of the verbs `must`, `must not`, or `may only`. The words `prefer`, `consider`, `should`, and `improve` do not appear in any Requirement.

A Document passes verification only when every Requirement below is satisfied.

## R1. Every Claim has Evidence

Every Claim in the Document must have supporting Evidence. An Unsupportable Claim must be Resolved by R2 before the report is emitted.

## R2. Unsupportable Claims are Resolved

Every Unsupportable Claim in the Document must receive a Resolution before the report is emitted. The Resolution is one of three actions:

1. Modify the Document to weaken the Claim so it becomes Supportable.
2. Modify the Document to remove the Claim.
3. Record a Warning that names the Claim and the Reason the Claim is unsupportable.

A Document must not be published with an unresolved Unsupportable Claim.

## R3. No Strengthening

A Modification applied to the Document must not make a Claim stronger than the Evidence supports. Inferring intent, intent-based rewriting, and paraphrase that adds a new assertion are Forbidden.

## R4. Numeric Claims are Exact

Every Numeric Claim in the Document must match the Evidence exactly. If the Evidence shows `6`, the Document must say `6`. The Document must not say `several` or `multiple` where the Evidence shows `6`.

## R5. Architectural Claims match Implementation

Every Architectural Claim must match the file layout, module boundaries, and component responsibilities found in the implementation at the time of verification.

## R6. Behavioural Claims match Implementation

Every Behavioural Claim must match the runtime behaviour recorded in the implementation source, or in a passing test, or in a specification cited by the implementation.

## R7. Guarantees have Evidence of Enforcement

Every Guarantee must have Evidence that demonstrates the Guarantee is enforced. A Guarantee supported only by intent, comment, or design document is unsupportable.

## R8. Public Interface Claims are Verifiable

Every Public interface claim must reference a symbol, command, configuration key, tool, or endpoint that exists at the cited path at the time of verification.

## R9. Relative Links resolve

Every Relative link in the Document must resolve to a real file in the repository. An anchor-only link must resolve within the Document.

## R10. Referenced Files exist

Every file path mentioned in the Document, including those inside code fences, must exist in the repository at the time of verification.

## R11. Terminology is Single-Valued

A concept in the Document must be referred to by one term throughout the Document. Two terms for the same concept is a violation of R11.

## R12. Counts are Consistent

A count stated in one section of the Document must equal the same count stated in any other section of the Document.

## R13. Modifications obey the Editing Rules

A Modification to the Document is Permitted only when it satisfies the Editing Rules section. A Modification that does not satisfy the Editing Rules section is Forbidden.

## R14. Author Style is Preserved

A Permitted Modification may change a Claim. A Permitted Modification may not change the Document's surrounding terminology, section order, or voice.

## R15. Report conforms to Output Format

The output of this skill must be a verification report that conforms to the Output Format section.

---

# Procedure

The Procedure is the fixed sequence of steps executed against the Document. The verifier executes Step 1 through Step 7 in order. The verifier does not skip a step. The verifier does not reorder steps.

## Step 1 — Identify the Document

The verifier records the Document path, its type, and its intended audience.

The allowed Document types are: `README`, `llms.txt`, architecture documentation, user guide, developer guide, API documentation, design document, specification, ADR, tutorial.

The allowed audiences are: end users, contributors, maintainers, AI agents, API consumers.

If the Document type is not in the allowed list, the verifier records a Warning. The Warning Reason is `could not be verified`. The verifier continues the verification pass using the most restrictive allowed type, which is `specification`.

## Step 2 — Extract Claims

The verifier reads the Document completely. The verifier produces an internal list of every Claim in the Document. The internal list is not part of the report output.

## Step 3 — Verify Claims against Evidence

For every Claim in the internal list, the verifier locates Evidence in the repository.

### Evidence precedence

When Sources disagree, the verifier accepts Evidence in this order, from highest to lowest:

1. The implementation file referenced by the Claim. When the Claim is generic, the implementation file that owns the subject of the Claim.
2. A specification cited by the implementation. When no specification exists, the closest Authoritative source for the subject.
3. A passing test that exercises the subject of the Claim.
4. Other documentation in the repository.

When no Source supports a Claim, the Claim is Unsupportable.

### Resolution of Unsupportable Claims

For every Unsupportable Claim, the verifier applies R2. The verifier may apply a different Resolution to different Unsupportable Claims. A single Resolution need not apply to all.

## Step 4 — Verify Navigation

For every Relative link in the Document, the verifier resolves the target. For every file path mentioned in prose or in code fences, the verifier confirms the file exists. The verifier records a failure as a Correction under R9 or R10.

## Step 5 — Verify Consistency

The verifier walks the Document for terminology collisions, duplicate concepts, contradictory Claims, and stale references. The verifier applies R11 and R12. The verifier records a collision or inconsistency as a Correction.

## Step 6 — Future-proof

The verifier walks the Document for Claims that depend on transient implementation details. A Claim that names a specific internal function, line number, or version-specific behaviour is flagged as a Warning. The Warning Reason is `may become stale`.

A count that materially aids understanding remains in the Document. The verifier verifies the count against Evidence in Step 3.

## Step 7 — Produce the report

The verifier emits the verification report. The report conforms to the Output Format section.

---

# Editing Rules

The Editing Rules section is the single source of truth for what a Modification may do. A Modification is Permitted only when it satisfies at least one of the seven conditions in the Permitted list. A Modification is Forbidden when it satisfies at least one of the eight conditions in the Forbidden list. A Modification that satisfies both a Permitted condition and a Forbidden condition is Forbidden.

## Permitted Modifications

A Modification is Permitted only when the Modification does one of the following:

- corrects an Unsupportable Claim,
- removes an Unsupportable Claim,
- weakens an Unsupportable Claim to a Supportable Claim,
- resolves a terminology collision under R11,
- resolves a count inconsistency under R12,
- resolves a broken Relative link or a missing file reference under R9 or R10,
- removes a transient implementation detail flagged in Step 6.

## Forbidden Modifications

A Modification is Forbidden when the Modification does one of the following:

- rewrites prose for voice,
- reorganises sections,
- renames concepts,
- adds new Claims,
- strengthens an existing Claim,
- changes the Document's intended audience,
- introduces a new term that is not in the Definitions section,
- removes Claims that are Supportable.

A Permitted Modification applied to the Document must preserve the Document's existing terminology, section order, and voice per R14.

---

# Output Format

The verification report is a single markdown document. The report contains the following sections, in this order. A section is omitted only when the section would be empty.

## Document

One line: the path of the Document under review.

## Type and audience

Two lines: the Document type from Step 1, and the intended audience from Step 1.

## Corrections

A bulleted list. One bullet per Correction. Each bullet has exactly these fields:

- **Location**: the section heading or line range in the Document.
- **Issue**: the violated Requirement, named by its identifier (for example, R5).
- **Evidence**: the file path and, when relevant, the line range or symbol in the repository that supports the Correction.
- **Correction**: the exact change made to the Document, or a one-line summary of the change.
- **Confidence**: one of `High`, `Medium`, `Low`, as defined in the Confidence levels subsection.

## Warnings

A bulleted list. One bullet per Warning. Each bullet has exactly these fields:

- **Location**: the section heading or line range in the Document.
- **Claim**: the Claim that triggered the Warning, quoted verbatim from the Document.
- **Reason**: one of `could not be verified`, `may become stale`, or `remains ambiguous`.
- **Recommendation**: the action the Document's author must take, or `leave unchanged with reason`.
- **Confidence**: one of `High`, `Medium`, `Low`.

## Verified highlights

A bulleted list. One bullet per Verified highlight. Each bullet has exactly these fields:

- **Location**: the section heading or line range in the Document.
- **Claim**: the Claim, quoted verbatim.
- **Evidence**: the file path and line range or symbol that supports the Claim.
- **Confidence**: one of `High`, `Medium`, `Low`.

## Overall assessment

One line, exactly one of:

- `Pass — every Requirement satisfied; Document is ready for publication.`
- `Pass with warnings — every Requirement satisfied; see Warnings.`
- `Fail — at least one Requirement is violated and not Corrected.`

A report is `Pass` only when every applicable Requirement in the Requirements section is satisfied. A report is `Fail` when any Requirement is violated and no Correction is recorded for it.

## Rationale

One paragraph explaining the Overall assessment. The Rationale must reference Requirement identifiers. The Rationale may not reference impressions.

## Confidence levels

Confidence is a property of an Observation. The verifier classifies every Observation as one of:

- **High**: the Observation is verified directly from the implementation. The cited file and line are present in the repository at the time of the verification pass.
- **Medium**: the Observation is supported by documentation, by a test, or by an Authoritative source, but the implementation was not directly inspected.
- **Low**: the Observation is an inference from repository structure, naming, or absence of evidence. An Observation with Confidence `Low` is recorded as a Warning, not as a Correction.

A Correction has Confidence `High` or `Medium`. A Correction may not have Confidence `Low`.

---

# Acceptance Criteria

The verification report is accepted only when every item below is true:

- Every Claim in the Document has supporting Evidence, or a Correction, or a Warning.
- Every Numeric Claim matches the Evidence exactly.
- Every Architectural Claim matches the implementation.
- Every Behavioural Claim matches the implementation, a test, or an Authoritative source.
- Every Guarantee has Evidence of enforcement.
- Every Public interface claim references an existing symbol, command, configuration key, tool, or endpoint.
- Every Relative link resolves.
- Every file path mentioned in the Document exists in the repository.
- Terminology is single-valued throughout the Document.
- Counts are consistent across the Document.
- The verification report conforms to the Output Format section.
- The Overall assessment is one of the three values in the Output Format section.
- Every Correction has Confidence `High` or `Medium`.
- Every Warning has Confidence `High`, `Medium`, or `Low` and includes a Reason and a Recommendation.
