# mock_skills_4 — Adversarial Design Notes

Each file in this batch is designed to defeat a well-tuned analyzer. The issues are real
but expressed in ways that look legitimate, authoritative, or correct at a glance.

---

## test-contradictions-hard (cloud cost governance)

**What makes it hard:** Contradicting pairs are placed 3–4 sections apart so the model
cannot see both sides in a short context window.

| Pair | Pattern |
|---|---|
| HARD-DIRECT-1 ($500 = high cost) ↔ HARD-DIRECT-5 ($200–800 = medium cost) | Numeric range overlap — the band $500–800 is simultaneously high-cost and medium-cost |
| HARD-DIRECT-2 (no exceptions) ↔ HARD-DIRECT-8 (dev/sandbox exempt) | Exception-swallows-rule — the exempt category is broad enough to negate the rule |
| HARD-DIRECT-3 (idle = CPU <5% / 7 days) ↔ HARD-DIRECT-9 (rightsizing = CPU <10% / 5 days) | Definition overlap — a resource at 7% CPU / 6 days is both idle and a rightsizing candidate |
| HARD-DIRECT-4 (RI ≥60% baseline) ↔ HARD-DIRECT-10 (RI ≤40% total capacity) | Floor vs ceiling — both cannot be satisfied simultaneously |
| HARD-DIRECT-6 (CTO approval) ↔ HARD-DIRECT-12 (team leads can grant exemptions) | Escalation approver conflict — two sections name different authorities for the same decision |
| HARD-DIRECT-7 (anomaly = >20% MoM) ↔ HARD-DIRECT-11 (anomaly = >15% WoW) | Same term, two incompatible definitions in different sections |
| HARD-DIRECT-13 (auto-scaling must be enabled) ↔ HARD-DIRECT-15 (auto-scaling disabled by default) | Enable/disable policy conflict for non-production stateless workloads |
| HARD-DIRECT-14 (audit logs hot tier 180 days) ↔ unlabeled (all objects to cold tier after 90 days) | Scope overlap — audit logs are a subset of "all objects" |

---

## test-ambiguities-hard (data breach response)

