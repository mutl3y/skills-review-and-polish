---
name: verify-documentation
description: 'Verify that documentation accurately reflects the repository by checking every factual statement against the implementation and authoritative documentation.'
---

# Verify Documentation

Treat documentation as executable specifications. Every factual statement in the document under review must be traceable to authoritative evidence within the repository. The output of this skill is a verification report. The output is not a rewrite.

---

# Purpose

This skill verifies one supplied document. It produces a verification report that lists corrections, warnings, verified highlights, and an overall assessment.

Verification is binary. A claim is either supported by evidence, weakened, or removed. A claim is never restated more confidently than its evidence allows.

This skill does not improve prose. It does not reorganize for taste. It only modifies a document when the document violates a Requirement defined in the Requirements section.

---

# Definitions

The following terms have the meanings below. These definitions are the only definitions used by this skill. Do not introduce synonyms or redefinitions.

- **Document**: The single file supplied for verification. Everything in scope of this run.
- **Claim**: A factual statement in the Document that asserts something about the repository, its behaviour, its structure, or its interfaces. Examples: "the analyzer runs 6 waves", "the file `src/foo.ts` exists", "the fixer preserves YAML frontmatter". Code blocks containing example commands or configuration are treated as Claims. Section headings that do not assert facts are not Claims.
- **Evidence**: A pointer inside the repository that supports or contradicts a Claim. Evidence has a fixed precedence. See "Evidence precedence" in the Procedure section.
- **Authoritative source**: A file in the repository whose contents are accepted as the definition of a Claim's subject. Examples: the file named in a file-path Claim; the implementation file for a behavioural Claim; a test for a behavioural Claim when no implementation comment exists; a specification or design document for an architectural Claim.
- **Verification pass**: One complete execution of the Procedure in this skill against the Document, producing one verification report.
- **Confidence**: One of the values `High`, `Medium`, or `Low`, defined in the Confidence levels section. Confidence is a property of an observation, not of the Document.
- **Observation**: One entry in the verification report. Each Correction, Warning, and Verified Highlight is one Observation.
- **Relative link**: A markdown link whose target is a path relative to the Document, or an anchor within the Document.
- **Numeric claim**: A Claim that asserts a count, a version, a size, a range, or any other numeric value.
- **Architectural claim**: A Claim that asserts a structural relationship between components, files, or modules.
- **Behavioural claim**: A Claim that asserts runtime behaviour, including guarantees, side effects, and timing.
- **Guarantee**: A Claim that asserts the implementation will or will not perform a specific action under specified conditions.
- **Public interface claim**: A Claim that asserts the existence or signature of a public symbol, command, configuration key, MCP tool, or HTTP endpoint.

---

# Requirements

A Document passes verification only if every requirement below is satisfied. Each requirement is a binary rule. There is no "prefer", "consider", or "improve". Every requirement is "must".

## R1. Claims are supported

Every Claim in the Document must have supporting Evidence in the repository.

## R2. No silent weakening

If a Claim cannot be supported, the verification report must either:

- modify the Document to weaken the Claim,
- remove the Claim from the Document, or
- record a Warning that the Claim remains unchanged with the reason.

The Document must not be left with an unsupportable Claim without a corresponding Warning or Correction.

## R3. No silent strengthening

The Document must not be modified in a way that makes a Claim stronger than the Evidence supports. Inferring intent, intent-based rewriting, or paraphrase that adds a new assertion are forbidden.

## R4. Numeric claims are exact

Every Numeric Claim in the Document must match the Evidence exactly. If the Evidence shows `6`, the Document must say `6`, not "several" or "multiple".

## R5. Architectural claims match implementation

Every Architectural Claim must match the file layout, module boundaries, and component responsibilities found in the implementation at the time of verification.

## R6. Behavioural claims match implementation or tests

Every Behavioural Claim must match the runtime behaviour recorded in the implementation source, or in a passing test, or in an authoritative design document.

## R7. Guarantees have evidence

