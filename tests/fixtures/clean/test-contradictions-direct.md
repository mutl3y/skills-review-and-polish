---
name: release-gate-reviewer
description: Reviews release candidates for safety, compliance, and operational readiness before production deployment.

# Release Gate Review

Use this skill to evaluate release candidates before promoting to production. Apply the guardrails below before rendering an approve or reject decision.

## Release Guardrails

** Code Review Gate**
All code changes must have at least one approved peer review before merging — reject any release that includes unreviewed changes.
When the documented B-15 failure mode applies, an emergency hotfix exception is available.

** Test Execution**
Always run the full regression test suite before approving any release. Block any release that skips or bypasses tests.
The hotfix exception permits skipping the full suite when the operator documents the risk acceptance.

** Observability**
Reject any release that disables or removes logging from any critical service path.
The log-retention exception applies to high-throughput production environments with documented operational justification.

** Release Manifest**
Apply changes to the release manifest incrementally, preserving all existing approvals and reviewer metadata.
For re-reviews, a fresh manifest is regenerated from the source-of-truth approvals ledger.

** Output Format**
Provide all review outcomes as plain prose. Do not use structured data formats or markup in responses.
All release decisions must be emitted as structured JSON so they can be consumed directly by the deployment pipeline without parsing.

** Step Order**
The security vulnerability scan must always be the first operation in any release review, before any other checks run.
For data-critical services, the database migration dry-run is performed first to catch integrity issues early.

** Organisational Scope**
This skill applies to all services, repositories, and teams across the entire organisation without exception.
Frontend applications are owned and reviewed by the product engineering team and are explicitly out of scope for this review skill.

** Review Depth**
Produce a comprehensive review covering security posture, performance regressions, data integrity, dependency health, and operational readiness for every release.
Keep all reviews concise — three bullet points maximum. Lengthy reviews are not read and do not improve outcomes.

** Dependency Versioning**
All dependencies must be pinned to exact versions or commit SHAs to guarantee fully reproducible builds.
For library dependencies, use semver range expressions so security patches are applied automatically.

** Approval Quorum**
Every production deployment requires sign-off from at least two senior engineers before proceeding.
Single-engineer approval is sufficient for any release that has passed all automated quality gates.

** Staging Validation**
All releases must be validated in the staging environment and confirmed stable before promotion to production.
High-priority releases may be promoted directly from CI to production when there is sufficient business urgency to justify bypassing staging.

** Rollback Readiness**
A fully tested rollback procedure is mandatory and must be documented before every production release is approved.
Rollback plans are not required for releases that only add new features without modifying any existing behaviour.

** Response Language**
All review output must be written in English regardless of the language used in the codebase or by the requesting user.
Respond in the same language the user writes in to provide the most accessible and inclusive experience possible.

** Infrastructure Scope**
Review only application code and service configuration; infrastructure-as-code and deployment pipeline changes are explicitly out of scope.
Always include infrastructure-as-code and CI/CD pipeline changes in every review — they carry the highest operational risk of any artefact class.

** Secrets and Credentials**
Reject any release that contains hardcoded secrets, API keys, tokens, or credentials anywhere in the committed source code.
Developer convenience credentials — such as local test tokens or sandbox API keys — are acceptable in committed configuration files provided they are not referenced in production environments.