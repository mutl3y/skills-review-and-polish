---
name: devsecops-security-review-checklist
description: Guides security engineers through comprehensive pre-production security reviews for cloud-native applications, covering OWASP Top 10, authentication, encryption, dependency scanning, container security, network controls, and CI/CD pipeline security.

# DevSecOps Security Review Checklist

Use this skill to conduct pre-production security reviews of cloud-native applications before they are promoted to production.

## OWASP Top 10

Every production application must be reviewed against the OWASP Top 10 before go-live. All items must be explicitly confirmed as Not Applicable or Mitigated in the review record.

**Injection (A03):** Verify that all database interactions use parameterised queries or an ORM that prevents SQL injection. No raw string concatenation in query construction. Validate at system boundaries: CLI args, HTTP headers, file names, form fields.

**Broken Authentication (A07):** Confirm that session tokens are generated with a cryptographically secure RNG, are invalidated on logout, and expire after the configured idle timeout. Brute-force protection must be in place on authentication endpoints.

**Cross-Site Scripting (A03):** Verify output encoding is applied to all user-controlled values before they are rendered in HTML context. Content-Security-Policy headers must be present and must not include `unsafe-inline` without a nonce.

**Broken Access Control (A01):** Confirm that every API endpoint enforces authorisation checks on the server side. Client-side role checks are not sufficient. Verify that horizontal privilege escalation (accessing another user's resources by ID manipulation) is prevented.

**Security Misconfiguration (A05):** Confirm that default credentials, unnecessary services, and debug endpoints have been removed. Stack traces must not be exposed in production error responses.

**Insecure Deserialization (A08):** Verify that untrusted data is not deserialised before type and integrity checks are performed. Flag any use of native serialisation formats (Java serialisation, Python pickle) with user-controlled input.

**Using Components with Known Vulnerabilities (A06):** Software composition analysis (SCA) must be run against all direct and transitive dependencies. No HIGH or CRITICAL CVEs may be present in production unless a documented exception with a risk acceptance date is on file.

**Insecure Direct Object References:** Confirm that resource identifiers exposed in URLs and request bodies are validated against the authenticated user's permission scope before the underlying data is returned.

**XML External Entities (XXE):** If the application parses XML, confirm that external entity processing is disabled in the parser configuration.

**Server-Side Request Forgery (SSRF):** Verify that any functionality that fetches a URL provided by the user validates the target against an allow-list of permitted schemes and destinations.

## Authentication and Authorisation

All authentication must use the organisation's approved identity provider. Direct username/password authentication against application-managed credential stores is not permitted for new applications.

Confirm that role-based access control (RBAC) is implemented and that roles are granted on a least-privilege basis. Every role definition must be documented. Access reviews must be scheduled at least annually.

Multi-factor authentication must be enforced for all administrative interfaces, internal dashboards, and cloud console access. SMS-based OTP is permitted only where hardware tokens are not operationally feasible.

Service-to-service authentication must use short-lived tokens or mutual TLS. Long-lived API keys are only permitted where the consuming service cannot support token-based auth, and must be stored in a secrets management system, not in environment variables or configuration files.

## Encryption

**In transit:** All data in transit between clients and servers, and between internal services, must be encrypted using TLS 1.2 or higher. TLS 1.0 and 1.1 must be explicitly disabled. Cipher suites must be restricted to those approved in the organisation's cryptographic standards.

**At rest:** All persistent data stores containing personal data or credentials must encrypt data at rest using AES-256 or equivalent. Encryption keys must be managed in the organisation's approved key management service, not stored alongside the data they protect.

Database backups must be encrypted with the same or stronger controls as the primary data store.

## Container and Image Security

All container images must be scanned for known CVEs before being pushed to the production registry. Images with HIGH or CRITICAL vulnerabilities must not be deployed to production without a documented exception.

Container images must be built from approved base images maintained by the platform team. Unapproved public images must not be used directly in production without security review.

Containers must not run as root. The `runAsNonRoot: true` constraint must be set in the pod security context. Read-only root filesystems must be used where operationally feasible.

## Network Controls

Network policies must be configured to restrict pod-to-pod communication to explicitly permitted traffic flows. Default-deny ingress and egress policies must be applied and then selectively opened.

Ingress traffic must pass through the ingress controller. Direct exposure of application pods via NodePort or ExternalIP is not permitted without security review.

All internal traffic between services in different security zones must pass through the service mesh where one is deployed. Unencrypted intra-cluster traffic is not acceptable for services handling personal data.

## CI/CD Pipeline Security

All source repositories must have secret scanning enabled. Detected secrets must be rotated immediately and the finding must be recorded in the incident register regardless of whether the secret has been confirmed exposed.

Dependency updates must go through the standard pull request process and must trigger the full test and scan pipeline. Automatic merging of dependency updates without pipeline completion is not permitted.

Pipeline execution must use the principle of least privilege. CI runners must not have production credentials. Deployment credentials must be scoped to the minimum permissions required for the deployment action.

## Audit Logging

All authentication events, authorisation failures, and administrative actions must be logged. Log entries must include a timestamp, the identity of the requesting principal, the action performed, and the outcome.

Logs must be shipped to the centralised SIEM within 60 seconds of generation. Local log storage may be used as a buffer but must not be the sole destination.

Log retention must comply with the applicable regulatory requirement for the data classification of the service. At minimum, security logs must be retained for 12 months.

Logs must be tamper-evident. Write access to the log store must be restricted to the log ingestion pipeline; no application may have the ability to delete or modify its own audit logs.