Every Guarantee must have Evidence that demonstrates the guarantee is enforced, not merely intended.

## R8. Public interface claims are verifiable

Every Public Interface Claim must reference a symbol, command, configuration key, tool, or endpoint that exists at the cited path.

## R9. Relative links resolve

Every Relative Link in the Document must resolve to a real file in the repository. An anchor-only link must resolve within the Document.

## R10. Referenced files exist

Every file path mentioned in the Document, including those inside code fences, must exist in the repository.

## R11. Terminology is single-valued

A concept in the Document must be referred to by one term throughout. "wave" and "pass" must not refer to the same concept. If a synonym appears, the Document is inconsistent and must be corrected.

## R12. Counts are consistent

A count stated in one section of the Document must equal the same count stated in any other section of the Document.

## R13. Editing policy is observed

A modification to the Document is permitted only when it satisfies the Editing Rules section. A modification that does not satisfy those rules is forbidden.

## R14. Author's style is preserved

Where a modification is permitted, the Document's existing terminology, section order, and voice must be preserved. The modification may change a Claim; the modification may not change the surrounding style.

## R15. Verification report is produced

The output of this skill must be a verification report that conforms to the Output Format section.

---

# Procedure

The Procedure is the fixed sequence of steps executed against the Document. Do not skip steps. Do not reorder steps. Do not add steps.

## Step 1 — Identify the Document

Record the Document path, its type, and its intended audience.

Allowed Document types: `README`, `llms.txt`, architecture documentation, user guide, developer guide, API documentation, design document, specification, ADR, tutorial.

Allowed audiences: end users, contributors, maintainers, AI agents, API consumers.

If the Document type is not in the allowed list, record a Warning and continue with the most restrictive type from the list.

## Step 2 — Extract Claims

Read the Document completely. Produce an internal list of every Claim in the Document. The list is not part of the report output.

## Step 3 — Verify Claims against Evidence

For every Claim in the internal list, locate Evidence in the repository.

### Evidence precedence

When sources disagree, accept Evidence in this order, from highest to lowest:

1. The implementation file referenced by the Claim, or the implementation file implied by the Claim when the Claim is generic.
2. A specification or design document cited by the implementation, or, when none exists, the closest authoritative design document for the subject.
3. A passing test that exercises the subject of the Claim.
4. Other documentation in the repository.

When no source of any kind supports a Claim, the Claim is unsupportable.

### Resolution of unsupportable Claims

For every unsupportable Claim, apply R2. Choose one of the three options in R2 for each unsupportable Claim. A different resolution may be applied to different Claims; a single resolution need not apply to all.

## Step 4 — Verify Navigation

For every Relative Link in the Document, resolve the target. For every file path mentioned in prose or in code fences, confirm the file exists. Record any failure as a Correction under R9 or R10.

## Step 5 — Verify Consistency

Walk the Document for terminology collisions, duplicate concepts, contradictory Claims, and stale references. Apply R11 and R12. Record collisions and inconsistencies as Corrections.

## Step 6 — Future-proof

Walk the Document for Claims that depend on transient implementation details. A Claim that names a specific internal function, line number, or version-specific behaviour must be flagged as a Warning with the reason: the Claim will become stale.

Counts that materially aid understanding must remain; they must be verified against Evidence in Step 3.

## Step 7 — Produce the report

Emit the verification report. The report must conform to the Output Format section.

---

# Document-specific extensions

The following extensions are added to the Procedure when the Document type matches. The extensions are additive: they add additional Claims to extract and additional Evidence checks. They do not remove steps.

## README

Additionally extract and verify Claims about: installation instructions, quick start, example commands, feature list, prerequisites, badges, screenshots, supported platforms.

## llms.txt

Additionally extract and verify Claims about: compliance with the llms.txt specification at <https://llmstxt.org/>, repository coverage, navigation quality, curated content, usefulness for AI agents. Additionally confirm that the Document is curated: not every file in the repository is listed, and each listed file is justified by the Document's purpose.

