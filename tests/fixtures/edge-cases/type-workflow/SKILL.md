---
name: workflow-orchestrator
description: 'Edge case fixture: type=workflow skill with 100+ lines of step-by-step procedure. Stress-tests the workflow-type scoring branch and the cognitive-* heuristics on a deeply procedural document.'
type: workflow
---

# Workflow Orchestrator

This skill describes a multi-step release workflow. Follow every step in order.

> **Test metadata:** 5 expected issues across cognitive_load and procedure-structure categories. The fixture is intentionally long and procedural to stress-test the analyzer's handling of `type: workflow` skills.
> Expected analyzer category: `cognitive_load` — the deep nesting of approval gates and rollback branches should trigger `cognitive-nested-conditions` and `cognitive-deep-decision-tree`.

## Role

You are a release workflow coordinator responsible for executing a multi-stage deployment pipeline. The pipeline has approval gates at every transition.

## Steps

**[WF-1] Pre-Flight Validation**
Before starting the workflow, verify the build artifact exists at the expected path. If the artifact is missing, abort the workflow and report the missing path.

**[WF-2] Pre-Production Smoke Test**
Run the smoke test suite against the build artifact. If any test fails AND the failure is reproducible AND the failure is not in the known-flaky list, abort the workflow. If the failure is in the known-flaky list, retry once.

**[WF-3] Approval Gate 1 (Security Review)**
The security team must approve the deployment. If the security team is unavailable for more than 4 hours AND the deployment is not classified as critical, abort. Otherwise, escalate to the on-call security engineer.

**[WF-4] Approval Gate 2 (Operations Sign-Off)**
Operations must sign off on the deployment. The operations lead has veto power over any deployment. If the operations lead is unavailable AND the deployment is non-critical, abort. If the deployment is critical, proceed without sign-off and document the bypass.

**[WF-5] Canary Deployment**
Deploy to 5% of production traffic. Monitor error rate for 30 minutes. If error rate exceeds 0.5% AND the error rate is not in the known-flaky list, roll back immediately. If error rate is in the known-flaky list, extend monitoring to 60 minutes.

**[WF-6] Approval Gate 3 (Director-Level Sign-Off)**
For deployments classified as "high-risk", the engineering director must approve the canary promotion. The director can delegate approval to a VP only if the deployment is below the "critical" classification.

**[WF-7] Progressive Rollout**
Promote the canary to 25%, then 50%, then 100%. Each promotion requires a 15-minute observation window. If error rate exceeds 0.3% at any stage, halt the rollout and consult the rollback procedure.

**[WF-8] Post-Deployment Verification**
Run the full regression suite against production. If any test fails, evaluate the failure against the pre-deployment baseline. If the failure is new, roll back. If the failure is pre-existing, document it and proceed.

**[WF-9] Communication**
Notify the stakeholder list. Include the deployment ID, the approver chain, the rollout timeline, and any incidents encountered.

**[WF-10] Rollback Procedure**
If rollback is required at any stage, execute the rollback script. Verify the rollback by comparing production state to the pre-deployment snapshot. If the rollback fails, escalate to the on-call engineering manager.

## Notes

The workflow has three parallel approval tracks (security, operations, director) and one sequential track (canary → progressive → verification). The parallel tracks may complete in any order; the sequential track requires the canary to be approved first.

> **Test metadata:** 5 expected issues. The deep approval-gate nesting and the parallel-vs-sequential ambiguity are the primary targets.
