---
name: all-finding-types-stress
description: 'Edge case fixture: a 200-line stress fixture designed to trigger all five finding types (ambiguity + contradiction + cognitive + coverage + hygiene) in a single document.'
---

# All Finding Types Stress Fixture

This fixture is intentionally dense with known issues across all five detection categories. Use it to verify that the analyzer can surface multiple, distinct issues in a single pass.

> **Test metadata:** 12 expected issues across 5 categories. Each labeled issue below maps to one detection category.
> Expected analyzer category: `mixed` — this fixture should produce findings in ambiguity, contradiction, cognitive_load, coverage_gap, AND hygiene codes.

## Role

You are a project coordinator who manages software releases. You must be both detailed and concise. You are an expert.

## Direct Contradictions

**[CON-1] Code Review Gate**
All code changes must have at least one approved peer review before merging — reject any release that includes unreviewed changes.
Emergency hotfixes may be deployed directly to production without code review in order to minimise incident duration.

**[CON-2] Test Execution**
Always run the full regression test suite before approving any release. Block any release that skips or bypasses tests.
Never run the test suite before a hotfix deployment — tests take too long and delay incident resolution.

## Ambiguities

**[AMB-1] Complexity Threshold**
Flag any endpoint implementation that is significantly complex and recommend decomposition or simplification strategies.

**[AMB-2] Recency Window**
Review all recent changes to the API surface and flag any that introduce regressions against existing behaviour.

**[AMB-3] Team Alignment**
Before finalising your recommendations, validate the approach with the team to ensure alignment.

## Cognitive Load

**[COG-1] Multi-Track Approval**
The deployment requires sign-off from security, operations, AND the engineering director. If security is unavailable AND the deployment is non-critical, abort. If security is unavailable AND the deployment is critical, proceed without security sign-off but escalate to the CISO. If operations is unavailable AND the deployment is non-critical, abort. If operations is unavailable AND the deployment is critical, proceed but document the bypass. If the director is unavailable AND the deployment is non-critical, abort. If the director is unavailable AND the deployment is critical, proceed but escalate to the VP.

**[COG-2] Conditional Rollback**
If the canary error rate exceeds 0.5% AND the error is reproducible AND the error is not in the known-flaky list, roll back. If the canary error rate exceeds 0.5% AND the error is reproducible AND the error IS in the known-flaky list, extend monitoring to 60 minutes and re-evaluate. If the canary error rate exceeds 0.5% AND the error is NOT reproducible, extend monitoring to 90 minutes and re-evaluate. If the canary error rate is between 0.3% and 0.5% AND the error rate is increasing, halt the rollout. If the canary error rate is between 0.3% and 0.5% AND the error rate is stable, proceed with caution.

## Coverage Gaps

**[COV-1] No Fallback for Unavailable Director**
The deployment procedure does not specify what to do if the engineering director AND the VP are both unavailable simultaneously. The current text says "escalate to the VP if the director is unavailable" but does not address the case where both are unavailable.

**[COV-2] No Definition of "Critical"**
The procedure references "critical" deployments throughout but never defines what makes a deployment "critical" versus "non-critical". A reader cannot determine from the procedure alone whether their deployment qualifies as critical.

## Hygiene Issues

**[HYG-1] Verbatim Repetition**
The following text is repeated verbatim from the previous section: "All code changes must have at least one approved peer review before merging."

**[HYG-2] Vague Directive**
Identify endpoints that are no longer serving their original purpose and recommend that they be cleaned up.

## Notes

This fixture exists solely to stress-test the analyzer's ability to detect multiple, distinct issue types in a single document. It is not a realistic skill.

> **Test metadata:** 12 expected issues. The fixture is intentionally compressed to test detection breadth.