**What makes it hard:** Every undefined term has legal or regulatory weight, so it *sounds*
like a precise industry-standard phrase. Practitioners often assume shared definitions exist
(they don't, in this document).

| Type | Examples |
|---|---|
| Undefined legal threshold | "material", "significant risk", "substantial risk" |
| Undefined timeframe | "timely", "promptly", "without undue delay", "recently" |
| Undefined scope | "all affected parties", "all relevant systems", "sensitive data" |
| Undefined actor | "senior management", "relevant authorities", "appropriate team" |
| Undefined standard | "appropriate technical measures", "standard industry practice", "adequate controls" |
| Undefined effort | "reasonable steps", "best efforts" |
| Undefined quantity | "small number of records", "majority of affected individuals" |
| Undefined condition | "if harm is likely" — no likelihood threshold or decision-maker named |

---

## test-coverage-gaps-hard (DevSecOps security checklist)

**What makes it hard:** The checklist is genuinely thorough on the *obvious* domains.
An analyst skimming it would conclude it is comprehensive. The gaps are in less-visible
but critical security areas.

**Visible (covered):** OWASP Top 10, authentication, MFA, encryption in transit/at rest,
container image CVE scanning, network policies, access logging, SIEM shipping, CI/CD
secret scanning, SCA dependency scanning.

**Silent gaps (not mentioned anywhere):**

| Gap | Why a well-written checklist would include it |
|---|---|
| Secrets management lifecycle | Scanning for hardcoded secrets ≠ rotating/scoping live secrets |
| Rate limiting / DDoS protection | Covered auth but not abuse/volume attacks |
| Supply chain security (SBOM, image signing) | CVE scanning ≠ provenance verification |
| Security regression test suite in CI | Secret scanning ≠ running security-specific test cases |
| Privileged access management / JIT access | Least-privilege IAM ≠ PAM tooling for elevated sessions |
| Data residency / cross-border transfer | Encryption ≠ where data physically resides |
| Vulnerability disclosure policy | Internal scanning ≠ how external researchers report findings |
| Security training requirements | Controls ≠ human/process layer |
| TLS certificate lifecycle management | "Use TLS" ≠ "monitor cert expiry, automate renewal" |
| Security alert response SLAs | Logging ≠ time-to-respond commitments |
| Third-party vendor security assessment | First-party app ≠ vendor posture |
| DR environment security | Production security ≠ DR site access controls |
| Client-side / mobile security | Server-side controls ≠ CSP, SRI, mobile storage |
| Data classification / security tagging | Encryption ≠ sensitivity labels on resources |
| Penetration testing schedule | Automated scanning ≠ human-led pen testing |

---

## test-obligation-hard (healthcare records management)

**What makes it hard:** Every weak instruction uses a strong-sounding verb first
("ensure", "verify", "implement", "apply"). The hedge is buried later in the clause.
The structure `<strong verb>, <hedge phrase>, that <requirement>` reads as compliance
language but is not enforceable.

| Pattern | Example hedge | Semantics |
|---|---|---|
| "ensure, where practicable, that" | "where practicable" | can always claim impracticable |
| "take reasonable steps to" | "reasonable" | infinitely arguable standard |
| "use best endeavours / best efforts" | "best" | no objective measure |
| "verify, as appropriate, that" | "as appropriate" | discretion to skip |
| "implement adequate controls" | "adequate" | undefined standard |
| "review on a periodic basis" | "periodic" | no defined frequency |
| "respond in a timely manner" | "timely" | no defined timeframe |
| "document in the format required" | "required" by unnamed document | undefined |
| "proportionate remediation" | "proportionate" | undefined measure |
| double hedge: "where possible and as appropriate" | two hedges compound | practically optional |

---

## test-circular-hard (financial risk management)

**What makes it hard:** The domain jargon sounds self-contained and precise. The circular
reasoning is hidden behind technical vocabulary that implies a real definition exists.

| Label | Pattern | The loop |
|---|---|---|
| HARD-CIRC-1 | Near-synonym | credit risk → credit loss → credit risk |
| HARD-CIRC-2 | Tautological | NPL defined by NPL criteria; NPL criteria define NPL |
| HARD-CIRC-3 | 3-hop | default event → credit obligation → obligor → default event |
| HARD-CIRC-4 | Reciprocal jargon | VaR → confidence interval → VaR |
| HARD-CIRC-5 | Near-synonym | mark-to-market → current market price → mark-to-market |
| HARD-CIRC-6 | Tautological | liquid asset → "readily convertible" defined as what liquid assets can do |
| HARD-CIRC-7 | 3-hop | liquidity stress → funding gap → liquidity buffer → liquidity stress |
| HARD-CIRC-8 | Reciprocal jargon | operational loss event → operational risk loss → loss event |
| HARD-CIRC-9 | Near-synonym | residual risk defined using inherent risk; inherent risk defined using residual risk |
| HARD-CIRC-10 | Tautological | risk appetite breach defined by risk appetite statement; statement defines breach threshold |

---

## test-dead-hard (Kubernetes cloud-native deployment)

**What makes it hard:** Every deprecated reference is syntactically valid and would have
been correct for an earlier version of the tool. The file provides a Current Tool Stack
section, so the analyzer has internal context — but it must know *which* features were
removed in *which* version.

| Label | Deprecated feature | Removed/disabled |
|---|---|---|
| HARD-DEAD-1 | `apiVersion: extensions/v1beta1` for Deployments | Removed in K8s 1.16; use `apps/v1` |
| HARD-DEAD-2 | `kubectl run --generator=run-pod/v1` | `--generator` flag removed in K8s 1.18 |
| HARD-DEAD-3 | `PodSecurityPolicy` / `policy/v1beta1` | Removed in K8s 1.25; use Pod Security Admission |
| HARD-DEAD-4 | `kubectl get componentstatuses` | Deprecated 1.19, removed in 1.27 |
| HARD-DEAD-5 | `kubernetes.io/ingress.class` annotation | Superseded by `ingressClassName` field in K8s 1.18+ |
| HARD-DEAD-6 | `helm init` | Removed in Helm 3 (no Tiller) |
| HARD-DEAD-7 | `kubectl apply --server-dry-run` | Renamed to `--dry-run=server` in K8s 1.18 |
| HARD-DEAD-8 | `::set-output` workflow command | Deprecated Oct 2022, disabled Feb 2023 |
| HARD-DEAD-9 | `::save-state` / `get-state` commands | Deprecated alongside `set-output` |
| HARD-DEAD-10 | `terraform 0.12upgrade` | Removed in Terraform 0.16+ |
| HARD-DEAD-11 | `eksctl create cluster --version=1.21` | EKS 1.21 reached end-of-life |
| HARD-DEAD-12 | `apiVersion: argoproj.io/v1alpha1` Application | Superseded by `argoproj.io/v1` in ArgoCD 2.x |

---

## test-mixed-hard (ML model deployment governance)

**What makes it hard:** All 6 sub-types appear in a single coherent document. Each issue
uses the hardest variant of its pattern. The two coverage gaps have no label in the body —
they are missing topics in an otherwise thorough guide.

| Label | Sub-type | Adversarial quality |
|---|---|---|
| MIX-H-WASTE-1 | context_waste — preamble | 170-word historical paragraph before first instruction; contains real information so isn't obviously pure waste |
| MIX-H-WASTE-2 | context_waste — verbatim repetition | Drift monitoring instruction copied verbatim to a later section; second occurrence also carries a conflicting threshold |
| MIX-H-DIRECT-1 | contradiction | "All models must provide explainability" vs unlabeled "rule-based systems are exempt from explainability requirement" |
| MIX-H-DIRECT-2 | contradiction | Retraining at 5% drift in one section vs 10% drift in the repeat section |
| MIX-H-AMBIG-1 | ambiguity — undefined threshold | "significant performance degradation" — no metric, no value |
| MIX-H-AMBIG-2 | ambiguity — undefined actor | "the appropriate team must sign off" — no team named |
| MIX-H-OBLIG-1 | obligation_strength | "ensure, where practicable" — standard hedge on a safety-critical instruction |
| MIX-H-OBLIG-2 | obligation_strength | "take reasonable steps" |
| MIX-H-RESP-1 | responsibility_ambiguity — passive voice | "a fairness review must be conducted" — no named actor |
| MIX-H-RESP-2 | responsibility_ambiguity — undefined judgment | "use your judgment" to determine if bias is actionable |
| MIX-H-DEAD-1 | dead_instruction | MLflow `conda_env` parameter deprecated in MLflow 2.x; use `pip_requirements` |
| MIX-H-DEAD-2 | dead_instruction | SageMaker `RetainAllVariantProperties` flag removed from `update_endpoint` in Boto3 SDK v1.34+ |
| MIX-H-CIRC-1 | circular_definition | Model drift detected when score > drift threshold; drift threshold is the score above which drift is detected |
| MIX-H-CIRC-2 | circular_definition | Feature importance quantifies explainability; explainability is aggregated feature importance |
| MIX-H-GAP-1 | coverage_gap (silent) | No rollback procedure — guide covers deploy, monitor, retire but never how to roll back a bad model version |
| MIX-H-GAP-2 | coverage_gap (silent) | No training data versioning or lineage — guide tracks model versions but not the dataset versions they were trained on |