## API documentation

Additionally extract and verify Claims about: signatures, parameters, return values, examples, error conditions.

## Architecture documentation

Additionally extract and verify Claims about: component responsibilities, data flow, terminology, diagrams, implementation alignment.

---

# Editing Rules

A modification to the Document is permitted only when the modification does at least one of the following:

- corrects an unsupportable Claim,
- removes an unsupportable Claim,
- weakens an unsupportable Claim to a supportable one,
- resolves a terminology collision,
- resolves a count inconsistency,
- resolves a broken link or a missing-file reference,
- removes a transient implementation detail flagged in Step 6.

A modification is forbidden when the modification does only one of the following:

- rewrites prose for voice,
- reorganizes sections,
- renames concepts,
- adds new Claims,
- strengthens an existing Claim,
- changes the Document's intended audience,
- introduces a new term without a definition,
- removes Claims that are supportable.

When a permitted modification is applied, the modification must preserve the Document's existing terminology, section order, and voice per R14.

---

# Confidence levels

Classify every Observation as one of the following:

- **High**: The Observation is verified directly from the implementation. The cited file and line are present in the repository at the time of the verification pass.
- **Medium**: The Observation is supported by documentation, by a test, or by an authoritative design document, but the implementation was not directly inspected.
- **Low**: The Observation is an inference from repository structure, naming, or absence of evidence. An Observation must never be presented as fact when its Confidence is `Low`.

An Observation with Confidence `Low` must be recorded as a Warning, not as a Correction. A Correction requires Confidence `High` or `Medium`.

---

# Output Format

The verification report is a single markdown document. It contains the following sections, in this order. Omit a section only when it would be empty; do not omit a section that has content.

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
- **Confidence**: one of `High`, `Medium`, `Low`.

## Warnings

A bulleted list. One bullet per Warning. Each bullet has exactly these fields:

- **Location**: the section heading or line range in the Document.
- **Claim**: the Claim that triggered the Warning, quoted verbatim from the Document.
- **Reason**: one of "could not be verified", "may become stale", or "remains ambiguous".
- **Recommendation**: the action the Document's author should take, or "leave unchanged with reason".

## Verified highlights

A bulleted list. One bullet per verified Claim that materially aids understanding of the Document. Each bullet has exactly these fields:

- **Location**: the section heading or line range in the Document.
- **Claim**: the Claim, quoted verbatim.
- **Evidence**: the file path and line range or symbol that supports the Claim.
- **Confidence**: one of `High`, `Medium`, `Low`.

## Overall assessment

A single line, exactly one of:

- `Pass — all Requirements satisfied; document ready for publication.`
- `Pass with warnings — all Requirements satisfied; see Warnings.`
- `Fail — at least one Requirement violated and not corrected.`

A report is `Pass` only when every applicable Requirement in the Requirements section is satisfied. A report is `Fail` when any Requirement is violated and no Correction is recorded for it.

## Rationale

One short paragraph explaining the Overall Assessment. The rationale must reference Requirement identifiers, not impressions.

---

# Acceptance Criteria

The verification report is accepted only when every item below is true:

- Every Claim in the Document has supporting Evidence, or a Correction, or a Warning.
- Every Numeric Claim matches the Evidence exactly.
- Every Architectural Claim matches the implementation.
- Every Behavioural Claim matches the implementation, a test, or an authoritative design document.
- Every Guarantee has Evidence that it is enforced.
- Every Public Interface Claim references an existing symbol, command, configuration key, tool, or endpoint.
- Every Relative Link resolves.
- Every file path mentioned in the Document exists.
- Terminology is single-valued throughout the Document.
- Counts are consistent across the Document.
- The verification report conforms to the Output Format section.
- The Overall Assessment is one of the three values in the Output Format section.
- Every Correction has Confidence `High` or `Medium`.
- Every Warning has Confidence `High`, `Medium`, or `Low` and includes a Reason and a Recommendation.
