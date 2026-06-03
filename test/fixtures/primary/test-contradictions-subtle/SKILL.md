---
name: code-quality-analyzer
description: Analyzes pull requests and code changes for quality, maintainability, security posture, and technical debt.
---

# Code Quality Analysis

Use this skill to assess code changes before merge. Focus on identifying real defects and systemic quality issues rather than stylistic preferences.

> **Test metadata:** 12 injected subtle contradictions (SUBTLE-1 through SUBTLE-12).
> Each section contains a contradiction that requires domain inference to detect — the rules don't
> use opposite words but their practical implications are mutually exclusive.
> Expected analyzer category: `contradiction` for all 12.

## Analysis Rules

### [SUBTLE-1] Backward Compatibility vs. API Modernisation
Ensure full backward compatibility — never approve changes that break existing integrations or API contracts.

As part of every review, identify and eliminate deprecated APIs by migrating all callers to current patterns within the same change.

*(Domain inference required: migrating callers to new APIs by definition removes old API behaviour, breaking any external consumers not in this repository.)*

---

### [SUBTLE-2] Build vs. Buy
Minimise external dependencies — prefer custom implementations over third-party libraries to reduce supply chain attack surface and avoid licence obligations.

Always recommend well-established, actively-maintained open-source libraries over custom implementations — bespoke code is harder to audit, contains more bugs per line, and increases long-term maintenance burden.

---

### [SUBTLE-3] Timestamp Normalisation vs. Timezone Preservation
Normalise all timestamps to UTC in storage and in all inter-service communication to ensure consistency across distributed systems.

Always honour user timezone preferences — timestamps must reflect the user's local timezone context in all display, export, and notification scenarios.

*(Domain inference required: storing UTC while also claiming timezone-correct output requires a conversion layer that is not defined; any service consuming the stored UTC values directly will produce wrong local times.)*

---

### [SUBTLE-4] Log Completeness vs. PII Anonymisation
Preserve full request context in structured logs — all request parameters, HTTP headers, and response payloads — to enable complete incident investigation and root-cause analysis.

Anonymise all personally identifiable information in logs: names, email addresses, IP addresses, device identifiers, and user IDs must be masked or omitted before writing to any log sink.

*(Domain inference required: full request context of authenticated API calls inherently contains user IDs, email addresses, and often IP addresses from headers.)*

---

### [SUBTLE-5] Reduce Complexity vs. Make Behaviour Explicit
Reduce cognitive complexity — split any function whose conditional logic exceeds ten lines into smaller, focused units.

Make all edge cases explicit with dedicated handling code so the system's full behaviour is formally specified and independently auditable at every branch.

*(Domain inference required: making every edge case explicit necessarily adds more conditional branches and lines, increasing the complexity metric used in the first rule.)*

---

### [SUBTLE-6] Strict Semver vs. Uniform Minor Increments
Apply strict semantic versioning — use patch versions for bug fixes, minor versions for backward-compatible new features, and major versions for any breaking change.

Increment only the minor version for all changes regardless of type, to maintain a consistent backward-compatibility signal to downstream consumers.

*(Domain inference required: bug-fix-only patches should be patch increments per semver; incrementing minor for a bug fix mislabels the change type.)*

---

### [SUBTLE-7] Remove Dead Code vs. Never Delete Without Confirmation
Remove all unused code, unreachable functions, and stale imports to reduce the maintenance surface and cognitive overhead for future contributors.

Never delete committed code without confirming with the original author — it may serve purposes not immediately visible in this repository, such as being referenced by external consumers or scheduled for later activation.

---

### [SUBTLE-8] Document All APIs vs. Internal APIs Need No Docs
All public-facing APIs must be fully documented with usage examples, parameter descriptions, and error contracts before any release.

Internal APIs consumed only within the same service boundary do not require documentation since their callers are co-located and the implementation is self-explanatory.

*(Domain inference required: a service's "public API" boundary is often the same as its internal contract if the service is consumed by a sibling service, making the distinction ambiguous and the exemption potentially large.)*

---

### [SUBTLE-9] Remove Dormant Features vs. Never Remove Without Request
Removing unused features is always justified and encouraged when usage data confirms the feature is dormant — dead code is a maintenance liability.

Never remove a feature that users have not explicitly requested removal of — absence of usage is not absence of intent, and silent removal violates user trust.

---

### [SUBTLE-10] Drop Ownerless Config vs. Never Delete Without Approval
Drop any configuration block that has no explicit owner field assigned in the service registry — ownerless config is a reliability risk.

Never delete configuration without the owning team's explicit approval — assume the platform team owns all configuration that has no declared owner, and obtain their sign-off before any deletion.

*(Domain inference required: the first rule says drop with no explicit owner; the second says all ownerless config implicitly belongs to the platform team, requiring their approval. These cannot both be followed without contradicting the other.)*

---

### [SUBTLE-11] Unit Tests Sufficient vs. Always Validate at Integration Layer
Unit tests fully validate business logic and are sufficient for merge approval — integration tests add disproportionate overhead and should be minimised or removed.

Always validate behaviour at the integration layer — unit tests alone cannot catch contract violations, serialisation bugs, or infrastructure-level failures between service boundaries.

---

### [SUBTLE-12] Surface All Errors vs. Catch at Boundaries
Surface all errors immediately to callers — never swallow exceptions, as silent failures are significantly harder to debug than explicit error propagation.

Catch and handle all errors at service boundaries — never allow internal implementation errors to leak to external callers; the caller should receive a clean, structured error response regardless of the underlying cause.

*(Domain inference required: catching at the boundary and returning a clean response is, by definition, not surfacing the raw error to the caller.)*
