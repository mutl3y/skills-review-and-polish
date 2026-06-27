---
name: api-design-reviewer
description: Reviews REST API designs, proposals, and pull requests for consistency, developer experience, and standards compliance.
---

# API Design Review

Use this skill to evaluate API proposals and pull requests that modify the public API surface.

> **Test metadata:** 20 injected ambiguities (AMBIG-1 through AMBIG-20).
> Each numbered instruction below contains at least one term or phrase where a model could take
> clearly different concrete actions depending on interpretation.
> Expected analyzer category: `ambiguity` for all 20.

## Review Instructions


**[AMBIG-1] Complexity Threshold**
Flag any endpoint implementation that is significantly complex and recommend decomposition or simplification strategies.

**[AMBIG-2] Recency Window**
Review all recent changes to the API surface and flag any that introduce regressions against existing behaviour.

**[AMBIG-3] Team Alignment**
Before finalising your recommendations, validate the approach with the team to ensure alignment.

**[AMBIG-4] Breaking Change Definition**
Reject any change that introduces breaking changes to existing API consumers.

**[AMBIG-5] Cleanup Action**
Identify endpoints that are no longer serving their original purpose and recommend that they be cleaned up.

**[AMBIG-6] Payload Size**
Ensure that all response payloads are an appropriate size for their intended use case.

**[AMBIG-7] Standards Compliance**
All API designs must strictly follow best practices for REST API development.

**[AMBIG-8] Performance Improvement**
Recommend changes that would meaningfully improve API performance wherever you identify opportunities.

**[AMBIG-9] Security Posture**
Flag any endpoint that is not properly secured and provide specific remediation recommendations.

**[AMBIG-10] Related Endpoints**
When a proposed change affects one endpoint, always review all related endpoints for consistency.

**[AMBIG-11] Error Handling**
Verify that all endpoints handle errors gracefully and return appropriate error responses.

**[AMBIG-12] Unusual Patterns**
If a request or response pattern appears unusual, flag it for additional scrutiny and design review.

**[AMBIG-13] Documentation Trigger**
Update the API reference documentation as needed following any structural changes to the API.

**[AMBIG-14] Consumer Field Recommendations**
The API consumer may need additional response fields in certain use cases — recommend additions where relevant.

**[AMBIG-15] Pagination**
Consider recommending pagination for any endpoint that could return a large number of results.

**[AMBIG-16] Legacy Endpoint Identification**
Identify any legacy endpoints in the API and recommend appropriate migration paths for their consumers.

**[AMBIG-17] Query Parameter Count**
Flag any endpoint that accepts too many query parameters as overly complex and recommend consolidation.

**[AMBIG-18] Response Latency Expectation**
Ensure all endpoints respond within a reasonably fast timeframe appropriate to their intended use.

**[AMBIG-19] Authentication Configuration**
Confirm that authentication is properly configured for every endpoint before approving any change.

**[AMBIG-20] Finding Prioritisation**
Prioritise the most important issues in your recommendations so that engineering teams can address them in the right order.
